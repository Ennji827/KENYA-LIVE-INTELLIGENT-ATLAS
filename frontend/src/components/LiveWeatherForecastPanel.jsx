import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getApiBase } from "../utils/api";

function formatTime(value) {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatDay(value) {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

function riskClass(value) {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("high")) return "high";
  if (normalized.includes("medium") || normalized.includes("watch")) return "medium";
  return "low";
}

function threeDayRain(row) {
  return (row.daily || []).slice(0, 3).reduce((sum, day) => sum + (Number(day.precipitation_sum) || 0), 0);
}

function totalRain(rows, limit = 7) {
  return (rows || []).slice(0, limit).reduce((sum, day) => sum + (Number(day.precipitation_sum) || 0), 0);
}

function formatMetric(value, suffix = "", digits = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  const formatted = number.toFixed(digits);
  return suffix ? `${formatted} ${suffix}` : formatted;
}

function WeatherMetric({ label, value, note }) {
  return (
    <div className="aeis-weather-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {note && <em>{note}</em>}
    </div>
  );
}

function rainIntensity(probability) {
  const value = Number(probability) || 0;
  if (value >= 70) return "high";
  if (value >= 35) return "medium";
  return "low";
}

function rainfallBarColor(risk) {
  const normalized = String(risk || "").toLowerCase();
  if (normalized.includes("high")) return "#dc2626";
  if (normalized.includes("medium") || normalized.includes("watch")) return "#d97706";
  return "#0284c7";
}

function NationalRainTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="aeis-weather-chart-tooltip">
      <strong>{row.countyCode} {row.county}</strong>
      <span>{row.rainfall.toFixed(1)} mm forecast over 3 days</span>
      <span>{row.condition}</span>
      <em>{row.risk} forecast watch</em>
    </div>
  );
}

export default function LiveWeatherForecastPanel({ countyName = "", compact = false, mapAdjacent = false }) {
  const [payload, setPayload] = useState(null);
  const [status, setStatus] = useState("Loading live forecast...");
  const requestIdRef = useRef(0);

  const loadForecast = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    const query = countyName ? `?county=${encodeURIComponent(countyName)}` : "";
    setStatus("Updating forecast...");
    try {
      const response = await fetch(`${getApiBase()}/api/weather/forecast${query}`);
      const data = await response.json();
      if (requestId !== requestIdRef.current) return;
      if (!response.ok) {
        setStatus(data.error || "Forecast unavailable.");
        return;
      }
      setPayload(data);
      setStatus(`Updated ${formatTime(data.generated_at)} from ${data.provider}.`);
    } catch (error) {
      setStatus(error.message || "Forecast unavailable.");
    }
  }, [countyName]);

  useEffect(() => {
    let cancelled = false;
    let timer = null;
    setPayload(null);

    async function guardedLoad() {
      if (cancelled) return;
      await loadForecast();
    }

    guardedLoad();
    timer = window.setInterval(guardedLoad, 10 * 60 * 1000);

    return () => {
      cancelled = true;
      requestIdRef.current += 1;
      if (timer) window.clearInterval(timer);
    };
  }, [loadForecast]);

  const forecast = payload?.forecast || null;
  const countyRows = payload?.counties || [];
  const dailyRows = forecast?.daily || [];
  const visibleDailyRows = dailyRows.slice(0, compact ? 3 : 7);
  const nextThreeDayRain = totalRain(dailyRows, 3);
  const nextSevenDayRain = totalRain(dailyRows, 7);
  const currentRain = forecast?.current?.rain ?? forecast?.current?.precipitation;
  const watchRows = useMemo(() => {
    return [...countyRows]
      .sort((a, b) => {
        const riskRank = { High: 3, Medium: 2, "Heat / dry watch": 2, Low: 1, Unavailable: 0 };
        return (riskRank[b.risk] || 0) - (riskRank[a.risk] || 0) || threeDayRain(b) - threeDayRain(a);
      })
      .slice(0, compact ? 6 : 5);
  }, [compact, countyRows]);
  const nationalRainRows = useMemo(() => {
    return [...countyRows]
      .map((row) => ({
        county: row.county,
        countyCode: row.county_code,
        rainfall: threeDayRain(row),
        risk: row.risk || "Unavailable",
        condition: row.current?.condition || "Condition unavailable",
      }))
      .sort((a, b) => b.rainfall - a.rainfall)
      .slice(0, 10);
  }, [countyRows]);
  const nationalRiskCounts = useMemo(() => {
    return countyRows.reduce(
      (counts, row) => {
        const risk = String(row.risk || "").toLowerCase();
        if (risk.includes("high")) counts.high += 1;
        else if (risk.includes("medium") || risk.includes("watch")) counts.watch += 1;
        else if (risk.includes("low")) counts.low += 1;
        return counts;
      },
      { high: 0, watch: 0, low: 0 },
    );
  }, [countyRows]);

  const rootClasses = [
    "aeis-card",
    "aeis-weather-live-card",
    compact ? "compact" : "",
    mapAdjacent ? "map-adjacent" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={rootClasses}>
      <div className="aeis-weather-head">
        <div>
          <div className="aeis-weather-eyebrow">
            <span className="aeis-live-dot">Open API · no key</span>
            <span>{payload?.provider_status === "live" ? "Connected" : "Checking source"}</span>
          </div>
          <h2 className="aeis-section-title">Live Weather Forecast</h2>
          <p className="aeis-section-copy">
            {countyName ? `${countyName} county forecast for field operations.` : "National forecast watch across all 47 counties."}
          </p>
        </div>
        <div className="aeis-weather-actions">
          <span className="aeis-weather-scope-pill">{countyName ? `${countyName} County` : "National Command Center"}</span>
          <button type="button" className="aeis-btn ghost aeis-weather-refresh" onClick={loadForecast}>
            Refresh
          </button>
        </div>
      </div>

      {!payload ? (
        <div className="aeis-weather-empty">
          <strong>Loading weather intelligence</strong>
          <span>{status}</span>
        </div>
      ) : forecast ? (
        <>
          <div className="aeis-weather-current-grid">
            <div className="aeis-weather-current">
              <span>Current conditions</span>
              <strong>{formatMetric(forecast.current?.temperature_2m, "C", 1)}</strong>
              <p>{forecast.current?.condition || "Condition unavailable"}</p>
            </div>
            <div className={`aeis-weather-risk-panel ${riskClass(forecast.risk)}`}>
              <span>Operational risk</span>
              <strong>{forecast.risk || "Unavailable"}</strong>
              <p>{formatMetric(nextThreeDayRain, "mm", 1)} rain expected in the next 3 days.</p>
            </div>
          </div>

          <div className="aeis-weather-metrics">
            <WeatherMetric label="Humidity" value={formatMetric(forecast.current?.relative_humidity_2m, "%")} note="Current" />
            <WeatherMetric label="Rain now" value={formatMetric(currentRain, "mm", 1)} note="Current hour" />
            <WeatherMetric label="7-day rain" value={formatMetric(nextSevenDayRain, "mm", 1)} note="Forecast total" />
            <WeatherMetric label="Wind" value={formatMetric(forecast.current?.wind_speed_10m, "km/h", 1)} note="10 m speed" />
          </div>

          <div className={`aeis-weather-advisory ${riskClass(forecast.risk)}`}>
            <strong>{forecast.county_code} {forecast.county}</strong>
            <span>{forecast.advisory}</span>
          </div>

          <div className="aeis-weather-daily-grid">
            {visibleDailyRows.map((day) => {
              const probability = Math.min(100, Math.max(0, Number(day.precipitation_probability_max) || 0));
              return (
                <article className="aeis-weather-day-card" key={day.date}>
                  <div className="aeis-weather-day-head">
                    <strong>{formatDay(day.date)}</strong>
                    <span className={`aeis-weather-risk ${rainIntensity(probability)}`}>{probability}% rain</span>
                  </div>
                  <p>{day.condition}</p>
                  <div className="aeis-weather-day-metrics">
                    <span>{formatMetric(day.temperature_2m_min, "C")} - {formatMetric(day.temperature_2m_max, "C")}</span>
                    <span>{formatMetric(day.precipitation_sum, "mm", 1)}</span>
                    <span>{formatMetric(day.wind_speed_10m_max, "km/h", 0)}</span>
                  </div>
                  <div className="aeis-rain-probability-track" aria-hidden="true">
                    <i style={{ width: `${probability}%` }} />
                  </div>
                </article>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <div className="aeis-weather-metrics national">
            <WeatherMetric label="Live counties" value={`${payload?.summary?.live_counties ?? "--"}/${payload?.summary?.counties ?? 47}`} note="Forecast coverage" />
            <WeatherMetric label="High watch" value={nationalRiskCounts.high} note="Forecast signal" />
            <WeatherMetric label="Medium / dry watch" value={nationalRiskCounts.watch} note="Forecast signal" />
            <WeatherMetric label="3-day rain total" value={formatMetric(payload?.summary?.three_day_rainfall_total_mm, "mm", 1)} note="National sum" />
          </div>

          {!compact && nationalRainRows.length > 0 && (
            <div className="aeis-weather-chart-panel">
              <div className="aeis-weather-chart-heading">
                <div>
                  <strong>Highest 3-day rainfall outlook</strong>
                  <span>Top 10 counties by Open-Meteo forecast total</span>
                </div>
                <div className="aeis-weather-chart-legend" aria-label="Forecast risk colors">
                  <span className="high">High</span>
                  <span className="medium">Watch</span>
                  <span className="low">Low</span>
                </div>
              </div>
              <div className="aeis-weather-chart" role="img" aria-label="Horizontal bar chart comparing three-day rainfall forecasts for ten counties">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={nationalRainRows}
                    layout="vertical"
                    margin={{ top: 4, right: 22, bottom: 4, left: 12 }}
                  >
                    <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" horizontal={false} />
                    <XAxis
                      type="number"
                      unit=" mm"
                      tick={{ fill: "#64748b", fontSize: 11, fontWeight: 700 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="county"
                      width={88}
                      tick={{ fill: "#0f172a", fontSize: 11, fontWeight: 800 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <RechartsTooltip content={<NationalRainTooltip />} cursor={{ fill: "#f8fafc" }} />
                    <Bar dataKey="rainfall" radius={[0, 5, 5, 0]} maxBarSize={18}>
                      {nationalRainRows.map((row) => (
                        <Cell key={row.countyCode} fill={rainfallBarColor(row.risk)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          <div className="aeis-weather-list-heading">
            <strong>Priority forecast queue</strong>
            <span>Forecast signals only; confirm warnings with official county or KMD information.</span>
          </div>
          <div className="aeis-weather-watch-list">
            {watchRows.map((row) => (
              <div className="aeis-weather-watch-row" key={row.county_code}>
                <div>
                  <strong>{row.county_code} {row.county}</strong>
                  <span>{row.current?.condition || "Unavailable"}</span>
                </div>
                <b>{formatMetric(row.current?.temperature_2m, "C", 1)}</b>
                <em>{threeDayRain(row).toFixed(1)} mm</em>
                <span className={`aeis-weather-risk ${riskClass(row.risk)}`}>{row.risk}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <p className="aeis-source-note">
        {status} Open weather source: Open-Meteo Best Match forecast, refreshed every 10 minutes. Confirm operational alerts with official county/KMD station data where available.
      </p>
    </section>
  );
}
