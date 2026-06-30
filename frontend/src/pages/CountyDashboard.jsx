import React from "react";
import { BarChart3 } from "lucide-react";
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

export default function CountyDashboard({
  filter,
  setFilter,
  selectedCounty,
  lockedCounty,
  session,
  onOpenIntelligenceHub,
}) {
  if (!selectedCounty) {
    return (
      <>
        <div className="aeis-topbar">
          <div>
            <div className="aeis-kicker">County dashboard</div>
            <h1 className="aeis-title">Select a County Workspace</h1>
            <p className="aeis-subtitle">
              The county dashboard is isolated by county. Search and select a county code or county name to open its specific rainfall, water, vegetation, land-use, soil, road, and registry intelligence.
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
            County workspace with real boundaries, live forecast below the map, and source-required gates for rainfall, NDVI, NDWI, water, vegetation stress, land cover, field/site registry, soil, and roads.
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
      <section className="aeis-card aeis-card-pad aeis-county-hub-cta">
        <div>
          <span className="aeis-kicker">Deep intelligence</span>
          <h2>Open the county consoles when you need the heavy analysis</h2>
          <p>
            Rainfall history, water, vegetation, forest, soil, land-use, roads, and county action briefs
            now live in the Intelligence Hub so this dashboard stays fast and easy to read.
          </p>
        </div>
        <button type="button" className="aeis-btn" onClick={onOpenIntelligenceHub}>
          <BarChart3 size={16} /> Open Intelligence Hub
        </button>
      </section>

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
          <CropHealthPanel stats={stats} title="County Vegetation Stress" />
        </div>
      </div>
    </>
  );
}
