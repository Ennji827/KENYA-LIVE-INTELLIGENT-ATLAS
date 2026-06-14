import React, { useEffect, useMemo, useState } from "react";
import { getApiBase } from "../utils/api";

const defaultBands = {
  county: "",
  source: "",
  acquired_at: "",
  cloud_cover: "",
  nir: "",
  red: "",
  swir: "",
};

function statusTone(status) {
  if (status === "actual") return "actual";
  if (status === "actualizable" || status === "partial") return "partial";
  return "needed";
}

export default function SystemActualizationPanel({ compact = false }) {
  const [payload, setPayload] = useState(null);
  const [status, setStatus] = useState("Loading actualization status...");
  const [bands, setBands] = useState(defaultBands);
  const [evaluation, setEvaluation] = useState(null);
  const [evaluationStatus, setEvaluationStatus] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function loadActualization() {
      try {
        const response = await fetch(`${getApiBase()}/api/system/actualization`);
        const data = await response.json();
        if (!response.ok) {
          if (!cancelled) setStatus(data.error || "Actualization status unavailable.");
          return;
        }
        if (!cancelled) {
          setPayload(data);
          setStatus(`${data.status} / ${data.readiness}% readiness`);
        }
      } catch (error) {
        if (!cancelled) setStatus(error.message || "Actualization status unavailable.");
      }
    }
    loadActualization();
    return () => {
      cancelled = true;
    };
  }, []);

  const providers = useMemo(() => payload?.providers || [], [payload]);

  const updateBand = (field, value) => {
    setBands((current) => ({ ...current, [field]: value }));
  };

  const evaluateBands = async (event) => {
    event.preventDefault();
    if (!bands.county || !bands.source || !bands.acquired_at || bands.nir === "" || bands.red === "" || bands.swir === "") {
      setEvaluationStatus("Enter county, source, acquisition date, NIR, Red, and SWIR from a real raster source.");
      return;
    }
    setEvaluationStatus("Evaluating real band values...");
    try {
      const response = await fetch(`${getApiBase()}/api/indices/evaluate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...bands,
          nir: Number(bands.nir),
          red: Number(bands.red),
          swir: Number(bands.swir),
          cloud_cover: bands.cloud_cover === "" ? null : Number(bands.cloud_cover),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setEvaluationStatus(data.error || "Evaluation failed.");
        return;
      }
      setEvaluation(data);
      setEvaluationStatus(`Evaluation complete: ${data.classification.outcome}`);
    } catch (error) {
      setEvaluationStatus(error.message || "Evaluation failed.");
    }
  };

  return (
    <div className="aeis-card aeis-card-pad aeis-actualization-card">
      <div className="aeis-card-heading">
        <div>
          <h2 className="aeis-section-title">System Actualization</h2>
          <p className="aeis-section-copy">
            Production-readiness view separating actual connected capability from unconnected provider gaps.
          </p>
        </div>
        <div className="aeis-actual-score">
          <strong>{payload?.readiness ?? "--"}%</strong>
          <span>Readiness</span>
        </div>
      </div>

      <div className="aeis-actual-status">{status}</div>

      <div className="aeis-provider-list">
        {providers.map((provider) => (
          <div className="aeis-provider-row" key={provider.name}>
            <div>
              <strong>{provider.name}</strong>
              <span>{provider.evidence}</span>
            </div>
            <em className={statusTone(provider.status)}>{provider.status}</em>
            <b>{provider.readiness}%</b>
          </div>
        ))}
      </div>

      {!compact && (
        <>
          <div className="aeis-actual-columns">
            <div>
              <h3 className="aeis-mini-heading">Production Blockers</h3>
              <div className="aeis-actual-list">
                {(payload?.blockers || []).map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
            </div>
            <div>
              <h3 className="aeis-mini-heading">Next Actions</h3>
              <div className="aeis-actual-list">
                {(payload?.next_actions || []).map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
            </div>
          </div>

          <form className="aeis-band-evaluator" onSubmit={evaluateBands}>
            <h3 className="aeis-mini-heading">Actual NDVI / NDWI Band Evaluator</h3>
            <div className="aeis-band-grid">
              <label>
                County
                <input value={bands.county} onChange={(event) => updateBand("county", event.target.value)} />
              </label>
              <label>
                Source
                <input value={bands.source} onChange={(event) => updateBand("source", event.target.value)} />
              </label>
              <label>
                Acquisition date
                <input type="date" value={bands.acquired_at} onChange={(event) => updateBand("acquired_at", event.target.value)} />
              </label>
              <label>
                Cloud %
                <input type="number" step="0.1" value={bands.cloud_cover} onChange={(event) => updateBand("cloud_cover", event.target.value)} />
              </label>
              <label>
                NIR
                <input type="number" step="0.001" value={bands.nir} onChange={(event) => updateBand("nir", event.target.value)} />
              </label>
              <label>
                Red
                <input type="number" step="0.001" value={bands.red} onChange={(event) => updateBand("red", event.target.value)} />
              </label>
              <label>
                SWIR
                <input type="number" step="0.001" value={bands.swir} onChange={(event) => updateBand("swir", event.target.value)} />
              </label>
            </div>
            <div className="aeis-btn-row">
              <button type="submit" className="aeis-btn">Evaluate bands</button>
              <span className="aeis-source-note">{evaluationStatus}</span>
            </div>
          </form>

          {evaluation && (
            <div className="aeis-index-outcome">
              <div>
                <span>NDVI</span>
                <strong>{evaluation.indices.ndvi}</strong>
              </div>
              <div>
                <span>NDWI</span>
                <strong>{evaluation.indices.ndwi}</strong>
              </div>
              <div>
                <span>Outcome</span>
                <strong>{evaluation.classification.outcome}</strong>
              </div>
              <div>
                <span>Confidence</span>
                <strong>{evaluation.confidence}%</strong>
              </div>
            </div>
          )}

          {evaluation && (
            <div className="aeis-index-decision">
              <h3 className="aeis-mini-heading">Evaluator Action</h3>
              <p>{evaluation.action}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
