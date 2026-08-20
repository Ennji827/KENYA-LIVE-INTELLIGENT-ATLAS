"""Per-region facility counts from the bundled GeoPackage point layers.

Backs the infrastructure topics with real surveyed locations:

    hospitals      -> health facilities      (count, 13,535 points)
    schools        -> learning institutions  (count, 72,077 points)
    police_posts   -> police facilities      (count,  3,944 points)
    admin_offices  -> administration offices (count,  8,486 points)

Design mirrors ``osm_metrics`` / ``gee_metrics``: values are computed per view
(national counties, a county's sub-counties, or a sub-county's wards), cached
per (topic, scope), and every response carries the same
``regions: [{name, value}]`` shape the frontend already consumes as
``liveValues``.

The source layers carry NO administrative attributes — no county, sub-county or
ward column (the school layer has a SUB-COUNTY field, but it is empty in all
72,077 rows). So each facility is assigned to a region by point-in-polygon
against the same boundary GeoJSON the rest of the app uses, via
``domain.point_in_feature``. That keeps counts consistent with the choropleth
by construction, and needs no geospatial dependency: GeoPackage is SQLite, and
the point geometries are decoded here with ``struct``.

These files are local, so unlike the OSM and Earth Engine services there is no
provider to be unavailable. A missing or unreadable file degrades to null
values and the frontend falls back to scaffolding.
"""

from __future__ import annotations

import sqlite3
import struct
import threading

from django.core.cache import cache

from aeis_django.settings import BASE_DIR

from . import domain

# BASE_DIR is the backend package root, so this survives the repository or the
# backend directory being renamed — which walking up to PROJECT_ROOT and back
# down by hard-coded name did not.
FACILITY_ROOT = BASE_DIR / "data" / "facilities"

# Kenya's bounding box, generously padded. The school layer contains two points
# digitised at Indian Ocean longitudes (61.0 and 73.8); everything else falls
# well inside. Filtering here keeps a stray point from being silently dropped
# later by the polygon test with no explanation.
KENYA_BBOX = (33.5, 42.2, -5.2, 5.8)  # lon_min, lon_max, lat_min, lat_max

# topic -> source layer and presentation. `category` names the attribute column
# holding the facility type, used for the per-type breakdown in the response.
FACILITY_CONFIG: dict[str, dict] = {
    "hospitals": {
        "path": FACILITY_ROOT / "facilities_mapped_health.gpkg",
        "layer": "facilities_mapped_health",
        "category": "Category",
        "name_column": "FacilityNa",
        "unit": "facilities",
        "metric": "Health facilities",
        "label": "Hospitals & clinics",
    },
    "schools": {
        "path": FACILITY_ROOT / "facilities_mapped_school.gpkg",
        "layer": "facilities_mapped_school",
        "category": "Institutio",
        "name_column": "SchoolName",
        "unit": "institutions",
        "metric": "Learning institutions",
        "label": "Schools",
    },
    "police_posts": {
        "path": FACILITY_ROOT / "facilities_mapped_police.gpkg",
        "layer": "facilities_mapped_police",
        "category": "Category",
        "name_column": "FacilityNa",
        "unit": "facilities",
        "metric": "Police facilities",
        "label": "Police stations",
    },
    "admin_offices": {
        "path": FACILITY_ROOT / "facilities_mapped_ngao.gpkg",
        "layer": "facilities_mapped_ngao",
        "category": "Category",
        "name_column": "FacilityNa",
        "unit": "offices",
        "metric": "Administration offices",
        "label": "Administration offices",
    },
}

SUPPORTED_TOPICS = tuple(FACILITY_CONFIG)

_POINT_CACHE: dict[str, list[tuple[float, float, str, str]]] = {}
_POINT_LOCK = threading.RLock()

# Envelope indicator (flags bits 1-3) -> byte length of the GeoPackage envelope.
_ENVELOPE_BYTES = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}


def _decode_point(blob: bytes) -> tuple[float, float] | None:
    """(lon, lat) from a GeoPackage POINT blob, or None if not a usable point.

    Layout: 'GP' magic, version, flags, int32 srs_id, optional envelope, then
    standard WKB. Bit 4 of flags marks an empty geometry.
    """
    if not blob or len(blob) < 8 or blob[0:2] != b"GP":
        return None
    flags = blob[3]
    if (flags >> 4) & 1:  # empty geometry
        return None
    envelope = _ENVELOPE_BYTES.get((flags >> 1) & 7)
    if envelope is None:
        return None
    wkb = blob[8 + envelope :]
    if len(wkb) < 21:
        return None
    order = "<" if wkb[0] == 1 else ">"
    # Mask off the SRID/Z/M flags so POINT Z / POINT M decode too.
    if struct.unpack(order + "I", wkb[1:5])[0] & 0xFFFF != 1:
        return None
    lon, lat = struct.unpack(order + "dd", wkb[5:21])
    return lon, lat


def _load_points(topic: str) -> list[tuple[float, float, str, str]]:
    """All (lon, lat, category, name) for a topic, read once and held in memory."""
    if topic in _POINT_CACHE:
        return _POINT_CACHE[topic]

    with _POINT_LOCK:
        if topic in _POINT_CACHE:
            return _POINT_CACHE[topic]

        config = FACILITY_CONFIG[topic]
        path = config["path"]
        if not path.exists():
            _POINT_CACHE[topic] = []
            return []

        points: list[tuple[float, float, str, str]] = []
        connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        try:
            columns = {
                row[1]
                for row in connection.execute(f'PRAGMA table_info("{config["layer"]}")')
            }
            category = config["category"] if config["category"] in columns else None
            label = config["name_column"] if config["name_column"] in columns else None
            select = "SELECT geom, {}, {}".format(
                f'"{category}"' if category else "NULL",
                f'"{label}"' if label else "NULL",
            )
            for blob, raw_category, raw_name in connection.execute(
                f'{select} FROM "{config["layer"]}"'
            ):
                point = _decode_point(blob)
                if point is None:
                    continue
                lon, lat = point
                if not (
                    KENYA_BBOX[0] <= lon <= KENYA_BBOX[1]
                    and KENYA_BBOX[2] <= lat <= KENYA_BBOX[3]
                ):
                    continue
                points.append(
                    (
                        round(lon, 5),
                        round(lat, 5),
                        _clean_category(raw_category),
                        str(raw_name or "").strip() or "Unnamed",
                    )
                )
        except sqlite3.DatabaseError:
            points = []
        finally:
            connection.close()

        _POINT_CACHE[topic] = points
        return points


def _clean_category(value) -> str:
    """Normalise the free-text facility type.

    The administration-offices layer contains 61 rows whose Category is the
    whole newline-joined option list rather than one choice — a data-entry
    artifact. Those, and blanks, collapse to "Unspecified".
    """
    text = str(value or "").strip()
    if not text or "\n" in text or text.lower() in {"none", "other [specify]"}:
        return "Unspecified"
    return text


def _feature_bbox(geometry: dict) -> tuple[float, float, float, float] | None:
    """(lon_min, lon_max, lat_min, lat_max) for a Polygon/MultiPolygon."""
    kind = geometry.get("type")
    coordinates = geometry.get("coordinates") or []
    if kind == "Polygon":
        rings = coordinates
    elif kind == "MultiPolygon":
        rings = [ring for polygon in coordinates for ring in polygon]
    else:
        return None

    lons: list[float] = []
    lats: list[float] = []
    for ring in rings:
        for position in ring:
            if len(position) >= 2:
                lons.append(position[0])
                lats.append(position[1])
    if not lons:
        return None
    return min(lons), max(lons), min(lats), max(lats)


def _target_names(level: str, county: str | None, subcounty: str | None) -> list[str]:
    """Region names backing the current map view, in the same order and from the
    same boundary files ``gee_metrics`` uses, so both services colour exactly the
    same regions — including those that end up with a count of zero.
    """
    if level == "national":
        return [domain.county_name(f) for f in domain.counties() if f.get("geometry")]
    if level == "county":
        return [
            domain.subcounty_name(f)
            for f in domain.subcounties()
            if f.get("geometry") and f.get("properties", {}).get("ADM1_EN") == county
        ]
    # subcounty (or ward) view: the wards of the active sub-county.
    return [
        domain.ward_name(f)
        for f in domain.wards()
        if f.get("geometry") and f.get("properties", {}).get("ADM2_EN") == subcounty
    ]


# Grid cell size in degrees for the spatial index below. At Kenya's latitudes
# 0.25° is roughly 28km — fine enough that a cell rarely overlaps more than a
# handful of sub-counties, coarse enough that indexing a county stays cheap.
_GRID_DEGREES = 0.25


def _cell(lon: float, lat: float) -> tuple[int, int]:
    return (int(lon / _GRID_DEGREES), int(lat / _GRID_DEGREES))


def _build_index(boxes):
    """Map grid cell -> indices of targets whose bbox covers that cell.

    Without this, every point is tested against every target's bbox: 72,000
    schools x 47 counties is 3.4M comparisons before a single polygon test.
    The index cuts the candidate set per point to the few regions actually
    near it.
    """
    index: dict[tuple[int, int], list[int]] = {}
    for position, (_, _, box) in enumerate(boxes):
        if box is None:
            continue
        x0, y0 = _cell(box[0], box[2])
        x1, y1 = _cell(box[1], box[3])
        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                index.setdefault((x, y), []).append(position)
    return index


_ASSIGNMENT_CACHE: dict[str, tuple[list[tuple], int]] = {}
_ASSIGNMENT_LOCK = threading.RLock()


def _ward_index():
    """Ward features with their parent names, bboxes and a grid index."""
    entries = []
    for feature in domain.wards():
        geometry = feature.get("geometry")
        if not geometry:
            continue
        box = _feature_bbox(geometry)
        if box is None:
            continue
        properties = feature.get("properties", {})
        entries.append(
            (
                properties.get("ADM1_EN") or "",
                properties.get("ADM2_EN") or "",
                domain.ward_name(feature),
                feature,
                box,
            )
        )
    index: dict[tuple[int, int], list[int]] = {}
    for position, entry in enumerate(entries):
        box = entry[4]
        x0, y0 = _cell(box[0], box[2])
        x1, y1 = _cell(box[1], box[3])
        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                index.setdefault((x, y), []).append(position)
    return entries, index


def _assign_points(topic: str) -> tuple[list[tuple], int]:
    """Assign every facility to the ward containing it, once.

    Wards nest inside sub-counties inside counties, and ward features carry
    their parents as ADM1_EN/ADM2_EN (verified: every ward parent name matches
    a county and sub-county exactly). So a single ward assignment answers every
    zoom level — national, county and sub-county views are then pure rollups of
    this list rather than fresh point-in-polygon passes.

    Testing against wards rather than counties is also far cheaper per point:
    ward rings hold a fraction of the vertices a county outline does, and the
    grid index leaves only a couple of candidates per point.

    Returns (assignments, unassigned) where each assignment is
    (county, subcounty, ward, category, lon, lat, name) — the coordinates and
    name ride along so the same pass also feeds the dot layer.
    """
    if topic in _ASSIGNMENT_CACHE:
        return _ASSIGNMENT_CACHE[topic]

    with _ASSIGNMENT_LOCK:
        if topic in _ASSIGNMENT_CACHE:
            return _ASSIGNMENT_CACHE[topic]

        entries, index = _ward_index()
        assignments: list[tuple] = []
        unassigned = 0

        for lon, lat, category, name in _load_points(topic):
            placed = False
            for position in index.get(_cell(lon, lat), ()):
                adm1, adm2, adm3, feature, box = entries[position]
                if not (box[0] <= lon <= box[1] and box[2] <= lat <= box[3]):
                    continue
                if domain.point_in_feature((lon, lat), feature):
                    assignments.append((adm1, adm2, adm3, category, lon, lat, name))
                    placed = True
                    break
            if not placed:
                unassigned += 1

        _ASSIGNMENT_CACHE[topic] = (assignments, unassigned)
        return _ASSIGNMENT_CACHE[topic]


def _rollup(topic: str, level: str, county: str | None, subcounty: str | None):
    """Counts and per-category breakdowns keyed by region name for one view."""
    assignments, unassigned = _assign_points(topic)
    counts: dict[str, int] = {}
    breakdown: dict[str, dict[str, int]] = {}

    for adm1, adm2, adm3, category, _lon, _lat, _name in assignments:
        if level == "national":
            key = adm1
        elif level == "county":
            if adm1 != county:
                continue
            key = adm2
        else:
            if adm2 != subcounty:
                continue
            key = adm3
        if not key:
            continue
        counts[key] = counts.get(key, 0) + 1
        bucket = breakdown.setdefault(key, {})
        bucket[category] = bucket.get(category, 0) + 1

    return counts, breakdown, unassigned


def metric_payload(
    topic: str,
    level: str = "national",
    county: str | None = None,
    subcounty: str | None = None,
) -> tuple[int, dict]:
    """Facility counts per region for one topic at one scope."""
    if topic not in FACILITY_CONFIG:
        return 400, {
            "error": f"Unsupported facility topic: {topic}",
            "supported_topics": list(SUPPORTED_TOPICS),
        }
    if level not in {"national", "county", "subcounty", "ward"}:
        return 400, {"error": f"Unsupported level: {level}"}
    if level == "county" and not county:
        return 400, {"error": "county is required for level=county"}
    if level in {"subcounty", "ward"} and not subcounty:
        return 400, {"error": "subcounty is required for level=subcounty"}

    config = FACILITY_CONFIG[topic]
    base = {
        "topic": topic,
        "unit": config["unit"],
        "metric": config["metric"],
        "provider": "kla_facility_registry",
        "source": f"Surveyed facility registry ({config['path'].name})",
        "level": level,
        "county": county,
        "subcounty": subcounty,
        "regions": [],
        "generated_at": domain.now_iso(),
    }

    if not config["path"].exists():
        # Same contract as an unconfigured provider: 200 + no values, so the
        # frontend falls back to scaffolding rather than showing an error.
        base["status"] = "not_configured"
        base["message"] = f"Facility layer not found: {config['path'].name}"
        return 200, base

    cache_key = f"facility_metric:{topic}:{level}:{county or ''}:{subcounty or ''}"
    cached = cache.get(cache_key)
    if cached is not None:
        return 200, {**cached, "cached": True}

    names = _target_names(level, county, subcounty)
    if not names:
        base["status"] = "no_regions"
        return 200, base

    counts, breakdown, unassigned = _rollup(topic, level, county, subcounty)

    regions = [
        {
            "name": name,
            "value": counts.get(name, 0),
            "categories": breakdown.get(name, {}),
            "provider": "kla_facility_registry",
        }
        for name in dict.fromkeys(names)
    ]
    regions.sort(key=lambda row: -(row.get("value") or 0))

    payload = {
        **base,
        "status": "ok",
        "regions": regions,
        "coverage": {
            "regions": len(regions),
            "facilities_total": len(_load_points(topic)),
            "facilities_in_view": sum(counts.values()),
            # Points that fall inside no ward at all (coastal digitising slack,
            # border slivers). Counted once nationally, not per view.
            "facilities_unassigned": unassigned,
        },
    }
    cache.set(cache_key, payload, 60 * 60 * 24)
    return 200, payload


# Ceiling on dots returned in one response. Nationally the school layer holds
# ~72,000 points; drawing and shipping them all stalls the browser, so the view
# is thinned by an even stride and the response says so. Drilling into a county
# or sub-county drops well under this, where every point is returned.
MAX_POINTS = 12000


def points_payload(
    topic: str,
    level: str = "national",
    county: str | None = None,
    subcounty: str | None = None,
    limit: int = MAX_POINTS,
) -> tuple[int, dict]:
    """Individual facility locations for one scope, for the map's dot layer."""
    if topic not in FACILITY_CONFIG:
        return 400, {
            "error": f"Unsupported facility topic: {topic}",
            "supported_topics": list(SUPPORTED_TOPICS),
        }
    if level not in {"national", "county", "subcounty", "ward"}:
        return 400, {"error": f"Unsupported level: {level}"}
    if level == "county" and not county:
        return 400, {"error": "county is required for level=county"}
    if level in {"subcounty", "ward"} and not subcounty:
        return 400, {"error": "subcounty is required for level=subcounty"}

    config = FACILITY_CONFIG[topic]
    limit = max(500, min(int(limit or MAX_POINTS), 60000))

    base = {
        "topic": topic,
        "unit": config["unit"],
        "metric": config["metric"],
        "provider": "kla_facility_registry",
        "level": level,
        "county": county,
        "subcounty": subcounty,
        "points": [],
        "categories": [],
        "generated_at": domain.now_iso(),
    }
    if not config["path"].exists():
        base["status"] = "not_configured"
        return 200, base

    cache_key = f"facility_points:{topic}:{level}:{county or ''}:{subcounty or ''}:{limit}"
    cached = cache.get(cache_key)
    if cached is not None:
        return 200, {**cached, "cached": True}

    assignments, _ = _assign_points(topic)
    scoped = [
        row
        for row in assignments
        if (
            level == "national"
            or (level == "county" and row[0] == county)
            or (level not in {"national", "county"} and row[1] == subcounty)
        )
    ]

    total = len(scoped)
    # Even stride rather than a head slice: taking the first N would show one
    # dense corner of the country and leave the rest blank, which would read as
    # "no facilities here" rather than "not all drawn".
    stride = 1 if total <= limit else (total + limit - 1) // limit
    sampled = scoped[::stride] if stride > 1 else scoped

    # Categories are interned to indices so the payload carries each label once
    # instead of repeating it on every point.
    categories: list[str] = []
    lookup: dict[str, int] = {}
    points = []
    for _adm1, _adm2, _adm3, category, lon, lat, name in sampled:
        index = lookup.get(category)
        if index is None:
            index = len(categories)
            lookup[category] = index
            categories.append(category)
        points.append([lon, lat, index, name])

    payload = {
        **base,
        "status": "ok",
        "points": points,
        "categories": categories,
        "coverage": {
            "in_scope": total,
            "returned": len(points),
            "truncated": stride > 1,
            "stride": stride,
        },
    }
    cache.set(cache_key, payload, 60 * 60 * 24)
    return 200, payload


def status_payload() -> dict:
    """Which facility layers are present and how many points each holds."""
    layers = {}
    for topic, config in FACILITY_CONFIG.items():
        present = config["path"].exists()
        layers[topic] = {
            "label": config["label"],
            "metric": config["metric"],
            "unit": config["unit"],
            "file": config["path"].name,
            "available": present,
            "facilities": len(_load_points(topic)) if present else 0,
        }
    return {
        "provider": "kla_facility_registry",
        "supported_topics": list(SUPPORTED_TOPICS),
        "layers": layers,
        "generated_at": domain.now_iso(),
    }
