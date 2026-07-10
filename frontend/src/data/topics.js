// AEIS-K Intelligence topics.
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
    id: "rainfall",
    label: "Rainfall",
    icon: "🌧️",
    category: "Climate",
    unit: "mm/yr",
    metricLabel: "Annual rainfall",
    aggregation: "avg", // national/county figure is an average of children
    decimals: 0,
    range: [250, 2200],
    skew: 1,
    ramp: ["#eff6ff", "#1d4ed8"],
    higherIsBetter: null, // more rain is not simply "good" or "bad"
    description:
      "Seasonal and annual precipitation distribution across the country, from arid north to the highlands and coast.",
    liveHint:
      "Can be backed today by the existing Open-Meteo forecast and NASA POWER history feeds.",
  },
  {
    id: "weather",
    label: "Weather",
    icon: "⛅",
    category: "Climate",
    unit: "°C",
    metricLabel: "Mean temperature",
    aggregation: "avg",
    decimals: 1,
    range: [12, 30],
    skew: 1,
    ramp: ["#e0f2fe", "#ea580c"],
    higherIsBetter: null,
    description:
      "Near-real-time weather conditions — temperature, humidity, and short-range forecast signals across the country.",
    liveHint:
      "Back with the live Open-Meteo forecast feed (already connected for county pages).",
  },
  {
    id: "farmland",
    label: "Farm Land",
    icon: "🌾",
    category: "Land use",
    unit: "% of land",
    metricLabel: "Cultivated land share",
    aggregation: "avg",
    decimals: 1,
    range: [2, 68],
    skew: 1.1,
    ramp: ["#fefce8", "#ca8a04"],
    higherIsBetter: null,
    description:
      "Share of land under active cultivation, indicating agricultural footprint and food-production capacity.",
    liveHint: "Connect a national land-cover / cropland classification source.",
  },
  {
    id: "forests",
    label: "Forests",
    icon: "🌳",
    category: "Environment",
    unit: "% cover",
    metricLabel: "Forest cover",
    aggregation: "avg",
    decimals: 1,
    range: [1, 55],
    skew: 1.4,
    ramp: ["#f0fdf4", "#15803d"],
    higherIsBetter: true,
    description:
      "Natural and planted forest cover combined — indigenous canopy plus plantation and reforestation, a measure of biodiversity, carbon stock, and restoration.",
    liveHint:
      "Connect canopy / land-cover remote sensing and the forestry plantation registry.",
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
