import React from "react";

export default function FertilizerPanel({ countyName }) {
  return (
    <div className="aeis-card aeis-card-pad">
      <h2 className="aeis-section-title">Soil & Input Planning</h2>
      <p className="aeis-section-copy">
        Soil and land-management input demand for {countyName || "the selected area"} is not displayed until verified county inputs are connected.
      </p>
      <div className="aeis-metric-list">
        <div className="aeis-metric-row">
          <span>Verified field/site registry</span>
          <strong>Source required</strong>
        </div>
        <div className="aeis-metric-row">
          <span>Land-use class and area</span>
          <strong>Source required</strong>
        </div>
        <div className="aeis-metric-row">
          <span>Soil test / restoration program</span>
          <strong>Source required</strong>
        </div>
        <div className="aeis-metric-row">
          <span>Live rainfall gate</span>
          <strong>Use forecast below map</strong>
        </div>
      </div>
      <div className="aeis-index-decision compact">
        <h3 className="aeis-mini-heading">Real Data Rule</h3>
        <p>
          AEIS-K will not publish soil or input-demand estimates without verified registry, land-use, soil, and rainfall inputs.
        </p>
      </div>
    </div>
  );
}
