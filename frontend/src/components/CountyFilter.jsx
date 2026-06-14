import React, { useEffect, useMemo, useState } from "react";
import useAEISStore from "../store/useAEISStore";

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export default function CountyFilter({ counties, value, onChange, allowNational = true, lockedCounty = "" }) {
  const [search, setSearch] = useState("");
  const subcounties = useAEISStore((state) => state.subcounties);
  const wards = useAEISStore((state) => state.wards);
  const fetchGeoJSONData = useAEISStore((state) => state.fetchGeoJSONData);
  const isLocked = Boolean(lockedCounty);

  useEffect(() => {
    fetchGeoJSONData();
  }, [fetchGeoJSONData]);

  const filteredCounties = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return counties;
    return counties.filter((county) => {
      return (
        county.name.toLowerCase().includes(query) ||
        county.countyCode?.includes(query) ||
        county.displayName?.toLowerCase().includes(query)
      );
    });
  }, [counties, search]);

  const selectedCounty = counties.find((county) => county.name === value.county) || null;
  const boundarySubcounties = useMemo(() => {
    if (!selectedCounty || !subcounties?.features?.length) return [];
    return uniqueSorted(
      subcounties.features
        .filter((feature) => feature.properties?.ADM1_EN === selectedCounty.name)
        .map((feature) => feature.properties?.ADM2_EN)
    );
  }, [selectedCounty, subcounties]);

  const boundaryWards = useMemo(() => {
    if (!selectedCounty || !wards?.features?.length) return [];
    return uniqueSorted(
      wards.features
        .filter((feature) => {
          const props = feature.properties || {};
          if (props.ADM1_EN && props.ADM1_EN !== selectedCounty.name) return false;
          if (value.subcounty && props.ADM2_EN && props.ADM2_EN !== value.subcounty) return false;
          return props.ADM1_EN === selectedCounty.name || props.ADM2_EN === value.subcounty;
        })
        .map((feature) => feature.properties?.ADM3_EN || feature.properties?.shapeName)
    );
  }, [selectedCounty, value.subcounty, wards]);

  const updateCounty = (countyName) => {
    if (isLocked) return;

    if (!countyName && allowNational) {
      onChange({
        county: "",
        subcounty: "",
        ward: "",
      });
      return;
    }

    const county = counties.find((item) => item.name === countyName);
    if (!county) return;
    onChange({
      county: county.name,
      subcounty: "",
      ward: "",
    });
  };

  const updateSubcounty = (subcountyName) => {
    if (!selectedCounty) return;
    onChange({
      ...value,
      subcounty: subcountyName,
      ward: "",
    });
  };

  return (
    <div className="aeis-card aeis-card-pad">
      <h2 className="aeis-section-title">County / Sub-county / Ward Filter</h2>
      <p className="aeis-section-copy">
        {isLocked
          ? `This workspace is locked to ${lockedCounty}.`
          : "Keep the command center national, or search and select one county for county-level intelligence."}
      </p>
      <div className="aeis-filter-grid aeis-filter-grid-four">
        <div className="aeis-field">
          <label htmlFor="aeis-county-search">County search</label>
          <input
            id="aeis-county-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name or code, e.g. 018"
            disabled={isLocked}
          />
        </div>
        <div className="aeis-field">
          <label htmlFor="aeis-county">County</label>
          <select id="aeis-county" value={value.county} onChange={(event) => updateCounty(event.target.value)} disabled={isLocked}>
            {allowNational && !isLocked && <option value="">National Command Center</option>}
            {filteredCounties.map((county) => (
              <option key={county.name} value={county.name}>
                {county.displayName || county.name}
              </option>
            ))}
          </select>
        </div>
        <div className="aeis-field">
          <label htmlFor="aeis-subcounty">Sub-county</label>
          <select
            id="aeis-subcounty"
            value={value.subcounty || ""}
            onChange={(event) => updateSubcounty(event.target.value)}
            disabled={!selectedCounty}
          >
            <option value="">All sub-counties</option>
            {boundarySubcounties.map((subcounty) => (
              <option key={subcounty} value={subcounty}>
                {subcounty}
              </option>
            ))}
          </select>
        </div>
        <div className="aeis-field">
          <label htmlFor="aeis-ward">Ward</label>
          <select
            id="aeis-ward"
            value={value.ward || ""}
            onChange={(event) => onChange({ ...value, ward: event.target.value })}
            disabled={!selectedCounty}
          >
            <option value="">All wards</option>
            {boundaryWards.map((ward) => (
              <option key={ward} value={ward}>
                {ward}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
