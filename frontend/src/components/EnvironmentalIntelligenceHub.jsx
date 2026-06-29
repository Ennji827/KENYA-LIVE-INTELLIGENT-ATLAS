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
import { getApiBase } from "../utils/api";

const CONSOLES = [
  {
    id: "rainfall",
    label: "Rainfall",
    icon: CloudRain,
    tone: "blue",
    sourceSlugs: ["nasa-power", "open-meteo", "knbs-statistical-portals"],
  },
  {
    id: "water",
    label: "Water",
    icon: Droplets,
    tone: "cyan",
    sourceSlugs: ["jrc-global-surface-water", "google-earth-engine", "copernicus-sentinel-2"],
  },
  {
    id: "vegetation",
    label: "Vegetation",
    icon: Leaf,
    tone: "green",
    sourceSlugs: ["copernicus-sentinel-2", "usgs-landsat", "google-earth-engine"],
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
    sourceSlugs: ["isric-soilgrids", "open-meteo", "nasa-power"],
  },
  {
    id: "landuse",
    label: "Land use & roads",
    icon: Layers3,
    tone: "slate",
    sourceSlugs: ["knbs-statistical-portals", "esa-worldcover", "openstreetmap-roads", "kenya-roads-board"],
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

function isoDate(value = new Date()) {
  return value.toISOString().slice(0, 10);
}

function tenYearStart() {
  const value = new Date();
  value.setFullYear(value.getFullYear() - 10);
  value.setMonth(0, 1);
  return isoDate(value);
}

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
    const rainfall = Number(row.PRECTOTCORR);
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

function rainfallOutlook(records = []) {
  const monthly = new Map();
  records.forEach((row) => {
    const month = Number(String(row.date || "").slice(5, 7));
    const rainfall = Number(row.PRECTOTCORR);
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

export default function EnvironmentalIntelligenceHub({ session, county, onOpenAssistant }) {
  const [activeConsole, setActiveConsole] = useState("rainfall");
  const [catalog, setCatalog] = useState(null);
  const [history, setHistory] = useState(null);
  const [status, setStatus] = useState("Loading source catalogue...");
  const [loading, setLoading] = useState(false);

  const countyName = county?.name || "";
  const scopeLabel = countyName || "National command center";
  const rainfallRows = useMemo(() => annualRainfall(history?.records || []), [history]);
  const outlookRows = useMemo(() => rainfallOutlook(history?.records || []), [history]);
  const averageRain = average(rainfallRows.map((row) => row.rainfall));
  const latestRain = rainfallRows[rainfallRows.length - 1];
  const active = CONSOLES.find((consoleItem) => consoleItem.id === activeConsole) || CONSOLES[0];
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
        const historyQuery = new URLSearchParams({
          temporal: "monthly",
          start: tenYearStart(),
          end: isoDate(),
          parameters: "PRECTOTCORR,T2M,RH2M,WS2M",
        });
        if (countyName) {
          historyQuery.set("county", countyName);
        } else {
          historyQuery.set("latitude", "-0.0236");
          historyQuery.set("longitude", "37.9062");
        }
        const historyResponse = await fetch(`${apiBase}/api/data/history/nasa-power?${historyQuery}`, {
          headers: { Authorization: `Bearer ${session.token}` },
        });
        const historyPayload = await historyResponse.json();
        if (!historyResponse.ok) throw new Error(historyPayload.error || "Unable to load rainfall history.");
        setHistory(historyPayload);
        setStatus(
          countyName
            ? `10-year rainfall console loaded for ${countyName}.`
            : "10-year rainfall console loaded from the Kenya central reference point. County aggregation is the next production step.",
        );
      } else {
        setHistory(null);
        setStatus("Sign in to load 10-year rainfall history and the six-month historical outlook.");
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
          <span>10-year avg rain</span>
          <strong>{Number.isFinite(averageRain) ? `${formatNumber(averageRain, 0)} mm` : "--"}</strong>
          <em>NASA POWER monthly</em>
        </div>
        <div>
          <span>Latest complete year</span>
          <strong>{latestRain?.year || "--"}</strong>
          <em>{latestRain ? `${formatNumber(latestRain.rainfall, 0)} mm` : "Source pending"}</em>
        </div>
        <div>
          <span>Source honesty</span>
          <strong>{activeConsole === "rainfall" && rainfallRows.length ? "Live" : "Gated"}</strong>
          <em>Unconnected metrics stay hidden</em>
        </div>
      </div>

      {activeConsole === "rainfall" ? (
        <div className="aeis-env-rainfall-grid">
          <div className="aeis-env-chart-card">
            <div className="aeis-insight-panel-head">
              <div>
                <strong>Rainfall console: last 10 years</strong>
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
                <span>Chart surfaces are ready; values stay blocked until source-backed data is connected.</span>
              </div>
              <active.icon size={18} />
            </div>
            {activeConsole === "water" && (
              <SourceGate
                title="Water console metrics"
                rows={[
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
                  { metric: "Soil organic carbon / texture", source: "ISRIC SoilGrids", status: "Source required" },
                  { metric: "Soil moisture condition", source: "Open-Meteo / satellite model", status: "Provider required" },
                  { metric: "County soil risk", source: "Soil + rainfall + land-use overlay", status: "Provider required" },
                ]}
              />
            )}
            {activeConsole === "landuse" && (
              <>
                <SourceGate
                  title="Land-use and road portal metrics"
                  rows={[
                    { metric: "Housing / built-up land", source: "KNBS + ESA WorldCover + OSM", status: "Source required" },
                    { metric: "Cropland / forest / water shares", source: "ESA WorldCover + Sentinel/Landsat", status: "Source required" },
                    { metric: "Tarmac and all-weather roads", source: "Kenya Roads Board / OSM highway+surface tags", status: "Source required" },
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
