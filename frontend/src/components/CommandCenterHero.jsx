import React from "react";
import {
  ArrowRight,
  Bot,
  CalendarDays,
  CloudSun,
  Map,
  RefreshCw,
  Satellite,
  ShieldCheck,
} from "lucide-react";

function formatUpdatedAt(value) {
  if (!value) return "Connecting to live evidence";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Live evidence connected";
  return `Updated ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function statusCopy(status) {
  if (status === "loading") return "Connecting";
  if (status === "refreshing") return "Refreshing";
  if (status === "partial") return "Partial evidence";
  if (status === "error") return "Connection issue";
  return "Operational";
}

export default function CommandCenterHero({
  selectedCounty,
  session,
  dataStatus = "loading",
  updatedAt,
  onRefresh,
  onNavigate,
}) {
  const countyMode = Boolean(selectedCounty);
  const role = session?.role;
  const allActions = [
    { id: "map", label: "Explore map", copy: "Inspect boundaries and imagery", icon: Map },
    { id: "intelligence", label: "Ask intelligence", copy: "Run evidence-backed analysis", icon: Bot },
    { id: "county-sites", label: "County directory", copy: "Compare county workspaces", icon: Satellite },
  ];
  const actions = allActions.filter((action) => {
    if (role === "auditor") return false;
    if (role === "farmer") return ["map", "intelligence"].includes(action.id);
    if (["county", "field_officer"].includes(role)) return action.id !== "county-sites";
    if (role === "analyst") return action.id !== "admin";
    return true;
  });

  return (
    <section className={`aeis-command-hero ${countyMode ? "county" : "national"}`}>
      <div className="aeis-command-hero-glow" aria-hidden="true" />
      <div className="aeis-command-hero-main">
        <div className="aeis-command-hero-copy">
          <div className="aeis-command-hero-eyebrow">
            <span><ShieldCheck size={14} /> Verified workspace</span>
            <span className={`aeis-command-health ${dataStatus}`}>
              <i aria-hidden="true" />
              {statusCopy(dataStatus)}
            </span>
          </div>
          <h1>{countyMode ? `${selectedCounty.name} Intelligence` : "National Agriculture Command Center"}</h1>
          <p>
            {countyMode
              ? `Live weather, administrative boundaries, satellite discovery, and operational evidence for county code ${selectedCounty.countyCode}.`
              : "A source-backed view of weather exposure, GIS coverage, field intelligence, and reporting across Kenya's 47 counties."}
          </p>
          <div className="aeis-command-hero-meta">
            <span><CloudSun size={15} /> Open-Meteo live forecast</span>
            <span><Satellite size={15} /> Landsat and Sentinel catalogues</span>
            <span><CalendarDays size={15} /> {formatUpdatedAt(updatedAt)}</span>
          </div>
        </div>

        <button
          type="button"
          className="aeis-command-refresh"
          onClick={onRefresh}
          disabled={dataStatus === "loading" || dataStatus === "refreshing"}
        >
          <RefreshCw className={dataStatus === "loading" || dataStatus === "refreshing" ? "spin" : ""} size={17} />
          Refresh evidence
        </button>
      </div>

      {actions.length > 0 && (
        <div className="aeis-command-actions" aria-label="Command center quick actions">
          {actions.map(({ id, label, copy, icon: Icon }) => (
            <button type="button" key={id} onClick={() => onNavigate?.(id)}>
              <span className="aeis-command-action-icon"><Icon size={18} /></span>
              <span>
                <strong>{label}</strong>
                <small>{copy}</small>
              </span>
              <ArrowRight size={16} />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
