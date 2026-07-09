import React, { useMemo, useState } from "react";
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
import {
  getTopic,
  regionValue,
  aggregate,
  formatValue,
  rampColor,
  SOURCE_STATUS_LABEL,
} from "../data/topics";
import { buildReport, reportToCsv, downloadText, scopeLabel } from "../utils/intel";

// The drill-down workspace for one topic: map + ranked regions + charts +
// reports + AI insights, navigable National -> County -> Sub-county.
export default function TopicWorkspace({
  topicId,
  initialScope,
  onBackToHub,
  onChangeArea,
}) {
  const topic = getTopic(topicId);
  const [scope, setScope] = useState(
    initialScope || { level: "national", county: "", subcounty: "" },
  );
  const [regions, setRegions] = useState([]);
  const [report, setReport] = useState(null);

  // The map renders national counties, or the sub-counties of the active county.
  const mapLevel = scope.level === "national" ? "national" : "county";

  const handleDrill = (name) => {
    if (scope.level === "national") {
      setScope({ level: "county", county: name, subcounty: "" });
    } else {
      // In a county view, clicking a sub-county focuses it.
      setScope((s) => ({ ...s, level: "subcounty", subcounty: name }));
    }
  };

  const goNational = () => setScope({ level: "national", county: "", subcounty: "" });
  const goCounty = () =>
    setScope((s) => ({ level: "county", county: s.county, subcounty: "" }));

  // Headline figure for the current scope, derived from the visible regions.
  const headline = useMemo(() => {
    if (scope.level === "subcounty") {
      return regionValue(topicId, scope.subcounty);
    }
    return aggregate(topicId, regions.map((r) => r.value));
  }, [scope, regions, topicId]);

  const chartData = useMemo(() => regions.slice(0, 12), [regions]);
  const [minVal, maxVal] = useMemo(() => {
    const vals = regions.map((r) => r.value).filter((v) => typeof v === "number");
    return vals.length ? [Math.min(...vals), Math.max(...vals)] : [0, 1];
  }, [regions]);

  const childTier =
    scope.level === "national" ? "counties" : "sub-counties";

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
              <span className="crumb crumb--current">{scope.subcounty}</span>
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
            onClick={() => setReport(buildReport(topicId, scope, regions))}
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
          <span className="dot" /> {SOURCE_STATUS_LABEL}
        </div>
      </div>

      <div className="workspace__grid">
        {/* Map */}
        <section className="panel panel--map">
          <div className="panel__head">
            <h3>Distribution map</h3>
            <span className="panel__hint">
              {scope.level === "national"
                ? "Click a county to drill down"
                : "Click a sub-county to focus it"}
            </span>
          </div>
          <TopicMap
            topicId={topicId}
            level={mapLevel}
            county={scope.county}
            selectedRegion={
              scope.level === "subcounty" ? scope.subcounty : null
            }
            onDrill={handleDrill}
            onRegionsLoaded={setRegions}
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
                scope.subcounty === r.name || scope.county === r.name;
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
                  tick={{ fontSize: 11 }}
                />
                <Tooltip
                  formatter={(v) => formatValue(topicId, v)}
                  cursor={{ fill: "rgba(148,163,184,0.15)" }}
                />
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
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
          <InsightPanel topicId={topicId} scope={scope} regions={regions} />
        </section>
      </div>

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
