import React, { useMemo } from "react";
import CountyFilter from "../components/CountyFilter";
import CropHealthPanel from "../components/CropHealthPanel";
import FertilizerPanel from "../components/FertilizerPanel";
import StatCard from "../components/StatCard";
import { getCountyByName, sampleCounties } from "../data/sampleDashboardData";

export default function FarmerDashboard({ filter, setFilter, lockedCounty }) {
  const selectedCounty = useMemo(() => getCountyByName(filter.county), [filter.county]);

  if (!filter.county) {
    return (
      <>
        <div className="aeis-topbar">
          <div>
            <div className="aeis-kicker">Farmer dashboard</div>
            <h1 className="aeis-title">Select a County for Farm Support</h1>
            <p className="aeis-subtitle">
              Farm decision support requires verified farm boundaries and a county farmer registry.
            </p>
          </div>
          <div className="aeis-status-pill">No county selected</div>
        </div>
        <CountyFilter counties={sampleCounties} value={filter} onChange={setFilter} lockedCounty={lockedCounty} />
      </>
    );
  }

  return (
    <>
      <div className="aeis-topbar">
        <div>
          <div className="aeis-kicker">Farmer dashboard</div>
          <h1 className="aeis-title">{filter.county} Farm Decision Support</h1>
          <p className="aeis-subtitle">
            Farm-level values are hidden until verified farm boundaries, registry records, and source-dated crop-health rasters are connected.
          </p>
        </div>
        <div className="aeis-status-pill">{selectedCounty?.displayName || filter.county}</div>
      </div>

      <CountyFilter counties={sampleCounties} value={filter} onChange={setFilter} lockedCounty={lockedCounty} />

      <div style={{ height: 16 }} />
      <div className="aeis-grid aeis-kpi-grid">
        <StatCard label="Farm Boundary" value="Source required" tone="navy" />
        <StatCard label="Farmer Registry" value="Source required" tone="green" />
        <StatCard label="Farm Health" value="Blocked" note="Requires real NDVI/NDWI" tone="amber" />
        <StatCard label="Weather Advisory" value="Live forecast" note="Shown below map" tone="blue" />
      </div>

      <div style={{ height: 16 }} />
      <div className="aeis-grid aeis-two-col">
        <div className="aeis-grid">
          <CropHealthPanel title={`${filter.county} Farm Health Status`} />
          <div className="aeis-card aeis-card-pad">
            <h2 className="aeis-section-title">Verified Farm Inputs</h2>
            <p className="aeis-section-copy">
              AEIS-K will not show farm-level advisory values until these records are connected from real county or farmer sources.
            </p>
            <div className="aeis-metric-list">
              <div className="aeis-metric-row"><span>Farm boundary</span><strong>Source required</strong></div>
              <div className="aeis-metric-row"><span>Crop type / stage</span><strong>Source required</strong></div>
              <div className="aeis-metric-row"><span>Soil test</span><strong>Source required</strong></div>
              <div className="aeis-metric-row"><span>Field verification</span><strong>Source required</strong></div>
            </div>
          </div>
        </div>
        <div className="aeis-grid">
          <FertilizerPanel countyName={filter.county} />
          <div className="aeis-card aeis-card-pad">
            <h2 className="aeis-section-title">Farmer Advisory</h2>
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
                <span>Fertilizer recommendation</span>
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
