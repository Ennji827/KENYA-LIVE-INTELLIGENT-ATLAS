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

const DownloadIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3v12M7 11l5 5 5-5M4 21h16" />
  </svg>
);

const SearchIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);

const BackIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M19 12H5M12 19l-7-7 7-7" />
  </svg>
);

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

// Absolute timestamps are exact but unreadable at a glance in a list of forty
// reports; this gives the scannable form and keeps the exact one in `title`.
function relativeTime(iso) {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "—";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
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
    <span className={`badge badge--${status}`}>
      <span className="status-dot" aria-hidden="true" />
      {STATUS_LABEL[status] || status}
    </span>
  );
}

// The four workflow states as a progress rail.
//
// A report's status was previously a lone badge, which says where it is but
// not where it sits in the pipeline or what is left. The rail shows the whole
// route at once — done, current, still ahead — which is the question anyone
// looking at a draft actually has.
function StatusRail({ status }) {
  const at = STATUS_ORDER.indexOf(status);
  return (
    <ol className="rail" aria-label={`Workflow stage: ${STATUS_LABEL[status]}`}>
      {STATUS_ORDER.map((s, i) => (
        <li
          key={s}
          className={`rail__step${i < at ? " is-done" : ""}${i === at ? " is-current" : ""}`}
          aria-current={i === at ? "step" : undefined}
        >
          <span className="rail__label">{STATUS_LABEL[s]}</span>
        </li>
      ))}
    </ol>
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

  // Escape closes any modal in this app; doing it here as well as on the
  // backdrop means the keyboard route out is never missing.
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

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
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Generate a report"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal__head">
          <div>
            <p className="u-eyebrow">New intelligence report</p>
            <h2 className="modal__title">Generate a report</h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <form className="form" onSubmit={submit}>
          <label className="field">
            <span className="field__label">
              Title <em>optional</em>
            </span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Nakuru drought brief"
            />
          </label>

          <div className="field-row">
            <label className="field">
              <span className="field__label">Scope level</span>
              <select value={scopeLevel} onChange={(e) => setScopeLevel(e.target.value)}>
                {SCOPE_LEVELS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">
                Area name {scopeLevel !== "national" && <em>required</em>}
              </span>
              <input
                type="text"
                value={scopeName}
                onChange={(e) => setScopeName(e.target.value)}
                placeholder={scopeLevel === "national" ? "Kenya" : "e.g. Nakuru"}
                disabled={scopeLevel === "national"}
              />
            </label>
          </div>

          <label className="field">
            <span className="field__label">
              Focus question <em>optional</em>
            </span>
            <textarea
              rows={3}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="What should this report investigate? Leave blank for a full brief."
            />
          </label>

          {error && <p className="alert alert--error">{error}</p>}

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
    <article className="report-detail">
      <button type="button" className="link-btn" onClick={onBack}>
        <BackIcon />
        All reports
      </button>

      <header className="report-detail__head panel">
        <div className="report-detail__title">
          <StatusBadge status={report.status} />
          <h1>{report.title}</h1>
          <dl className="meta-row">
            <div className="meta-row__item">
              <dt>Scope</dt>
              <dd>
                {titleCase(report.scope_level)}
                {report.scope_name ? ` · ${report.scope_name}` : ""}
              </dd>
            </div>
            <div className="meta-row__item">
              <dt>Confidence</dt>
              <dd className="u-num">{report.confidence}</dd>
            </div>
            <div className="meta-row__item">
              <dt>Author</dt>
              <dd>{report.generated_by}</dd>
            </div>
            <div className="meta-row__item">
              <dt>Updated</dt>
              <dd title={new Date(report.updated_at).toLocaleString()}>
                {relativeTime(report.updated_at)}
              </dd>
            </div>
          </dl>
        </div>

        <div className="report-detail__exports">
          <span className="u-eyebrow">Export</span>
          <div className="chip-row">
            {EXPORT_FORMATS.map((f) => (
              <button
                key={f.key}
                type="button"
                className="chip chip--action"
                onClick={() => doExport(f.key)}
                disabled={busy === `export:${f.key}`}
              >
                <DownloadIcon />
                {busy === `export:${f.key}` ? "…" : f.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="panel report-detail__workflow">
        <StatusRail status={report.status} />

        {targets.length > 0 && (
          <div className="report-detail__transition">
            <label className="field">
              <span className="field__label">
                Workflow note <em>optional</em>
              </span>
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
          </div>
        )}

        {targets.length === 0 && report.status !== "published" && (
          <p className="report-detail__locked u-muted">
            Your role cannot advance this report from{" "}
            {STATUS_LABEL[report.status]}.
          </p>
        )}

        {error && <p className="alert alert--error">{error}</p>}
      </div>

      <div className="panel report-detail__body prose">
        {contentEntries.length === 0 && (
          <p className="u-muted">No content sections in this report.</p>
        )}
        {contentEntries.map(([section, value]) => {
          const items = Array.isArray(value) ? value : [value];
          return (
            <section key={section} className="prose__section">
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
        <div className="panel">
          <h2 className="panel__title">Audit trail</h2>
          <ol className="timeline">
            {report.audit_events.map((ev, i) => (
              <li key={i} className="timeline__item">
                <span className="timeline__dot" aria-hidden="true" />
                <div className="timeline__body">
                  <p className="timeline__head">
                    <strong>{titleCase(ev.action)}</strong>
                    {ev.from_status && ev.to_status ? (
                      <span className="timeline__move">
                        {STATUS_LABEL[ev.from_status] || ev.from_status}
                        <span aria-hidden="true"> → </span>
                        {STATUS_LABEL[ev.to_status] || ev.to_status}
                      </span>
                    ) : ev.to_status ? (
                      <span className="timeline__move">
                        {STATUS_LABEL[ev.to_status] || ev.to_status}
                      </span>
                    ) : null}
                  </p>
                  <p className="timeline__meta">
                    {ev.actor ? `${ev.actor} · ` : ""}
                    <span title={new Date(ev.created_at).toLocaleString()}>
                      {relativeTime(ev.created_at)}
                    </span>
                  </p>
                  {ev.note && <p className="timeline__note">{ev.note}</p>}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </article>
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
      window.scrollTo({ top: 0, behavior: "smooth" });
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
    () => [
      { value: "", label: "All" },
      ...STATUS_ORDER.map((s) => ({ value: s, label: STATUS_LABEL[s] })),
    ],
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
      <header className="page-head">
        <div>
          <p className="u-eyebrow">Kenya Live Atlas · Intelligence</p>
          <h1 className="page-head__title">Reports</h1>
          <p className="page-head__sub">
            Browse, export, and advance AI-generated intelligence reports through
            their review and approval workflow.
          </p>
        </div>
        {canGenerate && (
          <button type="button" className="btn" onClick={() => setShowGenerate(true)}>
            <span aria-hidden="true">+</span> Generate report
          </button>
        )}
      </header>

      <div className="toolbar">
        <nav className="seg" role="tablist" aria-label="Filter by status">
          {statusTabs.map((t) => (
            <button
              key={t.value || "all"}
              role="tab"
              aria-selected={status === t.value}
              className={`seg__btn${status === t.value ? " is-active" : ""}`}
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
          className="search"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(searchInput.trim());
            setPage(1);
          }}
        >
          <span className="search__icon" aria-hidden="true">
            <SearchIcon />
          </span>
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search title, type, or area…"
            aria-label="Search reports"
          />
          <button type="submit" className="btn btn--ghost">Search</button>
        </form>
      </div>

      {loading || detailLoading ? (
        <div className="panel">
          <ul className="row-skeleton">
            {[0, 1, 2, 3, 4].map((i) => (
              <li key={i}>
                <span className="u-skeleton row-skeleton__bar" />
                <span className="u-skeleton row-skeleton__bar row-skeleton__bar--short" />
              </li>
            ))}
          </ul>
        </div>
      ) : error ? (
        <p className="alert alert--error">{error}</p>
      ) : reports.length === 0 ? (
        <div className="empty-state">
          <h2>No reports match your filters</h2>
          <p>
            {status || search
              ? "Clear the status filter or search term to see everything."
              : "Generated reports will appear here once the first one is created."}
          </p>
          {(status || search) && (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                setStatus("");
                setSearch("");
                setSearchInput("");
                setPage(1);
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        /* One markup, two layouts: a table from tablet up, and the same rows
           restacked as cards below it (see .data-table in intel.css). The
           `data-label` attributes are what the card layout uses as row
           headings, so a phone never gets a five-column table to sideways-
           scroll through. */
        <div className="panel panel--flush">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Title</th>
                <th scope="col">Scope</th>
                <th scope="col">Status</th>
                <th scope="col" className="is-num">Confidence</th>
                <th scope="col">Updated</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.id} className="data-table__row" onClick={() => openReport(r.id)} tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openReport(r.id);
                    }
                  }}
                >
                  <td data-label="Title">
                    <span className="data-table__title">{r.title}</span>
                    <span className="data-table__sub">{r.generated_by}</span>
                  </td>
                  <td data-label="Scope">
                    {titleCase(r.scope_level)}
                    {r.scope_name ? ` · ${r.scope_name}` : ""}
                  </td>
                  <td data-label="Status"><StatusBadge status={r.status} /></td>
                  <td data-label="Confidence" className="u-num">{r.confidence}</td>
                  <td data-label="Updated" title={new Date(r.updated_at).toLocaleString()}>
                    {relativeTime(r.updated_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pagination && pagination.pages > 1 && (
        <nav className="pager" aria-label="Pagination">
          <button
            type="button"
            className="btn btn--ghost"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            ← Prev
          </button>
          <span className="pager__status">
            Page <span className="u-num">{pagination.page}</span> of{" "}
            <span className="u-num">{pagination.pages}</span> ·{" "}
            <span className="u-num">{pagination.total}</span> reports
          </span>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={page >= pagination.pages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next →
          </button>
        </nav>
      )}

      {showGenerate && (
        <GenerateModal onClose={() => setShowGenerate(false)} onCreated={onGenerated} />
      )}
    </div>
  );
}
