import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchReports,
  fetchReport,
  createReport,
  transitionReport,
  downloadReport,
} from "../utils/apiClient";

// ── Workflow model (mirrors services/reports.py) ────────────────────
// The backend is the source of truth for what is allowed; we mirror it here
// purely to decide which buttons to show. Any drift fails safe: the backend
// rejects the transition and we surface its error.
const STATUS_ORDER = ["draft", "reviewed", "approved", "published"];

const STATUS_LABEL = {
  draft: "Draft",
  reviewed: "Reviewed",
  approved: "Approved",
  published: "Published",
};

// Allowed next states from a given status (reports.py TRANSITIONS).
const NEXT_STATES = {
  draft: ["reviewed"],
  reviewed: ["draft", "approved"],
  approved: ["reviewed", "published"],
  published: [],
};

// Roles permitted to move a report *into* each target (reports.py required_roles).
const TARGET_ROLES = {
  reviewed: ["ministry", "analyst", "county"],
  approved: ["ministry"],
  published: ["ministry"],
  draft: ["ministry", "analyst"],
};

const EXPORT_FORMATS = [
  { key: "pdf", label: "PDF" },
  { key: "xlsx", label: "Excel" },
  { key: "csv", label: "CSV" },
  { key: "geojson", label: "GeoJSON" },
];

const SCOPE_LEVELS = [
  { value: "national", label: "National" },
  { value: "county", label: "County" },
  { value: "subcounty", label: "Sub-county" },
  { value: "ward", label: "Ward" },
];

function transitionLabel(from, to) {
  if (to === "reviewed" && from === "draft") return "Mark reviewed";
  if (to === "reviewed") return "Return to review";
  if (to === "approved") return "Approve";
  if (to === "published") return "Publish";
  if (to === "draft") return "Return to draft";
  return `Move to ${STATUS_LABEL[to] || to}`;
}

// Render one content value: strings as-is, dicts flattened to "k: v" pairs.
function renderValue(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.entries(value)
      .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`)
      .join("; ");
  }
  return String(value ?? "");
}

function titleCase(key) {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function StatusBadge({ status }) {
  return (
    <span className={`report-badge report-badge--${status}`}>
      {STATUS_LABEL[status] || status}
    </span>
  );
}

// ── Generate-report modal ───────────────────────────────────────────
function GenerateModal({ onClose, onCreated }) {
  const [title, setTitle] = useState("");
  const [scopeLevel, setScopeLevel] = useState("national");
  const [scopeName, setScopeName] = useState("");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = {
        title: title.trim(),
        scope_level: scopeLevel,
        scope_name: scopeName.trim(),
        question: question.trim(),
      };
      const { report } = await createReport(body);
      onCreated(report);
    } catch (err) {
      setError(err.message || "Report generation failed.");
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <div>
            <div className="modal__eyebrow">New intelligence report</div>
            <h3>Generate a report</h3>
          </div>
          <button type="button" className="modal__close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <form className="reports__form" onSubmit={submit}>
          <label className="reports__field">
            <span>Title <em>(optional)</em></span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Nakuru drought brief"
            />
          </label>

          <div className="reports__field-row">
            <label className="reports__field">
              <span>Scope level</span>
              <select value={scopeLevel} onChange={(e) => setScopeLevel(e.target.value)}>
                {SCOPE_LEVELS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </label>
            <label className="reports__field">
              <span>Area name {scopeLevel !== "national" && <em>(required)</em>}</span>
              <input
                type="text"
                value={scopeName}
                onChange={(e) => setScopeName(e.target.value)}
                placeholder={scopeLevel === "national" ? "Kenya" : "e.g. Nakuru"}
                disabled={scopeLevel === "national"}
              />
            </label>
          </div>

          <label className="reports__field">
            <span>Focus question <em>(optional)</em></span>
            <textarea
              rows={3}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="What should this report investigate? Leave blank for a full brief."
            />
          </label>

          {error && <p className="reports__error">{error}</p>}

          <div className="modal__actions">
            <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn" disabled={busy}>
              {busy ? "Generating…" : "Generate report"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Report detail ───────────────────────────────────────────────────
function ReportDetail({ report, role, onBack, onChanged }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const targets = (NEXT_STATES[report.status] || []).filter((t) =>
    (TARGET_ROLES[t] || []).includes(role),
  );

  const doTransition = async (target) => {
    setBusy(target);
    setError("");
    try {
      const { report: updated } = await transitionReport(report.id, target, note);
      setNote("");
      onChanged(updated);
    } catch (err) {
      setError(err.message || "Transition failed.");
    }
    setBusy("");
  };

  const doExport = async (fmt) => {
    setBusy(`export:${fmt}`);
    setError("");
    try {
      const { blob, filename } = await downloadReport(report.id, fmt);
      saveBlob(blob, filename);
    } catch (err) {
      setError(err.message || "Export failed.");
    }
    setBusy("");
  };

  const contentEntries = Object.entries(report.content || {});

  return (
    <div className="report-detail">
      <button type="button" className="reports__back" onClick={onBack}>
        ← All reports
      </button>

      <header className="report-detail__head panel">
        <div className="report-detail__title">
          <StatusBadge status={report.status} />
          <h1>{report.title}</h1>
          <p className="report-detail__meta">
            {titleCase(report.scope_level)}
            {report.scope_name ? ` · ${report.scope_name}` : ""} · Confidence:{" "}
            {report.confidence} · By {report.generated_by} ·{" "}
            {new Date(report.updated_at).toLocaleString()}
          </p>
        </div>

        <div className="report-detail__exports">
          {EXPORT_FORMATS.map((f) => (
            <button
              key={f.key}
              type="button"
              className="chip"
              onClick={() => doExport(f.key)}
              disabled={busy === `export:${f.key}`}
            >
              {busy === `export:${f.key}` ? "…" : `↓ ${f.label}`}
            </button>
          ))}
        </div>
      </header>

      {(targets.length > 0 || error) && (
        <div className="report-detail__workflow panel">
          {targets.length > 0 && (
            <>
              <label className="reports__field">
                <span>Workflow note <em>(optional)</em></span>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Add context for this status change"
                />
              </label>
              <div className="report-detail__actions">
                {targets.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={t === "published" || t === "approved" ? "btn" : "btn btn--ghost"}
                    onClick={() => doTransition(t)}
                    disabled={!!busy}
                  >
                    {busy === t ? "Working…" : transitionLabel(report.status, t)}
                  </button>
                ))}
              </div>
            </>
          )}
          {error && <p className="reports__error">{error}</p>}
        </div>
      )}

      <div className="report-detail__body panel">
        {contentEntries.length === 0 && <p>No content sections in this report.</p>}
        {contentEntries.map(([section, value]) => {
          const items = Array.isArray(value) ? value : [value];
          return (
            <section key={section} className="report-section">
              <h2>{titleCase(section)}</h2>
              {items.length === 1 ? (
                <p>{renderValue(items[0])}</p>
              ) : (
                <ul>
                  {items.map((item, i) => (
                    <li key={i}>{renderValue(item)}</li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      {Array.isArray(report.audit_events) && report.audit_events.length > 0 && (
        <div className="report-detail__audit panel">
          <h2>Audit trail</h2>
          <ol className="report-audit">
            {report.audit_events.map((ev, i) => (
              <li key={i}>
                <strong>{titleCase(ev.action)}</strong>
                {ev.from_status && ev.to_status
                  ? ` · ${STATUS_LABEL[ev.from_status] || ev.from_status} → ${
                      STATUS_LABEL[ev.to_status] || ev.to_status
                    }`
                  : ev.to_status
                    ? ` · ${STATUS_LABEL[ev.to_status] || ev.to_status}`
                    : ""}
                {ev.actor ? ` · ${ev.actor}` : ""}
                <span className="report-audit__time">
                  {new Date(ev.created_at).toLocaleString()}
                </span>
                {ev.note && <div className="report-audit__note">{ev.note}</div>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

// ── Reports workspace (list + detail) ───────────────────────────────
export default function ReportsWorkspace({ user }) {
  const perms = user?.permissions || [];
  const role = user?.role || "";
  const canGenerate = perms.includes("report_generate");

  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);

  const [data, setData] = useState(null); // { results, pagination }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [selected, setSelected] = useState(null); // full report
  const [detailLoading, setDetailLoading] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);

  const loadList = useCallback(() => {
    setLoading(true);
    setError("");
    fetchReports({ status, search, page, page_size: 20 })
      .then((payload) => setData(payload))
      .catch((err) => setError(err.message || "Could not load reports."))
      .finally(() => setLoading(false));
  }, [status, search, page]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const openReport = async (id) => {
    setDetailLoading(true);
    setError("");
    try {
      const { report } = await fetchReport(id);
      setSelected(report);
    } catch (err) {
      setError(err.message || "Could not open report.");
    }
    setDetailLoading(false);
  };

  const onDetailChanged = (updated) => {
    setSelected(updated);
    loadList();
  };

  const onGenerated = (report) => {
    setShowGenerate(false);
    setSelected(report);
    loadList();
  };

  const pagination = data?.pagination;
  const reports = data?.results || [];

  const statusTabs = useMemo(
    () => [{ value: "", label: "All" }, ...STATUS_ORDER.map((s) => ({ value: s, label: STATUS_LABEL[s] }))],
    [],
  );

  if (selected) {
    return (
      <div className="reports">
        <ReportDetail
          report={selected}
          role={role}
          onBack={() => setSelected(null)}
          onChanged={onDetailChanged}
        />
      </div>
    );
  }

  return (
    <div className="reports">
      <header className="reports__hero">
        <div>
          <div className="reports__eyebrow">KENYA LIVE ATLAS · Intelligence Reports</div>
          <h1>Reports</h1>
          <p>
            Browse, export, and advance AI-generated intelligence reports through
            their review and approval workflow.
          </p>
        </div>
        {canGenerate && (
          <button type="button" className="btn" onClick={() => setShowGenerate(true)}>
            + Generate report
          </button>
        )}
      </header>

      <div className="reports__toolbar">
        <nav className="reports__tabs" role="tablist">
          {statusTabs.map((t) => (
            <button
              key={t.value || "all"}
              role="tab"
              aria-selected={status === t.value}
              className={`hub__tab${status === t.value ? " is-active" : ""}`}
              onClick={() => {
                setStatus(t.value);
                setPage(1);
              }}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <form
          className="reports__search"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(searchInput.trim());
            setPage(1);
          }}
        >
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search title, type, or area…"
          />
          <button type="submit" className="btn btn--ghost">Search</button>
        </form>
      </div>

      <div className="panel reports__list">
        {loading || detailLoading ? (
          <p className="reports__empty">Loading reports…</p>
        ) : error ? (
          <p className="reports__error">{error}</p>
        ) : reports.length === 0 ? (
          <p className="reports__empty">No reports match your filters yet.</p>
        ) : (
          <div className="report-table-wrap">
            <table className="report-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Scope</th>
                  <th>Status</th>
                  <th>Confidence</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.id} className="report-row" onClick={() => openReport(r.id)}>
                    <td>
                      <span className="report-row__title">{r.title}</span>
                      <span className="report-row__by">{r.generated_by}</span>
                    </td>
                    <td>
                      {titleCase(r.scope_level)}
                      {r.scope_name ? ` · ${r.scope_name}` : ""}
                    </td>
                    <td><StatusBadge status={r.status} /></td>
                    <td>{r.confidence}</td>
                    <td>{new Date(r.updated_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {pagination && pagination.pages > 1 && (
        <div className="reports__pager">
          <button
            type="button"
            className="btn btn--ghost"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            ← Prev
          </button>
          <span>
            Page {pagination.page} of {pagination.pages} · {pagination.total} reports
          </span>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={page >= pagination.pages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next →
          </button>
        </div>
      )}

      {showGenerate && (
        <GenerateModal onClose={() => setShowGenerate(false)} onCreated={onGenerated} />
      )}
    </div>
  );
}
