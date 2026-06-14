import React, { useEffect, useState } from "react";
import StatCard from "./StatCard";
import { getApiBase } from "../utils/api";

function formatTime(value) {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function RealtimeOperationsFeed({ countyName = "" }) {
  const [payload, setPayload] = useState(null);
  const [status, setStatus] = useState("Loading live source status...");

  useEffect(() => {
    let cancelled = false;
    let timer = null;

    async function loadFeed() {
      const query = countyName ? `?county=${encodeURIComponent(countyName)}` : "";
      try {
        const response = await fetch(`${getApiBase()}/api/dashboard/realtime${query}`);
        const data = await response.json();
        if (!response.ok) {
          if (!cancelled) setStatus(data.error || "Live source status unavailable.");
          return;
        }
        if (!cancelled) {
          setPayload(data);
          setStatus(`Updated ${formatTime(data.generated_at)}. Refreshes every ${data.refresh_seconds || 60}s.`);
        }
      } catch (error) {
        if (!cancelled) setStatus(error.message || "Live source status unavailable.");
      }
    }

    loadFeed();
    timer = window.setInterval(loadFeed, 60000);

    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, [countyName]);

  const metrics = payload?.metrics || {};

  return (
    <div className="aeis-card aeis-card-pad aeis-live-card">
      <div className="aeis-card-heading">
        <div>
          <h2 className="aeis-section-title">Live Source Status</h2>
          <p className="aeis-section-copy">
            {payload?.scope || (countyName ? `${countyName} County` : "National Command Center")} real-source monitoring for connected services and blocked operational feeds.
          </p>
        </div>
        <span className="aeis-live-dot">Live</span>
      </div>

      <div className="aeis-grid aeis-live-kpis">
        <StatCard label="Forecast" value={metrics.forecastStatus || "--"} tone="blue" />
        <StatCard label="GEE Layers" value={metrics.geeLayersConfigured ?? "--"} tone="green" />
        <StatCard label="Alerts Feed" value={metrics.alertFeedStatus || "--"} tone="amber" />
        <StatCard label="Active Sessions" value={metrics.activeCountySessions ?? "--"} tone="navy" />
      </div>

      <div className="aeis-live-events">
        {(payload?.events || []).map((event) => (
          <div className={`aeis-live-event ${String(event.severity || "low").toLowerCase()}`} key={event.id}>
            <span>{formatTime(event.time)}</span>
            <strong>{event.county_code} {event.county} / {event.signal}</strong>
            <p>{event.message}</p>
          </div>
        ))}
      </div>

      <p className="aeis-source-note">{payload?.source_note || status}</p>
      <p className="aeis-source-note">{status}</p>
    </div>
  );
}
