import React, { useEffect, useState } from "react";
import { Bot, Database, FileWarning, Lightbulb, LoaderCircle, Send, ShieldCheck, X } from "lucide-react";
import { getApiBase } from "../utils/api";
import { cancelJob, waitForJob } from "../utils/processingJobs";

const starterQuestions = [
  "Which counties have the lowest rainfall forecast and need verification?",
  "Summarize rainfall, water, vegetation, and land conditions in Nyandarua.",
  "Which wards need field verification?",
  "Generate a Ministry intelligence brief.",
];

function Section({ title, items, tone = "" }) {
  if (!items?.length) return null;
  return (
    <section className={`aeis-ai-section ${tone}`}>
      <h3>{title}</h3>
      <ul>
        {items.map((item, index) => (
          <li key={`${title}-${index}`}>{typeof item === "string" ? item : `${item.source}: ${item.observation}`}</li>
        ))}
      </ul>
    </section>
  );
}

export default function IntelligenceAssistant({ session, filter, initialQuestion = "" }) {
  const [status, setStatus] = useState(null);
  const [question, setQuestion] = useState("");
  const [scopeLevel, setScopeLevel] = useState(
    filter?.ward ? "ward" : filter?.subcounty ? "subcounty" : filter?.county ? "county" : "national",
  );
  const [scopeName, setScopeName] = useState(filter?.ward || filter?.subcounty || filter?.county || "");
  const [answer, setAnswer] = useState(null);
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  const [activeJob, setActiveJob] = useState(null);
  const [message, setMessage] = useState("Ask a source-grounded question about rainfall, water, vegetation, land use, roads, soil, GIS, or field operations.");

  const headers = { Authorization: `Bearer ${session.token}` };

  useEffect(() => {
    if (initialQuestion) setQuestion(initialQuestion);
  }, [initialQuestion]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`${getApiBase()}/api/intelligence/status`, { headers }).then((response) => response.json()),
      fetch(`${getApiBase()}/api/intelligence/insights?limit=8`, { headers }).then((response) => response.json()),
    ])
      .then(([statusPayload, historyPayload]) => {
        if (!cancelled) {
          setStatus(statusPayload);
          setHistory(historyPayload.results || []);
        }
      })
      .catch(() => {
        if (!cancelled) setMessage("Intelligence service is unavailable.");
      });
    return () => {
      cancelled = true;
    };
  }, [session.token]);

  useEffect(() => {
    if (filter?.ward) {
      setScopeLevel("ward");
      setScopeName(filter.ward);
    } else if (filter?.subcounty) {
      setScopeLevel("subcounty");
      setScopeName(filter.subcounty);
    } else if (filter?.county) {
      setScopeLevel("county");
      setScopeName(filter.county);
    }
  }, [filter?.county, filter?.subcounty, filter?.ward]);

  useEffect(() => {
    let cancelled = false;
    async function resumeIntelligenceJob() {
      try {
        const response = await fetch(`${getApiBase()}/api/jobs?limit=20`, { headers });
        const payload = await response.json();
        if (!response.ok) return;
        const pending = (payload.results || []).find(
          (job) => job.job_type === "intelligence" && ["queued", "running"].includes(job.status),
        );
        if (!pending || cancelled) return;
        setBusy(true);
        setActiveJob(pending);
        setMessage("Reconnected to intelligence analysis already in progress.");
        const completed = await waitForJob(
          pending.id,
          session,
          (job) => {
            if (!cancelled) setActiveJob(job);
          },
        );
        if (cancelled) return;
        const result = completed.result?.intelligence;
        if (result) {
          setAnswer(result);
          setMessage("Background intelligence analysis completed.");
        }
      } catch (error) {
        if (!cancelled) setMessage(error.message);
      } finally {
        if (!cancelled) {
          setBusy(false);
          setActiveJob(null);
        }
      }
    }
    resumeIntelligenceJob();
    return () => {
      cancelled = true;
    };
  }, [session.token]);

  const submit = async (event) => {
    event?.preventDefault();
    if (!question.trim()) return;
    setBusy(true);
    setMessage("Queueing evidence review...");
    try {
      const response = await fetch(`${getApiBase()}/api/intelligence/query`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          scope_level: scopeName ? scopeLevel : "national",
          scope_name: scopeName,
          provider: "auto",
          async: true,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Intelligence request failed.");
      setActiveJob(payload.job);
      const completed = await waitForJob(payload.job.id, session, setActiveJob);
      const result = completed.result?.intelligence;
      if (!result) throw new Error("The intelligence job completed without an analysis result.");
      setAnswer(result);
      setHistory((current) => [
        {
          id: result.id,
          scope_name: result.scope.name,
          question,
          executive_summary: result.executive_summary,
          confidence: result.confidence,
          provider: result.provider,
          created_at: result.generated_at,
        },
        ...current,
      ].slice(0, 8));
      setMessage("Analysis complete. Review the confidence, evidence, and missing-data sections before acting.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
      setActiveJob(null);
    }
  };

  const cancelActiveJob = async () => {
    if (!activeJob) return;
    try {
      const cancelled = await cancelJob(activeJob.id, session);
      setActiveJob(cancelled);
      setMessage("Queued intelligence analysis cancelled.");
    } catch (error) {
      setMessage(error.message);
    }
  };

  return (
    <div className="aeis-intelligence-page">
      <div className="aeis-topbar">
        <div>
          <div className="aeis-kicker">Evidence-grounded decision support</div>
          <h1 className="aeis-title">AEIS-K Intelligence Assistant</h1>
          <p className="aeis-subtitle">
            Ask questions across connected weather, satellite catalogues, GIS assets, alerts, and field reports. Missing evidence is always disclosed.
          </p>
        </div>
        <div className="aeis-ai-provider-badge">
          <Bot size={18} />
          <div>
            <strong>{status?.provider?.active === "openai_responses" ? "OpenAI Responses" : "Local trusted analysis"}</strong>
            <span>{status?.provider?.safety_rule || "Connected evidence only"}</span>
          </div>
        </div>
      </div>

      <div className="aeis-ai-layout">
        <aside className="aeis-card aeis-ai-history">
          <div className="aeis-ai-history-head">
            <h2>Recent intelligence</h2>
            <span>{history.length}</span>
          </div>
          {history.length ? history.map((item) => (
            <button type="button" key={item.id} onClick={() => setQuestion(item.question || "")}>
              <strong>{item.scope_name || "Kenya"}</strong>
              <span>{item.question || "Intelligence brief"}</span>
              <em>{item.confidence} confidence</em>
            </button>
          )) : <p>No intelligence history yet.</p>}
        </aside>

        <main className="aeis-card aeis-ai-workspace">
          <form className="aeis-ai-composer" onSubmit={submit}>
            <div className="aeis-ai-scope">
              <label htmlFor="aeis-ai-scope">Analysis scope</label>
              <select
                value={scopeLevel}
                onChange={(event) => {
                  setScopeLevel(event.target.value);
                  if (event.target.value === "national") setScopeName("");
                }}
                disabled={["county", "field_officer", "farmer"].includes(session.role)}
              >
                <option value="national">National</option>
                <option value="county">County</option>
                <option value="subcounty">Sub-county</option>
                <option value="ward">Ward</option>
              </select>
              <input
                id="aeis-ai-scope"
                value={scopeName}
                onChange={(event) => setScopeName(event.target.value)}
                placeholder={scopeLevel === "national" ? "Kenya" : `Enter ${scopeLevel.replace("county", "-county")} name`}
                disabled={scopeLevel === "national" || ["county", "field_officer", "farmer"].includes(session.role)}
              />
            </div>
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Ask which areas need verification, request a county brief, or compare available climate evidence…"
              rows={4}
            />
            <div className="aeis-ai-starters">
              {starterQuestions.map((starter) => (
                <button type="button" key={starter} onClick={() => setQuestion(starter)}>
                  {starter}
                </button>
              ))}
            </div>
            <div className="aeis-ai-submit-row">
              <p>{message}</p>
              <button type="submit" className="aeis-btn" disabled={busy || !question.trim()}>
                <Send size={16} /> {busy ? "Analyzing…" : "Analyze evidence"}
              </button>
            </div>
            {activeJob && (
              <div className={`aeis-processing-job ${activeJob.status}`}>
                <LoaderCircle className={activeJob.status === "running" ? "spin" : ""} size={18} />
                <div>
                  <strong>{activeJob.status_message || "Processing intelligence"}</strong>
                  <span>{activeJob.progress}% complete · attempt {activeJob.attempts || 0}/{activeJob.max_attempts || 2}</span>
                  <progress max="100" value={activeJob.progress || 0} />
                </div>
                {activeJob.status === "queued" && (
                  <button type="button" onClick={cancelActiveJob}><X size={15} /> Cancel</button>
                )}
              </div>
            )}
          </form>

          {answer ? (
            <article className="aeis-ai-answer">
              <header>
                <div>
                  <span>{answer.scope.level} intelligence</span>
                  <h2>{answer.scope.name}</h2>
                </div>
                <span className={`aeis-confidence ${answer.confidence}`}>
                  <ShieldCheck size={16} /> {answer.confidence} confidence
                </span>
              </header>
              <div className="aeis-ai-executive">
                <Lightbulb size={20} />
                <div>
                  <h3>Executive Summary</h3>
                  <p>{answer.executive_summary}</p>
                </div>
              </div>
              <div className="aeis-ai-section-grid">
                <Section title="Key Observations" items={answer.key_observations} />
                <Section title="Risk Areas" items={answer.risk_areas} tone="risk" />
                <Section title="Affected Areas" items={answer.affected_areas} />
                <Section title="Recommended Actions" items={answer.recommended_actions} tone="action" />
                <Section title="Climate and Satellite Evidence" items={answer.evidence} />
              </div>
              <div className="aeis-ai-trust-grid">
                <section>
                  <h3><Database size={16} /> Data Sources Used</h3>
                  {answer.data_sources.map((source) => (
                    <div key={`${source.name}-${source.category}`}>
                      <strong>{source.name}</strong>
                      <span>{source.category} · {source.status}</span>
                    </div>
                  ))}
                </section>
                <section>
                  <h3><FileWarning size={16} /> Missing Data</h3>
                  <ul>{answer.missing_data.map((item) => <li key={item}>{item}</li>)}</ul>
                </section>
              </div>
              <details className="aeis-explainability">
                <summary>What does this mean? Explain how this result was produced</summary>
                <p>{answer.explainability}</p>
              </details>
            </article>
          ) : (
            <div className="aeis-ai-empty">
              <Bot size={42} />
              <h2>Intelligence that shows its evidence</h2>
              <p>Select a starter question or enter your own. AEIS-K will not fill missing NDVI, rainfall history, land-cover, or field evidence with invented values.</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
