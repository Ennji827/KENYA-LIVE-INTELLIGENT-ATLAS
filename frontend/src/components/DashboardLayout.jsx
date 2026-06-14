import React from "react";

const navItems = [
  { id: "home", label: "Dashboard Home" },
  { id: "map", label: "Map Intelligence" },
  { id: "county", label: "County Dashboard" },
  { id: "county-sites", label: "County Sites" },
  { id: "farmer", label: "Farmer Dashboard" },
  { id: "reports", label: "Reports" },
  { id: "admin", label: "Admin / Ministry" },
];

function allowedNavItems(session) {
  if (session?.role === "county") {
    return navItems.filter((item) => item.id !== "admin" && item.id !== "county-sites");
  }
  if (session?.role === "analyst") {
    return navItems.filter((item) => item.id !== "admin");
  }
  return navItems;
}

export default function DashboardLayout({
  activePage,
  onPageChange,
  children,
  session,
  onLogout,
  counties = [],
  selectedCounty = "",
  lockedCounty = "",
  onCountySelect,
}) {
  const visibleNavItems = allowedNavItems(session);
  const isCountyLocked = Boolean(lockedCounty);

  return (
    <div className="aeis-shell">
      <aside className="aeis-sidebar">
        <div className="aeis-brand">
          <h1>AEIS-K</h1>
          <p>Agro-Environmental Intelligence System for Kenya</p>
        </div>
        {session && (
          <div className="aeis-session-card">
            <strong>{session.command_center || "AEIS-K Workspace"}</strong>
            {session.email && <small>{session.email}</small>}
            {session.demo_remote_access && <em>Remote demo session</em>}
            <span>{session.boundary_scope || "national"}</span>
            <button type="button" onClick={onLogout}>Sign out</button>
          </div>
        )}
        <div className="aeis-sidebar-county-picker">
          <label htmlFor="aeis-sidebar-county">County workspace</label>
          <select
            id="aeis-sidebar-county"
            value={isCountyLocked ? lockedCounty : selectedCounty}
            onChange={(event) => onCountySelect?.(event.target.value)}
            disabled={isCountyLocked}
          >
            {!isCountyLocked && <option value="">National Command Center</option>}
            {counties.map((county) => (
              <option key={county.name} value={county.name}>
                {county.displayName || county.name}
              </option>
            ))}
          </select>
          <span>{isCountyLocked ? `Locked to ${lockedCounty}` : "Jump to any county dashboard"}</span>
        </div>
        <nav className="aeis-nav" aria-label="AEIS-K dashboard navigation">
          {visibleNavItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={activePage === item.id ? "active" : ""}
              onClick={() => onPageChange(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </aside>
      <main className="aeis-main">{children}</main>
    </div>
  );
}
