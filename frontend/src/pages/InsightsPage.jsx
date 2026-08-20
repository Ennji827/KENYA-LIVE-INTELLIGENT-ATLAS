import React, { useEffect, useMemo, useState } from "react";
import { postIntelligenceQuery } from "../utils/apiClient";
import { localInsights, scopeLabel } from "../utils/intel";
import { getTopic, regionValue, suggestedQuestions } from "../data/topics";
import {
  loadRegionFeatures,
  mapLevelFor,
  nameKeyFor,
} from "../utils/geo";

const BackIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M19 12H5M12 19l-7-7 7-7" />
  </svg>
);

const LinkIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
    <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
  </svg>
);

const SendIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

// Full-page answer for one question about one scope.
//
// The question and scope live in the URL, so an answer is shareable and
// survives a refresh. `regions` is handed over from the workspace when you ask
// from there — those are the exact values you were looking at, live feed
// included. On a cold load (shared link, refresh, back button) there is no
// handoff, so the page resolves the same regions itself from the boundary
// data, falling back to scaffolded values.
export default function InsightsPage({
  topicId,
  scope,
  question,
  regions: handoffRegions,
  dataStatus: handoffStatus,
  onBack,
  onAsk,
}) {
  const topic = getTopic(topicId);
  const [regions, setRegions] = useState(handoffRegions || null);
  const [dataStatus, setDataStatus] = useState(handoffStatus || "scaffolded");
  const [insights, setInsights] = useState(null);
  const [source, setSource] = useState(null); // "model" | "local"
  const [loading, setLoading] = useState(true);
  const [followUp, setFollowUp] = useState("");
  const [copied, setCopied] = useState(false);

  const scopeText = scopeLabel(scope);

  // Cold load: no handoff, so rebuild the region list from the boundary data.
  useEffect(() => {
    if (handoffRegions) {
      setRegions(handoffRegions);
      setDataStatus(handoffStatus || "scaffolded");
      return undefined;
    }
    let cancelled = false;
    const level = mapLevelFor(scope.level);
    const nameKey = nameKeyFor(level);
    loadRegionFeatures({
      level,
      county: scope.county,
      subcounty: scope.subcounty,
    })
      .then((features) => {
        if (cancelled) return;
        setRegions(
          features
            .map((f) => {
              const name = f.properties?.[nameKey];
              return { name, value: regionValue(topicId, name) };
            })
            .filter((r) => r.name)
            .sort((a, b) => b.value - a.value),
        );
        setDataStatus("scaffolded");
      })
      .catch(() => {
        if (!cancelled) setRegions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [handoffRegions, handoffStatus, topicId, scope]);

  // Run the analysis once the regions are known. Tries the backend
  // intelligence endpoint first; any failure falls back to the local analyser.
  useEffect(() => {
    if (!regions) return undefined;
    let cancelled = false;
    setLoading(true);
    setInsights(null);

    // Everything the backend needs to resolve scope and ground the analysis in
    // exactly what was on screen.
    const workspace = {
      topic: topic.label,
      topic_id: topicId,
      unit: topic.unit,
      metric: topic.metricLabel,
      source_status: dataStatus,
      scope: scopeText,
      level: scope.level,
      county: scope.county || "",
      subcounty: scope.subcounty || "",
      regions: regions.map((r) => ({ name: r.name, value: r.value })),
    };

    postIntelligenceQuery({ question, workspace })
      .then((payload) => {
        if (cancelled) return;
        const modelInsights = normalizeModelResponse(payload);
        if (!modelInsights.length) throw new Error("empty");
        setInsights(modelInsights);
        setSource("model");
        setLoading(false);
      })
      .catch(() => {
        // Backend offline, role not permitted, or an unusable response.
        if (cancelled) return;
        setInsights(localInsights(topicId, scope, regions, question));
        setSource("local");
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [regions, dataStatus, question, topicId, scope, scopeText, topic]);

  const prompts = useMemo(() => suggestedQuestions(topic), [topic]);

  // The whole view — topic, scope and question — is in the URL, so "share this
  // answer" is just the address bar. Surfacing it as a button is the difference
  // between a feature that exists and one anybody uses.
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (insecure origin, permission denied) — the address
      // bar still holds the same link, so this stays silent.
    }
  };

  return (
    <div className="insights">
      <div className="insights__bar">
        <button type="button" className="link-btn" onClick={onBack}>
          <BackIcon />
          Back to map · {scopeText}
        </button>
        <button type="button" className="link-btn" onClick={copyLink}>
          <LinkIcon />
          {copied ? "Link copied" : "Copy link"}
        </button>
      </div>

      <header className="insights__head" style={{ "--accent": topic.ramp[1] }}>
        <div className="insights__tags">
          <span className="tag tag--accent">
            <span aria-hidden="true">{topic.icon}</span>
            {topic.label}
          </span>
          <span className="tag">{scopeText}</span>
          <span className={`tag tag--${dataStatus === "connected" ? "live" : "draft"}`}>
            <span className="status-dot" aria-hidden="true" />
            {dataStatus === "connected" ? "Live data" : "Scaffolded values"}
          </span>
        </div>

        <h1 className="insights__question">
          {question || "Overview of the current view"}
        </h1>

        <dl className="insights__facts">
          <div className="fact">
            <dt>Analysed by</dt>
            <dd>
              {loading
                ? "…"
                : source === "model"
                  ? "Intelligence model"
                  : "Local analysis engine"}
            </dd>
          </div>
          <div className="fact">
            <dt>Regions in view</dt>
            <dd className="u-num">{regions ? regions.length : "…"}</dd>
          </div>
          <div className="fact">
            <dt>Metric</dt>
            <dd>{topic.metricLabel}</dd>
          </div>
        </dl>
      </header>

      {loading && (
        <ol className="insight-list" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <li key={i} className="insight-card insight-card--loading">
              <span className="insight-card__index u-num">{i + 1}</span>
              <div className="insight-card__body">
                <span className="u-skeleton insight-card__bar" />
                <span className="u-skeleton insight-card__bar insight-card__bar--short" />
              </div>
            </li>
          ))}
        </ol>
      )}

      {!loading && insights?.length > 0 && (
        <ol className="insight-list">
          {insights.map((item, i) => (
            <li key={i} className="insight-card">
              <span className="insight-card__index u-num">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div className="insight-card__body">
                <p className="insight-card__text">{item.text}</p>
                {item.reason && (
                  <p className="insight-card__reason">
                    <span className="u-eyebrow">Why</span>
                    {item.reason}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}

      {!loading && insights?.length === 0 && (
        <div className="empty-state">
          <h2>No insights for this view</h2>
          <p>
            Nothing could be derived from the regions currently in scope. Try a
            wider area, or ask a different question below.
          </p>
        </div>
      )}

      <section className="composer">
        <h2 className="composer__title">Ask another question</h2>
        <p className="composer__sub">
          Answers are grounded in the {regions ? regions.length : ""} regions of{" "}
          <strong>{scopeText}</strong> currently in scope.
        </p>

        <form
          className="composer__form"
          onSubmit={(e) => {
            e.preventDefault();
            const q = followUp.trim();
            if (q) {
              setFollowUp("");
              onAsk(q);
            }
          }}
        >
          <textarea
            value={followUp}
            onChange={(e) => setFollowUp(e.target.value)}
            placeholder={`e.g. ${prompts[1]}`}
            rows={2}
            aria-label="Your question"
          />
          <button type="submit" className="btn" disabled={!followUp.trim()}>
            Get insights
            <SendIcon />
          </button>
        </form>

        <div className="chip-row">
          {prompts
            .filter((p) => p !== question)
            .map((p) => (
              <button
                key={p}
                type="button"
                className="chip"
                onClick={() => onAsk(p)}
              >
                {p}
              </button>
            ))}
        </div>
      </section>
    </div>
  );
}

// Accept a few plausible backend shapes and reduce them to {text, reason}[].
function normalizeModelResponse(payload) {
  if (!payload) return [];
  if (Array.isArray(payload.insights)) {
    return payload.insights
      .map((i) =>
        typeof i === "string"
          ? { text: i, reason: "" }
          : { text: i.text || i.insight || "", reason: i.reason || i.explanation || "" },
      )
      .filter((i) => i.text);
  }
  if (payload.answer || payload.explanation) {
    return [
      {
        text: payload.answer || payload.summary || "",
        reason: payload.explanation || payload.reason || "",
      },
    ].filter((i) => i.text);
  }
  return [];
}
