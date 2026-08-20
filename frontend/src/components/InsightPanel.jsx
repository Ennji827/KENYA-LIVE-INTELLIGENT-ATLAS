import React, { useEffect, useState } from "react";
import { fetchIntelligenceStatus } from "../utils/apiClient";
import { scopeLabel } from "../utils/intel";
import { getTopic, suggestedQuestions } from "../data/topics";

// Ask-the-model launcher. It only composes the question — asking hands off to
// the insights page, which runs the analysis and owns the answer. Keeping the
// answer off this card stops a long response from expanding the workspace
// under the chart.
export default function InsightPanel({ topicId, scope, onAsk }) {
  const topic = getTopic(topicId);
  const [question, setQuestion] = useState("");
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

  const ask = (q) => {
    const query = (q ?? question).trim();
    if (query) onAsk(query);
  };

  return (
    <div className="composer composer--inline">
      <div className="composer__head">
        <h3 className="composer__title">Ask the model</h3>
        {provider && (
          <span
            className={`feed-pill feed-pill--${provider.openai_configured ? "live" : "idle"}`}
            title={
              provider.openai_configured
                ? `Hosted model: ${provider.openai_model}`
                : "Hosted model not configured — answers come from the local rule-based engine"
            }
          >
            <span className="status-dot" aria-hidden="true" />
            {provider.openai_configured ? "Model online" : "Local engine"}
          </span>
        )}
      </div>

      <p className="composer__sub">
        Analyses <strong>{topic.label}</strong> at{" "}
        <strong>{scopeLabel(scope)}</strong> and explains its reasoning.
      </p>

      <form
        className="composer__form"
        onSubmit={(e) => {
          e.preventDefault();
          ask();
        }}
      >
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={`e.g. ${suggestedQuestions(topic)[0]}`}
          rows={2}
          aria-label="Your question"
        />
        <button type="submit" className="btn" disabled={!question.trim()}>
          Get insights
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
      </form>

      <div className="chip-row">
        {suggestedQuestions(topic).map((s) => (
          <button
            key={s}
            type="button"
            className="chip"
            onClick={() => {
              setQuestion(s);
              ask(s);
            }}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
