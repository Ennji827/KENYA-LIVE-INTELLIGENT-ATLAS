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
import { Bot, CloudRain, DatabaseZap, Leaf, RefreshCw, Satellite } from "lucide-react";
import { getApiBase } from "../utils/api";

function isoDate(value = new Date()) {
  return value.toISOString().slice(0, 10);
}

function twentyYearStart() {
  const value = new Date();
  value.setFullYear(value.getFullYear() - 20);
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

function annualizeClimate(records = []) {
  const grouped = new Map();
  records.forEach((row) => {
    const year = String(row.date || "").slice(0, 4);
    if (!year) return;
    const bucket = grouped.get(year) || {
      year,
      rainfall: 0,
      tempTotal: 0,
      tempCount: 0,
    };
    const rainfall = Number(row.PRECTOTCORR);
    if (Number.isFinite(rainfall)) bucket.rainfall += rainfall;
    const temp = Number(row.T2M);
    if (Number.isFinite(temp)) {
      bucket.tempTotal += temp;
      bucket.tempCount += 1;
    }
    grouped.set(year, bucket);
  });

  return [...grouped.values()]
    .sort((a, b) => Number(a.year) - Number(b.year))
    .map((row) => ({
      year: row.year,
      rainfall: Number(row.rainfall.toFixed(1)),
      temperature: row.tempCount ? Number((row.tempTotal / row.tempCount).toFixed(1)) : null,
    }));
}

function average(values) {
  const valid = values.map(Number).filter(Number.isFinite);
  if (!valid.length) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function climateSignal(rows) {
  if (!rows.length) {
    return {
      title: "Select a county to build a 20-year comparison",
      detail: "AEIS-K will compare rainfall and temperature from NASA POWER before making climate statements.",
      tone: "neutral",
    };
  }
  const longRain = average(rows.map((row) => row.rainfall));
  const recentRain = average(rows.slice(-5).map((row) => row.rainfall));
  if (!Number.isFinite(longRain) || !Number.isFinite(recentRain)) {
    return {
      title: "History loaded",
      detail: "Climate records are available, but the rainfall comparison needs more valid values.",
      tone: "neutral",
    };
  }
  const change = ((recentRain - longRain) / longRain) * 100;
  if (change >= 15) {
    return {
      title: "Recent years are wetter than the long-term baseline",
      detail: `Recent 5-year rainfall is ${formatNumber(change, 1)}% above the 20-year average.`,
      tone: "wet",
    };
  }
  if (change <= -15) {
    return {
      title: "Recent years are drier than the long-term baseline",
      detail: `Recent 5-year rainfall is ${formatNumber(Math.abs(change), 1)}% below the 20-year average.`,
      tone: "dry",
    };
  }
  return {
    title: "Recent rainfall is near the long-term baseline",
    detail: `Recent 5-year rainfall differs from the 20-year average by ${formatNumber(change, 1)}%.`,
    tone: "stable",
  };
}

function sourceTone(access = "") {
  if (access === "connected" || access === "connected_catalogue" || access === "configured") return "live";
  if (access === "configuration_required") return "setup";
  return "pending";
}

function SourcePill({ source }) {
  return (
    <div className={`aeis-source-pill ${sourceTone(source.access)}`}>
      <span>{source.provider}</span>
      <strong>{source.name}</strong>
      <em>{source.latest_available || source.coverage_start || "available"}</em>
    </div>
  );
}

export default function ClimateInsightStudio({ session, county, onOpenAssistant }) {
  const [catalog, setCatalog] = useState(null);
  const [history, setHistory] = useState(null);
  const [landsat, setLandsat] = useState(null);
  const [sentinel, setSentinel] = useState(null);
  const [status, setStatus] = useState("Choose a county for 20-year comparison.");
  const [loading, setLoading] = useState(false);

  const countyName = county?.name || "";
  const rows = useMemo(() => annualizeClimate(history?.records || []), [history]);
  const signal = useMemo(() => climateSignal(rows), [rows]);
  const latestYear = rows[rows.length - 1];
  const averageRain = average(rows.map((row) => row.rainfall));
  const averageTemp = average(rows.map((row) => row.temperature));
  const sources = useMemo(() => {
    const wanted = new Set(["nasa-power", "copernicus-sentinel-2", "usgs-landsat", "google-earth-engine"]);
    return (catalog?.sources || []).filter((source) => wanted.has(source.slug));
  }, [catalog]);

  const loadInsightData = useCallback(async () => {
    setLoading(true);
    const apiBase = getApiBase();
    try {
      const requests = [fetch(`${apiBase}/api/data/sources`).then((response) => response.json())];
      if (countyName && session?.token) {
        const historyQuery = new URLSearchParams({
          county: countyName,
          temporal: "monthly",
          start: twentyYearStart(),
          end: isoDate(),
          parameters: "PRECTOTCORR,T2M,T2M_MAX,T2M_MIN",
        });
        const landsatQuery = new URLSearchParams({
          county: countyName,
          max_cloud: "35",
          lookback_days: "365",
        });
        const sentinelQuery = new URLSearchParams({
          county: countyName,
          collection: "sentinel-2-l2a",
          start: "2015-06-27",
          end: isoDate(),
          max_cloud: "35",
          limit: "8",
        });
        requests.push(
          fetch(`${apiBase}/api/data/history/nasa-power?${historyQuery}`, {
            headers: { Authorization: `Bearer ${session.token}` },
          }).then(async (response) => {
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || "Unable to load NASA POWER history.");
            return payload;
          }),
          fetch(`${apiBase}/api/data/imagery/landsat/latest?${landsatQuery}`).then((response) => response.json()),
          fetch(`${apiBase}/api/data/imagery/sentinel-2?${sentinelQuery}`, {
            headers: { Authorization: `Bearer ${session.token}` },
          }).then(async (response) => {
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || "Unable to search Sentinel-2.");
            return payload;
          }),
        );
      }

      const [catalogPayload, historyPayload, landsatPayload, sentinelPayload] = await Promise.all(requests);
      setCatalog(catalogPayload);
      if (historyPayload) setHistory(historyPayload);
      if (landsatPayload) setLandsat(landsatPayload);
      if (sentinelPayload) setSentinel(sentinelPayload);
      setStatus(
        countyName
          ? `20-year climate comparison loaded for ${countyName}.`
          : "Global source pipeline ready. Select a county for comparison.",
      );
    } catch (error) {
      setStatus(error.message || "Insight Studio could not load all sources.");
    } finally {
      setLoading(false);
    }
  }, [countyName, session?.token]);

  useEffect(() => {
    loadInsightData();
  }, [loadInsightData]);

  const assistantPrompt = countyName
    ? `Analyze ${countyName} using the 20-year NASA POWER rainfall and temperature trend, latest Landsat/Sentinel source status, NDVI/NDWI/LST readiness, and field verification priorities.`
    : "Analyze national AEIS-K data-source readiness for 20-year rainfall comparison, NDVI/NDWI/LST monitoring, and field verification priorities.";

  return (
    <section className="aeis-card aeis-insight-studio">
      <div className="aeis-insight-studio-head">
        <div>
          <span className="aeis-kicker">Insight Studio</span>
          <h2>{countyName ? `${countyName} climate and satellite intelligence` : "Climate and satellite intelligence"}</h2>
          <p>
            One clean workspace for long-term rainfall comparison, global imagery readiness, and guided analysis.
          </p>
        </div>
        <div className="aeis-insight-actions">
          <button type="button" className="aeis-btn ghost" onClick={loadInsightData} disabled={loading}>
            <RefreshCw size={15} className={loading ? "spin" : ""} /> Refresh
          </button>
          <button type="button" className="aeis-btn" onClick={() => onOpenAssistant?.(assistantPrompt)}>
            <Bot size={16} /> Ask assistant
          </button>
        </div>
      </div>

      <div className="aeis-insight-summary">
        <div className={`aeis-insight-signal ${signal.tone}`}>
          <CloudRain size={20} />
          <div>
            <strong>{signal.title}</strong>
            <span>{signal.detail}</span>
          </div>
        </div>
        <div className="aeis-insight-stat">
          <span>Latest year</span>
          <strong>{latestYear?.year || "--"}</strong>
          <em>{latestYear ? `${formatNumber(latestYear.rainfall, 0)} mm rain` : "County required"}</em>
        </div>
        <div className="aeis-insight-stat">
          <span>20-year avg rain</span>
          <strong>{Number.isFinite(averageRain) ? `${formatNumber(averageRain, 0)} mm` : "--"}</strong>
          <em>NASA POWER monthly</em>
        </div>
        <div className="aeis-insight-stat">
          <span>20-year avg temp</span>
          <strong>{Number.isFinite(averageTemp) ? `${formatNumber(averageTemp, 1)} °C` : "--"}</strong>
          <em>2 m temperature</em>
        </div>
      </div>

      <div className="aeis-insight-grid">
        <div className="aeis-insight-chart-panel">
          <div className="aeis-insight-panel-head">
            <div>
              <strong>20-year rainfall and temperature comparison</strong>
              <span>{history?.earliest_available || "Start"} → {history?.latest_available || "latest available"}</span>
            </div>
            <CloudRain size={18} />
          </div>
          {rows.length ? (
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={rows} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#dbe7ef" />
                <XAxis dataKey="year" minTickGap={18} tick={{ fontSize: 11 }} />
                <YAxis yAxisId="rain" tick={{ fontSize: 11 }} width={44} />
                <YAxis yAxisId="temp" orientation="right" tick={{ fontSize: 11 }} width={38} />
                <Tooltip />
                <Area yAxisId="rain" dataKey="rainfall" fill="#dbeafe" stroke="#2563eb" name="Rainfall mm" />
                <Bar yAxisId="rain" dataKey="rainfall" fill="#38bdf8" radius={[5, 5, 0, 0]} name="Rainfall mm" />
                <Line yAxisId="temp" dataKey="temperature" stroke="#f97316" strokeWidth={2.5} dot={false} name="Temp °C" />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="aeis-insight-empty-chart">
              <CloudRain size={34} />
              <strong>Select a county to load a 20-year chart.</strong>
              <span>AEIS-K will not show historical rainfall comparisons without source records.</span>
            </div>
          )}
        </div>

        <div className="aeis-insight-source-panel">
          <div className="aeis-insight-panel-head">
            <div>
              <strong>Global source pipeline</strong>
              <span>Ready for new rainfall, NDVI, NDWI, and LST evidence as providers publish it.</span>
            </div>
            <Satellite size={18} />
          </div>
          <div className="aeis-source-pill-grid">
            {sources.map((source) => <SourcePill source={source} key={source.slug} />)}
          </div>
          <div className="aeis-satellite-readiness">
            <div>
              <Leaf size={18} />
              <span>NDVI / NDWI / LST</span>
              <strong>{sources.some((source) => source.slug === "google-earth-engine" && source.access === "configured") ? "Configured" : "Provider tile setup required"}</strong>
            </div>
            <div>
              <Satellite size={18} />
              <span>Sentinel-2 scenes</span>
              <strong>
                {sentinel?.item_count != null
                  ? `${sentinel.item_count} low-cloud scenes`
                  : "Catalogue ready"}
              </strong>
            </div>
            <div>
              <DatabaseZap size={18} />
              <span>Latest Landsat</span>
              <strong>{landsat?.scene?.date || landsat?.status || "Search ready"}</strong>
            </div>
          </div>
          <p className="aeis-source-note">{status}</p>
        </div>
      </div>
    </section>
  );
}
