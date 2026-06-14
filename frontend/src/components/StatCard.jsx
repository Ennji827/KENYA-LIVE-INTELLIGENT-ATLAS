import React from "react";

export default function StatCard({ label, value, note, tone = "green", onClick, active = false }) {
  const Element = onClick ? "button" : "div";
  return (
    <Element
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`aeis-card aeis-stat-card ${tone} ${onClick ? "interactive" : ""} ${active ? "active" : ""}`}
    >
      <div className="aeis-stat-label">{label}</div>
      <div className="aeis-stat-value">{value}</div>
      {note && <div className="aeis-stat-note">{note}</div>}
    </Element>
  );
}
