import React from "react";
import CountyFilter from "../components/CountyFilter";
import ReportsPanel from "../components/ReportsPanel";
import { sampleCounties } from "../data/sampleDashboardData";

function downloadReports(filename, reports) {
  const rows = [
    ["id", "type", "scope", "status", "updatedAt"],
    ...reports.map((report) => [report.id, report.type, report.scope, report.status, report.updatedAt]),
  ];
  const csv = rows.map((row) => row.map((cell) => `"${String(cell || "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function Reports({ filter, setFilter, reports, lockedCounty }) {
  return (
    <>
      <div className="aeis-topbar">
        <div>
          <div className="aeis-kicker">Reports</div>
          <h1 className="aeis-title">AEIS-K Reports</h1>
          <p className="aeis-subtitle">
            County, ward, farm, fertilizer, and imagery reports for operational review and export.
          </p>
        </div>
        <div className="aeis-status-pill">{reports.length} reports</div>
      </div>

      <CountyFilter counties={sampleCounties} value={filter} onChange={setFilter} lockedCounty={lockedCounty} />
      <div style={{ height: 16 }} />

      <div className="aeis-grid aeis-two-col">
        <ReportsPanel reports={reports} />
        <div className="aeis-card aeis-card-pad">
          <h2 className="aeis-section-title">Report Generation</h2>
          <p className="aeis-section-copy">
            Select a scope, then generate structured reports for county, ward, or farm decision support.
          </p>
          <div className="aeis-btn-row">
            <button type="button" className="aeis-btn">County report</button>
            <button type="button" className="aeis-btn secondary">Ward report</button>
            <button type="button" className="aeis-btn secondary">Farm report</button>
            <button type="button" className="aeis-btn ghost" onClick={() => downloadReports("aeis-k-reports.csv", reports)}>Download report index</button>
          </div>
        </div>
      </div>
    </>
  );
}
