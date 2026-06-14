import React, { useMemo, useState } from "react";
import StatCard from "../components/StatCard";
import { sampleCounties } from "../data/sampleDashboardData";

function countyEmail(countyName) {
  const slug = countyName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "county";
  return `${slug}@county.aeis-k.local`;
}

function sitePath(county) {
  const slug = county.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `/county/${county.countyCode}-${slug}`;
}

export default function CountySites({ onOpenCounty }) {
  const [query, setQuery] = useState("");

  const visibleCounties = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return sampleCounties;
    return sampleCounties.filter((county) => {
      const values = [county.name, county.displayName, county.countyCode, countyEmail(county.name), sitePath(county)];
      return values.some((value) => value.toLowerCase().includes(needle));
    });
  }, [query]);

  return (
    <>
      <div className="aeis-topbar">
        <div>
          <div className="aeis-kicker">County sites</div>
          <h1 className="aeis-title">All County Workspaces</h1>
          <p className="aeis-subtitle">
            Official AEIS-K county workspace directory for Kenya's 47 counties, with county numbers, county email identities, and county-level intelligence entry points.
          </p>
        </div>
        <div className="aeis-status-pill">{visibleCounties.length} visible counties</div>
      </div>

      <div className="aeis-grid aeis-three-col">
        <StatCard label="County Sites" value={sampleCounties.length} tone="green" />
        <StatCard label="Analytics" value="Source required" note="Provider-backed only" tone="amber" />
        <StatCard label="Live Forecast" value="Below map" tone="blue" />
      </div>

      <div style={{ height: 16 }} />
      <div className="aeis-card aeis-card-pad">
        <div className="aeis-field">
          <label htmlFor="aeis-county-site-search">Search county number, name, or email</label>
          <input
            id="aeis-county-site-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="018 Nyandarua, Nairobi, 047, nyandarua@county.aeis-k.local"
          />
        </div>
      </div>

      <div style={{ height: 16 }} />
      <div className="aeis-county-sites-grid">
        {visibleCounties.map((county) => (
            <article className="aeis-county-site-card" key={county.name}>
              <div className="aeis-county-site-head">
                <span>{county.countyCode}</span>
                <div>
                  <h2>{county.name}</h2>
                  <p>{sitePath(county)}</p>
                </div>
              </div>
              <div className="aeis-county-site-meta">
                <div>
                  <span>Email login</span>
                  <strong>{countyEmail(county.name)}</strong>
                </div>
                <div>
                  <span>Crop stress</span>
                  <strong>Blocked</strong>
                </div>
                <div>
                  <span>Rainfall risk</span>
                  <strong>Live forecast</strong>
                </div>
                <div>
                  <span>NDVI</span>
                  <strong>Source required</strong>
                </div>
              </div>
              <div className="aeis-county-site-footer">
                <span>Farmer registry source required</span>
                <button type="button" className="aeis-btn" onClick={() => onOpenCounty(county)}>
                  Open county site
                </button>
              </div>
            </article>
        ))}
      </div>
    </>
  );
}
