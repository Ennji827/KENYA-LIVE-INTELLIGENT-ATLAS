import React, { lazy, Suspense } from "react";
import CountyFilter from "../components/CountyFilter";
import CropHealthPanel from "../components/CropHealthPanel";
import FertilizerPanel from "../components/FertilizerPanel";
import LandCoverChart from "../components/LandCoverChart";
import RemoteSensingImageryPanel from "../components/RemoteSensingImageryPanel";
import CountyIntelligenceBrief from "../components/CountyIntelligenceBrief";
import DataAuthorityPanel from "../components/DataAuthorityPanel";
import RealtimeOperationsFeed from "../components/RealtimeOperationsFeed";
import StatCard from "../components/StatCard";
import FieldReportsPanel from "../components/FieldReportsPanel";
import { getDashboardKpis, kenyaCounties } from "../data/kenyaCountyCatalog";

const EnvironmentalIntelligenceHub = lazy(() => import("../components/EnvironmentalIntelligenceHub"));

function WorkspaceLoading() {
  return (
    <div className="aeis-card aeis-card-pad aeis-workspace-loading" role="status">
      <span className="aeis-skeleton wide" />
      <span className="aeis-skeleton" />
      <span className="aeis-skeleton short" />
    </div>
  );
}

export default function CountyDashboard({ filter, setFilter, selectedCounty, lockedCounty, session, onAskAssistant }) {
  if (!selectedCounty) {
    return (
      <>
        <div className="aeis-topbar">
          <div>
            <div className="aeis-kicker">County dashboard</div>
            <h1 className="aeis-title">Select a County Workspace</h1>
            <p className="aeis-subtitle">
              The county dashboard is isolated by county. Search and select a county code or county name to open its specific rainfall, crop health, registry, and fertilizer intelligence.
            </p>
          </div>
          <div className="aeis-status-pill">National command center active</div>
        </div>
        <CountyFilter counties={kenyaCounties} value={filter} onChange={setFilter} lockedCounty={lockedCounty} />
      </>
    );
  }

  const stats = selectedCounty.stats;
  const kpis = getDashboardKpis(selectedCounty);

  return (
    <>
      <div className="aeis-topbar">
        <div>
          <div className="aeis-kicker">County dashboard</div>
          <h1 className="aeis-title">{filter.county} County Intelligence</h1>
          <p className="aeis-subtitle">
            County workspace with real boundaries, live forecast below the map, and source-required gates for NDVI, NDWI, crop stress, land cover, farmer registry, and fertilizer demand.
          </p>
        </div>
        <div className="aeis-status-pill">{filter.subcounty || "All sub-counties"} / {filter.ward || "All wards"}</div>
      </div>

      <CountyFilter counties={kenyaCounties} value={filter} onChange={setFilter} lockedCounty={lockedCounty} />
      <div style={{ height: 16 }} />

      <div className="aeis-grid aeis-kpi-grid">
        {kpis.map((kpi) => (
          <StatCard key={kpi.label} {...kpi} />
        ))}
      </div>

      <div style={{ height: 16 }} />
      <Suspense fallback={<WorkspaceLoading />}>
        <EnvironmentalIntelligenceHub
          session={session}
          county={selectedCounty}
          onOpenAssistant={onAskAssistant}
        />
      </Suspense>

      <div style={{ height: 16 }} />
      <CountyIntelligenceBrief county={selectedCounty} />
      <div style={{ height: 16 }} />
      <FieldReportsPanel
        session={session}
        countyName={filter.county}
        subcountyName={filter.subcounty}
        wardName={filter.ward}
      />
      <div style={{ height: 16 }} />

      <div className="aeis-grid aeis-two-col">
        <div className="aeis-grid">
          <LandCoverChart stats={stats} />
          <FertilizerPanel stats={stats} countyName={filter.county} />
        </div>
        <div className="aeis-grid">
          <RealtimeOperationsFeed countyName={selectedCounty.name} />
          <RemoteSensingImageryPanel county={selectedCounty} />
          <DataAuthorityPanel county={selectedCounty} />
          <CropHealthPanel stats={stats} title="County Crop Stress" />
        </div>
      </div>
    </>
  );
}
