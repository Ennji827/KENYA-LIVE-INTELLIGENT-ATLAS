import React, { useMemo, useState } from "react";
import { TOPICS, SOURCE_STATUS_LABEL } from "../data/topics";
import TopicCard from "../components/TopicCard";

// Distinct topic categories, in display order, used as landing-page tabs.
const CATEGORIES = ["All", ...Array.from(new Set(TOPICS.map((t) => t.category)))];

// The single hub page: category tabs + all eight topics as clickable cards.
// The brand, user, and sign-out live in the shared SiteHeader above it.
export default function IntelHub({ onOpenTopic }) {
  const [tab, setTab] = useState("All");

  const visible = useMemo(
    () => (tab === "All" ? TOPICS : TOPICS.filter((t) => t.category === tab)),
    [tab],
  );

  return (
    <div className="hub">
      <header className="hub__hero">
        <div className="hub__eyebrow">AEIS-K · Critical Intelligence System</div>
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
        {visible.map((topic) => (
          <TopicCard
            key={topic.id}
            topic={topic}
            onClick={() => onOpenTopic(topic.id)}
          />
        ))}
      </section>
    </div>
  );
}
