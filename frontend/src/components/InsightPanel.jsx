import React, { useEffect, useState } from "react";
import { postIntelligenceQuery, fetchIntelligenceStatus } from "../utils/apiClient";
import { localInsights, scopeLabel } from "../utils/intel";
import { getTopic } from "../data/topics";

// Suggested prompts adapt to the topic so the box is never a blank page.
function suggestions(topic) {
  return [
    `Which regions have the highest ${topic.label.toLowerCase()}?`,
    `Where is ${topic.label.toLowerCase()} lowest?`,
    `What is the average and how wide is the gap?`,
  ];
}

// AI insights panel. Analyses the current workspace (topic + scope + visible
// regions) and returns insights with reasons. Tries the backend intelligence
// endpoint first; on any failure falls back to the local analyser.
export default function InsightPanel({ topicId, scope, regions, dataStatus = "scaffolded" }) {
  const topic = getTopic(topicId);
  const [question, setQuestion] = useState("");
  const [insights, setInsights] = useState(null);
  const [source, setSource] = useState(null); // "model" | "local"
  const [loading, setLoading] = useState(false);
  // Live provider state from /api/intelligence/status (null until known/failed).
  const [provider, setProvider] = useState(null);

  // Probe the intelligence provider once so the panel can show whether answers
  // will come from the hosted model or the local rule-based fallback.
  useEffect(() => {
    let cancelled = false;
    fetchIntelligenceStatus()
      .then((status) => {
        if (!cancelled) setProvider(status?.provider || null);
      })
      .catch(() => {
        if (!cancelled) setProvider(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function analyze(q) {
    const query = (q ?? question).trim();
    setLoading(true);
    setInsights(null);

    // Everything the backend needs to resolve scope and ground the analysis in
    // exactly what is on screen: the topic (with unit/metric + source status)
    // and the per-region values, plus the raw scope names for drill-down.
    const workspace = {
      topic: topic.label,
      topic_id: topicId,
      unit: topic.unit,
      metric: topic.metricLabel,
      source_status: dataStatus,
      scope: scopeLabel(scope),
      level: scope.level,
      county: scope.county || "",
      subcounty: scope.subcounty || "",
      ward: scope.ward || "",
      regions: regions.map((r) => ({ name: r.name, value: r.value })),
    };

    try {
      // Now sent with the session bearer token via apiClient, so the backend
      // model path is actually reachable (previously always 403'd → local).
      const payload = await postIntelligenceQuery({ question: query, workspace });
      const modelInsights = normalizeModelResponse(payload);
      if (modelInsights.length) {
        setInsights(modelInsights);
        setSource("model");
        setLoading(false);
        return;
      }
    } catch {
      // Fall through to local analysis (backend offline or role not permitted).
    }

    setInsights(localInsights(topicId, scope, regions, query));
    setSource("local");
    setLoading(false);
  }

  return (
    <div className="insight-panel">
      <div className="insight-panel__head">
        <h3>Ask the model</h3>
        <p>
          The model analyses your current workspace —{" "}
          <strong>{topic.label}</strong> at <strong>{scopeLabel(scope)}</strong>{" "}
          — and explains its reasoning.
        </p>
        {provider && (
          <div className="insight-panel__provider">
            <span className="dot" />
            {provider.openai_configured
              ? `Intelligence model online · ${provider.openai_model}`
              : "Local rule-based engine (hosted model not configured)"}
          </div>
        )}
      </div>

      <form
        className="insight-panel__form"
        onSubmit={(e) => {
          e.preventDefault();
          analyze();
        }}
      >
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={`e.g. ${suggestions(topic)[0]}`}
          rows={2}
        />
        <button type="submit" disabled={loading}>
          {loading ? "Analysing…" : "Get insights"}
        </button>
      </form>

      <div className="insight-panel__suggestions">
        {suggestions(topic).map((s) => (
          <button
            key={s}
            type="button"
            className="chip"
            onClick={() => {
              setQuestion(s);
              analyze(s);
            }}
          >
            {s}
          </button>
        ))}
      </div>

      {insights && (
        <div className="insight-panel__results">
          <div className="insight-panel__source">
            {source === "model"
              ? "Answered by the intelligence model"
              : "Answered by the local analysis engine (model offline)"}
          </div>
          <ol>
            {insights.map((item, i) => (
              <li key={i}>
                <div className="insight-text">{item.text}</div>
                {item.reason && (
                  <div className="insight-reason">
                    <span>Why:</span> {item.reason}
                  </div>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
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
