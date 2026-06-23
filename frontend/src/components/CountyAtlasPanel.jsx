import React, { useMemo, useState } from "react";
import * as turf from "@turf/turf";
import {
  Building2,
  ChevronRight,
  Layers3,
  Map,
  MapPin,
  Route,
  Search,
  Waves,
  X,
} from "lucide-react";

function featureName(feature, property) {
  return feature?.properties?.[property] || "";
}

function countyNumber(feature) {
  const digits = String(feature?.properties?.ADM1_PCODE || "").replace(/\D/g, "");
  return digits ? String(Number(digits)).padStart(3, "0") : "---";
}

function countyArea(feature) {
  if (!feature) return null;
  try {
    return turf.area(feature) / 1_000_000;
  } catch (error) {
    return null;
  }
}

function formatArea(value) {
  if (!Number.isFinite(value)) return "Unavailable";
  return `${Math.round(value).toLocaleString()} km²`;
}

const liveFeatureLayers = [
  { key: "hospitals", label: "Hospitals", icon: Building2 },
  { key: "water", label: "Water", icon: Waves },
  { key: "roads", label: "Roads", icon: Route },
  { key: "buildings", label: "Buildings", icon: MapPin },
];

export default function CountyAtlasPanel({
  counties,
  selectedCounty,
  selectedSubCounty,
  selectedWard,
  subcounties,
  wards,
  lockedCounty = "",
  segmentClass,
  segmentationVisible,
  segmentationStats,
  onCountySelect,
  onSubCountySelect,
  onWardSelect,
  onClear,
  onFeatureLayerChange,
}) {
  const [query, setQuery] = useState("");
  const [subcountyQuery, setSubcountyQuery] = useState("");
  const [wardQuery, setWardQuery] = useState("");

  const countyName = featureName(selectedCounty, "ADM1_EN");
  const subcountyName = featureName(selectedSubCounty, "ADM2_EN");
  const wardName = featureName(selectedWard, "shapeName") || featureName(selectedWard, "ADM3_EN");
  const area = countyArea(selectedCounty);

  const countyOptions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return [...(counties?.features || [])]
      .filter((feature) => {
        if (lockedCounty && featureName(feature, "ADM1_EN") !== lockedCounty) return false;
        if (!normalized) return true;
        const name = featureName(feature, "ADM1_EN").toLowerCase();
        return name.includes(normalized) || countyNumber(feature).includes(normalized);
      })
      .sort((a, b) => Number(countyNumber(a)) - Number(countyNumber(b)))
      .slice(0, normalized ? 10 : 47);
  }, [counties, lockedCounty, query]);

  const countySubcounties = useMemo(() => {
    if (!countyName) return [];
    return (subcounties?.features || [])
      .filter((feature) => featureName(feature, "ADM1_EN") === countyName)
      .sort((a, b) => featureName(a, "ADM2_EN").localeCompare(featureName(b, "ADM2_EN")));
  }, [countyName, subcounties]);

  const visibleSubcounties = useMemo(() => {
    const normalized = subcountyQuery.trim().toLowerCase();
    if (!normalized) return countySubcounties;
    return countySubcounties.filter((feature) =>
      featureName(feature, "ADM2_EN").toLowerCase().includes(normalized)
    );
  }, [countySubcounties, subcountyQuery]);

  const allCountyWards = useMemo(() => {
    if (!countyName) return [];
    return (wards?.features || []).filter((feature) => {
      const properties = feature.properties || {};
      if (properties.ADM1_EN && properties.ADM1_EN !== countyName) return false;
      return properties.ADM1_EN === countyName;
    });
  }, [countyName, wards]);

  const countyWards = useMemo(() => {
    if (!subcountyName) return allCountyWards;
    return allCountyWards.filter((feature) => featureName(feature, "ADM2_EN") === subcountyName);
  }, [allCountyWards, subcountyName]);

  const visibleWards = useMemo(() => {
    const normalized = wardQuery.trim().toLowerCase();
    return countyWards
      .filter((feature) => {
        const name = featureName(feature, "shapeName") || featureName(feature, "ADM3_EN");
        return !normalized || name.toLowerCase().includes(normalized);
      })
      .sort((a, b) => {
        const nameA = featureName(a, "shapeName") || featureName(a, "ADM3_EN");
        const nameB = featureName(b, "shapeName") || featureName(b, "ADM3_EN");
        return nameA.localeCompare(nameB);
      });
  }, [countyWards, wardQuery]);

  return (
    <aside className="aeis-atlas-panel" aria-label="Kenya atlas navigator">
      <div className="aeis-atlas-panel-head">
        <div>
          <span className="aeis-atlas-eyebrow">Kenya live atlas</span>
          <h2>{countyName || "National view"}</h2>
        </div>
        {countyName && !lockedCounty && (
          <button type="button" className="aeis-icon-button" onClick={onClear} title="Return to national view">
            <X size={18} aria-hidden="true" />
            <span className="sr-only">Return to national view</span>
          </button>
        )}
      </div>

      <div className="aeis-atlas-breadcrumb" aria-label="Selected administrative area">
        <button type="button" onClick={onClear} disabled={Boolean(lockedCounty)}>Kenya</button>
        {countyName && <><ChevronRight size={14} /><span>{countyName}</span></>}
        {subcountyName && <><ChevronRight size={14} /><span>{subcountyName}</span></>}
        {wardName && <><ChevronRight size={14} /><span>{wardName}</span></>}
      </div>

      {!countyName ? (
        <div className="aeis-atlas-search-section">
          <label htmlFor="atlas-county-search">Find a county</label>
          <div className="aeis-atlas-search">
            <Search size={17} aria-hidden="true" />
            <input
              id="atlas-county-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="County name or number"
            />
          </div>
          <div className="aeis-atlas-result-list">
            {countyOptions.map((feature) => (
              <button type="button" key={feature.properties?.ADM1_PCODE} onClick={() => onCountySelect(feature)}>
                <span>{countyNumber(feature)}</span>
                <strong>{featureName(feature, "ADM1_EN")}</strong>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="aeis-atlas-facts">
            <div><span>Gazetted no.</span><strong>{countyNumber(selectedCounty)}</strong></div>
            <div><span>Boundary area</span><strong>{formatArea(area)}</strong></div>
            <div><span>Sub-counties</span><strong>{countySubcounties.length}</strong></div>
            <div><span>Wards</span><strong>{allCountyWards.length}</strong></div>
          </div>

          <section className="aeis-atlas-level">
            <div className="aeis-atlas-level-head">
              <div><Map size={17} /><strong>Sub-counties</strong></div>
              <span>{countySubcounties.length}</span>
            </div>
            <div className="aeis-atlas-search compact">
              <Search size={15} aria-hidden="true" />
              <input
                value={subcountyQuery}
                onChange={(event) => setSubcountyQuery(event.target.value)}
                placeholder="Locate a sub-county"
                aria-label="Locate a sub-county"
              />
            </div>
            <div className="aeis-atlas-name-grid">
              {visibleSubcounties.map((feature) => {
                const name = featureName(feature, "ADM2_EN");
                return (
                  <button
                    type="button"
                    key={feature.properties?.ADM2_PCODE || name}
                    className={name === subcountyName ? "active" : ""}
                    onClick={() => onSubCountySelect(feature)}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          </section>

          {selectedSubCounty && (
            <section className="aeis-atlas-level">
              <div className="aeis-atlas-level-head">
                <div><MapPin size={17} /><strong>Wards</strong></div>
                <span>{countyWards.length}</span>
              </div>
              <div className="aeis-atlas-search compact">
                <Search size={15} aria-hidden="true" />
                <input
                  value={wardQuery}
                  onChange={(event) => setWardQuery(event.target.value)}
                  placeholder="Locate a ward"
                  aria-label="Locate a ward"
                />
              </div>
              <div className="aeis-atlas-name-grid">
                {visibleWards.map((feature) => {
                  const name = featureName(feature, "shapeName") || featureName(feature, "ADM3_EN");
                  return (
                    <button
                      type="button"
                      key={feature.properties?.shapeID || feature.properties?.ADM3_PCODE || name}
                      className={name === wardName ? "active" : ""}
                      onClick={() => onWardSelect(feature)}
                    >
                      {name}
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          <section className="aeis-atlas-level">
            <div className="aeis-atlas-level-head">
              <div><Layers3 size={17} /><strong>Live map features</strong></div>
              <span>OSM</span>
            </div>
            <div className="aeis-atlas-layer-grid">
              {liveFeatureLayers.map(({ key, label, icon: Icon }) => (
                <button
                  type="button"
                  key={key}
                  className={segmentationVisible && segmentClass === key ? "active" : ""}
                  onClick={() => onFeatureLayerChange(key)}
                >
                  <Icon size={16} aria-hidden="true" />
                  <span>{label}</span>
                </button>
              ))}
            </div>
            <p className="aeis-atlas-live-status">
              {segmentationVisible
                ? segmentationStats?.status === "loading"
                  ? "Loading mapped features..."
                  : `${Number(segmentationStats?.count || 0).toLocaleString()} mapped ${segmentClass} features shown.`
                : "Choose a feature layer to count and display available OpenStreetMap records."}
            </p>
          </section>

          <p className="aeis-atlas-source">
            Boundary area is calculated from the local administrative GeoJSON. Facility and feature totals reflect available OpenStreetMap records, not an official census.
          </p>
        </>
      )}
    </aside>
  );
}
