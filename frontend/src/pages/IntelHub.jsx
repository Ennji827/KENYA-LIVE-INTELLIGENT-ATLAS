import React, { useMemo, useState } from "react";
import { TOPICS, nationalValue, formatValue, SOURCE_STATUS_LABEL } from "../data/topics";

// Distinct topic categories, in display order, used as landing-page tabs.
const CATEGORIES = ["All", ...Array.from(new Set(TOPICS.map((t) => t.category)))];

// The single hub page: category tabs + all eight topics as clickable cards.
export default function IntelHub({ onOpenTopic, user, onSignOut }) {
  const [tab, setTab] = useState("All");

  const displayName =
    user && (user.first_name || user.name || user.email)
      ? user.first_name || user.name || user.email
      : null;

  const visible = useMemo(
    () => (tab === "All" ? TOPICS : TOPICS.filter((t) => t.category === tab)),
    [tab],
  );

  return (
    <div className="hub">
      <header className="hub__hero">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div className="hub__eyebrow">AEIS-K · Critical Intelligence System</div>
          {onSignOut && (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {displayName && (
                <span className="hub__eyebrow" style={{ opacity: 0.85 }}>
                  Signed in as {displayName}
                </span>
              )}
              <button type="button" className="btn btn--ghost" onClick={onSignOut}>
                Sign out
              </button>
            </div>
          )}
        </div>
        <h1>National Intelligence Hub</h1>
        <p>
          Live geospatial intelligence for decision makers and researchers.
          Select a topic, choose your area of interest, then drill down from
          national to county and sub-county level — generate reports and ask the
          model for insights.
        </p>
        <div className="hub__note">
          <span className="dot" /> {SOURCE_STATUS_LABEL} — values are structural
          placeholders until verified feeds are connected.
        </div>
      </header>

      <nav className="hub__tabs" role="tablist">
        {CATEGORIES.map((cat) => {
          const count =
            cat === "All"
              ? TOPICS.length
              : TOPICS.filter((t) => t.category === cat).length;
          return (
            <button
              key={cat}
              role="tab"
              aria-selected={tab === cat}
              className={`hub__tab${tab === cat ? " is-active" : ""}`}
              onClick={() => setTab(cat)}
            >
              {cat}
              <span className="hub__tab-count">{count}</span>
            </button>
          );
        })}
      </nav>

      <section className="hub__grid">
        {visible.map((topic) => {
          const national = nationalValue(topic.id);
          return (
            <button
              key={topic.id}
              type="button"
              className="topic-card"
              onClick={() => onOpenTopic(topic.id)}
              style={{ "--accent": topic.ramp[1] }}
            >
              <span className="topic-card__icon" aria-hidden>
                {topic.icon}
              </span>
              <span className="topic-card__category">{topic.category}</span>
              <span className="topic-card__label">{topic.label}</span>
              <span className="topic-card__value">
                {formatValue(topic.id, national)}
              </span>
              <span className="topic-card__desc">{topic.description}</span>
              <span className="topic-card__cta">Explore →</span>
            </button>
          );
        })}
      </section>
    </div>
  );
}
