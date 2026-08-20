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
import ScopeNav from "../components/ScopeNav";
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
import {
  fetchOsmMetric,
  fetchGeeMetric,
  fetchFacilityMetric,
  fetchFacilityPoints,
} from "../utils/apiClient";
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

// Topics backed by the surveyed facility registries (GeoPackage point layers
// counted per region server-side). Live at every drill level.
const FACILITY_TOPICS = new Set([
  "hospitals",
  "schools",
  "police_posts",
  "admin_offices",
]);

const FileIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
  </svg>
);

const GridIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" />
  </svg>
);

// Chart tooltip.
//
// Recharts' default is an unstyled white box in the browser's default face,
// which is exactly the "generic" text this revamp is removing. This renders
// the same data in the app's own type: label in the display face, every figure
// mono and tabular so a three-series readout stays column-aligned as the
// cursor moves.
function ChartTooltip({ active, payload, label, units, decimals, live }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tip">
      <p className="chart-tip__label">{label}</p>
      <ul className="chart-tip__rows">
        {payload.map((row) => {
          const d = decimals[row.dataKey] ?? 0;
          const unit = units[row.dataKey] || "";
          return (
            <li key={row.dataKey}>
              <span className="chart-tip__swatch" style={{ background: row.stroke }} aria-hidden="true" />
              <span className="chart-tip__name">{row.name}</span>
              <span className="chart-tip__value u-num">
                {Number(row.value).toLocaleString(undefined, {
                  maximumFractionDigits: d,
                })}
                {unit ? ` ${unit}` : ""}
              </span>
            </li>
          );
        })}
      </ul>
      {!live && (
        <p className="chart-tip__foot">Scaffolded — awaiting verified source</p>
      )}
    </div>
  );
}

// The drill-down workspace for one topic: map + ranked regions + charts +
// reports + AI insights, navigable National -> County -> Sub-county.
export default function TopicWorkspace({
  topicId,
  scope,
  onScope,
  onAsk,
  onBackToTopics,
  user,
}) {
  const topic = getTopic(topicId);
  // `scope` is owned by the app shell and mirrored in the URL, so every drill
  // is shareable and the browser Back button walks back up the hierarchy.
  const setScope = onScope;
  const [regions, setRegions] = useState([]);
  const [report, setReport] = useState(null);
  // Live per-county values from OpenStreetMap for supported topics; null means
  // "use scaffolding". `live` flags that at least one real value arrived.
  const [liveValues, setLiveValues] = useState(null);
  const [liveState, setLiveState] = useState("idle"); // idle | loading | live | error
  const [liveSource, setLiveSource] = useState(null); // "OpenStreetMap" | "Google Earth Engine"
  const [geeTile, setGeeTile] = useState(null); // { url, opacity, unit } raster overlay
  // Individual facility locations for the map's dot layer (registry topics).
  const [facilityPoints, setFacilityPoints] = useState(null);

  // Verified per-metric temporal series, keyed by metric.key, when they exist.
  const [chartLive, setChartLive] = useState({});
  const [chartLiveState, setChartLiveState] = useState("idle"); // idle | loading | done

  // Map level: national counties, the sub-counties of the active county, or the
  // wards of the active sub-county. Ward focus stays on the sub-county's wards.
  const mapLevel =
    scope.level === "national"
      ? "national"
      : scope.level === "county"
      ? "county"
      : "subcounty";

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
      setLiveState("loading");
      setGeeTile(null);
      fetchGeeMetric(GEE_BACKEND[topicId], {
        level: mapLevel,
        county: scope.county || undefined,
        subcounty: scope.subcounty || undefined,
      })
        .then((data) => applyRegions(data, "Google Earth Engine", true))
        .catch(fail);
      return () => {
        cancelled = true;
      };
    }

    if (FACILITY_TOPICS.has(topicId)) {
      setLiveState("loading");
      setGeeTile(null);
      fetchFacilityMetric(topicId, {
        level: mapLevel,
        county: scope.county || undefined,
        subcounty: scope.subcounty || undefined,
      })
        .then((data) => applyRegions(data, "KLA facility registry", false))
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

  // Facility locations for the dot layer. Separate from the counts above so a
  // slow or failed point fetch never blocks the choropleth — the map still
  // colours regions even if the dots do not arrive.
  useEffect(() => {
    let cancelled = false;
    if (!FACILITY_TOPICS.has(topicId)) {
      setFacilityPoints(null);
      return undefined;
    }
    setFacilityPoints(null);
    fetchFacilityPoints(topicId, {
      level: mapLevel,
      county: scope.county || undefined,
      subcounty: scope.subcounty || undefined,
    })
      .then((data) => {
        if (!cancelled && Array.isArray(data?.points)) setFacilityPoints(data);
      })
      .catch(() => {
        if (!cancelled) setFacilityPoints(null);
      });
    return () => {
      cancelled = true;
    };
  }, [topicId, mapLevel, scope.county, scope.subcounty]);

  // Report generation is gated behind an M-PESA payment. Clicking "Generate
  // report" opens the gateway; a successful payment builds and reveals it.
  const [showPayment, setShowPayment] = useState(false);

  const handlePaid = () => {
    setShowPayment(false);
    setReport(buildReport(topicId, scope, regions));
  };

  const handleDrill = (name) => {
    if (scope.level === "national") {
      setScope({ level: "county", county: name, subcounty: "", ward: "" });
    } else if (scope.level === "county") {
      // Clicking a sub-county drills into its wards.
      setScope({ ...scope, level: "subcounty", subcounty: name, ward: "" });
    } else {
      // In a sub-county (or ward) view, clicking a ward focuses it.
      setScope({ ...scope, level: "ward", ward: name });
    }
  };

  const goNational = () =>
    setScope({ level: "national", county: "", subcounty: "", ward: "" });
  const goCounty = () =>
    setScope({
      level: "county",
      county: scope.county,
      subcounty: "",
      ward: "",
    });
  const goSubcounty = () =>
    setScope({
      level: "subcounty",
      county: scope.county,
      subcounty: scope.subcounty,
      ward: "",
    });

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

  const isLive = liveState === "live";
  const liveLabel = isLive ? `Live · ${liveSource}` : null;
  // Whether the headline is a total or a mean changes what the number means,
  // so it is stated next to it rather than left to be inferred.
  const aggregationLabel =
    scope.level === "ward"
      ? "Ward value"
      : topic.aggregation === "sum"
        ? `Total across ${regions.length} regions`
        : `Average across ${regions.length} regions`;

  return (
    <div className="workspace">
      {/* ── Command bar: where you are + what you can do ── */}
      <div className="cmdbar">
        <nav className="crumbs" aria-label="Breadcrumb">
          <button className="crumb" onClick={onBackToTopics}>
            Home
          </button>
          <span className="crumb__sep" aria-hidden="true">/</span>
          <button className="crumb" onClick={goNational}>
            <span className="crumb__icon" aria-hidden="true">{topic.icon}</span>
            {topic.label}
          </button>
          <span className="crumb__sep" aria-hidden="true">/</span>
          {!scope.county ? (
            <span className="crumb crumb--current">National</span>
          ) : (
            <button className="crumb" onClick={goNational}>National</button>
          )}
          {scope.county && (
            <>
              <span className="crumb__sep" aria-hidden="true">/</span>
              {scope.level === "county" ? (
                <span className="crumb crumb--current">{scope.county}</span>
              ) : (
                <button className="crumb" onClick={goCounty}>{scope.county}</button>
              )}
            </>
          )}
          {scope.subcounty && (
            <>
              <span className="crumb__sep" aria-hidden="true">/</span>
              {scope.level === "subcounty" ? (
                <span className="crumb crumb--current">{scope.subcounty}</span>
              ) : (
                <button className="crumb" onClick={goSubcounty}>{scope.subcounty}</button>
              )}
            </>
          )}
          {scope.ward && (
            <>
              <span className="crumb__sep" aria-hidden="true">/</span>
              <span className="crumb crumb--current">{scope.ward}</span>
            </>
          )}
        </nav>

        <div className="cmdbar__actions">
          <button className="btn btn--ghost" onClick={() => setShowPayment(true)}>
            <FileIcon />
            Generate report
          </button>
          <button className="btn btn--ghost" onClick={onBackToTopics}>
            <GridIcon />
            All topics
          </button>
        </div>
      </div>

      {/* ── Headline metric for the current scope ── */}
      <section className="metric-head" style={{ "--accent": topic.ramp[1] }}>
        <div className="metric-head__id">
          <span className="metric-head__icon" aria-hidden="true">{topic.icon}</span>
          <div>
            <p className="u-eyebrow">{topic.category}</p>
            <h1 className="metric-head__scope">{scopeLabel(scope)}</h1>
            <p className="metric-head__metric">{topic.metricLabel}</p>
          </div>
        </div>

        <div className="metric-head__readout">
          <span className="metric-head__value u-metric">
            {formatValue(topicId, headline)}
          </span>
          <span className="u-eyebrow">{aggregationLabel}</span>
        </div>

        <div className={`feed-pill feed-pill--${liveState}`}>
          <span className="status-dot" aria-hidden="true" />
          {isLive
            ? `Live · ${liveSource}`
            : liveState === "loading"
              ? "Connecting to live source…"
              : SOURCE_STATUS_LABEL}
        </div>
      </section>

      {/* Live feed for the connected climate source. */}
      {topicId === "weather" && <LiveWeatherStrip county={scope.county} />}

      <div className="workspace__grid">
        {/* Map */}
        <section className="panel panel--map">
          <header className="panel__head">
            <h2 className="panel__title">Distribution map</h2>
            <p className="panel__hint">
              {scope.level === "national"
                ? "Tap a county to drill down"
                : scope.level === "county"
                ? "Tap a sub-county to drill down"
                : scope.level === "subcounty"
                ? "Tap a ward to focus it"
                : "Tap another ward to switch · Backspace to go up"}
            </p>
          </header>
          <ScopeNav scope={scope} onScope={setScope} />
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
            facilityPoints={facilityPoints}
            liveLabel={liveLabel}
          />
        </section>

        {/* Distribution over time for the current scope */}
        <section className="panel panel--chart">
          <header className="panel__head">
            <h2 className="panel__title">
              {seriesDefs.length > 1 ? topic.label : topic.metricLabel} over time
            </h2>
            <p className="panel__hint">
              {chartLiveState === "loading"
                ? "Checking for a verified series…"
                : anyLive
                ? `Live · ${chartLiveSource}`
                : `${timeGrain === "monthly" ? "Monthly" : "Annual"} · scaffolded`}
            </p>
          </header>

          <div className="chart">
            {/* Fills .chart, which flexes to whatever height the
                viewport-locked layout leaves it. Axis type, grid and legend
                colours are set in CSS (.chart .recharts-*) rather than as SVG
                attributes, so they follow the light/dark tokens. */}
            <ResponsiveContainer width="100%" height="100%">
              {/* The right margin clears half of the last x-axis label. Recharts
                  reserves nothing for it, and the mono tick face is wider than
                  the sans it assumes, so without this "2026" is cut in half by
                  the container edge. */}
              <LineChart
                data={timeRows}
                margin={{ left: 0, right: hasRightAxis ? 4 : 18, top: 8, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="2 4" vertical={false} />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  interval={timeGrain === "monthly" ? 3 : 0}
                />
                {/* 64px, not the 48 that fits the browser default face: these
                    ticks are set in JetBrains Mono, and a six-figure count
                    ("80,000") overruns 48px and gets clipped to "0,000". */}
                <YAxis
                  yAxisId="left"
                  tickLine={false}
                  axisLine={false}
                  width={64}
                  tickFormatter={(v) => Number(v).toLocaleString()}
                />
                {hasRightAxis && (
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tickLine={false}
                    axisLine={false}
                    width={64}
                    tickFormatter={(v) => Number(v).toLocaleString()}
                  />
                )}
                <Tooltip
                  cursor={{ strokeDasharray: "3 3" }}
                  content={
                    <ChartTooltip
                      units={unitByKey}
                      decimals={decimalsByKey}
                      live={anyLive}
                    />
                  }
                />
                {seriesDefs.length > 1 && (
                  <Legend verticalAlign="top" align="left" height={28} iconType="plainline" iconSize={14} />
                )}
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
                    activeDot={{ r: 4, strokeWidth: 2 }}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Ask-the-model launcher, docked at the foot of the graph section.
              Asking hands the on-screen regions to the insights page, which
              renders the answer in full rather than expanding this card. */}
          <div className="panel__footer">
            <InsightPanel
              topicId={topicId}
              scope={scope}
              onAsk={(question) =>
                onAsk(question, regions, isLive ? "connected" : "scaffolded")
              }
            />
          </div>
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
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal modal--wide"
        role="dialog"
        aria-modal="true"
        aria-label={report.title}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal__head">
          <div>
            <p className="u-eyebrow">Intelligence report</p>
            <h2 className="modal__title">{report.title}</h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <p className="modal__lede">{report.headline}</p>
        <p className="feed-pill feed-pill--idle">
          <span className="status-dot" aria-hidden="true" />
          {report.sourceStatus}
        </p>

        <h3 className="modal__section">Key findings</h3>
        <ol className="finding-list">
          {report.findings.map((f, i) => (
            <li key={i} className="finding">
              <span className="finding__index u-num">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div>
                <p className="finding__text">{f.text}</p>
                {f.reason && (
                  <p className="finding__reason">
                    <span className="u-eyebrow">Why</span>
                    {f.reason}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>

        <h3 className="modal__section">
          Data <span className="u-muted">({report.tier})</span>
        </h3>
        <div className="table-scroll">
          <table className="data-table data-table--compact">
            <thead>
              <tr>
                <th scope="col" className="is-num">#</th>
                <th scope="col">Region</th>
                <th scope="col" className="is-num">{report.unit}</th>
              </tr>
            </thead>
            <tbody>
              {report.regions.map((r, i) => (
                <tr key={r.name}>
                  <td className="u-num" data-label="#">{i + 1}</td>
                  <td data-label="Region">{r.name}</td>
                  <td className="u-num" data-label={report.unit}>
                    {formatValue(topicId, r.value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="modal__actions">
          <button
            className="btn btn--ghost"
            onClick={() =>
              downloadText(`${report.id}.csv`, reportToCsv(report), "text/csv")
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
