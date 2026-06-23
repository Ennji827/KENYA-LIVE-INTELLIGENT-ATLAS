import React from "react";

export default function AlertsPanel({ alerts }) {
  const rows = alerts || [];
  return (
    <div className="aeis-card aeis-card-pad">
      <h2 className="aeis-section-title">Alerts</h2>
      {!rows.length && (
        <div className="aeis-empty-state">No active operational alerts.</div>
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
