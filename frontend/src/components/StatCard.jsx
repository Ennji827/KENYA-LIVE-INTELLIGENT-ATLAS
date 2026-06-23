import React from "react";

export default function StatCard({ label, value, note, tone = "green", onClick, active = false, icon: Icon }) {
  const Element = onClick ? "button" : "div";
  return (
    <Element
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`aeis-card aeis-stat-card ${tone} ${onClick ? "interactive" : ""} ${active ? "active" : ""}`}
    >
      <div className="aeis-stat-head">
        <div className="aeis-stat-label">{label}</div>
        {Icon && <span className="aeis-stat-icon" aria-hidden="true"><Icon size={17} /></span>}
      </div>
      <div className="aeis-stat-value">{value}</div>
      {note && <div className="aeis-stat-note">{note}</div>}
    </Element>
  );
}
