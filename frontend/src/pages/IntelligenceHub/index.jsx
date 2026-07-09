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
    status: "live",
    statusLabel: "Live fallback",
    metrics: "Annual totals, monthly normals, wet/dry months, six-month historical outlook",
    live: "NASA POWER monthly climate fallback; KMD/KALRO preferred when imported",
    required: "KMD station/monthly exports or KALRO/KAOP reviewed agro-weather records",
    missing: "Official KMD/KALRO county monthly records remain gated until imported",
    output: "Rainfall trend, county comparison, and rainfall-risk action brief",
  },
  {
    id: "water",
    title: "Water Console",
    icon: Droplets,
    detail: "Surface-water extent, NDWI readiness, expansion/shrinkage, and water-risk source gates.",
    status: "partial",
    statusLabel: "Proxy only",
    metrics: "Water extent, NDWI, yearly water transition, rainfall pressure",
    live: "Climate-based water-pressure proxy from source-backed monthly records",
    required: "JRC Global Surface Water, Sentinel-2 NDWI, or Earth Engine zonal statistics",
    missing: "True water extent, NDWI, and water transition history",
    output: "Expansion/shrinkage signal, exposed wards, and water-risk gate status",
  },
  {
    id: "vegetation",
    title: "Vegetation Console",
    icon: Leaf,
    detail: "NDVI, NDWI, vegetation anomaly, recovery signals, and Sentinel/Landsat readiness.",
    status: "partial",
    statusLabel: "Proxy only",
    metrics: "NDVI, NDWI, vegetation anomaly, recovery trend, rainfall support",
    live: "Vegetation-support proxy from rainfall and temperature history",
    required: "Sentinel-2, Landsat, or Earth Engine raster statistics by county/ward",
    missing: "NDVI/NDWI zonal statistics and 10-year vegetation anomaly baseline",
    output: "Vegetation stress/recovery brief and field-verification priority",
  },
  {
    id: "forest",
    title: "Forest Console",
    icon: FlameKindling,
    detail: "Forest cover, tree-cover change, fire/drought exposure, and land-cover source status.",
    status: "partial",
    statusLabel: "Proxy only",
    metrics: "Forest cover, tree-cover share, change, dryness and fire exposure",
    live: "Dryness-pressure proxy from rainfall, temperature, humidity, and wind",
    required: "ESA WorldCover, Sentinel/Landsat classification, or reviewed forest inventory",
    missing: "Forest cover, tree-cover change, and fire/drought exposure overlays",
    output: "Forest cover status, loss/expansion gate, and drought/fire exposure brief",
  },
  {
    id: "soil",
    title: "Soil Health Console",
    icon: Sprout,
    detail: "SoilGrids, soil moisture, rainfall overlay, and county soil-risk planning gates.",
    status: "partial",
    statusLabel: "Proxy only",
    metrics: "Soil organic carbon, pH, texture, moisture, rainfall deficit overlay",
    live: "Soil-moisture proxy from rainfall, humidity, and temperature",
    required: "ISRIC SoilGrids, verified soil-test uploads, or soil-moisture model outputs",
    missing: "SoilGrids properties, verified soil tests, and modelled soil moisture",
    output: "County soil-risk planning gate and soil/rainfall advisory context",
  },
  {
    id: "landuse",
    title: "Land Use Console",
    icon: Layers3,
    detail: "Housing, cropland, forest land, grassland, bare land, water, and land-use change.",
    status: "partial",
    statusLabel: "Boundary ready",
    metrics: "Built-up, cropland, forest, grassland, bare land, water, change over time",
    live: "Boundary hierarchy plus rainfall exposure context for land-use planning",
    required: "KNBS land/housing tables, ESA WorldCover, Dynamic World, or reviewed classification",
    missing: "Built-up, cropland, forest, grassland, bare land, water shares, and land-use change",
    output: "Land-use shares, county change signal, and source-backed planning brief",
  },
  {
    id: "roads",
    title: "Roads & Infrastructure Console",
    icon: Route,
    detail: "Tarmac roads, all-weather roads, road access, and rainfall/water exposure overlay.",
    status: "partial",
    statusLabel: "Boundary ready",
    metrics: "Tarmac km, all-weather km, road density, access gaps, exposure overlay",
    live: "Boundary hierarchy plus rainfall exposure context for road planning",
    required: "Kenya Roads Board records, official road agency exports, or QA-reviewed OSM",
    missing: "Tarmac road length, all-weather road length, road density, and exposure overlay",
    output: "Road access and weather-exposure brief with missing-provider labels",
  },
  {
    id: "county",
    title: "County Intelligence Dashboard",
    icon: MapPinned,
    detail: "County-scoped dashboards with ward/sub-county context and source-backed action briefs.",
    status: "partial",
    statusLabel: "Partial",
    metrics: "County rainfall, ward/sub-county coverage, field reports, alerts, source readiness",
    live: "County boundaries, monthly climate profile, and connected operational records",
    required: "Official boundary updates, county field registry, reports, alerts, and metric imports",
    missing: "County field registry, reviewed environmental metrics, and source-backed action evidence where not imported",
    output: "County action brief with evidence used, gaps, and recommended verification",
  },
];

function consoleCardClass(card, selectedConsole) {
  return [
    selectedConsole === card.id ? "active" : "",
    card.status ? `status-${card.status}` : "",
  ].filter(Boolean).join(" ");
}

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
  const selectedConsoleCard = useMemo(
    () => CONSOLE_CARDS.find((card) => card.id === selectedConsole) || CONSOLE_CARDS[0],
    [selectedConsole],
  );
  const assistantPrompt = useMemo(() => {
    const consoleScope = selectedConsoleCard?.title || "Intelligence Hub";
    const consoleMetrics = selectedConsoleCard?.metrics || "connected source-backed metrics";
    if (selectedCounty?.name) {
      return `Analyze ${selectedCounty.name} through the ${consoleScope}. Use ${consoleMetrics}. Keep missing values source-gated and identify the required provider for each gap.`;
    }
    return `Analyze Kenya through the ${consoleScope}. Use ${consoleMetrics}. Keep missing values source-gated and identify the required provider for each gap.`;
  }, [selectedConsoleCard, selectedCounty?.name]);

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
                className={consoleCardClass(card, selectedConsole)}
                onClick={() => setSelectedConsole(card.id)}
              >
                <span><Icon size={18} /></span>
                <strong>{card.title}</strong>
                <small className={`aeis-hub-console-status ${card.status}`}>{card.statusLabel}</small>
                <em>{card.detail}</em>
                <div className="aeis-hub-console-data">
                  <p><b>Metrics:</b> {card.metrics}</p>
                  <p><b>Live now:</b> {card.live}</p>
                  <p><b>Missing data:</b> {card.missing}</p>
                  <p><b>Required source:</b> {card.required}</p>
                  <p><b>Output:</b> {card.output}</p>
                </div>
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
