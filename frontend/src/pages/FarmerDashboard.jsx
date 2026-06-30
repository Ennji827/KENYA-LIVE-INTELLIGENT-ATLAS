import React, { useMemo } from "react";
import CountyFilter from "../components/CountyFilter";
import CropHealthPanel from "../components/CropHealthPanel";
import FertilizerPanel from "../components/FertilizerPanel";
import StatCard from "../components/StatCard";
import FieldReportsPanel from "../components/FieldReportsPanel";
import { getCountyByName, kenyaCounties } from "../data/kenyaCountyCatalog";

export default function FarmerDashboard({ filter, setFilter, lockedCounty, session }) {
  const selectedCounty = useMemo(() => getCountyByName(filter.county), [filter.county]);

  if (!filter.county) {
    return (
      <>
        <div className="aeis-topbar">
          <div>
            <div className="aeis-kicker">Field dashboard</div>
            <h1 className="aeis-title">Select a County for Field Support</h1>
            <p className="aeis-subtitle">
              Field decision support requires verified site boundaries and a county field/site registry.
            </p>
          </div>
          <div className="aeis-status-pill">No county selected</div>
        </div>
        <CountyFilter counties={kenyaCounties} value={filter} onChange={setFilter} lockedCounty={lockedCounty} />
      </>
    );
  }

  return (
    <>
      <div className="aeis-topbar">
        <div>
          <div className="aeis-kicker">Field dashboard</div>
          <h1 className="aeis-title">{filter.county} Field Decision Support</h1>
          <p className="aeis-subtitle">
            Field/site-level values are hidden until verified boundaries, registry records, and source-dated vegetation/water rasters are connected.
          </p>
        </div>
        <div className="aeis-status-pill">{selectedCounty?.displayName || filter.county}</div>
      </div>

      <CountyFilter counties={kenyaCounties} value={filter} onChange={setFilter} lockedCounty={lockedCounty} />

      <div style={{ height: 16 }} />
      <div className="aeis-grid aeis-kpi-grid">
        <StatCard label="Site Boundary" value="Source required" tone="navy" />
        <StatCard label="Field Registry" value="Source required" tone="green" />
        <StatCard label="Vegetation Health" value="Blocked" note="Requires real NDVI/NDWI" tone="amber" />
        <StatCard label="Weather Advisory" value="Live forecast" note="Shown below map" tone="blue" />
      </div>

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
          <CropHealthPanel title={`${filter.county} Field Vegetation Status`} />
          <div className="aeis-card aeis-card-pad">
            <h2 className="aeis-section-title">Verified Field Inputs</h2>
            <p className="aeis-section-copy">
              AEIS-K will not show field/site-level advisory values until these records are connected from real county or field sources.
            </p>
            <div className="aeis-metric-list">
              <div className="aeis-metric-row"><span>Site boundary</span><strong>Source required</strong></div>
              <div className="aeis-metric-row"><span>Land-use class / activity</span><strong>Source required</strong></div>
              <div className="aeis-metric-row"><span>Soil test</span><strong>Source required</strong></div>
              <div className="aeis-metric-row"><span>Field verification</span><strong>Source required</strong></div>
            </div>
          </div>
        </div>
        <div className="aeis-grid">
          <FertilizerPanel countyName={filter.county} />
          <div className="aeis-card aeis-card-pad">
            <h2 className="aeis-section-title">Field Advisory</h2>
            <div className="aeis-metric-list">
              <div className="aeis-metric-row">
                <span>County / Ward</span>
                <strong>{filter.county} / {filter.ward || "Select ward"}</strong>
              </div>
              <div className="aeis-metric-row">
                <span>Weather advisory</span>
                <strong>Use live forecast below map</strong>
              </div>
              <div className="aeis-metric-row">
                <span>Soil/input recommendation</span>
                <strong>Blocked until verified inputs</strong>
              </div>
              <div className="aeis-metric-row">
                <span>Alert message</span>
                <strong>Connect source data</strong>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
