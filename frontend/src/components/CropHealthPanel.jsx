import React, { useEffect, useState } from "react";
import { getApiBase } from "../utils/api";

function providerText(connected) {
  return connected ? "Connected" : "Source required";
}

export default function CropHealthPanel({ title = "Crop Health" }) {
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

  const layers = geeStatus?.layers || {};
  const ndviConnected = Boolean(layers.geeNdvi?.configured);
  const ndwiConnected = Boolean(layers.geeNdwi?.configured);
  const cropHealthReady = ndviConnected && ndwiConnected;

  return (
    <div className="aeis-card aeis-card-pad">
      <h2 className="aeis-section-title">{title}</h2>
      <p className="aeis-section-copy">
        Crop-health decisions are hidden until AEIS-K receives source-dated NDVI and NDWI rasters from GEE, Sentinel/Landsat, UAV, or another approved provider.
      </p>
      <div className="aeis-metric-list">
        <div className="aeis-metric-row">
          <span>NDVI raster</span>
          <strong>{providerText(ndviConnected)}</strong>
        </div>
        <div className="aeis-metric-row">
          <span>NDWI raster</span>
          <strong>{providerText(ndwiConnected)}</strong>
        </div>
        <div className="aeis-metric-row">
          <span>Crop stress score</span>
          <strong>{cropHealthReady ? "Ready for provider calculation" : "Blocked"}</strong>
        </div>
        <div className="aeis-metric-row">
          <span>Decision status</span>
          <strong>{cropHealthReady ? "Use connected rasters" : "Do not publish"}</strong>
        </div>
      </div>
      <div className="aeis-index-decision compact">
        <h3 className="aeis-mini-heading">Real Data Rule</h3>
        <p>
          AEIS-K will not show NDVI/NDWI crop-health values without a source raster. Connect raster source URLs and acquisition metadata before county or farm crop-stress decisions are displayed.
        </p>
      </div>
    </div>
  );
}
