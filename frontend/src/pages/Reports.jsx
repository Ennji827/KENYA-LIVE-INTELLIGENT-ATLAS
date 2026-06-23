import React, { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Download, FilePlus2, LoaderCircle, Search, ShieldCheck, X } from "lucide-react";
import { getApiBase } from "../utils/api";
import { cancelJob, waitForJob } from "../utils/processingJobs";

const statuses = ["", "draft", "reviewed", "approved", "published"];

function authHeaders(session, json = false) {
  return {
    Authorization: `Bearer ${session.token}`,
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

function statusLabel(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "All statuses";
}

export default function Reports({ filter, session, lockedCounty }) {
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(null);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [scopeLevel, setScopeLevel] = useState("");
  const [cropType, setCropType] = useState("");
  const [riskLevel, setRiskLevel] = useState("");
  const [dataSource, setDataSource] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("Loading report workflow…");
  const [showGenerator, setShowGenerator] = useState(false);
  const [title, setTitle] = useState("");
  const [question, setQuestion] = useState("");
  const [activeJob, setActiveJob] = useState(null);

  const scopeName = lockedCounty || filter?.county || "";
  const canGenerate = session.permissions?.includes("report_generate");

  const loadReports = async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({ page_size: "50" });
      if (status) query.set("status", status);
      if (search) query.set("search", search);
      if (scopeName) query.set("county", scopeName);
      if (scopeLevel) query.set("scope_level", scopeLevel);
      if (cropType) query.set("crop_type", cropType);
      if (riskLevel) query.set("risk_level", riskLevel);
      if (dataSource) query.set("data_source", dataSource);
      if (dateFrom) query.set("date_from", dateFrom);
      if (dateTo) query.set("date_to", dateTo);
      const response = await fetch(`${getApiBase()}/api/reports?${query}`, {
        headers: authHeaders(session),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to load reports.");
      setRows(payload.results || []);
      setMessage(`${payload.pagination?.total || 0} report(s) in this workspace.`);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReports();
  }, [status, scopeName, session.token]);

  useEffect(() => {
    let cancelled = false;
    async function resumeReportJob() {
      try {
        const response = await fetch(`${getApiBase()}/api/jobs?limit=20`, {
          headers: authHeaders(session),
        });
        const payload = await response.json();
        if (!response.ok) return;
        const pending = (payload.results || []).find(
          (job) => job.job_type === "report" && ["queued", "running"].includes(job.status),
        );
        if (!pending || cancelled) return;
        setActiveJob(pending);
        setMessage("Reconnected to report generation already in progress.");
        const completed = await waitForJob(
          pending.id,
          session,
          (job) => {
            if (!cancelled) setActiveJob(job);
          },
        );
        if (cancelled) return;
        if (completed.result?.report_id) {
          await openReport(completed.result.report_id);
          await loadReports();
          setMessage("Background report generation completed.");
        }
      } catch (error) {
        if (!cancelled) setMessage(error.message);
      } finally {
        if (!cancelled) setActiveJob(null);
      }
    }
    resumeReportJob();
    return () => {
      cancelled = true;
    };
  }, [session.token]);

  const openReport = async (id) => {
    const response = await fetch(`${getApiBase()}/api/reports/${id}`, {
      headers: authHeaders(session),
    });
    const payload = await response.json();
    if (response.ok) setSelected(payload.report);
    else setMessage(payload.error || "Unable to open report.");
  };

  const generate = async (event) => {
    event.preventDefault();
    setMessage("Queueing a source-grounded intelligence report...");
    try {
      const response = await fetch(`${getApiBase()}/api/reports`, {
        method: "POST",
        headers: authHeaders(session, true),
        body: JSON.stringify({
          title: title || `${scopeName || "Kenya"} Intelligence Brief`,
          question: question || "Generate a professional Ministry intelligence brief from connected evidence.",
          scope_level: scopeName ? "county" : "national",
          scope_name: scopeName,
          async: true,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Report generation failed.");
      setActiveJob(payload.job);
      const completed = await waitForJob(payload.job.id, session, setActiveJob);
      const reportId = completed.result?.report_id;
      if (!reportId) throw new Error("The report job completed without a report identifier.");
      await openReport(reportId);
      setShowGenerator(false);
      setTitle("");
      setQuestion("");
      setMessage("Draft report generated. Review evidence and missing data before approval.");
      await loadReports();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setActiveJob(null);
    }
  };

  const cancelActiveJob = async () => {
    if (!activeJob) return;
    try {
      const cancelled = await cancelJob(activeJob.id, session);
      setActiveJob(cancelled);
      setMessage("Queued report generation cancelled.");
    } catch (error) {
      setMessage(error.message);
    }
  };

  const transition = async (nextStatus) => {
    if (!selected) return;
    const response = await fetch(`${getApiBase()}/api/reports/${selected.id}/transition`, {
      method: "POST",
      headers: authHeaders(session, true),
      body: JSON.stringify({ status: nextStatus }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setMessage(payload.error || "Workflow update failed.");
      return;
    }
    setSelected(payload.report);
    setMessage(`Report moved to ${nextStatus}.`);
    loadReports();
  };

  const download = async (format) => {
    if (!selected) return;
    const response = await fetch(`${getApiBase()}/api/reports/${selected.id}/export/${format}`, {
      headers: authHeaders(session),
    });
    if (!response.ok) {
      const payload = await response.json();
      setMessage(payload.error || "Export failed.");
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `aeis-report-${selected.id}.${format}`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const nextActions = useMemo(() => {
    if (!selected) return [];
    if (selected.status === "draft" && session.permissions?.includes("report_review")) {
      return [{ status: "reviewed", label: "Mark reviewed" }];
    }
    if (selected.status === "reviewed" && session.permissions?.includes("report_approve")) {
      return [{ status: "approved", label: "Approve report" }];
    }
    if (selected.status === "approved" && session.permissions?.includes("report_publish")) {
      return [{ status: "published", label: "Publish report" }];
    }
    return [];
  }, [selected, session.permissions]);

  return (
    <div className="aeis-reports-page">
      <div className="aeis-topbar">
        <div>
          <div className="aeis-kicker">Auditable national reporting</div>
          <h1 className="aeis-title">Reports and Approval Workflow</h1>
          <p className="aeis-subtitle">
            Generate evidence-backed national and county briefs, review them, approve them, and export publication-ready files.
          </p>
        </div>
        {canGenerate && (
          <button type="button" className="aeis-btn" onClick={() => setShowGenerator((value) => !value)}>
            <FilePlus2 size={17} /> Generate report
          </button>
        )}
      </div>

      {showGenerator && (
        <form className="aeis-card aeis-report-generator" onSubmit={generate}>
          <div>
            <label>Report title</label>
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={`${scopeName || "Kenya"} Intelligence Brief`} />
          </div>
          <div>
            <label>Analysis instruction</label>
            <textarea value={question} onChange={(event) => setQuestion(event.target.value)} rows={3} placeholder="Describe the Ministry or county decision this report should support." />
          </div>
          <div className="aeis-report-generator-actions">
            <span>Scope: <strong>{scopeName || "National"}</strong></span>
            <button type="submit" className="aeis-btn">Create draft</button>
          </div>
        </form>
      )}

      {activeJob && (
        <div className={`aeis-processing-job ${activeJob.status}`}>
          <LoaderCircle className={activeJob.status === "running" ? "spin" : ""} size={18} />
          <div>
            <strong>{activeJob.status_message || "Processing report"}</strong>
            <span>{activeJob.progress}% complete · attempt {activeJob.attempts || 0}/{activeJob.max_attempts || 2}</span>
            <progress max="100" value={activeJob.progress || 0} />
          </div>
          {activeJob.status === "queued" && (
            <button type="button" onClick={cancelActiveJob}><X size={15} /> Cancel</button>
          )}
        </div>
      )}

      <div className="aeis-report-toolbar">
        <label>
          <Search size={16} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search reports…" />
        </label>
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          {statuses.map((item) => <option value={item} key={item || "all"}>{statusLabel(item)}</option>)}
        </select>
        <button type="button" onClick={loadReports}>Apply filters</button>
        <span>{message}</span>
      </div>
      <div className="aeis-report-filter-grid">
        <select value={scopeLevel} onChange={(event) => setScopeLevel(event.target.value)}>
          <option value="">All administrative levels</option>
          <option value="national">National</option>
          <option value="county">County</option>
          <option value="subcounty">Sub-county</option>
          <option value="ward">Ward</option>
        </select>
        <input value={cropType} onChange={(event) => setCropType(event.target.value)} placeholder="Crop type" />
        <input value={riskLevel} onChange={(event) => setRiskLevel(event.target.value)} placeholder="Risk level" />
        <input value={dataSource} onChange={(event) => setDataSource(event.target.value)} placeholder="Data source" />
        <label><span>From</span><input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
        <label><span>To</span><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
      </div>

      <div className="aeis-report-layout">
        <section className="aeis-card aeis-report-list">
          <header>
            <h2>Report register</h2>
            <span>{loading ? "Loading…" : rows.length}</span>
          </header>
          {rows.length ? rows.map((report) => (
            <button
              type="button"
              key={report.id}
              className={selected?.id === report.id ? "active" : ""}
              onClick={() => openReport(report.id)}
            >
              <div>
                <strong>{report.title}</strong>
                <span>{report.scope_level} · {report.scope_name}</span>
              </div>
              <em className={`aeis-report-status ${report.status}`}>{report.status}</em>
              <small>{new Date(report.updated_at).toLocaleDateString()}</small>
            </button>
          )) : <p className="aeis-empty-state">No reports match the current filters.</p>}
        </section>

        <section className="aeis-card aeis-report-preview">
          {selected ? (
            <>
              <header>
                <div>
                  <span>Report preview</span>
                  <h2>{selected.title}</h2>
                  <p>{selected.scope_level} · {selected.scope_name} · generated by {selected.generated_by}</p>
                </div>
                <span className={`aeis-report-status ${selected.status}`}>{selected.status}</span>
              </header>

              <div className="aeis-report-confidence">
                <ShieldCheck size={18} />
                <strong>{selected.confidence} confidence</strong>
                <span>{selected.data_sources?.length || 0} data source(s)</span>
              </div>

              {Object.entries(selected.content || {}).map(([section, value]) => (
                <article key={section}>
                  <h3>{section.replaceAll("_", " ")}</h3>
                  {Array.isArray(value) ? (
                    <ul>{value.map((item, index) => <li key={index}>{typeof item === "string" ? item : `${item.source}: ${item.observation}`}</li>)}</ul>
                  ) : <p>{String(value)}</p>}
                </article>
              ))}

              <div className="aeis-report-actions">
                {nextActions.map((action) => (
                  <button type="button" className="aeis-btn" key={action.status} onClick={() => transition(action.status)}>
                    <CheckCircle2 size={16} /> {action.label}
                  </button>
                ))}
                {["pdf", "csv", "xlsx", "geojson"].map((format) => (
                  <button type="button" key={format} onClick={() => download(format)}>
                    <Download size={15} /> {format.toUpperCase()}
                  </button>
                ))}
              </div>

              <details className="aeis-report-audit">
                <summary>Audit trail ({selected.audit_events?.length || 0})</summary>
                {(selected.audit_events || []).map((event, index) => (
                  <div key={index}>
                    <strong>{event.action}</strong>
                    <span>{event.actor || "system"} · {new Date(event.created_at).toLocaleString()}</span>
                  </div>
                ))}
              </details>
            </>
          ) : (
            <div className="aeis-ai-empty">
              <FilePlus2 size={42} />
              <h2>Select or generate a report</h2>
              <p>The preview shows evidence, confidence, missing data, workflow status, and audit history before export.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
