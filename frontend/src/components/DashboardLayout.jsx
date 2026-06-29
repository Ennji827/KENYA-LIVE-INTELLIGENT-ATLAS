import React from "react";
import {
  BarChart3,
  Bot,
  Building2,
  ClipboardList,
  FileText,
  LayoutDashboard,
  LogOut,
  Map,
  MapPinned,
  ShieldCheck,
  Sprout,
} from "lucide-react";
import KsaPoweredBy from "./KsaPoweredBy";
import SystemStatusBar from "./SystemStatusBar";

const navItems = [
  { id: "home", label: "Climate Command", icon: LayoutDashboard },
  { id: "map", label: "Map Intelligence", icon: Map },
  { id: "intelligence", label: "Intelligence Assistant", icon: Bot },
  { id: "county", label: "County Dashboard", icon: MapPinned },
  { id: "county-sites", label: "County Sites", icon: Building2 },
  { id: "farmer", label: "Field Dashboard", icon: Sprout },
  { id: "reports", label: "Reports", icon: FileText },
  { id: "admin", label: "Admin / Ministry", icon: ShieldCheck },
];

function allowedNavItems(session) {
  if (session?.role === "auditor") {
    return navItems
      .filter((item) => ["home", "reports", "admin"].includes(item.id))
      .map((item) => (item.id === "admin" ? { ...item, label: "Audit / Data Quality" } : item));
  }
  if (session?.role === "farmer") {
    return navItems.filter((item) => ["home", "map", "intelligence", "farmer"].includes(item.id));
  }
  if (session?.role === "field_officer") {
    return navItems.filter((item) => !["admin", "county-sites"].includes(item.id));
  }
  if (session?.role === "county") {
    return navItems.filter((item) => item.id !== "admin" && item.id !== "county-sites");
  }
  if (session?.role === "analyst") {
    return navItems.filter((item) => !["admin", "farmer"].includes(item.id));
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
          <span className="aeis-brand-mark"><BarChart3 size={23} /></span>
          <div>
            <h1>AEIS-K</h1>
            <p>Climate, Water & Land Intelligence</p>
          </div>
        </div>
        {session && (
          <div className="aeis-session-card">
            <strong>{session.command_center || "AEIS-K Workspace"}</strong>
            {session.email && <small>{session.email}</small>}
            {session.demo_remote_access && <em>Remote demo session</em>}
            <span>{session.boundary_scope || "national"}</span>
            <button type="button" onClick={onLogout}><LogOut size={15} /> Sign out</button>
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
        <div className="aeis-nav-section">
          <span>Workspace</span>
          <nav className="aeis-nav" aria-label="AEIS-K dashboard navigation">
            {visibleNavItems.map((item) => {
              const Icon = item.icon || ClipboardList;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={activePage === item.id ? "active" : ""}
                  onClick={() => onPageChange(item.id)}
                  aria-current={activePage === item.id ? "page" : undefined}
                >
                  <Icon size={17} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
        <KsaPoweredBy />
      </aside>
      <main className="aeis-main">
        <SystemStatusBar
          session={session}
          counties={counties}
          onPageChange={onPageChange}
          onCountySelect={onCountySelect}
        />
        {children}
      </main>
    </div>
  );
}
