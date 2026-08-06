import React, { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  Legend,
  XAxis,
  YAxis,
  Tooltip,
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
  topicSeries,
  buildScaffoldSeries,
  SOURCE_STATUS_LABEL,
} from "../data/topics";
import { buildReport, reportToCsv, downloadText, scopeLabel } from "../utils/intel";
import { fetchOsmMetric, fetchGeeMetric } from "../utils/apiClient";
import { fetchTopicLiveSeries, mergeMetricSeries } from "../utils/timeseries";

// Topics backed by a live OpenStreetMap feed (per-county, national scope).
const OSM_TOPICS = new Set(["roads"]);

// Composite topic id → the backend GEE topic that colours its map (the topic's
// primary metric): weather → land-surface temperature, land use → cropland.
const GEE_BACKEND = {
  weather: "weather",
  landuse: "farmland",
  water_bodies: "water_bodies",
};
// Topics whose map is backed by Google Earth Engine zonal stats + raster tiles.
const GEE_TOPICS = new Set(Object.keys(GEE_BACKEND));

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

  // Verified per-metric temporal series, keyed by metric.key, when they exist.
  const [chartLive, setChartLive] = useState({});
  const [chartLiveState, setChartLiveState] = useState("idle"); // idle | loading | done

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
      fetchGeeMetric(GEE_BACKEND[topicId], {
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

  // ── Distribution over time (one line per metric) ────────────────
  // Composite topics (weather, land use) plot several metrics; simple topics
  // plot one. The primary metric is anchored to the headline above.
  const scopeKey = scopeLabel(scope);
  const seriesDefs = useMemo(() => topicSeries(topic), [topic]);
  const timeGrain = seriesDefs[0]?.grain || "annual";
  const regionNames = useMemo(
    () => (scope.level === "ward" ? [scope.ward] : regions.map((r) => r.name)),
    [scope, regions],
  );
  const scaffold = useMemo(
    () => buildScaffoldSeries(topicId, { seedKey: scopeKey, regionNames, headline }),
    [topicId, scopeKey, regionNames, headline],
  );

  // Swap a metric's scaffold for a verified series where reviewed data exists.
  // Any failure (nothing imported, unauthorised, offline) leaves scaffolds alone.
  useEffect(() => {
    let cancelled = false;
    setChartLiveState("loading");
    setChartLive({});
    fetchTopicLiveSeries(seriesDefs, scope)
      .then((map) => {
        if (cancelled) return;
        setChartLive(map);
        setChartLiveState("done");
      })
      .catch(() => {
        if (cancelled) return;
        setChartLive({});
        setChartLiveState("done");
      });
    return () => {
      cancelled = true;
    };
    // seriesDefs is stable per topic; scope fields drive the refetch.
  }, [topicId, scope.level, scope.county, scope.subcounty, scope.ward]);

  // Resolve each metric to its live points when present, else its scaffold.
  const resolved = useMemo(
    () =>
      scaffold.map((s) => {
        const live = chartLive[s.metric.key];
        return {
          key: s.metric.key,
          metric: s.metric,
          isLive: !!live,
          source: live?.source,
          points: live?.points || s.points,
        };
      }),
    [scaffold, chartLive],
  );
  const timeRows = useMemo(() => mergeMetricSeries(resolved), [resolved]);
  const anyLive = resolved.some((r) => r.isLive);
  const chartLiveSource = resolved.find((r) => r.isLive)?.source;
  const hasRightAxis = seriesDefs.some((m) => m.axis === "right");
  const unitByKey = useMemo(
    () => Object.fromEntries(seriesDefs.map((m) => [m.key, m.unit])),
    [seriesDefs],
  );
  const decimalsByKey = useMemo(
    () => Object.fromEntries(seriesDefs.map((m) => [m.key, m.decimals])),
    [seriesDefs],
  );
  const liveByKey = useMemo(
    () => Object.fromEntries(resolved.map((r) => [r.key, r.isLive])),
    [resolved],
  );

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

      {/* Live feed for the connected climate source. */}
      {topicId === "weather" && <LiveWeatherStrip county={scope.county} />}

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

        {/* Distribution over time for the current scope */}
        <section className="panel panel--chart">
          <div className="panel__head">
            <h3>
              {seriesDefs.length > 1 ? topic.label : topic.metricLabel} over time ·{" "}
              {scopeLabel(scope)}
            </h3>
            <span className="panel__hint">
              {chartLiveState === "loading"
                ? "Checking for a verified series…"
                : anyLive
                ? `Live · ${chartLiveSource}`
                : `${timeGrain === "monthly" ? "Monthly" : "Annual"} · ${SOURCE_STATUS_LABEL}`}
            </span>
          </div>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height={320}>
              <LineChart
                data={timeRows}
                margin={{ left: 4, right: hasRightAxis ? 4 : 16, top: 8, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11 }}
                  interval={timeGrain === "monthly" ? 3 : 0}
                />
                <YAxis
                  yAxisId="left"
                  tick={{ fontSize: 11 }}
                  width={44}
                  tickFormatter={(v) => Number(v).toLocaleString()}
                />
                {hasRightAxis && (
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fontSize: 11 }}
                    width={44}
                    tickFormatter={(v) => Number(v).toLocaleString()}
                  />
                )}
                <Tooltip
                  formatter={(value, name, item) => {
                    const key = item?.dataKey;
                    const d = decimalsByKey[key] ?? 0;
                    const u = unitByKey[key] || "";
                    return [
                      `${Number(value).toLocaleString(undefined, { maximumFractionDigits: d })} ${u}`.trim(),
                      name,
                    ];
                  }}
                />
                {seriesDefs.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
                {seriesDefs.map((m) => (
                  <Line
                    key={m.key}
                    yAxisId={m.axis === "right" ? "right" : "left"}
                    type="monotone"
                    dataKey={m.key}
                    name={m.label}
                    stroke={m.color}
                    strokeWidth={2.2}
                    strokeDasharray={anyLive && !liveByKey[m.key] ? "5 4" : undefined}
                    dot={false}
                    connectNulls
                  />
                ))}
              </LineChart>
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
