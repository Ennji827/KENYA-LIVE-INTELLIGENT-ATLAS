// Shared access to the Kenya boundary GeoJSON in /public/data.
// Files are multi-megabyte, so every loader is cached at module level and
// resolved once per URL.

import { kenyaCountyNames } from "../data/kenyaCountyCatalog";
import { getApiBase } from "./api";

const COUNTIES_URL = "/data/counties.geojson";
const SUBCOUNTIES_URL = "/data/sub_counties.geojson";

const cache = new Map();

export async function loadGeo(url) {
  if (cache.has(url)) return cache.get(url);
  const promise = fetch(url).then((r) => {
    if (!r.ok) throw new Error(`Failed to load ${url}`);
    return r.json();
  });
  cache.set(url, promise);
  return promise;
}

export function countiesUrl() {
  return COUNTIES_URL;
}

export function subcountiesUrl() {
  return SUBCOUNTIES_URL;
}

// County names, sorted alphabetically for selectors.
export function listCounties() {
  return [...kenyaCountyNames].sort((a, b) => a.localeCompare(b));
}

// Sub-county names for one county, read from the sub-county boundaries.
export async function listSubcounties(county) {
  if (!county) return [];
  const data = await loadGeo(SUBCOUNTIES_URL);
  return data.features
    .filter((f) => f.properties?.ADM1_EN === county)
    .map((f) => f.properties?.ADM2_EN)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

// Ward names for one sub-county, enriched by the Django boundary hierarchy.
export async function listWards(county, subcounty) {
  if (!subcounty) return [];
  const params = new URLSearchParams();
  if (county) params.set("county", county);
  params.set("subcounty", subcounty);
  const response = await fetch(`${getApiBase()}/api/boundary/wards?${params}`);
  if (!response.ok) throw new Error("Failed to load wards");
  const data = await response.json();
  return (data.features || [])
    .map((f) => f.properties?.ADM3_EN || f.properties?.shapeName)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}
