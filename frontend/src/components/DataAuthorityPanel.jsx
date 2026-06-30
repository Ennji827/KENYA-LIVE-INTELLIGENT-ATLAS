import React, { useEffect, useState } from "react";
import { getApiBase } from "../utils/api";

const nationalSources = [
  { label: "County boundaries", status: "Loaded", note: "Local GeoJSON boundary files" },
  { label: "County codes", status: "Pinned", note: "Official 001-047 order" },
  { label: "County login isolation", status: "Active", note: "Django accounts, sessions, GPS geofence" },
  { label: "Rainfall/weather", status: "Live forecast", note: "Open-Meteo model forecast connected; official station feed recommended" },
  { label: "Latest Landsat", status: "Connected", note: "USGS LandsatLook Collection 2 catalogue and browse overlay" },
  { label: "NDVI/NDWI rasters", status: "Provider required", note: "Use NASA for visual context; connect GEE/Sentinel/Landsat for official county rasters" },
  { label: "Google Earth Engine", status: "Checking", note: "Backend GEE configuration status" },
  { label: "Field/site registry", status: "Source required", note: "Connect verified county field/site records" },
];

function sourceRows(county) {
  if (!county?.stats?.intelligence?.sourceReadiness) return nationalSources;

  return [
    ...county.stats.intelligence.sourceReadiness.map((source) => ({
      label: source.label,
      status: source.status,
      note: `${source.score}% readiness`,
    })),
    { label: "Google Earth Engine", status: "Checking", note: "Backend GEE configuration status" },
  ];
}

export default function DataAuthorityPanel({ county = null }) {
  const [geeStatus, setGeeStatus] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function loadGeeStatus() {
      try {
        const response = await fetch(`${getApiBase()}/api/gee/layers`);
        if (!response.ok) throw new Error("GEE endpoint unavailable");
        const payload = await response.json();
        if (!cancelled) setGeeStatus(payload);
      } catch (error) {
        if (!cancelled) setGeeStatus({ status: "unavailable", configured_layers: 0 });
      }
    }
    loadGeeStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = sourceRows(county).map((source) => {
    if (source.label !== "Google Earth Engine") return source;
    if (!geeStatus) return source;
    return {
      label: "Google Earth Engine",
      status: geeStatus.status === "connected" ? "Connected" : "Provider ready",
      note:
        geeStatus.status === "connected"
          ? `${geeStatus.configured_layers} Earth Engine layers configured`
          : "Set AEIS_GEE_NDVI_TILE_URL, AEIS_GEE_NDWI_TILE_URL, or AEIS_GEE_LST_TILE_URL",
    };
  });

  return (
    <div className="aeis-card aeis-card-pad">
      <h2 className="aeis-section-title">Data Authority and Readiness</h2>
      <p className="aeis-section-copy">
        AEIS-K separates loaded operational data from provider gaps so only source-backed climate, water, land, road, soil, and field outputs are treated as official.
      </p>
      <div className="aeis-authority-list">
        {rows.map((source) => (
          <div className="aeis-authority-row" key={source.label}>
            <strong>{source.label}</strong>
            <span>{source.status}</span>
            <em>{source.note}</em>
          </div>
        ))}
      </div>
    </div>
  );
}
