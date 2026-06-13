import * as turf from "@turf/turf";

// Deterministic setup heatmaps. Production can replace these with Sentinel,
// Earth Engine, or field-sensor tiles without changing the map components.

const KENYA_BBOX = [33.8, -4.8, 40.2, 5.1];

export const SEGMENT_PROFILES = {
  buildings: {
    label: "Buildings",
    color: "#dc2626",
    target: { ndvi: 0.22, ndwi: 0.16, ndbi: 0.78, texture: 0.72 },
  },
  cropland: {
    label: "Cropland",
    color: "#16a34a",
    target: { ndvi: 0.72, ndwi: 0.36, ndbi: 0.12, texture: 0.34 },
  },
  water: {
    label: "Water",
    color: "#0284c7",
    target: { ndvi: 0.1, ndwi: 0.86, ndbi: 0.05, texture: 0.18 },
  },
  forest: {
    label: "Forest",
    color: "#166534",
    target: { ndvi: 0.86, ndwi: 0.5, ndbi: 0.04, texture: 0.48 },
  },
  bare_land: {
    label: "Bare land",
    color: "#d97706",
    target: { ndvi: 0.26, ndwi: 0.18, ndbi: 0.42, texture: 0.4 },
  },
};

function stableIntensity(index, salt = 0) {
  const value = Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function clamp(value, low = 0, high = 1) {
  return Math.max(low, Math.min(high, value));
}

function boundaryFeatures(boundary) {
  if (!boundary) return [];
  if (boundary.type === "FeatureCollection") return boundary.features || [];
  if (boundary.type === "Feature") return [boundary];
  if (boundary.type === "Polygon" || boundary.type === "MultiPolygon") {
    return [{ type: "Feature", properties: {}, geometry: boundary }];
  }
  return [];
}

function getBoundaryBox(boundary) {
  try {
    return boundary ? turf.bbox(boundary) : KENYA_BBOX;
  } catch (error) {
    return KENYA_BBOX;
  }
}

function pointInBoundary(lon, lat, features) {
  if (!features.length) return true;
  const point = turf.point([lon, lat]);

  return features.some((feature) => {
    try {
      return turf.booleanPointInPolygon(point, feature);
    } catch (error) {
      return false;
    }
  });
}

function generateBoundaryHeatmap(salt, boundary, intensityAdjust = (value) => value, desiredCount = 650) {
  const data = [];
  const [west, south, east, north] = getBoundaryBox(boundary);
  const features = boundaryFeatures(boundary);
  const maxAttempts = desiredCount * 18;

  for (let i = 0; i < maxAttempts && data.length < desiredCount; i++) {
    const latNoise = stableIntensity(i, salt + 1);
    const lonNoise = stableIntensity(i, salt + 2);
    const lon = west + (east - west) * lonNoise;
    const lat = south + (north - south) * latNoise;

    if (!pointInBoundary(lon, lat, features)) continue;

    const intensity = intensityAdjust(stableIntensity(i, salt + 3), latNoise, lonNoise);
    data.push({
      lat,
      lon,
      intensity: clamp(intensity),
    });
  }
  return data;
}

function spectralSignature(index, latNoise, lonNoise) {
  const urbanBias = Math.max(0, 1 - Math.hypot(latNoise - 0.34, lonNoise - 0.55) / 0.28);
  const waterBias = Math.max(0, 1 - Math.hypot(latNoise - 0.56, lonNoise - 0.38) / 0.24);
  const forestBias = Math.max(0, 1 - Math.hypot(latNoise - 0.72, lonNoise - 0.24) / 0.32);
  const cropBias = Math.max(0, 1 - Math.hypot(latNoise - 0.44, lonNoise - 0.44) / 0.4);

  return {
    ndvi: clamp(0.18 + stableIntensity(index, 61) * 0.34 + forestBias * 0.32 + cropBias * 0.22 - urbanBias * 0.2 - waterBias * 0.22),
    ndwi: clamp(0.12 + stableIntensity(index, 67) * 0.28 + waterBias * 0.55 + forestBias * 0.14),
    ndbi: clamp(0.08 + stableIntensity(index, 71) * 0.26 + urbanBias * 0.55 + stableIntensity(index, 73) * 0.08),
    texture: clamp(0.12 + stableIntensity(index, 79) * 0.45 + urbanBias * 0.32 + bareLandNoise(index) * 0.14),
  };
}

function bareLandNoise(index) {
  return stableIntensity(index, 83);
}

function similarity(signature, target) {
  const distance = Math.hypot(
    signature.ndvi - target.ndvi,
    signature.ndwi - target.ndwi,
    signature.ndbi - target.ndbi,
    (signature.texture - target.texture) * 0.75,
  );
  return clamp(1 - distance / 1.15);
}

export function generateSegmentationPoints({ boundary, segmentClass = "buildings", threshold = 0.72, desiredCount = 420 } = {}) {
  const profile = SEGMENT_PROFILES[segmentClass] || SEGMENT_PROFILES.buildings;
  const [west, south, east, north] = getBoundaryBox(boundary);
  const features = boundaryFeatures(boundary);
  const points = [];
  const maxAttempts = desiredCount * 26;

  for (let i = 0; i < maxAttempts && points.length < desiredCount; i++) {
    const latNoise = stableIntensity(i, 91);
    const lonNoise = stableIntensity(i, 97);
    const lon = west + (east - west) * lonNoise;
    const lat = south + (north - south) * latNoise;

    if (!pointInBoundary(lon, lat, features)) continue;

    const signature = spectralSignature(i, latNoise, lonNoise);
    const score = similarity(signature, profile.target);
    if (score < threshold) continue;

    points.push({
      lat,
      lon,
      similarity: Number(score.toFixed(2)),
      signature,
      classKey: segmentClass,
      label: profile.label,
      color: profile.color,
    });
  }

  return points;
}

export function generateNDVIHeatmap(boundary) {
  return generateBoundaryHeatmap(11, boundary, (value, latNoise) => value * 0.75 + (1 - latNoise) * 0.25);
}

export function generateNDWIHeatmap(boundary) {
  return generateBoundaryHeatmap(23, boundary, (value, latNoise, lonNoise) => value * 0.65 + lonNoise * 0.2 + latNoise * 0.15);
}

export function generateNDBIHeatmap(boundary) {
  return generateBoundaryHeatmap(37, boundary, (value, latNoise, lonNoise) => {
    const urbanCorridor = Math.abs(latNoise - 0.35) < 0.12 && Math.abs(lonNoise - 0.55) < 0.18;
    return urbanCorridor ? Math.max(value, 0.72) : value * 0.55;
  });
}
