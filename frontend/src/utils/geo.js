// Shared access to the Kenya boundary GeoJSON in /public/data.
// Files are multi-megabyte, so every loader is cached at module level and
// resolved once per URL.

import { kenyaCountyNames } from "../data/kenyaCountyCatalog";

const COUNTIES_URL = "/data/counties.geojson";
const SUBCOUNTIES_URL = "/data/sub_counties.geojson";
// Ward boundaries, enriched with parent ADM1_EN/ADM2_EN/ADM3_EN by
// scripts/enrich-wards.mjs (the raw source carries only shapeName).
const WARDS_URL = "/data/wards.geojson";

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

export function wardsUrl() {
  return WARDS_URL;
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

// Ward names for one sub-county, read from the enriched ward boundaries.
// County is optional but disambiguates sub-county names shared across counties.
export async function listWards(subcounty, county) {
  if (!subcounty) return [];
  const data = await loadGeo(WARDS_URL);
  return data.features
    .filter(
      (f) =>
        f.properties?.ADM2_EN === subcounty &&
        (!county || f.properties?.ADM1_EN === county),
    )
    .map((f) => f.properties?.ADM3_EN)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}
