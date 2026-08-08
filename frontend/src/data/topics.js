// Kenya Live Atlas Intelligence topics.
//
// This is the data backbone of the intelligence system. It defines the eight
// intelligence topics and produces a *scaffolded* distribution for every region
// (national -> county -> sub-county).
//
// IMPORTANT: The numeric values here are deterministic scaffolding, not verified
// measurements. They exist so the maps, charts, drill-down, reports, and AI
// insights can be built and demonstrated end to end. Every value is marked as
// `sourceStatus: "scaffolded"` and the UI shows an "awaiting verified source"
// badge. When a real feed is connected for a topic, replace `regionValue` for
// that topic with the live lookup and flip its `sourceStatus` to "connected".

import { kenyaCountyNames } from "./kenyaCountyCatalog";

// Deterministic string hash -> unsigned 32-bit int. Stable across reloads so a
// region always renders the same colour until a real source replaces it.
function hash(input) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Stable pseudo-random number in [0, 1) from a seed string.
function unit(seed) {
  return hash(seed) / 4294967295;
}

// Map a seed to a value inside [min, max], optionally skewed so the
// distribution is not perfectly flat (looks more like real geography).
function scaled(seed, min, max, skew = 1) {
  const base = Math.pow(unit(seed), skew);
  return min + base * (max - min);
}

export const TOPICS = [
  {
    id: "weather",
    label: "Weather",
    icon: "⛅",
    category: "Climate",
    unit: "°C",
    metricLabel: "Temperature, rainfall & humidity",
    aggregation: "avg",
    decimals: 1,
    range: [12, 30],
    skew: 1,
    ramp: ["#e0f2fe", "#ea580c"],
    higherIsBetter: null,
    description:
      "The core climate signals over time — temperature, rainfall, and humidity together — from the arid north to the highlands and coast.",
    liveHint:
      "Backed by reviewed monthly climate records with NASA POWER fallback (temperature, rainfall, humidity).",
    // Three metrics share the monthly time axis. Temperature and humidity read on
    // the left axis; rainfall (mm) on the right. `key` seeds the deterministic
    // scaffold — the primary metric reuses the topic id so the map (temperature)
    // and the chart agree.
    series: [
      { key: "weather",  label: "Temperature", unit: "°C", decimals: 1, range: [12, 30],   skew: 1, aggregation: "avg", grain: "monthly", seasonal: "osc",  swing: 2.6, color: "#ea580c", axis: "left",  live: { kind: "monthly", field: "temperature_c" } },
      { key: "rainfall", label: "Rainfall",    unit: "mm", decimals: 0, range: [250, 2200], skew: 1, aggregation: "avg", grain: "monthly", seasonal: "rain",             color: "#2563eb", axis: "right", live: { kind: "monthly", field: "rainfall_mm" } },
      { key: "humidity", label: "Humidity",    unit: "%",  decimals: 0, range: [38, 82],    skew: 1, aggregation: "avg", grain: "monthly", seasonal: "osc",  swing: 7,   color: "#0891b2", axis: "left",  live: { kind: "monthly", field: "humidity_pct" } },
    ],
  },
  {
    id: "landuse",
    label: "Land Use",
    icon: "🌾",
    category: "Land use",
    unit: "% of land",
    metricLabel: "Cropland & forest cover",
    aggregation: "avg",
    decimals: 1,
    range: [2, 68],
    skew: 1.1,
    ramp: ["#fefce8", "#ca8a04"],
    higherIsBetter: null,
    description:
      "How the country's land is used over time — cultivated cropland alongside forest cover, the agricultural footprint next to canopy and restoration.",
    liveHint:
      "Connect a national land-cover / cropland classification source plus canopy remote sensing.",
    // Two land-cover shares on one % axis. The map colours by cropland (the
    // primary metric reuses the topic id); forest cover is the second line.
    series: [
      { key: "landuse", label: "Cropland",     unit: "% of land", decimals: 1, range: [2, 68], skew: 1.1, aggregation: "avg", grain: "annual", seasonal: null, color: "#ca8a04", axis: "left", live: { kind: "metric", metric: "cropland_pct" } },
      { key: "forest",  label: "Forest cover", unit: "% cover",   decimals: 1, range: [1, 55], skew: 1.4, aggregation: "avg", grain: "annual", seasonal: null, color: "#15803d", axis: "left", live: { kind: "metric", metric: "forest_cover_pct" } },
    ],
  },
  {
    id: "water_bodies",
    label: "Water Bodies",
    icon: "💧",
    category: "Environment",
    unit: "km²",
    metricLabel: "Surface water area",
    aggregation: "sum",
    decimals: 0,
    range: [1, 2400],
    skew: 2.2,
    ramp: ["#ecfeff", "#0e7490"],
    higherIsBetter: null,
    description:
      "Lakes, rivers, dams, and wetlands — surface water availability and hydrological assets.",
    liveHint: "Connect a surface-water extent source (e.g. JRC / Sentinel).",
  },
  {
    id: "roads",
    label: "Roads",
    icon: "🛣️",
    category: "Infrastructure",
    unit: "km/1000 km²",
    metricLabel: "Road density",
    aggregation: "avg",
    decimals: 0,
    range: [40, 900],
    skew: 1.2,
    ramp: ["#fafaf9", "#57534e"],
    higherIsBetter: true,
    description:
      "Density of the classified road network — a proxy for connectivity and access to markets and services.",
    liveHint: "Connect the roads authority network dataset or OSM extract.",
  },
  // ── Facility registries ──────────────────────────────────────────────
  // Backed by the surveyed GeoPackage point layers in django_backend, counted
  // per region server-side (/api/facilities/metric/<id>). `aggregation: "sum"`
  // because a parent's figure is the total of its children, not their average.
  //
  // Each registry carries its own `dot` colour for the map's point layer. Only
  // one registry is ever drawn at a time (the map shows the selected topic and
  // nothing else), so the colour is an identity signal: it says *which* network
  // you are looking at without reading the legend. The four hues are kept far
  // apart from one another, and bright enough to read over both satellite
  // imagery and the dark end of the topic's own choropleth ramp.
  {
    id: "hospitals",
    label: "Hospitals & Clinics",
    icon: "🏥",
    category: "Infrastructure",
    unit: "facilities",
    metricLabel: "Health facilities",
    aggregation: "sum",
    decimals: 0,
    range: [20, 900],
    skew: 1.2,
    ramp: ["#fef2f2", "#dc2626"],
    dot: "#ff4d6d", // rose — health
    higherIsBetter: true,
    description:
      "Surveyed health facilities — dispensaries, clinics, health centres and hospitals — mapped to every ward.",
    liveHint: "Backed by the national health facility registry (13,535 mapped points).",
  },
  {
    id: "schools",
    label: "Schools",
    icon: "🏫",
    category: "Infrastructure",
    unit: "institutions",
    metricLabel: "Learning institutions",
    aggregation: "sum",
    decimals: 0,
    range: [100, 3200],
    skew: 1.1,
    // Emerald rather than the original indigo: police and administration
    // offices already occupy the blue–violet end, and three near-identical
    // choropleths made switching between the registries look like no change.
    ramp: ["#ecfdf5", "#047857"],
    dot: "#a3e635", // lime — learning institutions
    higherIsBetter: true,
    description:
      "ECDE, primary, secondary and tertiary institutions across the country, mapped to every ward.",
    liveHint: "Backed by the national school registry (72,075 mapped points).",
  },
  {
    id: "police_posts",
    label: "Police Stations",
    icon: "🚓",
    category: "Infrastructure",
    unit: "facilities",
    metricLabel: "Police facilities",
    aggregation: "sum",
    decimals: 0,
    range: [10, 260],
    skew: 1.1,
    ramp: ["#eff6ff", "#1d4ed8"],
    dot: "#4cc9f0", // cyan — security
    higherIsBetter: true,
    description:
      "Police posts, stations and command facilities — a proxy for security service coverage and response reach.",
    liveHint: "Backed by the national police facility registry (3,944 mapped points).",
  },
  {
    id: "admin_offices",
    label: "Administration Offices",
    icon: "🏛️",
    category: "Infrastructure",
    unit: "offices",
    metricLabel: "Administration offices",
    aggregation: "sum",
    decimals: 0,
    range: [20, 500],
    skew: 1.1,
    ramp: ["#f5f3ff", "#6d28d9"],
    dot: "#c792ea", // violet — administration
    higherIsBetter: true,
    description:
      "National government administration offices — chiefs, sub-chiefs and county commissioners — mapped to every ward.",
    liveHint: "Backed by the NGAO facility registry (8,486 mapped points).",
  },
  {
    id: "electricity",
    label: "Electricity",
    icon: "⚡",
    category: "Infrastructure",
    unit: "% connected",
    metricLabel: "Electrification rate",
    aggregation: "avg",
    decimals: 1,
    range: [12, 99],
    skew: 0.8,
    ramp: ["#fffbeb", "#b45309"],
    higherIsBetter: true,
    description:
      "Share of households connected to grid or verified off-grid electricity supply.",
    liveHint: "Connect the utility / rural electrification connections dataset.",
  },
  {
    id: "households",
    label: "Households",
    icon: "🏠",
    category: "Population",
    unit: "households",
    metricLabel: "Number of households",
    aggregation: "sum",
    decimals: 0,
    range: [30000, 1500000],
    skew: 1.6,
    ramp: ["#faf5ff", "#7e22ce"],
    higherIsBetter: null,
    description:
      "Distribution of households — the denominator for service delivery, planning, and per-capita analysis.",
    liveHint: "Connect the national census / civil registration household counts.",
  },
];

export const topicById = TOPICS.reduce((acc, t) => {
  acc[t.id] = t;
  return acc;
}, {});

export function getTopic(topicId) {
  return topicById[topicId] || null;
}

// Scaffolded value for a single leaf region (county or sub-county) and topic.
// Seed combines topic + region so each topic has its own independent pattern.
export function regionValue(topicId, regionName) {
  const topic = topicById[topicId];
  if (!topic || !regionName) return null;
  const [min, max] = topic.range;
  const value = scaled(`${topicId}::${regionName}`, min, max, topic.skew);
  return Number(value.toFixed(topic.decimals));
}

// Aggregate a set of leaf values into a parent figure, honouring the topic's
// aggregation mode (sum for counts/areas, avg for rates/percentages).
export function aggregate(topicId, values) {
  const topic = topicById[topicId];
  const clean = values.filter((v) => typeof v === "number" && !Number.isNaN(v));
  if (!topic || clean.length === 0) return null;
  if (topic.aggregation === "sum") {
    return Number(clean.reduce((s, v) => s + v, 0).toFixed(topic.decimals));
  }
  const mean = clean.reduce((s, v) => s + v, 0) / clean.length;
  return Number(mean.toFixed(topic.decimals));
}

// National distribution: one scaffolded value per county.
export function nationalDistribution(topicId) {
  return kenyaCountyNames
    .map((name) => ({ name, value: regionValue(topicId, name) }))
    .sort((a, b) => b.value - a.value);
}

// National headline figure for a topic (sum or average of counties).
export function nationalValue(topicId) {
  return aggregate(
    topicId,
    kenyaCountyNames.map((name) => regionValue(topicId, name)),
  );
}

// ── Scaffolded time series ────────────────────────────────────────
// A deterministic "distribution over time" for the current scope. Composite
// topics (weather, land use) carry several `series` metrics; simple topics get a
// single implicit metric. Values are stable pseudo-random and marked scaffolded
// until utils/timeseries.js overlays a real source per metric.
//
// Weather renders monthly (temperature & humidity oscillate; rainfall follows
// Kenya's bimodal seasons and its twelve months sum back to the annual figure).
// Everything else is an annual trend whose most-recent point matches the current
// headline, drifting deterministically into the past.

// The ordered metrics a topic plots. Simple topics derive one metric from their
// own fields; the primary metric reuses the topic id as its seed so the map and
// the chart agree.
export function topicSeries(topic) {
  if (!topic) return [];
  if (topic.series) return topic.series;
  return [
    {
      key: topic.id,
      label: topic.metricLabel,
      unit: topic.unit,
      decimals: topic.decimals,
      range: topic.range,
      skew: topic.skew,
      aggregation: topic.aggregation,
      grain: topic.category === "Climate" ? "monthly" : "annual",
      seasonal: null,
      color: topic.ramp[1],
      axis: "left",
      live: null,
    },
  ];
}

// Relative monthly weighting for Kenya's bimodal rainfall (long rains ~Apr,
// short rains ~Nov), indexed by calendar month 1–12.
function rainSeasonWeight(month) {
  const longRains = Math.exp(-(((month - 4) / 1.7) ** 2));
  const shortRains = 0.7 * Math.exp(-(((month - 11) / 1.5) ** 2));
  return 0.12 + longRains + shortRains;
}

// The ordered list of periods ending at the current one.
function periodList(grain, points) {
  const now = new Date();
  const out = [];
  if (grain === "monthly") {
    for (let i = points - 1; i >= 0; i -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      out.push({
        period: `${d.getFullYear()}-${mm}`,
        label: d.toLocaleString(undefined, { month: "short", year: "2-digit" }),
        month: d.getMonth() + 1,
      });
    }
  } else {
    const y = now.getFullYear();
    for (let i = points - 1; i >= 0; i -= 1) {
      out.push({ period: String(y - i), label: String(y - i), month: 0 });
    }
  }
  return out;
}

// Deterministic scaffold value for one leaf region under a metric.
function metricRegionValue(metric, regionName) {
  if (!regionName) return null;
  const [min, max] = metric.range;
  const value = scaled(`${metric.key}::${regionName}`, min, max, metric.skew || 1);
  return Number(value.toFixed(metric.decimals));
}

// Aggregate leaf values into a scope figure, honouring the metric's mode.
function aggregateMetric(metric, values) {
  const clean = values.filter((v) => typeof v === "number" && !Number.isNaN(v));
  if (!clean.length) return null;
  if (metric.aggregation === "sum") {
    return Number(clean.reduce((s, v) => s + v, 0).toFixed(metric.decimals));
  }
  const mean = clean.reduce((s, v) => s + v, 0) / clean.length;
  return Number(mean.toFixed(metric.decimals));
}

// Keep a scaffolded value non-negative, and inside 0–100 for percentage metrics.
function boundMetric(metric, value) {
  let v = Math.max(0, value);
  if (metric.unit.includes("%")) v = Math.min(100, v);
  return Number(v.toFixed(metric.decimals));
}

// The deterministic point series for one metric at a scope, anchored to
// `anchorValue` (the scope aggregate; for monthly rainfall, the annual figure).
function metricSeries(metric, seedKey, anchorValue, periods) {
  if (anchorValue == null || Number.isNaN(anchorValue)) {
    return periods.map((p) => ({ period: p.period, label: p.label, value: null }));
  }
  const seed = `${metric.key}::${seedKey}`;

  if (metric.grain === "monthly" && metric.seasonal === "rain") {
    // Distribute the annual anchor across each year's twelve months by the
    // seasonal weighting, so a full year of monthly points sums back to it.
    const weights = {};
    let total = 0;
    for (let m = 1; m <= 12; m += 1) {
      weights[m] = rainSeasonWeight(m);
      total += weights[m];
    }
    return periods.map((p) => {
      const noise = 1 + (unit(`${seed}::${p.period}`) - 0.5) * 0.18;
      const value = ((anchorValue * weights[p.month]) / total) * noise;
      return { period: p.period, label: p.label, value: boundMetric(metric, value) };
    });
  }

  if (metric.grain === "monthly" && metric.seasonal === "osc") {
    // A monthly mean oscillating gently around the anchor.
    const phase = unit(`${seed}::phase`) * Math.PI * 2;
    const swing = metric.swing ?? Math.max(0.6, (metric.range[1] - metric.range[0]) * 0.06);
    return periods.map((p) => {
      const seasonal = Math.sin(((p.month - 1) / 12) * Math.PI * 2 + phase);
      const noise = (unit(`${seed}::${p.period}`) - 0.5) * swing * 0.4;
      return { period: p.period, label: p.label, value: boundMetric(metric, anchorValue + seasonal * swing + noise) };
    });
  }

  // Annual trend anchored so the most-recent point equals the anchor.
  const trend = (unit(`${seed}::trend`) - 0.45) * 0.05; // ≈ −2.25%..+2.75% / yr
  const n = periods.length;
  return periods.map((p, i) => {
    const stepsBack = n - 1 - i;
    if (stepsBack === 0) {
      return { period: p.period, label: p.label, value: Number(anchorValue.toFixed(metric.decimals)) };
    }
    const noise = 1 + (unit(`${seed}::${p.period}`) - 0.5) * 0.05;
    return { period: p.period, label: p.label, value: boundMetric(metric, (anchorValue / (1 + trend) ** stepsBack) * noise) };
  });
}

// Build every metric's scaffolded series for a topic at a scope. `regionNames`
// are the child regions in view (or the single focused leaf); `headline` anchors
// the primary metric so its latest point matches the summary figure.
export function buildScaffoldSeries(topicId, { seedKey, regionNames = [], headline } = {}) {
  const topic = topicById[topicId];
  if (!topic) return [];
  const metrics = topicSeries(topic);
  const grain = metrics[0].grain;
  const periods = periodList(grain, grain === "monthly" ? 24 : 10);

  return metrics.map((metric) => {
    const isPrimary = metric.key === topic.id;
    const computed = aggregateMetric(
      metric,
      regionNames.map((n) => metricRegionValue(metric, n)),
    );
    const anchor = isPrimary && headline != null ? headline : computed;
    return { metric, points: metricSeries(metric, seedKey, anchor, periods), anchor };
  });
}

// Format a value with the topic's unit for display.
export function formatValue(topicId, value) {
  const topic = topicById[topicId];
  if (topic == null || value == null || Number.isNaN(value)) return "—";
  const rounded = Number(value).toLocaleString(undefined, {
    maximumFractionDigits: topic.decimals,
  });
  return `${rounded} ${topic.unit}`;
}

// Colour for a value on the topic's ramp, given the min/max of the current view
// so drill-down levels re-scale their own colour range.
export function rampColor(topicId, value, min, max) {
  const topic = topicById[topicId];
  if (!topic || value == null) return "#e2e8f0";
  const [lo, hi] = topic.ramp;
  const t = max > min ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0.5;
  return mixHex(lo, hi, t);
}

// Colour of a topic's facility dots on the map. Only the registry topics define
// one; anything else falls back to white, which reads over any base layer.
export function dotColor(topicId) {
  return topicById[topicId]?.dot || "#f8fafc";
}

function mixHex(a, b, t) {
  const pa = parseHex(a);
  const pb = parseHex(b);
  const r = Math.round(pa[0] + (pb[0] - pa[0]) * t);
  const g = Math.round(pa[1] + (pb[1] - pa[1]) * t);
  const bl = Math.round(pa[2] + (pb[2] - pa[2]) * t);
  return `#${[r, g, bl].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

function parseHex(hex) {
  const clean = hex.replace("#", "");
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

// Every scaffolded topic reports this until a live source is wired in.
export const SOURCE_STATUS = "scaffolded";
export const SOURCE_STATUS_LABEL = "Scaffolded · awaiting verified source";

// Starter prompts for the ask-the-model flow, adapted to the topic so neither
// the launcher card nor the insights page is ever a blank page. Shared so both
// offer the same three questions.
export function suggestedQuestions(topic) {
  const label = topic.label.toLowerCase();
  // Phrased around the *regions* rather than the topic, so the sentence stays
  // grammatical whatever the label is. "Where is <topic> lowest?" reads fine
  // for weather and rainfall but produces "Where is schools lowest?" for the
  // count topics, which is exactly the kind of machine-shaped copy that makes
  // a product feel unfinished.
  return [
    `Which regions rank highest for ${label}?`,
    `Which regions rank lowest for ${label}?`,
    `What is the average, and how wide is the gap?`,
  ];
}
