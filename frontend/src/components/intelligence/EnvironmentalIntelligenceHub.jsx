import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  CloudRain,
  Droplets,
  FlameKindling,
  Layers3,
  Leaf,
  MapPinned,
  RefreshCw,
  Route,
  Sprout,
} from "lucide-react";
import { getApiBase } from "../../utils/api";

const CONSOLES = [
  {
    id: "rainfall",
    label: "Rainfall",
    icon: CloudRain,
    tone: "blue",
    sourceSlugs: ["kenya-meteorological-department", "kalro-kaop-weather", "nasa-power", "open-meteo"],
  },
  {
    id: "water",
    label: "Water",
    icon: Droplets,
    tone: "cyan",
    sourceSlugs: ["kenya-meteorological-department", "nasa-power", "jrc-global-surface-water", "google-earth-engine"],
  },
  {
    id: "vegetation",
    label: "Vegetation",
    icon: Leaf,
    tone: "green",
    sourceSlugs: ["kalro-kaop-weather", "copernicus-sentinel-2", "usgs-landsat", "google-earth-engine"],
  },
  {
    id: "forest",
    label: "Forest",
    icon: FlameKindling,
    tone: "emerald",
    sourceSlugs: ["esa-worldcover", "copernicus-sentinel-2", "usgs-landsat"],
  },
  {
    id: "soil",
    label: "Soil health",
    icon: Sprout,
    tone: "amber",
    sourceSlugs: ["kalro-kaop-weather", "kenya-meteorological-department", "isric-soilgrids", "nasa-power"],
  },
  {
    id: "landuse",
    label: "Land Use",
    icon: Layers3,
    tone: "slate",
    sourceSlugs: ["knbs-statistical-portals", "esa-worldcover", "openstreetmap-roads"],
  },
  {
    id: "roads",
    label: "Roads & Infrastructure",
    icon: Route,
    tone: "slate",
    sourceSlugs: ["kenya-roads-board", "openstreetmap-roads", "knbs-statistical-portals"],
  },
  {
    id: "county",
    label: "County Intelligence",
    icon: MapPinned,
    tone: "blue",
    sourceSlugs: ["kenya-meteorological-department", "kalro-kaop-weather", "open-meteo", "nasa-power"],
  },
];

const LAND_USE_CLASSES = [
  { label: "Housing / built-up", color: "#ef4444", source: "KNBS, ESA WorldCover, OSM buildings" },
  { label: "Cropland", color: "#a855f7", source: "ESA WorldCover, Sentinel/Landsat classification" },
  { label: "Forest / tree cover", color: "#166534", source: "ESA WorldCover, Sentinel/Landsat" },
  { label: "Grassland / shrubland", color: "#84cc16", source: "ESA WorldCover" },
  { label: "Bare / sparse land", color: "#a3a3a3", source: "ESA WorldCover" },
  { label: "Permanent water", color: "#2563eb", source: "JRC Global Surface Water, NDWI" },
  { label: "Tarmac roads", color: "#111827", source: "Kenya Roads Board / OSM surface tags" },
  { label: "All-weather roads", color: "#f97316", source: "Kenya Roads Board / OSM road classification" },
];

const CONSOLE_METRICS = {
  rainfall: {
    key: "rainfall_mm",
    name: "Rainfall mm",
    unit: "mm",
    chartTitle: "Monthly rainfall history",
    annualTitle: "Annual rainfall comparison",
    color: "#2563eb",
    fill: "#dbeafe",
  },
  water: {
    key: "water_pressure_index",
    name: "Water pressure index",
    unit: "/100",
    chartTitle: "Monthly water-pressure proxy",
    annualTitle: "Annual water-pressure comparison",
    color: "#0891b2",
    fill: "#cffafe",
  },
  vegetation: {
    key: "vegetation_support_index",
    name: "Vegetation support index",
    unit: "/100",
    chartTitle: "Monthly vegetation-support proxy",
    annualTitle: "Annual vegetation-support comparison",
    color: "#16a34a",
    fill: "#dcfce7",
  },
  forest: {
    key: "dryness_pressure_index",
    name: "Forest dryness pressure",
    unit: "/100",
    chartTitle: "Monthly forest dryness-pressure proxy",
    annualTitle: "Annual forest dryness-pressure comparison",
    color: "#b45309",
    fill: "#ffedd5",
  },
  soil: {
    key: "soil_moisture_proxy",
    name: "Soil moisture proxy",
    unit: "/100",
    chartTitle: "Monthly soil-moisture proxy",
    annualTitle: "Annual soil-moisture comparison",
    color: "#d97706",
    fill: "#fef3c7",
  },
  county: {
    key: "rainfall_mm",
    name: "Monthly climate profile",
    unit: "mm",
    chartTitle: "County/national monthly climate profile",
    annualTitle: "Annual rainfall context",
    color: "#1d4ed8",
    fill: "#dbeafe",
  },
  landuse: {
    key: "rainfall_mm",
    name: "Rainfall exposure context",
    unit: "mm",
    chartTitle: "Monthly climate context for land-use planning",
    annualTitle: "Annual rainfall exposure",
    color: "#475569",
    fill: "#e2e8f0",
  },
  roads: {
    key: "rainfall_mm",
    name: "Rainfall exposure context",
    unit: "mm",
    chartTitle: "Monthly climate context for road exposure",
    annualTitle: "Annual rainfall exposure",
    color: "#334155",
    fill: "#e2e8f0",
  },
};

function formatNumber(value, digits = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return number.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function monthName(monthIndex) {
  return new Date(2024, monthIndex - 1, 1).toLocaleString(undefined, { month: "short" });
}

function annualRainfall(records = []) {
  const grouped = new Map();
  records.forEach((row) => {
    const year = String(row.date || "").slice(0, 4);
    if (!year) return;
    const rainfall = Number(row.rainfall_mm ?? row.PRECTOTCORR);
    if (!Number.isFinite(rainfall)) return;
    grouped.set(year, (grouped.get(year) || 0) + rainfall);
  });
  return [...grouped.entries()]
    .sort(([left], [right]) => Number(left) - Number(right))
    .map(([year, rainfall]) => ({
      year,
      rainfall: Number(rainfall.toFixed(1)),
    }));
}

function rainfallOutlook(records = [], providerOutlook = []) {
  if (providerOutlook?.some((row) => row.rainfall_mm != null || row.rainfall != null)) {
    return providerOutlook.map((row) => ({
      month: row.month,
      rainfall: Number(row.rainfall_mm ?? row.rainfall),
      method: row.method || "historical monthly normal",
    }));
  }
  const monthly = new Map();
  records.forEach((row) => {
    const month = Number(String(row.date || "").slice(5, 7));
    const rainfall = Number(row.rainfall_mm ?? row.PRECTOTCORR);
    if (!month || !Number.isFinite(rainfall)) return;
    const bucket = monthly.get(month) || { total: 0, count: 0 };
    bucket.total += rainfall;
    bucket.count += 1;
    monthly.set(month, bucket);
  });

  const now = new Date();
  return Array.from({ length: 6 }, (_, index) => {
    const next = new Date(now.getFullYear(), now.getMonth() + index + 1, 1);
    const month = next.getMonth() + 1;
    const bucket = monthly.get(month);
    const rainfall = bucket?.count ? bucket.total / bucket.count : null;
    return {
      month: monthName(month),
      rainfall: rainfall == null ? null : Number(rainfall.toFixed(1)),
      method: "10-year monthly normal",
    };
  });
}

function annualMetric(records = [], metricKey) {
  const grouped = new Map();
  records.forEach((row) => {
    const year = String(row.date || "").slice(0, 4);
    const value = Number(row[metricKey]);
    if (!year || !Number.isFinite(value)) return;
    const bucket = grouped.get(year) || { total: 0, count: 0 };
    bucket.total += value;
    bucket.count += 1;
    grouped.set(year, bucket);
  });
  return [...grouped.entries()]
    .sort(([left], [right]) => Number(left) - Number(right))
    .map(([year, bucket]) => ({
      year,
      value: Number((bucket.total / bucket.count).toFixed(1)),
    }));
}

function monthlyMetricRows(records = [], metricKey) {
  return records
    .filter((row) => Number.isFinite(Number(row[metricKey])))
    .slice(-60)
    .map((row) => ({
      month: row.month || String(row.date || "").slice(0, 7),
      value: Number(Number(row[metricKey]).toFixed(1)),
      rainfall_mm: row.rainfall_mm,
      temperature_c: row.temperature_c,
    }));
}

function average(values) {
  const valid = values.map(Number).filter(Number.isFinite);
  if (!valid.length) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function sourceTone(access = "") {
  if (access === "connected" || access === "connected_catalogue" || access === "configured") return "live";
  if (access === "configuration_required") return "setup";
  return "required";
}

function SourceChip({ source }) {
  return (
    <div className={`aeis-env-source-chip ${sourceTone(source?.access)}`}>
      <span>{source?.provider || "Provider required"}</span>
      <strong>{source?.name || "Source not connected"}</strong>
      <em>{source?.access?.replaceAll("_", " ") || "source required"}</em>
    </div>
  );
}

function SourceGate({ title, rows }) {
  return (
    <div className="aeis-env-source-gate">
      <strong>{title}</strong>
      <div className="aeis-env-gate-list">
        {rows.map((row) => (
          <div className="aeis-env-gate-row" key={row.metric}>
            <span>{row.metric}</span>
            <em>{row.source}</em>
            <strong>{row.status}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function EnvironmentalIntelligenceHub({ session, county, onOpenAssistant, defaultConsole = "rainfall" }) {
  const [activeConsole, setActiveConsole] = useState(defaultConsole || "rainfall");
  const [catalog, setCatalog] = useState(null);
  const [history, setHistory] = useState(null);
  const [status, setStatus] = useState("Loading source catalogue...");
  const [loading, setLoading] = useState(false);

  const countyName = county?.name || "";
  const scopeLabel = countyName || "National command center";
  const rainfallRows = useMemo(() => annualRainfall(history?.records || []), [history]);
  const outlookRows = useMemo(
    () => rainfallOutlook(history?.records || [], history?.six_month_outlook || []),
    [history],
  );
  const averageRain = average(rainfallRows.map((row) => row.rainfall));
  const latestRain = rainfallRows[rainfallRows.length - 1];
  const active = CONSOLES.find((consoleItem) => consoleItem.id === activeConsole) || CONSOLES[0];
  const metricConfig = CONSOLE_METRICS[activeConsole] || CONSOLE_METRICS.rainfall;
  const monthlyMetric = useMemo(
    () => monthlyMetricRows(history?.records || [], metricConfig.key),
    [history, metricConfig.key],
  );
  const annualMetricRows = useMemo(
    () => annualMetric(history?.records || [], metricConfig.key),
    [history, metricConfig.key],
  );
  const readiness = history?.console_readiness?.[activeConsole];
  const sourceBySlug = useMemo(() => {
    const map = new Map();
    (catalog?.sources || []).forEach((source) => map.set(source.slug, source));
    return map;
  }, [catalog]);

  const loadData = useCallback(async () => {
    setLoading(true);
    const apiBase = getApiBase();
    try {
      const catalogResponse = await fetch(`${apiBase}/api/data/sources`);
      const catalogPayload = await catalogResponse.json();
      setCatalog(catalogPayload);

      if (session?.token) {
        const historyQuery = new URLSearchParams({ years: "20" });
        if (countyName) {
          historyQuery.set("county", countyName);
        }
        const historyResponse = await fetch(`${apiBase}/api/data/intelligence/monthly?${historyQuery}`, {
          headers: { Authorization: `Bearer ${session.token}` },
        });
        const historyPayload = await historyResponse.json();
        if (!historyResponse.ok) throw new Error(historyPayload.error || "Unable to load monthly intelligence.");
        setHistory(historyPayload);
        setStatus(
          countyName
            ? `20-year monthly county intelligence loaded for ${countyName}.`
            : "20-year monthly national intelligence loaded from aggregated county-centre records.",
        );
      } else {
        setHistory(null);
        setStatus("Sign in to load 20-year monthly intelligence and the six-month historical outlook.");
      }
    } catch (error) {
      setStatus(error.message || "Environmental intelligence sources could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [countyName, session?.token]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    setActiveConsole(defaultConsole || "rainfall");
  }, [defaultConsole]);

  const assistantPrompt = countyName
    ? `Analyze ${countyName} as a county weather and land intelligence workspace. Use rainfall history, six-month historical rainfall outlook, water, vegetation, forest, soil health, land-use, housing, cropland, forest land, and road-source readiness.`
    : "Analyze Kenya as a national weather and land intelligence platform. Focus on rainfall, six-month historical rainfall outlook, water, vegetation, forest, soil health, land use, housing, cropland, forest land, and road-source readiness across counties.";

  return (
    <section className="aeis-card aeis-env-hub">
      <div className="aeis-env-head">
        <div>
          <span className="aeis-kicker">Climate, Water & Land Intelligence Hub</span>
          <h2>{scopeLabel}</h2>
          <p>
            National and county consoles for rainfall, water, vegetation, forests, soil health, land use,
            housing/built-up growth, cropland, and road intelligence.
          </p>
        </div>
        <div className="aeis-insight-actions">
          <button type="button" className="aeis-btn ghost" onClick={loadData} disabled={loading}>
            <RefreshCw size={15} className={loading ? "spin" : ""} /> Refresh
          </button>
          <button type="button" className="aeis-btn" onClick={() => onOpenAssistant?.(assistantPrompt)}>
            Ask intelligence assistant
          </button>
        </div>
      </div>

      <div className="aeis-env-console-tabs" role="tablist" aria-label="Environmental intelligence consoles">
        {CONSOLES.map((consoleItem) => {
          const Icon = consoleItem.icon;
          return (
            <button
              key={consoleItem.id}
              type="button"
              className={activeConsole === consoleItem.id ? `active ${consoleItem.tone}` : ""}
              onClick={() => setActiveConsole(consoleItem.id)}
            >
              <Icon size={17} />
              <span>{consoleItem.label}</span>
            </button>
          );
        })}
      </div>

      <div className="aeis-env-summary-strip">
        <div>
          <span>Console</span>
          <strong>{active.label}</strong>
          <em>{countyName ? "County-specific view" : "National reference view"}</em>
        </div>
        <div>
          <span>20-year avg rain</span>
          <strong>{Number.isFinite(averageRain) ? `${formatNumber(averageRain, 0)} mm` : "--"}</strong>
          <em>KMD/KALRO priority, NASA fallback</em>
        </div>
        <div>
          <span>Latest complete year</span>
          <strong>{latestRain?.year || "--"}</strong>
          <em>{latestRain ? `${formatNumber(latestRain.rainfall, 0)} mm` : "Source pending"}</em>
        </div>
        <div>
          <span>Source honesty</span>
          <strong>{readiness?.status ? readiness.status.replace("_", " ") : "Gated"}</strong>
          <em>{readiness?.source || "Unconnected metrics stay hidden"}</em>
        </div>
      </div>

      {activeConsole === "rainfall" ? (
        <div className="aeis-env-rainfall-grid">
          <div className="aeis-env-chart-card">
            <div className="aeis-insight-panel-head">
              <div>
                <strong>Rainfall console: last 20 years</strong>
                <span>{history?.earliest_available || "Start"} to {history?.latest_available || "latest complete month"}</span>
              </div>
              <CloudRain size={18} />
            </div>
            {rainfallRows.length ? (
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={rainfallRows} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#dbe7ef" />
                  <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} width={46} />
                  <Tooltip />
                  <Area dataKey="rainfall" name="Annual rainfall mm" fill="#dbeafe" stroke="#2563eb" />
                  <Bar dataKey="rainfall" name="Annual rainfall mm" fill="#38bdf8" radius={[5, 5, 0, 0]} />
                  <Line dataKey="rainfall" name="Rainfall trend" stroke="#0f172a" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <div className="aeis-insight-empty-chart">
                <CloudRain size={34} />
                <strong>Rainfall history waits for an active session.</strong>
                <span>AEIS-K will not plot rainfall without source records.</span>
              </div>
            )}
          </div>

          <div className="aeis-env-chart-card">
            <div className="aeis-insight-panel-head">
              <div>
                <strong>Next six months: historical rainfall outlook</strong>
                <span>Based on the same month in the previous 10 years; not an official forecast.</span>
              </div>
              <MapPinned size={18} />
            </div>
            {outlookRows.some((row) => row.rainfall != null) ? (
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={outlookRows} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#dbe7ef" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} width={42} />
                  <Tooltip />
                  <Bar dataKey="rainfall" name="Expected rainfall mm" fill="#2563eb" radius={[6, 6, 0, 0]} />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <div className="aeis-insight-empty-chart">
                <MapPinned size={34} />
                <strong>Historical outlook not ready.</strong>
                <span>Connect rainfall history to compute next-month normals.</span>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="aeis-env-source-layout">
          <div className="aeis-env-source-card">
            <div className="aeis-insight-panel-head">
              <div>
                <strong>{active.label} console design</strong>
                <span>{readiness?.note || "Climate context is populated; unsupported values stay blocked until source-backed data is connected."}</span>
              </div>
              <active.icon size={18} />
            </div>
            {monthlyMetric.length ? (
              <div className="aeis-env-mini-chart">
                <div className="aeis-env-mini-chart-head">
                  <strong>{metricConfig.chartTitle}</strong>
                  <span>{metricConfig.name} {metricConfig.unit}</span>
                </div>
                <ResponsiveContainer width="100%" height={230}>
                  <ComposedChart data={monthlyMetric} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#dbe7ef" />
                    <XAxis dataKey="month" tick={{ fontSize: 10 }} minTickGap={22} />
                    <YAxis tick={{ fontSize: 11 }} width={42} />
                    <Tooltip />
                    <Area dataKey="value" name={metricConfig.name} fill={metricConfig.fill} stroke={metricConfig.color} />
                    <Line dataKey="value" name={metricConfig.name} stroke={metricConfig.color} strokeWidth={2.4} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="aeis-insight-empty-chart">
                <active.icon size={34} />
                <strong>Monthly context not loaded yet.</strong>
                <span>Connect a session and source records to populate this console.</span>
              </div>
            )}
            {annualMetricRows.length ? (
              <div className="aeis-env-annual-strip">
                <strong>{metricConfig.annualTitle}</strong>
                <div>
                  {annualMetricRows.slice(-8).map((row) => (
                    <span key={row.year}>
                      <em>{row.year}</em>
                      <b>{formatNumber(row.value, metricConfig.unit === "mm" ? 0 : 1)}</b>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            {activeConsole === "water" && (
              <SourceGate
                title="Water console metrics"
                rows={[
                  { metric: "Monthly water-pressure proxy", source: "KMD/KALRO preferred; NASA POWER fallback", status: readiness?.status || "Partial" },
                  { metric: "Surface-water extent by year", source: "JRC Global Surface Water / Sentinel-2 NDWI", status: "Source required" },
                  { metric: "Expansion or shrinkage trend", source: "JRC yearly history", status: "Source required" },
                  { metric: "County water stress signal", source: "Rainfall + NDWI + field validation", status: "Provider required" },
                ]}
              />
            )}
            {activeConsole === "vegetation" && (
              <SourceGate
                title="Vegetation console metrics"
                rows={[
                  { metric: "Monthly vegetation-support proxy", source: "KMD/KALRO preferred; NASA POWER fallback", status: readiness?.status || "Partial" },
                  { metric: "NDVI time series", source: "Sentinel-2 / Landsat / GEE", status: "Raster tile required" },
                  { metric: "Vegetation anomaly", source: "10-year NDVI baseline", status: "Provider required" },
                  { metric: "County vegetation recovery", source: "NDVI + rainfall history", status: "Provider required" },
                ]}
              />
            )}
            {activeConsole === "forest" && (
              <SourceGate
                title="Forest portal metrics"
                rows={[
                  { metric: "Monthly dryness-pressure proxy", source: "KMD/KALRO preferred; NASA POWER fallback", status: readiness?.status || "Partial" },
                  { metric: "Forest / tree-cover share", source: "ESA WorldCover / Sentinel", status: "Source required" },
                  { metric: "Forest loss or expansion", source: "Multi-year land-cover product", status: "Source required" },
                  { metric: "Fire / drought exposure", source: "Weather + vegetation dryness", status: "Provider required" },
                ]}
              />
            )}
            {activeConsole === "soil" && (
              <SourceGate
                title="Soil health portal metrics"
                rows={[
                  { metric: "Monthly soil-moisture proxy", source: "KMD/KALRO preferred; NASA POWER fallback", status: readiness?.status || "Partial" },
                  { metric: "Soil organic carbon / texture", source: "ISRIC SoilGrids", status: "Source required" },
                  { metric: "Soil moisture condition", source: "Open-Meteo / satellite model", status: "Provider required" },
                  { metric: "County soil risk", source: "Soil + rainfall + land-use overlay", status: "Provider required" },
                ]}
              />
            )}
            {activeConsole === "landuse" && (
              <>
                <SourceGate
                  title="Land-use portal metrics"
                  rows={[
                    { metric: "Monthly rainfall exposure context", source: "KMD/KALRO preferred; NASA POWER fallback", status: "Live context" },
                    { metric: "Housing / built-up land", source: "KNBS + ESA WorldCover + OSM", status: "Source required" },
                    { metric: "Cropland / forest / water shares", source: "ESA WorldCover + Sentinel/Landsat", status: "Source required" },
                    { metric: "Land-use change by county", source: "KNBS + annual land-cover products", status: "Source required" },
                  ]}
                />
                <div className="aeis-env-landuse-legend">
                  {LAND_USE_CLASSES.map((item) => (
                    <div key={item.label}>
                      <i style={{ background: item.color }} />
                      <span>{item.label}</span>
                      <em>{item.source}</em>
                    </div>
                  ))}
                </div>
              </>
            )}
            {activeConsole === "roads" && (
              <SourceGate
                title="Roads and infrastructure portal metrics"
                rows={[
                  { metric: "Monthly rainfall exposure context", source: "KMD/KALRO preferred; NASA POWER fallback", status: "Live context" },
                  { metric: "Tarmac road length", source: "Kenya Roads Board / OSM surface tags", status: "Source required" },
                  { metric: "All-weather road length", source: "Kenya Roads Board / OSM road classification", status: "Source required" },
                  { metric: "Access and exposure overlay", source: "Roads + rainfall + water extent + county boundaries", status: "Provider required" },
                ]}
              />
            )}
            {activeConsole === "county" && (
              <SourceGate
                title="County intelligence dashboard metrics"
                rows={[
                  { metric: "Monthly climate profile", source: "KMD/KALRO preferred; NASA POWER fallback", status: readiness?.status || "Live" },
                  { metric: "County climate profile", source: "Open-Meteo + NASA POWER + county boundary", status: countyName ? "Scoped" : "National" },
                  { metric: "Sub-county and ward drill-down", source: "Official GIS boundary layers", status: "Ready" },
                  { metric: "County action brief", source: "Weather + imagery + field reports + reports", status: "Source gated" },
                ]}
              />
            )}
          </div>
          <div className="aeis-env-source-card">
            <div className="aeis-insight-panel-head">
              <div>
                <strong>Required source path</strong>
                <span>Official and open-source feeds to connect next.</span>
              </div>
              <Route size={18} />
            </div>
            <div className="aeis-env-source-list">
              {active.sourceSlugs.map((slug) => (
                <SourceChip source={sourceBySlug.get(slug)} key={slug} />
              ))}
            </div>
            <p className="aeis-source-note">
              {status}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
