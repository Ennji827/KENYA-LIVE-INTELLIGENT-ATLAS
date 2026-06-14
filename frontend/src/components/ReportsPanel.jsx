import React from "react";

function downloadText(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function reportCsv(report) {
  const rows = [
    ["id", "type", "scope", "status", "updatedAt"],
    [report.id, report.type, report.scope, report.status, report.updatedAt],
  ];
  return rows
    .map((row) => row.map((cell) => `"${String(cell || "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

function exportReport(report, format) {
  const slug = `${report.id}-${String(report.scope).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  if (format === "json") {
    downloadText(`${slug}.json`, JSON.stringify(report, null, 2), "application/json;charset=utf-8");
    return;
  }
  downloadText(`${slug}.csv`, reportCsv(report), "text/csv;charset=utf-8");
}

export default function ReportsPanel({ reports, compact = false }) {
  const rows = reports || [];
  return (
    <div className="aeis-card aeis-card-pad">
      <h2 className="aeis-section-title">Reports</h2>
      <p className="aeis-section-copy">
        County, ward, and farm report records will appear here after real report jobs are created from connected sources.
      </p>
      {!rows.length && (
        <div className="aeis-empty-state">
          No source-backed report records are available yet.
        </div>
      )}
      {rows.map((report) => (
        <div className="aeis-report-row" key={report.id}>
          <div>
            <h4>{report.type}</h4>
            <p>
              {report.scope} - {report.status} - Updated {report.updatedAt}
            </p>
          </div>
          {!compact && (
            <div className="aeis-btn-row">
              <button className="aeis-btn ghost" type="button" onClick={() => exportReport(report, "csv")}>Download CSV</button>
              <button className="aeis-btn ghost" type="button" onClick={() => exportReport(report, "json")}>Download JSON</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
