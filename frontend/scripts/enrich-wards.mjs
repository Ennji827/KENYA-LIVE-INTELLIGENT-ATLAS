// One-time spatial join: the ward boundaries (geoBoundaries, ADM3) carry no
// parent county/sub-county attribute — only a shapeName. This script assigns
// each ward its parent county (ADM1_EN) and sub-county (ADM2_EN) by locating a
// representative interior point of the ward inside the sub-county polygons
// (OCHA/HDX ADM2), then rewrites wards.geojson with ADM1_EN / ADM2_EN / ADM3_EN
// so the map can filter wards by their sub-county the same way it filters
// sub-counties by county.
//
// Run from the frontend/ directory so @turf/turf resolves:
//   node scripts/enrich-wards.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as turf from "@turf/turf";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "..", "public", "data");

const subcounties = JSON.parse(
  readFileSync(join(dataDir, "sub_Counties.geojson"), "utf8"),
);
const wards = JSON.parse(readFileSync(join(dataDir, "wards.geojson"), "utf8"));

// Precompute a bbox and a centroid for every sub-county once. The bbox is a
// cheap pre-filter (skip polygons that can't contain the point); the centroid
// backs the nearest-neighbour fallback for wards whose interior point doesn't
// land in any sub-county (source datasets don't share edges exactly).
const subs = subcounties.features
  // A few source rows carry null/empty geometry; they can't contain any ward.
  .filter((f) => f.geometry?.coordinates?.length && f.properties?.ADM2_EN)
  .map((f) => ({
    feature: f,
    adm1: f.properties?.ADM1_EN,
    adm2: f.properties?.ADM2_EN,
    bbox: turf.bbox(f),
    centroid: turf.centroid(f),
  }));

const inBbox = (pt, [minX, minY, maxX, maxY]) => {
  const [x, y] = pt.geometry.coordinates;
  return x >= minX && x <= maxX && y >= minY && y <= maxY;
};

let contained = 0;
let fallback = 0;

for (const ward of wards.features) {
  // pointOnFeature returns a point guaranteed to sit on the ward geometry, so
  // containment against the covering sub-county is reliable even for concave
  // or multipart wards (a plain centroid can fall outside those).
  const pt = turf.pointOnFeature(ward);

  let match = null;
  for (const s of subs) {
    if (!inBbox(pt, s.bbox)) continue;
    if (turf.booleanPointInPolygon(pt, s.feature)) {
      match = s;
      break;
    }
  }

  if (!match) {
    // Nearest sub-county centroid — handles coastal/border wards whose interior
    // point falls just outside every sub-county polygon.
    let best = null;
    let bestDist = Infinity;
    for (const s of subs) {
      const d = turf.distance(pt, s.centroid);
      if (d < bestDist) {
        bestDist = d;
        best = s;
      }
    }
    match = best;
    fallback += 1;
  } else {
    contained += 1;
  }

  ward.properties = {
    ...ward.properties,
    ADM3_EN: ward.properties?.shapeName ?? null,
    ADM2_EN: match?.adm2 ?? null,
    ADM1_EN: match?.adm1 ?? null,
  };
}

writeFileSync(join(dataDir, "wards.geojson"), JSON.stringify(wards));

console.log(`wards processed : ${wards.features.length}`);
console.log(`  by containment: ${contained}`);
console.log(`  by nearest    : ${fallback}`);
const unmatched = wards.features.filter((f) => !f.properties.ADM2_EN).length;
console.log(`  unmatched     : ${unmatched}`);
