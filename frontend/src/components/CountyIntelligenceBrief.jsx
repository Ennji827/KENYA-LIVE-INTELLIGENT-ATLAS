import React from "react";

function toneForPriority(priority) {
  const normalized = String(priority || "").toLowerCase();
  if (normalized === "critical") return "critical";
  if (normalized === "high") return "high";
  if (normalized === "watch") return "watch";
  return "stable";
}

export default function CountyIntelligenceBrief({ county }) {
  const intelligence = county.stats.intelligence;
  const tone = toneForPriority(intelligence.priority);
  const riskLabel = intelligence.riskScore == null ? "Source required" : intelligence.riskScore;
  const confidenceLabel = intelligence.confidenceScore == null ? "Source required" : `${intelligence.confidenceScore}%`;

  return (
    <div className={`aeis-card aeis-card-pad aeis-intel-card ${tone}`}>
      <div className="aeis-card-heading">
        <div>
          <h2 className="aeis-section-title">{county.name} Intelligence Brief</h2>
          <p className="aeis-section-copy">
            Source-readiness summary for county boundaries, live forecast, NDVI/NDWI rasters, farmer registry, and land-cover inputs.
          </p>
        </div>
        <div className={`aeis-priority-badge ${tone}`}>{intelligence.priority}</div>
      </div>

      <div className="aeis-intel-score-grid">
        <div className="aeis-score-block">
          <span>Risk score</span>
          <strong>{riskLabel}</strong>
          <div className="aeis-score-track">
            <div style={{ width: `${intelligence.riskScore || 0}%` }} />
          </div>
        </div>
        <div className="aeis-score-block">
          <span>Confidence</span>
          <strong>{confidenceLabel}</strong>
          <div className="aeis-score-track confidence">
            <div style={{ width: `${intelligence.confidenceScore || 0}%` }} />
          </div>
        </div>
        <div className="aeis-score-block">
          <span>Action window</span>
          <strong>{intelligence.actionWindow}</strong>
          <small>County team response timing</small>
        </div>
      </div>

      <div className="aeis-intel-columns">
        <div>
          <h3 className="aeis-mini-heading">Primary Drivers</h3>
          <div className="aeis-metric-list">
            {intelligence.drivers.map((driver) => (
              <div className="aeis-metric-row" key={driver.label}>
                <span>{driver.label}</span>
                <strong>{driver.value}</strong>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 className="aeis-mini-heading">Anomaly Flags</h3>
          <div className="aeis-intel-flags">
            {intelligence.anomalyFlags.map((flag) => (
              <div className={`aeis-intel-flag ${flag.tone}`} key={flag.type}>
                <strong>{flag.type}</strong>
                <span>{flag.detail}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="aeis-intel-columns">
        <div>
          <h3 className="aeis-mini-heading">Recommended Actions</h3>
          <div className="aeis-action-list">
            {intelligence.recommendations.map((item) => (
              <div className="aeis-action-item" key={item.title}>
                <span>{item.priority}</span>
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 className="aeis-mini-heading">Data Readiness</h3>
          <div className="aeis-readiness-list">
            {intelligence.sourceReadiness.map((source) => (
              <div className="aeis-readiness-row" key={source.label}>
                <div>
                  <strong>{source.label}</strong>
                  <span>{source.status}</span>
                </div>
                <div className="aeis-readiness-track">
                  <div style={{ width: `${source.score}%` }} />
                </div>
                <strong>{source.score}%</strong>
              </div>
            ))}
          </div>
        </div>
      </div>

      <p className="aeis-source-note">
        Intelligence status: county analytics stay unpublished until official data sources are connected.
      </p>
    </div>
  );
}
