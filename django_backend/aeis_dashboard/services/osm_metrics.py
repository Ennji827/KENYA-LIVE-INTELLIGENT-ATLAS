"""Per-county topic metrics derived live from OpenStreetMap (Overpass API).

This backs three of the intelligence topics with a real, keyless open data
source instead of the deterministic scaffolding in the frontend's topics.js:

    roads         -> classified road density  (km per 1000 km²)
    forests       -> forest/wood cover         (% of county area)
    water_bodies  -> surface water area        (km²)

The heavy lifting (boundary loading, bounding boxes, spherical polygon area,
point-in-polygon, the Overpass HTTP call) already exists in `domain`; this
module reuses it and adds the length/area aggregation plus caching.

Design mirrors the existing weather feed: each county is computed at most once
per TTL and cached, and the national response fans out over a small worker pool
(kept low to respect Overpass fair-use). Any county that errors or times out
returns a null value, so the frontend cleanly falls back to scaffolding.
"""

from __future__ import annotations

import json
import math
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from django.core.cache import cache

from . import domain

# Way-level OSM selectors per topic and how to turn the matched geometry into a
# county figure. We query `out geom` so every way carries its full node list,
# letting us compute real lengths and areas rather than just counts.
OSM_TOPIC_CONFIG = {
    "roads": {
        "selectors": [
            'way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential)$"]',
        ],
        "metric": "length_density",
        "unit": "km/1000 km²",
    },
    "forests": {
        "selectors": [
            'way["landuse"="forest"]',
            'way["natural"="wood"]',
        ],
        "metric": "area_pct",
        "unit": "% cover",
    },
    "water_bodies": {
        "selectors": [
            'way["natural"="water"]',
            'way["waterway"="riverbank"]',
            'way["landuse"="reservoir"]',
        ],
        "metric": "area_km2",
        "unit": "km²",
    },
}

SUPPORTED_TOPICS = tuple(OSM_TOPIC_CONFIG)

# Cache each county value for a day — OSM base geometry changes slowly and these
# queries are expensive. National fan-out uses a small pool to be a good citizen.
_COUNTY_TTL_SECONDS = 24 * 60 * 60
_MAX_WORKERS = 4
_OVERPASS_URL = "https://overpass-api.de/api/interpreter"
_OVERPASS_TIMEOUT = 55  # seconds; matches the [timeout:] in the query below
# Overpass frequently returns a transient 504/429 under load but succeeds on a
# quick retry, so we make a couple of attempts before giving up on a county.
_OVERPASS_ATTEMPTS = 3
_OVERPASS_RETRY_STATUS = {429, 502, 503, 504}
_OVERPASS_BACKOFF_SECONDS = 2

_EARTH_RADIUS_M = 6_378_137.0


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlambda / 2) ** 2
    return 2 * _EARTH_RADIUS_M * math.asin(min(1.0, math.sqrt(a)))


def _way_length_m(geometry: list[dict]) -> float:
    total = 0.0
    for a, b in zip(geometry, geometry[1:]):
        total += _haversine_m(a["lat"], a["lon"], b["lat"], b["lon"])
    return total


def _way_area_m2(geometry: list[dict]) -> float:
    # Treat the way's node list as a closed ring; reuse domain's spherical
    # shoelace by converting {lat,lon} points to [lon,lat] pairs.
    ring = [[point["lon"], point["lat"]] for point in geometry]
    return domain._ring_area_square_metres(ring)


def _geometry_centroid(geometry: list[dict]) -> tuple[float, float] | None:
    if not geometry:
        return None
    lon = sum(point["lon"] for point in geometry) / len(geometry)
    lat = sum(point["lat"] for point in geometry) / len(geometry)
    return lon, lat


def _overpass_geom_query(selectors: list[str], feature: dict) -> str:
    west, south, east, north = domain.bbox(feature)
    bbox_expr = f"({south},{west},{north},{east})"
    body = "\n".join(f"  {selector}{bbox_expr};" for selector in selectors)
    return f"[out:json][timeout:{_OVERPASS_TIMEOUT}];\n(\n{body}\n);\nout geom;"


def _request_overpass(query: str) -> dict:
    body = urlencode({"data": query}).encode("utf-8")
    last_exc: Exception | None = None
    for attempt in range(_OVERPASS_ATTEMPTS):
        request = Request(
            _OVERPASS_URL,
            data=body,
            headers={
                "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
                "User-Agent": "AEIS-K/0.1 topic metrics (OpenStreetMap)",
            },
            method="POST",
        )
        try:
            with urlopen(request, timeout=_OVERPASS_TIMEOUT + 5) as response:
                return json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            last_exc = exc
            if exc.code not in _OVERPASS_RETRY_STATUS:
                raise
        except (URLError, TimeoutError, OSError) as exc:
            last_exc = exc
        if attempt < _OVERPASS_ATTEMPTS - 1:
            time.sleep(_OVERPASS_BACKOFF_SECONDS * (attempt + 1))
    raise last_exc if last_exc else RuntimeError("Overpass request failed")


def _county_value(topic: str, feature: dict) -> dict:
    """Compute (or read from cache) one county's live value for a topic."""
    config = OSM_TOPIC_CONFIG[topic]
    code = domain.county_code(feature) or domain.county_name(feature)
    cache_key = f"osm_metric:{topic}:{code}"
    cached = cache.get(cache_key)
    if cached is not None:
        return {**cached, "cached": True}

    county_area_km2 = domain.geometry_area_square_metres(feature.get("geometry") or {}) / 1_000_000
    result = {
        "name": domain.county_name(feature),
        "value": None,
        "provider": "openstreetmap_overpass",
        "cached": False,
    }
    try:
        payload = _request_overpass(_overpass_geom_query(config["selectors"], feature))
    except (HTTPError, URLError, TimeoutError, OSError, ValueError) as exc:
        result["status"] = "provider_unavailable"
        result["message"] = str(exc)
        return result  # not cached: retry next time

    length_m = 0.0
    area_m2 = 0.0
    matched = 0
    for element in payload.get("elements", []):
        geometry = element.get("geometry") or []
        if len(geometry) < 2:
            continue
        centroid = _geometry_centroid(geometry)
        # Drop features whose centre falls in a neighbouring county (bbox spill).
        if not centroid or not domain.point_in_feature(centroid, feature):
            continue
        matched += 1
        if config["metric"] == "length_density":
            length_m += _way_length_m(geometry)
        else:
            area_m2 += _way_area_m2(geometry)

    if config["metric"] == "length_density":
        length_km = length_m / 1000
        value = round(length_km / county_area_km2 * 1000, 0) if county_area_km2 else None
    elif config["metric"] == "area_pct":
        area_km2 = area_m2 / 1_000_000
        value = round(area_km2 / county_area_km2 * 100, 1) if county_area_km2 else None
    else:  # area_km2
        value = round(area_m2 / 1_000_000, 0)

    result.update({"value": value, "status": "ok", "matched_features": matched})
    cache.set(cache_key, result, _COUNTY_TTL_SECONDS)
    return result


def metric_payload(topic: str, county: str | None = None) -> tuple[int, dict]:
    """National (all counties) or single-county live metric for a topic."""
    if topic not in OSM_TOPIC_CONFIG:
        return 400, {
            "error": f"Unsupported topic: {topic}",
            "supported_topics": list(SUPPORTED_TOPICS),
        }
    config = OSM_TOPIC_CONFIG[topic]

    if county:
        feature = domain.find_county(county)
        if not feature:
            return 404, {"error": "County not found", "county": county}
        row = _county_value(topic, feature)
        return 200, {
            "topic": topic,
            "unit": config["unit"],
            "metric": config["metric"],
            "provider": "openstreetmap_overpass",
            "source": "OpenStreetMap via Overpass API",
            "regions": [row],
            "generated_at": domain.now_iso(),
        }

    features = domain.counties()
    regions: list[dict] = []
    with ThreadPoolExecutor(max_workers=_MAX_WORKERS) as executor:
        future_map = {executor.submit(_county_value, topic, feature): feature for feature in features}
        for future in as_completed(future_map):
            try:
                regions.append(future.result())
            except Exception:  # pragma: no cover - defensive; keep national response alive
                feature = future_map[future]
                regions.append({"name": domain.county_name(feature), "value": None})

    regions.sort(key=lambda row: (row.get("value") is None, -(row.get("value") or 0)))
    live = sum(1 for row in regions if isinstance(row.get("value"), (int, float)))
    return 200, {
        "topic": topic,
        "unit": config["unit"],
        "metric": config["metric"],
        "provider": "openstreetmap_overpass",
        "source": "OpenStreetMap via Overpass API",
        "regions": regions,
        "coverage": {"counties": len(regions), "live_counties": live},
        "generated_at": domain.now_iso(),
    }
