import { create } from "zustand";
import * as turf from "@turf/turf";
import { getApiBase } from "../utils/api";

async function fetchGeoJSON(paths) {
  const candidates = Array.isArray(paths) ? paths : [paths];
  let lastError = null;

  for (const path of candidates) {
    try {
      const response = await fetch(path);
      if (!response.ok) {
        throw new Error(`${path} returned ${response.status}`);
      }
      return response.json();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("GeoJSON request failed");
}

function bboxContainsPoint(bounds, point) {
  const [minX, minY, maxX, maxY] = bounds;
  const [x, y] = point;
  return x >= minX && x <= maxX && y >= minY && y <= maxY;
}

function bboxesOverlap(first, second) {
  return (
    first[0] <= second[2] &&
    first[2] >= second[0] &&
    first[1] <= second[3] &&
    first[3] >= second[1]
  );
}

function findParentSubcounty(ward, subcountyIndex) {
  let point;

  try {
    point = turf.pointOnFeature(ward);
  } catch (error) {
    point = turf.centroid(ward);
  }

  const coords = point.geometry.coordinates;

  for (const item of subcountyIndex) {
    if (!bboxContainsPoint(item.bbox, coords)) continue;
    try {
      if (turf.booleanPointInPolygon(point, item.feature)) {
        return item.feature;
      }
    } catch (error) {
      // Skip malformed comparisons and keep looking.
    }
  }

  const wardBounds = turf.bbox(ward);
  for (const item of subcountyIndex) {
    if (!bboxesOverlap(item.bbox, wardBounds)) continue;
    try {
      if (turf.booleanIntersects(ward, item.feature)) {
        return item.feature;
      }
    } catch (error) {
      // Skip malformed comparisons and keep looking.
    }
  }

  return null;
}

function enrichWardsWithParents(wardsData, subcountyData) {
  if (!wardsData?.features || !subcountyData?.features) return wardsData;

  const subcountyIndex = subcountyData.features.map((feature) => ({
    feature,
    bbox: turf.bbox(feature),
  }));

  return {
    ...wardsData,
    features: wardsData.features.map((ward) => {
      const parent = findParentSubcounty(ward, subcountyIndex);
      if (!parent) return ward;

      const parentProps = parent.properties || {};
      return {
        ...ward,
        properties: {
          ...ward.properties,
          ADM2_EN: parentProps.ADM2_EN,
          ADM2_PCODE: parentProps.ADM2_PCODE,
          ADM1_EN: parentProps.ADM1_EN,
          ADM1_PCODE: parentProps.ADM1_PCODE,
        },
      };
    }),
  };
}

const useAEISStore = create((set, get) => ({
  mapCenter: [-0.0236, 37.9062],
  mapZoom: 6,

  counties: null,
  subcounties: null,
  wards: null,
  loadingGeoJSON: false,
  geoJSONError: null,

  selectedCounty: null,
  selectedSubCounty: null,
  selectedWard: null,
  hoveredCounty: null,
  hoveredSubCounty: null,
  hoveredWard: null,
  selectedAnalysis: null,
  loadingAnalysis: false,

  layers: {
    counties: true,
    subcounties: false,
    wards: false,
    nasaNdvi: false,
    nasaLst: false,
    nasaTrueColor: false,
    geeNdvi: false,
    geeNdwi: false,
    geeLst: false,
    segmentation: false,
  },

  fetchGeoJSONData: async () => {
    const { counties, subcounties, wards, loadingGeoJSON } = get();
    if (loadingGeoJSON || (counties && subcounties && wards)) return;

    set({ loadingGeoJSON: true, geoJSONError: null });

    try {
      const [countyData, subcountyData, rawWardData] = await Promise.all([
        fetchGeoJSON("/data/counties.geojson"),
        fetchGeoJSON(["/data/sub_Counties.geojson", "/data/sub_counties.geojson"]),
        fetchGeoJSON("/data/wards.geojson"),
      ]);
      const wardData = enrichWardsWithParents(rawWardData, subcountyData);

      set({
        counties: countyData,
        subcounties: subcountyData,
        wards: wardData,
        loadingGeoJSON: false,
        geoJSONError: null,
      });
    } catch (error) {
      console.error("Error loading GeoJSON boundaries:", error);
      set({
        loadingGeoJSON: false,
        geoJSONError: error.message || "Unable to load boundary data",
      });
    }
  },

  setMapView: (center, zoom) =>
    set({
      mapCenter: center,
      mapZoom: zoom,
    }),

  setSelectedCounty: (county) =>
    set({
      selectedCounty: county,
      selectedSubCounty: null,
      selectedWard: null,
      selectedAnalysis: null
    }),

  setHoveredCounty: (county) =>
    set({
      hoveredCounty: county,
    }),

  setSelectedSubCounty: (subcounty) =>
    set({
      selectedSubCounty: subcounty,
      selectedWard: null,
      selectedAnalysis: null
    }),

  setHoveredSubCounty: (subcounty) =>
    set({
      hoveredSubCounty: subcounty,
    }),

  setSelectedWard: (ward) =>
    set({
      selectedWard: ward,
      selectedAnalysis: null
    }),

  setHoveredWard: (ward) =>
    set({
      hoveredWard: ward,
    }),

  toggleLayer: (layerName) =>
    set((state) => ({
      layers: {
        ...state.layers,
        [layerName]: !state.layers[layerName],
      },
    })),

  setLayerVisibility: (layerName, visible) =>
    set((state) => ({
      layers: {
        ...state.layers,
        [layerName]: Boolean(visible),
      },
    })),

  setAnalysis: (analysis) => set({ selectedAnalysis: analysis, loadingAnalysis: false }),
  setLoadingAnalysis: (val) => set({ loadingAnalysis: val }),

  fetchAreaAnalysis: async (geometry) => {
    const API_BASE = getApiBase();
    set({ loadingAnalysis: true, selectedAnalysis: null });
    try {
      const response = await fetch(`${API_BASE}/api/analysis/area`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ geometry })
      });
      if (!response.ok) throw new Error('Area analysis failed');
      const data = await response.json();
      set({ selectedAnalysis: data, loadingAnalysis: false });
      return data;
    } catch (error) {
      console.error("Error fetching area analysis:", error);
      set({ selectedAnalysis: null, loadingAnalysis: false });
      return null;
    }
  },

  fetchAnalysis: async (level, name) => {
    const API_BASE = getApiBase();
    set({ loadingAnalysis: true });
    try {
      const response = await fetch(`${API_BASE}/api/analysis/${level}/${encodeURIComponent(name)}`);
      if (!response.ok) throw new Error('Analysis failed');
      const data = await response.json();
      set({ selectedAnalysis: data, loadingAnalysis: false });
    } catch (error) {
      console.error("Error fetching real data:", error);
      set({ selectedAnalysis: null, loadingAnalysis: false });
    }
  }
}));

export default useAEISStore;
