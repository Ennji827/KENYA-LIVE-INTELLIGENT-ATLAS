import React from "react";

export default function LandCoverChart() {
  return (
    <div className="aeis-card aeis-card-pad">
      <h2 className="aeis-section-title">Land Cover Composition</h2>
      <p className="aeis-section-copy">
        Land-cover percentages are hidden until AEIS-K is connected to a real classified land-cover source.
      </p>
      <div className="aeis-metric-list">
        <div className="aeis-metric-row">
          <span>Cropland</span>
          <strong>Source required</strong>
        </div>
        <div className="aeis-metric-row">
          <span>Bare land</span>
          <strong>Source required</strong>
        </div>
        <div className="aeis-metric-row">
          <span>Built-up area</span>
          <strong>Source required</strong>
        </div>
        <div className="aeis-metric-row">
          <span>Grassland</span>
          <strong>Source required</strong>
        </div>
      </div>
      <div className="aeis-index-decision compact">
        <h3 className="aeis-mini-heading">Accepted Sources</h3>
        <p>Use a classified Sentinel/Landsat/GEE product, Dynamic World, ESA WorldCover, official county land-cover data, or validated field classification.</p>
      </div>
    </div>
  );
}
