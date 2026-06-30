import React from "react";
import AccessControlPanel from "../components/AccessControlPanel";
import AlertsPanel from "../components/AlertsPanel";
import AuthAuditPanel from "../components/AuthAuditPanel";
import DataSourcesPanel from "../components/DataSourcesPanel";
import FertilizerPanel from "../components/FertilizerPanel";
import LandCoverChart from "../components/LandCoverChart";
import StatCard from "../components/StatCard";
import SystemActualizationPanel from "../components/SystemActualizationPanel";
import UserManagementPanel from "../components/UserManagementPanel";
import { getDashboardKpis, kenyaCounties, nationalSummary } from "../data/kenyaCountyCatalog";

export default function AdminPanel({ selectedCounty, alerts, reports, session }) {
  const stats = selectedCounty?.stats || nationalSummary;
  const scopeName = selectedCounty?.name || "National";
  const kpis = getDashboardKpis(selectedCounty || nationalSummary).slice(0, 4);

  if (session?.role === "auditor") {
    return (
      <>
        <div className="aeis-topbar">
          <div>
            <div className="aeis-kicker">Read-only assurance workspace</div>
            <h1 className="aeis-title">AEIS-K Audit and Data Quality</h1>
            <p className="aeis-subtitle">Review authentication events, source coverage, GIS quality warnings, and report evidence without changing operational data.</p>
          </div>
          <div className="aeis-status-pill">Auditor view</div>
        </div>
        <AuthAuditPanel session={session} />
        <div style={{ height: 16 }} />
        <DataSourcesPanel session={session} selectedCounty={selectedCounty} readOnly />
      </>
    );
  }

  return (
    <>
      <div className="aeis-topbar">
        <div>
          <div className="aeis-kicker">Admin / Ministry panel</div>
          <h1 className="aeis-title">AEIS-K Ministry Operations</h1>
          <p className="aeis-subtitle">
            Manage users, verify field/site records, view county summaries, soil/input planning data, vegetation stress alerts, and report generation workflows.
          </p>
        </div>
        <div className="aeis-status-pill">Ministry view</div>
      </div>

      <div className="aeis-grid aeis-kpi-grid">
        {kpis.map((kpi) => (
          <StatCard key={kpi.label} {...kpi} />
        ))}
      </div>

      <div style={{ height: 16 }} />
      <UserManagementPanel session={session} />

      <div style={{ height: 16 }} />
      <DataSourcesPanel session={session} selectedCounty={selectedCounty} />

      <div style={{ height: 16 }} />
      <div className="aeis-grid aeis-two-col">
        <div className="aeis-grid">
          <div className="aeis-card aeis-card-pad">
            <h2 className="aeis-section-title">County Summaries</h2>
            <table className="aeis-table">
              <thead>
                <tr>
                  <th>County</th>
                  <th>Registry</th>
                  <th>NDVI</th>
                  <th>Vegetation stress</th>
                  <th>Soil/input</th>
                </tr>
              </thead>
              <tbody>
                {kenyaCounties.map((county) => (
                  <tr key={county.name}>
                    <td>{county.name}</td>
                    <td>Source required</td>
                    <td>Source required</td>
                    <td>Blocked</td>
                    <td>Source required</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="aeis-card aeis-card-pad">
            <h2 className="aeis-section-title">Administration Actions</h2>
            <div className="aeis-btn-row">
              <button type="button" className="aeis-btn">Manage users</button>
              <button type="button" className="aeis-btn secondary">Verify farms</button>
              <button type="button" className="aeis-btn secondary">Generate reports</button>
              <button type="button" className="aeis-btn ghost">View {reports.length} report jobs</button>
            </div>
          </div>

          <AccessControlPanel />
          <AuthAuditPanel session={session} />
          <LandCoverChart stats={stats} />
        </div>

        <div className="aeis-grid">
          <SystemActualizationPanel />
          <FertilizerPanel stats={stats} countyName={scopeName} />
          <AlertsPanel alerts={alerts} />
        </div>
      </div>
    </>
  );
}
