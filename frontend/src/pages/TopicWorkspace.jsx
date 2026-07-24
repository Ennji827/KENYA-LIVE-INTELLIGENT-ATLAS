import React, { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
} from "recharts";
import TopicMap from "../components/TopicMap";
import InsightPanel from "../components/InsightPanel";
import PaymentGateway from "../components/PaymentGateway";
import LiveWeatherStrip from "../components/LiveWeatherStrip";
import {
  getTopic,
  regionValue,
  aggregate,
  formatValue,
  rampColor,
  SOURCE_STATUS_LABEL,
} from "../data/topics";
import { buildReport, reportToCsv, downloadText, scopeLabel } from "../utils/intel";
import { fetchOsmMetric, fetchGeeMetric } from "../utils/apiClient";

// Topics backed by a live OpenStreetMap feed (per-county, national scope).
const OSM_TOPICS = new Set(["roads"]);

// Topics backed by Google Earth Engine zonal statistics + raster tiles. These
// work at every drill level (national → county → sub-county → ward).
const GEE_TOPICS = new Set([
  "forests",
  "water_bodies",
  "farmland",
  "rainfall",
  "weather",
]);

// The drill-down workspace for one topic: map + ranked regions + charts +
// reports + AI insights, navigable National -> County -> Sub-county.
export default function TopicWorkspace({
  topicId,
  initialScope,
  onBackToHub,
  onChangeArea,
  user,
}) {
  const topic = getTopic(topicId);
  const [scope, setScope] = useState(
    initialScope || { level: "national", county: "", subcounty: "", ward: "" },
  );
  const [regions, setRegions] = useState([]);
  const [report, setReport] = useState(null);
  // Live per-county values from OpenStreetMap for supported topics; null means
  // "use scaffolding". `live` flags that at least one real value arrived.
  const [liveValues, setLiveValues] = useState(null);
  const [liveState, setLiveState] = useState("idle"); // idle | loading | live | error
  const [liveSource, setLiveSource] = useState(null); // "OpenStreetMap" | "Google Earth Engine"
  const [geeTile, setGeeTile] = useState(null); // { url, opacity, unit } raster overlay

  // Fetch live values for the current scope. GEE topics resolve at every drill
  // level (national → county → sub-county → ward) and also return a raster tile;
  // the OSM roads feed is national-only. Everything else stays on scaffolding.
  // Null/empty responses (incl. an unconfigured provider) fall back cleanly.
  useEffect(() => {
    let cancelled = false;

    const applyRegions = (data, source, withTile) => {
      if (cancelled) return;
      const map = {};
      (data.regions || []).forEach((r) => {
        if (r?.name && typeof r.value === "number") map[r.name] = r.value;
      });
      const has = Object.keys(map).length > 0;
      setLiveValues(has ? map : null);
      setLiveState(has ? "live" : "error");
      setLiveSource(has ? source : null);
      setGeeTile(withTile && data.tile?.url ? data.tile : null);
    };

    const fail = () => {
      if (cancelled) return;
      setLiveValues(null);
      setLiveState("error");
      setLiveSource(null);
      setGeeTile(null);
    };

    if (GEE_TOPICS.has(topicId)) {
      const level =
        scope.level === "national"
          ? "national"
          : scope.level === "county"
          ? "county"
          : "subcounty";
      setLiveState("loading");
      setGeeTile(null);
      fetchGeeMetric(topicId, {
        level,
        county: scope.county || undefined,
        subcounty: scope.subcounty || undefined,
      })
        .then((data) => applyRegions(data, "Google Earth Engine", true))
        .catch(fail);
      return () => {
        cancelled = true;
      };
    }

    if (OSM_TOPICS.has(topicId) && scope.level === "national") {
      setLiveState("loading");
      setGeeTile(null);
      fetchOsmMetric(topicId)
        .then((data) => applyRegions(data, "OpenStreetMap", false))
        .catch(fail);
      return () => {
        cancelled = true;
      };
    }

    setLiveValues(null);
    setLiveState("idle");
    setLiveSource(null);
    setGeeTile(null);
    return () => {
      cancelled = true;
    };
  }, [topicId, scope.level, scope.county, scope.subcounty]);
  // Report generation is gated behind an M-PESA payment. Clicking "Generate
  // report" opens the gateway; a successful payment builds and reveals it.
  const [showPayment, setShowPayment] = useState(false);

  const handlePaid = () => {
    setShowPayment(false);
    setReport(buildReport(topicId, scope, regions));
  };

  // Map level: national counties, the sub-counties of the active county, or the
  // wards of the active sub-county. Ward focus stays on the sub-county's wards.
  const mapLevel =
    scope.level === "national"
      ? "national"
      : scope.level === "county"
      ? "county"
      : "subcounty";

  const handleDrill = (name) => {
    if (scope.level === "national") {
      setScope({ level: "county", county: name, subcounty: "", ward: "" });
    } else if (scope.level === "county") {
      // Clicking a sub-county drills into its wards.
      setScope((s) => ({ ...s, level: "subcounty", subcounty: name, ward: "" }));
    } else {
      // In a sub-county (or ward) view, clicking a ward focuses it.
      setScope((s) => ({ ...s, level: "ward", ward: name }));
    }
  };

  const goNational = () =>
    setScope({ level: "national", county: "", subcounty: "", ward: "" });
  const goCounty = () =>
    setScope((s) => ({
      level: "county",
      county: s.county,
      subcounty: "",
      ward: "",
    }));
  const goSubcounty = () =>
    setScope((s) => ({
      level: "subcounty",
      county: s.county,
      subcounty: s.subcounty,
      ward: "",
    }));

  // Headline figure for the current scope, derived from the visible regions.
  const headline = useMemo(() => {
    // A focused ward is a leaf: show its own value. Every other level
    // aggregates the child regions currently in view.
    if (scope.level === "ward") {
      return regionValue(topicId, scope.ward);
    }
    return aggregate(topicId, regions.map((r) => r.value));
  }, [scope, regions, topicId]);

  const chartData = useMemo(() => regions.slice(0, 12), [regions]);
  const [minVal, maxVal] = useMemo(() => {
    const vals = regions.map((r) => r.value).filter((v) => typeof v === "number");
    return vals.length ? [Math.min(...vals), Math.max(...vals)] : [0, 1];
  }, [regions]);

  const childTier =
    scope.level === "national"
      ? "counties"
      : scope.level === "county"
      ? "sub-counties"
      : "wards";

  return (
    <div className="workspace">
      {/* Top bar: breadcrumb + actions */}
      <div className="workspace__bar">
        <nav className="crumbs">
          <button className="crumb" onClick={onBackToHub}>
            Hub
          </button>
          <span className="sep">/</span>
          <button className="crumb" onClick={goNational}>
            <span className="crumb-icon">{topic.icon}</span>
            {topic.label} · National
          </button>
          {scope.county && (
            <>
              <span className="sep">/</span>
              <button
                className="crumb"
                onClick={goCounty}
                disabled={scope.level === "county"}
              >
                {scope.county}
              </button>
            </>
          )}
          {scope.subcounty && (
            <>
              <span className="sep">/</span>
              <button
                className="crumb"
                onClick={goSubcounty}
                disabled={scope.level === "subcounty"}
              >
                {scope.subcounty}
              </button>
            </>
          )}
          {scope.ward && (
            <>
              <span className="sep">/</span>
              <span className="crumb crumb--current">{scope.ward}</span>
            </>
          )}
        </nav>
        <div className="workspace__actions">
          {onChangeArea && (
            <button className="btn btn--ghost" onClick={onChangeArea}>
              Change area
            </button>
          )}
          <button
            className="btn btn--ghost"
            onClick={() => setShowPayment(true)}
          >
            Generate report
          </button>
          <button className="btn" onClick={onBackToHub}>
            All topics
          </button>
        </div>
      </div>

      {/* Scope summary */}
      <div className="workspace__summary" style={{ "--accent": topic.ramp[1] }}>
        <div>
          <div className="summary-scope">{scopeLabel(scope)}</div>
          <div className="summary-metric">{topic.metricLabel}</div>
        </div>
        <div className="summary-value">{formatValue(topicId, headline)}</div>
        <div className="summary-status">
          <span className="dot" />{" "}
          {liveState === "live"
            ? `Live · ${liveSource}`
            : liveState === "loading"
            ? "Loading live data…"
            : SOURCE_STATUS_LABEL}
        </div>
      </div>

      {/* Live feed for topics backed by a connected source (weather/rainfall). */}
      {(topicId === "weather" || topicId === "rainfall") && (
        <LiveWeatherStrip county={scope.county} />
      )}

      <div className="workspace__grid">
        {/* Map */}
        <section className="panel panel--map">
          <div className="panel__head">
            <h3>Distribution map</h3>
            <span className="panel__hint">
              {scope.level === "national"
                ? "Click a county to drill down"
                : scope.level === "county"
                ? "Click a sub-county to drill down"
                : "Click a ward to focus it"}
            </span>
          </div>
          <TopicMap
            topicId={topicId}
            level={mapLevel}
            county={scope.county}
            subcounty={scope.subcounty}
            selectedRegion={scope.level === "ward" ? scope.ward : null}
            onDrill={handleDrill}
            onRegionsLoaded={setRegions}
            liveValues={liveValues}
            overlayTile={geeTile}
          />
        </section>

        {/* Ranked regions */}
        <section className="panel panel--rank">
          <div className="panel__head">
            <h3>Ranked {childTier}</h3>
            <span className="panel__hint">{regions.length} in view</span>
          </div>
          <div className="rank-list">
            {regions.map((r, i) => {
              const active =
                scope.ward === r.name ||
                scope.subcounty === r.name ||
                scope.county === r.name;
              return (
                <button
                  key={r.name}
                  className={`rank-row${active ? " rank-row--active" : ""}`}
                  onClick={() => handleDrill(r.name)}
                >
                  <span className="rank-idx">{i + 1}</span>
                  <span
                    className="rank-swatch"
                    style={{
                      background: rampColor(topicId, r.value, minVal, maxVal),
                    }}
                  />
                  <span className="rank-name">{r.name}</span>
                  <span className="rank-val">
                    {formatValue(topicId, r.value)}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Chart */}
        <section className="panel panel--chart">
          <div className="panel__head">
            <h3>Top {childTier} by {topic.metricLabel.toLowerCase()}</h3>
            <span className="panel__hint">
              {scope.level === "national"
                ? "Click a name to drill into that county"
                : scope.level === "county"
                ? "Click a name to drill into that sub-county"
                : "Click a name to zoom to that ward"}
            </span>
          </div>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart
                data={chartData}
                layout="vertical"
                margin={{ left: 8, right: 16, top: 4, bottom: 4 }}
              >
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={110}
                  tick={<ClickableAxisTick onSelect={handleDrill} />}
                />
                <Tooltip
                  formatter={(v) => formatValue(topicId, v)}
                  cursor={{ fill: "rgba(148,163,184,0.15)" }}
                />
                <Bar
                  dataKey="value"
                  radius={[0, 4, 4, 0]}
                  cursor="pointer"
                  onClick={(d) => d?.name && handleDrill(d.name)}
                >
                  {chartData.map((d) => (
                    <Cell
                      key={d.name}
                      fill={rampColor(topicId, d.value, minVal, maxVal)}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* AI insights */}
        <section className="panel panel--insight">
          <InsightPanel
            topicId={topicId}
            scope={scope}
            regions={regions}
            dataStatus={liveState === "live" ? "connected" : "scaffolded"}
          />
        </section>
      </div>

      {showPayment && (
        <PaymentGateway
          user={user}
          description={`${topic.label} report · ${scopeLabel(scope)}`}
          onPaid={handlePaid}
          onClose={() => setShowPayment(false)}
        />
      )}

      {report && (
        <ReportModal
          report={report}
          topicId={topicId}
          onClose={() => setReport(null)}
        />
      )}
    </div>
  );
}

// A clickable Y-axis category label. Recharts injects x/y/payload; clicking the
// region name drills into it (national → county, county → focus the sub-county),
// which zooms the map to that region.
function ClickableAxisTick({ x, y, payload, onSelect }) {
  const name = payload?.value;
  return (
    <text
      x={x}
      y={y}
      dy={4}
      textAnchor="end"
      className="chart-axis-tick"
      onClick={() => name && onSelect?.(name)}
    >
      <title>{`Zoom to ${name}`}</title>
      {name}
    </text>
  );
}

function ReportModal({ report, topicId, onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <div>
            <div className="modal__eyebrow">Intelligence report</div>
            <h2>{report.title}</h2>
          </div>
          <button className="modal__close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="report-headline">{report.headline}</div>
        <div className="report-status">
          <span className="dot" /> {report.sourceStatus}
        </div>

        <h4>Key findings</h4>
        <ol className="report-findings">
          {report.findings.map((f, i) => (
            <li key={i}>
              <div>{f.text}</div>
              {f.reason && <div className="report-reason">Why: {f.reason}</div>}
            </li>
          ))}
        </ol>

        <h4>Data ({report.tier})</h4>
        <div className="report-table-wrap">
          <table className="report-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Region</th>
                <th>{report.unit}</th>
              </tr>
            </thead>
            <tbody>
              {report.regions.map((r, i) => (
                <tr key={r.name}>
                  <td>{i + 1}</td>
                  <td>{r.name}</td>
                  <td>{formatValue(topicId, r.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="modal__actions">
          <button
            className="btn btn--ghost"
            onClick={() =>
              downloadText(
                `${report.id}.csv`,
                reportToCsv(report),
                "text/csv",
              )
            }
          >
            Download CSV
          </button>
          <button
            className="btn btn--ghost"
            onClick={() =>
              downloadText(
                `${report.id}.json`,
                JSON.stringify(report, null, 2),
                "application/json",
              )
            }
          >
            Download JSON
          </button>
          <button className="btn" onClick={() => window.print()}>
            Print / PDF
          </button>
        </div>
      </div>
    </div>
  );
}
