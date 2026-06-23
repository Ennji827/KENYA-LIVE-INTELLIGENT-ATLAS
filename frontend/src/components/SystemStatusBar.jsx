import React, { useEffect, useMemo, useRef, useState } from "react";
import { Activity, Database, Moon, Search, ShieldCheck, Sun } from "lucide-react";
import { getApiBase } from "../utils/api";

function readTheme() {
  return localStorage.getItem("aeis_theme") || "light";
}

export default function SystemStatusBar({
  session,
  counties = [],
  onPageChange,
  onCountySelect,
}) {
  const [health, setHealth] = useState(null);
  const [sources, setSources] = useState(null);
  const [theme, setTheme] = useState(readTheme);
  const [query, setQuery] = useState("");
  const searchRef = useRef(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("aeis_theme", theme);
  }, [theme]);

  useEffect(() => {
    const focusSearch = (event) => {
      const element = event.target;
      const typing = element instanceof HTMLInputElement
        || element instanceof HTMLTextAreaElement
        || element?.isContentEditable;
      if (event.key === "/" && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadStatus() {
      try {
        const [healthResponse, sourcesResponse] = await Promise.all([
          fetch(`${getApiBase()}/health`),
          fetch(`${getApiBase()}/api/data/sources`),
        ]);
        const [healthPayload, sourcePayload] = await Promise.all([
          healthResponse.json(),
          sourcesResponse.json(),
        ]);
        if (!cancelled) {
          setHealth(healthPayload);
          setSources(sourcePayload);
        }
      } catch (error) {
        if (!cancelled) setHealth({ status: "unavailable" });
      }
    }
    loadStatus();
    const timer = window.setInterval(loadStatus, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    const allPageOptions = [
      ["home", "National dashboard"],
      ["map", "Map intelligence"],
      ["intelligence", "Intelligence Assistant"],
      ["county", "County dashboard"],
      ["county-sites", "County sites"],
      ["reports", "Reports"],
      ["admin", "Data sources and administration"],
    ];
    const role = session?.role;
    const pageOptions = allPageOptions.filter(([id]) => {
      if (role === "analyst") return id !== "admin";
      if (role === "auditor") return ["home", "reports", "admin"].includes(id);
      if (role === "farmer") return ["home", "map", "intelligence"].includes(id);
      if (["county", "field_officer"].includes(role)) return !["admin", "county-sites"].includes(id);
      return true;
    });

    return [
      ...pageOptions
        .filter(([, label]) => label.toLowerCase().includes(needle))
        .map(([id, label]) => ({ type: "page", id, label })),
      ...counties
        .filter((county) => county.name.toLowerCase().includes(needle) || county.countyCode?.includes(needle))
        .slice(0, 6)
        .map((county) => ({ type: "county", id: county.name, label: `${county.countyCode} ${county.name}` })),
    ].slice(0, 8);
  }, [counties, query, session?.role]);

  const choose = (match) => {
    if (match.type === "page") onPageChange?.(match.id);
    else onCountySelect?.(match.id);
    setQuery("");
  };

  return (
    <div className="aeis-system-bar">
      <div className="aeis-command-search">
        <Search size={16} />
        <input
          ref={searchRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search counties and workspaces…"
          aria-label="AEIS-K command search"
        />
        {!query && <kbd>/</kbd>}
        {matches.length > 0 && (
          <div className="aeis-command-results">
            {matches.map((match) => (
              <button type="button" key={`${match.type}-${match.id}`} onClick={() => choose(match)}>
                <span>{match.type === "county" ? "County" : "Workspace"}</span>
                <strong>{match.label}</strong>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="aeis-system-signals" aria-live="polite">
        <span className={`aeis-system-signal ${health?.status === "healthy" ? "ready" : "warning"}`}>
          <Activity size={15} />
          {health?.status === "healthy"
            ? "System healthy"
            : health?.status === "unavailable"
              ? "System unavailable"
              : "Checking system"}
        </span>
        <span className="aeis-system-signal ready">
          <Database size={15} />
          {sources?.summary?.connected_apis ?? "—"} live sources
        </span>
        {(health?.processing_queue?.queued > 0 || health?.processing_queue?.running > 0) && (
          <span className="aeis-system-signal warning">
            <Activity size={15} />
            {(health.processing_queue.queued || 0) + (health.processing_queue.running || 0)} processing
          </span>
        )}
        <span className="aeis-system-signal">
          <ShieldCheck size={15} />
          {session?.role?.replace("_", " ") || "user"}
        </span>
        <span className="aeis-system-updated">
          Updated {health?.generated_at
            ? new Date(health.generated_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
            : "—"}
        </span>
        <button
          type="button"
          className="aeis-theme-toggle"
          onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        >
          {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
        </button>
      </div>
    </div>
  );
}
