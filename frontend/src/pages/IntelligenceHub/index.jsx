import React, { lazy, Suspense, useMemo, useState } from "react";
import {
  BarChart3,
  CloudRain,
  Droplets,
  FlameKindling,
  Layers3,
  Leaf,
  MapPinned,
  Route,
  Sprout,
} from "lucide-react";
import CountyFilter from "../../components/CountyFilter";
import { kenyaCounties } from "../../data/kenyaCountyCatalog";

const EnvironmentalIntelligenceHub = lazy(() => import("../../components/intelligence/EnvironmentalIntelligenceHub"));
const ClimateInsightStudio = lazy(() => import("../../components/intelligence/ClimateInsightStudio"));

const CONSOLE_CARDS = [
  {
    id: "rainfall",
    title: "Rainfall Console",
    icon: CloudRain,
    detail: "Last 10 years, annual rainfall, monthly normals, and six-month historical outlook.",
  },
  {
    id: "water",
    title: "Water Console",
    icon: Droplets,
    detail: "Surface-water extent, NDWI readiness, expansion/shrinkage, and water-risk source gates.",
  },
  {
    id: "vegetation",
    title: "Vegetation Console",
    icon: Leaf,
    detail: "NDVI, NDWI, vegetation anomaly, recovery signals, and Sentinel/Landsat readiness.",
  },
  {
    id: "forest",
    title: "Forest Console",
    icon: FlameKindling,
    detail: "Forest cover, tree-cover change, fire/drought exposure, and land-cover source status.",
  },
  {
    id: "soil",
    title: "Soil Health Console",
    icon: Sprout,
    detail: "SoilGrids, soil moisture, rainfall overlay, and county soil-risk planning gates.",
  },
  {
    id: "landuse",
    title: "Land Use Console",
    icon: Layers3,
    detail: "Housing, cropland, forest land, grassland, bare land, water, and land-use change.",
  },
  {
    id: "roads",
    title: "Roads & Infrastructure Console",
    icon: Route,
    detail: "Tarmac roads, all-weather roads, road access, and rainfall/water exposure overlay.",
  },
  {
    id: "county",
    title: "County Intelligence Dashboard",
    icon: MapPinned,
    detail: "County-scoped dashboards with ward/sub-county context and source-backed action briefs.",
  },
];

function WorkspaceLoading() {
  return (
    <div className="aeis-card aeis-card-pad aeis-workspace-loading" role="status">
      <span className="aeis-skeleton wide" />
      <span className="aeis-skeleton" />
      <span className="aeis-skeleton short" />
    </div>
  );
}

export default function IntelligenceHub({
  filter,
  setFilter,
  selectedCounty,
  lockedCounty,
  session,
  onAskAssistant,
}) {
  const [selectedConsole, setSelectedConsole] = useState("rainfall");
  const scopeLabel = selectedCounty?.name || "National Command Center";
  const assistantPrompt = useMemo(() => {
    if (selectedCounty?.name) {
      return `Analyze ${selectedCounty.name} through the Intelligence Hub: rainfall, water, vegetation, forest, soil health, land use, roads, and county decision priorities.`;
    }
    return "Analyze Kenya through the Intelligence Hub: rainfall, water, vegetation, forest, soil health, land use, roads, and county decision priorities.";
  }, [selectedCounty?.name]);

  return (
    <>
      <div className="aeis-topbar">
        <div>
          <div className="aeis-kicker">K-CLIMIS Intelligence Hub</div>
          <h1 className="aeis-title">Rainfall, Water, Land and Infrastructure Intelligence</h1>
          <p className="aeis-subtitle">
            Data-heavy consoles for national and county decision-making. The main dashboard stays clean;
            this workspace carries the long-history charts, source gates, and analytical comparisons.
          </p>
        </div>
        <div className="aeis-status-pill">{scopeLabel}</div>
      </div>

      <CountyFilter counties={kenyaCounties} value={filter} onChange={setFilter} lockedCounty={lockedCounty} />

      <section className="aeis-card aeis-card-pad aeis-hub-directory" aria-label="Intelligence console directory">
        <div className="aeis-hub-directory-head">
          <div>
            <span className="aeis-kicker">Console directory</span>
            <h2>Choose the intelligence layer you want to inspect</h2>
          </div>
          <button type="button" className="aeis-btn" onClick={() => onAskAssistant?.(assistantPrompt)}>
            <BarChart3 size={16} /> Ask assistant to analyze this scope
          </button>
        </div>
        <div className="aeis-hub-console-grid">
          {CONSOLE_CARDS.map((card) => {
            const Icon = card.icon;
            return (
              <button
                type="button"
                key={card.id}
                className={selectedConsole === card.id ? "active" : ""}
                onClick={() => setSelectedConsole(card.id)}
              >
                <span><Icon size={18} /></span>
                <strong>{card.title}</strong>
                <em>{card.detail}</em>
              </button>
            );
          })}
        </div>
        <p className="aeis-source-note">
          If an official/live source is not connected yet, the console keeps values gated and labels the missing provider.
        </p>
      </section>

      <div style={{ height: 16 }} />
      <Suspense fallback={<WorkspaceLoading />}>
        <EnvironmentalIntelligenceHub
          session={session}
          county={selectedCounty}
          onOpenAssistant={onAskAssistant}
          defaultConsole={selectedConsole}
        />
      </Suspense>

      <div style={{ height: 16 }} />
      <Suspense fallback={<WorkspaceLoading />}>
        <ClimateInsightStudio
          session={session}
          county={selectedCounty}
          onOpenAssistant={onAskAssistant}
        />
      </Suspense>
    </>
  );
}
