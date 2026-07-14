import React, { useEffect, useMemo, useState } from "react";
import { TOPICS, SOURCE_STATUS_LABEL } from "../data/topics";
import TopicCard from "../components/TopicCard";
import { fetchDashboardSummary, fetchIntelligenceStatus } from "../utils/apiClient";

// Distinct topic categories, in display order, used as landing-page tabs.
const CATEGORIES = ["All", ...Array.from(new Set(TOPICS.map((t) => t.category)))];

// The single hub page: category tabs + all eight topics as clickable cards.
// The brand, user, and sign-out live in the shared SiteHeader above it.
export default function IntelHub({ onOpenTopic }) {
  const [tab, setTab] = useState("All");
  // Live operational figures from the backend; null until loaded/failed.
  const [summary, setSummary] = useState(null);
  const [provider, setProvider] = useState(null);

  // Pull live dashboard + model status once. Both are optional: if the backend
  // is unreachable we simply keep showing the scaffolded note below.
  useEffect(() => {
    let cancelled = false;
    fetchDashboardSummary()
      .then((data) => {
        if (!cancelled) setSummary(data?.summary || null);
      })
      .catch(() => {});
    fetchIntelligenceStatus()
      .then((status) => {
        if (!cancelled) setProvider(status?.provider || null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const stats = useMemo(() => {
    if (!summary) return [];
    return [
      { label: "Connected sources", value: summary.connectedSources },
      { label: "Active alerts", value: summary.openAlerts },
      { label: "Insights generated", value: summary.intelligenceInsights },
      { label: "Reports ready", value: summary.reportsReady },
    ].filter((s) => typeof s.value === "number");
  }, [summary]);

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

        {stats.length > 0 && (
          <div className="hub__stats" role="status">
            {stats.map((s) => (
              <div key={s.label} className="hub__stat">
                <span className="hub__stat-value">{s.value.toLocaleString()}</span>
                <span className="hub__stat-label">{s.label}</span>
              </div>
            ))}
            {provider && (
              <div className="hub__stat hub__stat--model">
                <span className="hub__stat-value">
                  {provider.openai_configured ? "Online" : "Local"}
                </span>
                <span className="hub__stat-label">
                  {provider.openai_configured
                    ? `Model · ${provider.openai_model}`
                    : "Rule-based engine"}
                </span>
              </div>
            )}
          </div>
        )}
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
