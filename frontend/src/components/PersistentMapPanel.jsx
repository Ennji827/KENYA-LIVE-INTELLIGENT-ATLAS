import React, { useEffect, useMemo, useState } from "react";
import LiveMap from "./maps/LiveMap";
import LiveWeatherForecastPanel from "./LiveWeatherForecastPanel";
import useAEISStore from "../store/useAEISStore";

export default function PersistentMapPanel({ filter }) {
  const [baseMap, setBaseMap] = useState("street");
  const counties = useAEISStore((state) => state.counties);
  const loadingGeoJSON = useAEISStore((state) => state.loadingGeoJSON);
  const geoJSONError = useAEISStore((state) => state.geoJSONError);
  const layers = useAEISStore((state) => state.layers);
  const fetchGeoJSONData = useAEISStore((state) => state.fetchGeoJSONData);
  const setLayerVisibility = useAEISStore((state) => state.setLayerVisibility);
  const setSelectedCounty = useAEISStore((state) => state.setSelectedCounty);
  const setSelectedSubCounty = useAEISStore((state) => state.setSelectedSubCounty);
  const setSelectedWard = useAEISStore((state) => state.setSelectedWard);

  useEffect(() => {
    fetchGeoJSONData();
  }, [fetchGeoJSONData]);

  const activeCountyFeature = useMemo(() => {
    if (!counties?.features?.length) return null;
    return counties.features.find((feature) => feature.properties?.ADM1_EN === filter.county) || null;
  }, [counties, filter.county]);

  useEffect(() => {
    if (!filter.county) {
      setSelectedCounty(null);
      setSelectedSubCounty(null);
      setSelectedWard(null);
      return;
    }

    if (!activeCountyFeature) return;
    setSelectedCounty(activeCountyFeature);
    setSelectedSubCounty(null);
    setSelectedWard(null);
  }, [activeCountyFeature, filter.county, setSelectedCounty, setSelectedSubCounty, setSelectedWard]);

  const chips = [
    { key: "counties", label: "Counties" },
    { key: "subcounties", label: "Sub-counties" },
    { key: "wards", label: "Wards" },
    { key: "nasaTrueColor", label: "NASA true color" },
    { key: "nasaNdvi", label: "NASA NDVI" },
    { key: "nasaLst", label: "NASA LST" },
    { key: "geeNdvi", label: "GEE NDVI" },
    { key: "geeNdwi", label: "GEE NDWI" },
    { key: "geeLst", label: "GEE LST" },
  ];

  return (
    <aside className="aeis-map-rail" aria-label="Persistent AEIS-K map context">
      <div className="aeis-card aeis-card-pad aeis-map-context-card">
        <div className="aeis-card-heading">
          <div>
            <h2 className="aeis-section-title">Live Map Context</h2>
            <p className="aeis-section-copy">
              {filter.county ? `${filter.county} / ${filter.subcounty} / ${filter.ward}` : "National Command Center / all counties"}
            </p>
          </div>
          <select value={baseMap} onChange={(event) => setBaseMap(event.target.value)} className="aeis-mini-select">
            <option value="street">Street</option>
            <option value="satellite">Satellite</option>
            <option value="hybrid">Hybrid</option>
          </select>
        </div>

        <div className="aeis-chip-row">
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              className={`aeis-layer-chip ${layers[chip.key] ? "active" : ""}`}
              onClick={() => {
                const providerLayer = chip.key.startsWith("nasa") || chip.key.startsWith("gee");
                if (providerLayer) setBaseMap("satellite");
                if (providerLayer) {
                  ["nasaTrueColor", "nasaNdvi", "nasaLst", "geeNdvi", "geeNdwi", "geeLst"].forEach((key) => {
                    setLayerVisibility(key, key === chip.key ? !layers[chip.key] : false);
                  });
                  return;
                }
                setLayerVisibility(chip.key, !layers[chip.key]);
              }}
            >
              {chip.label}
            </button>
          ))}
        </div>

        <div className="aeis-map-mini">
          <LiveMap
            baseMap={baseMap}
            farms={[]}
            dashboardMode
            accessCountyName={filter.county || ""}
            mapHeight="360px"
            hoverSelectEnabled={false}
          />
        </div>

        <div className="aeis-map-status">
          {loadingGeoJSON ? "Loading administrative boundaries..." : geoJSONError || "County boundary and provider-layer context ready"}
        </div>
      </div>
      <LiveWeatherForecastPanel countyName={filter.county || ""} />
    </aside>
  );
}
