import React from "react";

export default function AlertsPanel({ alerts }) {
  const rows = alerts || [];
  return (
    <div className="aeis-card aeis-card-pad">
      <h2 className="aeis-section-title">Alerts</h2>
      {!rows.length && (
        <p className="aeis-section-copy">
          No official alert feed is connected yet. AEIS-K will display county crop-stress, rainfall, registry, and fertilizer alerts here only after a real source is connected.
        </p>
      )}
      <div className="aeis-grid">
        {rows.map((alert) => (
          <article className={`aeis-alert ${alert.severity.toLowerCase()}`} key={alert.id}>
            <h4>
              {alert.severity} - {alert.title}
            </h4>
            <p>
              <strong>{alert.county}:</strong> {alert.message}
            </p>
            <p>{alert.action}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
