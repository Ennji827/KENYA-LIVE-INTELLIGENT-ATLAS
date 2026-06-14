import React, { useEffect, useState } from "react";
import { getApiBase } from "../utils/api";

function statusTone(configured) {
  return configured ? "ready" : "estimated";
}

function statusLabel(configured) {
  return configured ? "Connected" : "Source required";
}

export default function RemoteSensingImageryPanel({ county }) {
  const [geeStatus, setGeeStatus] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function loadGeeStatus() {
      try {
        const response = await fetch(`${getApiBase()}/api/gee/layers`);
        const payload = await response.json();
        if (!cancelled && response.ok) setGeeStatus(payload);
      } catch (error) {
        if (!cancelled) setGeeStatus({ status: "unavailable", layers: {} });
      }
    }
    loadGeeStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  const geeLayers = geeStatus?.layers || {};
  const ndviConnected = Boolean(geeLayers.geeNdvi?.configured);
  const ndwiConnected = Boolean(geeLayers.geeNdwi?.configured);

  return (
    <div className="aeis-card aeis-card-pad">
      <div className="aeis-card-heading">
        <div>
          <h2 className="aeis-section-title">NDVI / NDWI Source Status</h2>
          <p className="aeis-section-copy">
            {county?.name ? `${county.name} imagery status.` : "Imagery status."} Official pixel decisions require a connected raster provider with acquisition metadata.
          </p>
        </div>
        <span className={`aeis-index-source ${ndviConnected || ndwiConnected ? "ready" : "estimated"}`}>
          {ndviConnected || ndwiConnected ? "Provider connected" : "Provider required"}
        </span>
      </div>

      <div className="aeis-imagery-grid">
        <div className="aeis-imagery-tile satellite">
          <div className="aeis-imagery-photo" />
          <div>
            <strong>NASA basemap imagery</strong>
            <span>True-color, MODIS NDVI, and LST layers are available on the map for national context.</span>
          </div>
        </div>
        <div className="aeis-imagery-tile">
          <div className="aeis-index-badge ndvi">NDVI</div>
          <div>
            <strong>{statusLabel(ndviConnected)}</strong>
            <span>
              {ndviConnected
                ? "GEE NDVI tile URL is configured for real raster display."
                : "Set AEIS_GEE_NDVI_TILE_URL for county/farm NDVI output."}
            </span>
          </div>
        </div>
        <div className="aeis-imagery-tile">
          <div className="aeis-index-badge ndwi">NDWI</div>
          <div>
            <strong>{statusLabel(ndwiConnected)}</strong>
            <span>
              {ndwiConnected
                ? "GEE NDWI tile URL is configured for real moisture raster display."
                : "Set AEIS_GEE_NDWI_TILE_URL for county/farm NDWI output."}
            </span>
          </div>
        </div>
      </div>

      <div className="aeis-index-outcome">
        <div>
          <span>County pixel values</span>
          <strong>Blocked until source</strong>
        </div>
        <div>
          <span>NDVI provider</span>
          <strong className={`aeis-inline-status ${statusTone(ndviConnected)}`}>{statusLabel(ndviConnected)}</strong>
        </div>
        <div>
          <span>NDWI provider</span>
          <strong className={`aeis-inline-status ${statusTone(ndwiConnected)}`}>{statusLabel(ndwiConnected)}</strong>
        </div>
      </div>

      <div className="aeis-index-decision">
        <h3 className="aeis-mini-heading">Operational Rule</h3>
        <p>
          Do not publish county, ward, or farm NDVI/NDWI maps without source-dated raster values. Use the map's NASA imagery for visual context, then connect GEE/Sentinel/Landsat raster tiles for official AEIS-K index products.
        </p>
      </div>

      <div className="aeis-imagery-rules">
        <div>
          <strong>Required metadata</strong>
          <span>Sensor, acquisition date, cloud mask, processing method, and boundary clipping method.</span>
        </div>
        <div>
          <strong>Accepted providers</strong>
          <span>Google Earth Engine, Sentinel-2, Landsat, NASA, UAV, or an approved county data provider.</span>
        </div>
        <div>
          <strong>Current GEE status</strong>
          <span>{geeStatus?.status || "Checking provider status..."}</span>
        </div>
      </div>
    </div>
  );
}
