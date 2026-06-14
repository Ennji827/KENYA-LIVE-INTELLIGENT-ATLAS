import React, { useEffect, useMemo, useState } from "react";
import StatCard from "./StatCard";
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

export default function LiveWeatherForecastPanel({ countyName = "" }) {
  const [payload, setPayload] = useState(null);
  const [status, setStatus] = useState("Loading live forecast...");

  const loadForecast = async () => {
    const query = countyName ? `?county=${encodeURIComponent(countyName)}` : "";
    setStatus("Updating forecast...");
    try {
      const response = await fetch(`${getApiBase()}/api/weather/forecast${query}`);
      const data = await response.json();
      if (!response.ok) {
        setStatus(data.error || "Forecast unavailable.");
        return;
      }
      setPayload(data);
      setStatus(`Updated ${formatTime(data.generated_at)} from ${data.provider}.`);
    } catch (error) {
      setStatus(error.message || "Forecast unavailable.");
    }
  };

  useEffect(() => {
    let cancelled = false;
    let timer = null;

    async function guardedLoad() {
      if (cancelled) return;
      await loadForecast();
    }

    guardedLoad();
    timer = window.setInterval(guardedLoad, 10 * 60 * 1000);

    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, [countyName]);

  const forecast = payload?.forecast || null;
  const countyRows = payload?.counties || [];
  const dailyRows = forecast?.daily || [];
  const watchRows = useMemo(() => {
    return [...countyRows]
      .sort((a, b) => {
        const riskRank = { High: 3, Medium: 2, "Heat / dry watch": 2, Low: 1, Unavailable: 0 };
        return (riskRank[b.risk] || 0) - (riskRank[a.risk] || 0) || threeDayRain(b) - threeDayRain(a);
      })
      .slice(0, 12);
  }, [countyRows]);

  return (
    <div className="aeis-card aeis-card-pad aeis-weather-live-card">
      <div className="aeis-card-heading">
        <div>
          <h2 className="aeis-section-title">Live Weather Forecast</h2>
          <p className="aeis-section-copy">
            {countyName ? `${countyName} county forecast for field operations.` : "National forecast watch across all 47 counties."}
          </p>
        </div>
        <button type="button" className="aeis-btn ghost" onClick={loadForecast}>
          Refresh
        </button>
      </div>

      {forecast ? (
        <>
          <div className="aeis-grid aeis-live-kpis">
            <StatCard label="Now" value={`${forecast.current.temperature_2m ?? "--"} C`} note={forecast.current.condition} tone="blue" />
            <StatCard label="Humidity" value={`${forecast.current.relative_humidity_2m ?? "--"}%`} tone="green" />
            <StatCard label="Current Rain" value={`${forecast.current.rain ?? forecast.current.precipitation ?? "--"} mm`} tone="blue" />
            <StatCard label="Risk" value={forecast.risk} tone={riskClass(forecast.risk) === "high" ? "amber" : "green"} />
          </div>

          <div className={`aeis-weather-advisory ${riskClass(forecast.risk)}`}>
            <strong>{forecast.county_code} {forecast.county}</strong>
            <span>{forecast.advisory}</span>
          </div>

          <div className="aeis-table-wrap">
            <table className="aeis-table aeis-weather-table">
              <thead>
                <tr>
                  <th>Day</th>
                  <th>Condition</th>
                  <th>Temp</th>
                  <th>Rain</th>
                  <th>Rain %</th>
                  <th>Wind</th>
                </tr>
              </thead>
              <tbody>
                {dailyRows.map((day) => (
                  <tr key={day.date}>
                    <td>{formatDay(day.date)}</td>
                    <td>{day.condition}</td>
                    <td>{day.temperature_2m_min} - {day.temperature_2m_max} C</td>
                    <td>{day.precipitation_sum ?? 0} mm</td>
                    <td>{day.precipitation_probability_max ?? 0}%</td>
                    <td>{day.wind_speed_10m_max ?? 0} km/h</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          <div className="aeis-grid aeis-live-kpis">
            <StatCard label="Counties" value={payload?.summary?.counties ?? "--"} tone="green" />
            <StatCard label="Live Counties" value={payload?.summary?.live_counties ?? "--"} tone="blue" />
            <StatCard label="Watch Counties" value={payload?.summary?.watch_counties ?? "--"} tone="amber" />
            <StatCard label="3-Day Rain Total" value={`${payload?.summary?.three_day_rainfall_total_mm ?? "--"} mm`} tone="blue" />
          </div>

          <div className="aeis-table-wrap">
            <table className="aeis-table aeis-weather-table">
              <thead>
                <tr>
                  <th>County</th>
                  <th>Now</th>
                  <th>Condition</th>
                  <th>3-day rain</th>
                  <th>Risk</th>
                </tr>
              </thead>
              <tbody>
                {watchRows.map((row) => (
                  <tr key={row.county_code}>
                    <td>{row.county_code} {row.county}</td>
                    <td>{row.current?.temperature_2m ?? "--"} C</td>
                    <td>{row.current?.condition || "Unavailable"}</td>
                    <td>{threeDayRain(row).toFixed(1)} mm</td>
                    <td><span className={`aeis-weather-risk ${riskClass(row.risk)}`}>{row.risk}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="aeis-source-note">
        {status} Forecast source: Open-Meteo model forecast. Confirm operational alerts with official county/KMD station data where available.
      </p>
    </div>
  );
}
