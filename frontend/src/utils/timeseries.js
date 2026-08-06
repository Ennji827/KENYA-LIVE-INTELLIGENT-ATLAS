// Live overlay for the "Over time" chart.
//
// Every metric of a topic (see data/topics.js `topicSeries`) has a scaffolded
// series. Where a metric declares a `live` source and reviewed data exists for
// the scope, we swap the scaffold for the real series (drawn solid; scaffolded
// metrics stay dashed). Metrics with no `live` config, or no imported data,
// simply keep their scaffold — new coverage lights up per metric, over time.

import { fetchMonthlyIntelligence, fetchEnvironmentalMetrics } from "./apiClient";

// De-duplicate points by period (first wins) and sort chronologically.
function normalise(points) {
  const byPeriod = new Map();
  points
    .filter((p) => p && typeof p.value === "number" && !Number.isNaN(p.value))
    .forEach((p) => {
      if (!byPeriod.has(p.period)) byPeriod.set(p.period, p);
    });
  return [...byPeriod.values()].sort((a, b) =>
    String(a.period).localeCompare(String(b.period)),
  );
}

// Fetch a real series for one metric's `live` config at a scope, or null when
// unavailable (no config, unsupported scope, nothing imported, request failed).
export async function fetchMetricLiveSeries(live, scope) {
  if (!live) return null;
  // Only national and county scopes have reviewed temporal coverage today.
  if (scope.level !== "national" && scope.level !== "county") return null;
  const county = scope.level === "county" ? scope.county : "";

  try {
    if (live.kind === "monthly") {
      const data = await fetchMonthlyIntelligence({ source: "local", county });
      const points = normalise(
        (data.records || []).map((r) => ({
          period: String(r.date).slice(0, 7), // YYYY-MM
          label: r.month,
          value: r[live.field],
        })),
      );
      return points.length
        ? { points, source: data.provider || "Reviewed records" }
        : null;
    }

    const data = await fetchEnvironmentalMetrics({ metric: live.metric, county });
    const want = county.toLowerCase();
    const rows = (data.records || []).filter(
      (r) =>
        r.metric_key === live.metric &&
        (county
          ? (r.scope_name || "").toLowerCase() === want
          : r.scope_level === "national"),
    );
    const points = normalise(
      rows.map((r) => ({
        period: r.period_start,
        label: String(r.period_start).slice(0, 4),
        value: r.value,
      })),
    );
    return points.length
      ? { points, source: data.provider || "Reviewed metrics" }
      : null;
  } catch {
    return null; // 404 / offline / unauthorised → scaffold only
  }
}

// Fetch live series for every metric of a topic in parallel, returning a map
// of metric.key → { points, source } (only for metrics that resolved to data).
export async function fetchTopicLiveSeries(seriesDefs, scope) {
  const entries = await Promise.all(
    seriesDefs.map((m) =>
      fetchMetricLiveSeries(m.live, scope).then((res) => [m.key, res]),
    ),
  );
  const out = {};
  entries.forEach(([key, res]) => {
    if (res) out[key] = res;
  });
  return out;
}

// Merge per-metric series into one Recharts dataset keyed by period, each metric
// contributing a column (dataKey = metric.key) so the lines share the x-axis.
export function mergeMetricSeries(resolved) {
  const byPeriod = new Map();
  resolved.forEach(({ key, points }) => {
    (points || []).forEach((p) => {
      const row = byPeriod.get(p.period) || { period: p.period, label: p.label };
      row[key] = p.value;
      byPeriod.set(p.period, row);
    });
  });
  return [...byPeriod.values()].sort((a, b) =>
    String(a.period).localeCompare(String(b.period)),
  );
}
