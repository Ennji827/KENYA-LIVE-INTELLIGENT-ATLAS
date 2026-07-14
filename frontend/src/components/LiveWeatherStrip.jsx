import React, { useEffect, useState } from "react";
import { fetchWeatherForecast } from "../utils/apiClient";

// A compact live-weather banner backed by the backend Open-Meteo feed
// (/api/weather/forecast). Shown on the weather and rainfall workspaces, whose
// topic definitions explicitly call for this feed. It renders a national
// summary at national scope and a county forecast once a county is selected.
// If the feed is unreachable it renders nothing, so the scaffolded workspace
// below is never blocked.
export default function LiveWeatherStrip({ county }) {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ready | error

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    fetchWeatherForecast(county || undefined)
      .then((payload) => {
        if (cancelled) return;
        setData(payload);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [county]);

  if (status === "error") return null;

  if (status === "loading") {
    return (
      <div className="live-weather live-weather--loading">
        <span className="dot" /> Loading live weather…
      </div>
    );
  }

  const providerStatus = data?.provider_status || "unknown";
  const isCounty = Boolean(county) && data?.forecast;

  const metrics = [];
  if (isCounty) {
    const f = data.forecast;
    const c = f.current || {};
    if (typeof c.temperature_2m === "number")
      metrics.push({ label: "Temperature", value: `${c.temperature_2m}°C` });
    if (typeof c.relative_humidity_2m === "number")
      metrics.push({ label: "Humidity", value: `${c.relative_humidity_2m}%` });
    if (c.condition) metrics.push({ label: "Condition", value: c.condition });
    if (f.risk) metrics.push({ label: "Risk", value: f.risk });
  } else if (data?.summary) {
    const s = data.summary;
    if (typeof s.live_counties === "number")
      metrics.push({ label: "Live counties", value: `${s.live_counties}/${s.counties}` });
    if (typeof s.watch_counties === "number")
      metrics.push({ label: "Watch counties", value: s.watch_counties });
    if (typeof s.three_day_rainfall_total_mm === "number")
      metrics.push({ label: "3-day rainfall", value: `${s.three_day_rainfall_total_mm} mm` });
  }

  if (!metrics.length) return null;

  return (
    <div className={`live-weather live-weather--${providerStatus}`}>
      <div className="live-weather__head">
        <span className="dot" />
        <strong>Live weather</strong>
        <span className="live-weather__provider">
          {data?.provider || "Open-Meteo"} · {providerStatus}
        </span>
      </div>
      <div className="live-weather__metrics">
        {metrics.map((m) => (
          <div key={m.label} className="live-weather__metric">
            <span className="live-weather__value">{m.value}</span>
            <span className="live-weather__label">{m.label}</span>
          </div>
        ))}
      </div>
      {isCounty && data.forecast.advisory && (
        <p className="live-weather__advisory">{data.forecast.advisory}</p>
      )}
    </div>
  );
}
