"""Per-region topic metrics and raster tile layers from Google Earth Engine.

This backs the environmental intelligence topics with real remote-sensing data,
replacing the deterministic scaffolding in the frontend's topics.js:

    forests       -> tree-cover share        (% of area, ESA WorldCover)
    farmland      -> cropland share          (% of area, ESA WorldCover)
    water_bodies  -> surface-water area      (km², JRC Global Surface Water)
    rainfall      -> annual precipitation    (mm/yr, CHIRPS)
    weather       -> mean land-surface temp  (°C, MODIS MOD11A2)

Design mirrors ``osm_metrics``: values are computed per view (national counties,
a county's sub-counties, or a sub-county's wards) with ``reduceRegions`` over the
matching boundary geometries, cached per (topic, scope), and every response
carries the same ``regions: [{name, value}]`` shape the frontend already consumes
as ``liveValues``. Each response also carries a ``tile`` URL from ``getMapId`` so
the same layer can be drawn as a raster overlay.

Earth Engine is optional: if the SDK is absent or no service-account credentials
are configured, every call returns ``status: "not_configured"`` with null values,
and the frontend cleanly falls back to scaffolding. Nothing here imports ``ee``
at module load, so the app runs unchanged until a key is supplied.

Activation (see .env.local):
    KLA_GEE_PROJECT           Google Cloud project id with the Earth Engine API enabled
    KLA_GEE_SERVICE_ACCOUNT   service-account email registered for Earth Engine
    KLA_GEE_SA_KEY_FILE       path to that account's JSON key file
                               (or KLA_GEE_SA_KEY holding the JSON itself)
"""

from __future__ import annotations

import json
import threading
from datetime import date, timedelta

from django.core.cache import cache

from aeis_django.env import env

from . import domain

# ── Topic → Earth Engine configuration ───────────────────────────────────────
# Each entry names the dataset and how to turn it into a single-band image to
# reduce, the reducer, the native scale (m/pixel) to reduce at, the display unit,
# the aggregation the frontend uses for parent figures, and the visualisation
# parameters for the raster tile overlay. `image` is a callable so dated
# collections (CHIRPS, MODIS) resolve against a recent window at request time.
SUPPORTED_TOPICS = ("forests", "farmland", "water_bodies", "rainfall", "weather")


def _worldcover_class_pct(class_value):
    """% of area in one ESA WorldCover class, as a 0–100 image (mean reducer)."""
    import ee

    cover = ee.ImageCollection("ESA/WorldCover/v200").first().select("Map")
    return cover.eq(class_value).multiply(100).rename("value")


def _config():
    """Build the topic config lazily so `ee` is only imported when configured."""
    import ee

    today = date.today()
    # Last full calendar year — a stable, complete annual window.
    year_start = date(today.year - 1, 1, 1).isoformat()
    year_end = date(today.year - 1, 12, 31).isoformat()
    # 18-month lookback for the temperature composite (MODIS 8-day product).
    lst_start = (today - timedelta(days=540)).isoformat()
    lst_end = today.isoformat()

    return {
        "forests": {
            "unit": "% cover",
            "metric": "area_pct",
            "aggregation": "avg",
            "reducer": ee.Reducer.mean(),
            "scale": 100,
            "image": lambda: _worldcover_class_pct(10),  # 10 = tree cover
            "vis": {"min": 0, "max": 100, "palette": ["ffffff", "15803d"]},
            "source": "ESA WorldCover v200 (tree cover) via Google Earth Engine",
        },
        "farmland": {
            "unit": "% of land",
            "metric": "area_pct",
            "aggregation": "avg",
            "reducer": ee.Reducer.mean(),
            "scale": 100,
            "image": lambda: _worldcover_class_pct(40),  # 40 = cropland
            "vis": {"min": 0, "max": 100, "palette": ["ffffff", "ca8a04"]},
            "source": "ESA WorldCover v200 (cropland) via Google Earth Engine",
        },
        "water_bodies": {
            "unit": "km²",
            "metric": "area_km2",
            "aggregation": "sum",
            "reducer": ee.Reducer.sum(),
            "scale": 90,
            # Area (km²) of pixels that hold surface water at least one month/yr.
            "image": lambda: (
                ee.Image.pixelArea()
                .divide(1_000_000)
                .updateMask(
                    ee.Image("JRC/GSW1_4/GlobalSurfaceWater").select("seasonality").gte(1)
                )
                .rename("value")
            ),
            "vis": {"min": 0, "max": 12, "palette": ["ecfeff", "0e7490"]},
            "source": "JRC Global Surface Water v1.4 via Google Earth Engine",
        },
        "rainfall": {
            "unit": "mm/yr",
            "metric": "annual_mm",
            "aggregation": "avg",
            "reducer": ee.Reducer.mean(),
            "scale": 5000,
            "image": lambda: (
                ee.ImageCollection("UCSB-CHG/CHIRPS/DAILY")
                .filterDate(year_start, year_end)
                .select("precipitation")
                .sum()
                .rename("value")
            ),
            "vis": {"min": 0, "max": 2200, "palette": ["eff6ff", "1d4ed8"]},
            "source": f"CHIRPS daily precipitation ({year_start[:4]}) via Google Earth Engine",
        },
        "weather": {
            "unit": "°C",
            "metric": "mean_temp",
            "aggregation": "avg",
            "reducer": ee.Reducer.mean(),
            "scale": 1000,
            # MOD11A2 LST_Day is in Kelvin × 0.02 → convert to °C.
            "image": lambda: (
                ee.ImageCollection("MODIS/061/MOD11A2")
                .filterDate(lst_start, lst_end)
                .select("LST_Day_1km")
                .mean()
                .multiply(0.02)
                .subtract(273.15)
                .rename("value")
            ),
            "vis": {"min": 12, "max": 40, "palette": ["e0f2fe", "ea580c"]},
            "source": f"MODIS MOD11A2 land-surface temperature via Google Earth Engine",
        },
    }


# ── Earth Engine initialisation (lazy, cached, thread-safe) ──────────────────
_INIT_LOCK = threading.RLock()
_INIT_STATE = {"ready": False, "error": None}
_TTL_SECONDS = 24 * 60 * 60  # values change slowly; be kind to EE quotas


def _credentials_present() -> bool:
    return bool(
        env("KLA_GEE_SERVICE_ACCOUNT")
        and (env("KLA_GEE_SA_KEY_FILE") or env("KLA_GEE_SA_KEY"))
    )


def configured() -> bool:
    """True when the SDK is importable and credentials are set (no network I/O)."""
    if not _credentials_present():
        return False
    try:
        import ee  # noqa: F401
    except ImportError:
        return False
    return True


def _ensure_initialised() -> tuple[bool, str | None]:
    """Initialise EE once per process. Returns (ready, error_message)."""
    if _INIT_STATE["ready"]:
        return True, None
    if not configured():
        return False, "not_configured"

    with _INIT_LOCK:
        if _INIT_STATE["ready"]:
            return True, None
        try:
            import ee

            email = env("KLA_GEE_SERVICE_ACCOUNT")
            key_file = env("KLA_GEE_SA_KEY_FILE")
            if key_file:
                credentials = ee.ServiceAccountCredentials(email, key_file)
            else:
                # Key provided inline as JSON — hand the string straight to EE.
                credentials = ee.ServiceAccountCredentials(
                    email, key_data=env("KLA_GEE_SA_KEY")
                )
            init_kwargs = {}
            project = env("KLA_GEE_PROJECT")
            if project:
                init_kwargs["project"] = project
            ee.Initialize(credentials, **init_kwargs)
            _INIT_STATE["ready"] = True
            return True, None
        except Exception as exc:  # broad: EE raises many credential/quota types
            _INIT_STATE["error"] = str(exc)
            return False, str(exc)


# ── Boundary geometry selection per scope ────────────────────────────────────
def _target_features(level: str, county: str | None, subcounty: str | None):
    """The boundary features whose values back the current map view, each as
    (name, geojson_geometry)."""
    if level == "national":
        return [
            (domain.county_name(f), f.get("geometry"))
            for f in domain.counties()
            if f.get("geometry")
        ]
    if level == "county":
        return [
            (domain.subcounty_name(f), f.get("geometry"))
            for f in domain.subcounties()
            if f.get("geometry") and f.get("properties", {}).get("ADM1_EN") == county
        ]
    # subcounty (or ward) view: the wards of the active sub-county.
    return [
        (domain.ward_name(f), f.get("geometry"))
        for f in domain.wards()
        if f.get("geometry") and f.get("properties", {}).get("ADM2_EN") == subcounty
    ]


def _feature_collection(targets):
    import ee

    features = []
    for name, geometry in targets:
        try:
            geom = ee.Geometry(geometry, geodesic=False)
        except Exception:
            continue
        features.append(ee.Feature(geom, {"aeis_name": name}))
    return ee.FeatureCollection(features)


def _round(value, metric):
    if value is None:
        return None
    if metric in {"area_km2", "annual_mm"}:
        return round(value, 0)
    if metric == "mean_temp":
        return round(value, 1)
    return round(value, 1)  # percentages


# ── Public API ───────────────────────────────────────────────────────────────
def metric_payload(
    topic: str,
    level: str = "national",
    county: str | None = None,
    subcounty: str | None = None,
) -> tuple[int, dict]:
    """Zonal statistics + a raster tile URL for one topic at one scope."""
    if topic not in SUPPORTED_TOPICS:
        return 400, {
            "error": f"Unsupported GEE topic: {topic}",
            "supported_topics": list(SUPPORTED_TOPICS),
        }
    if level not in {"national", "county", "subcounty", "ward"}:
        return 400, {"error": f"Unsupported level: {level}"}
    if level == "county" and not county:
        return 400, {"error": "county is required for level=county"}
    if level in {"subcounty", "ward"} and not subcounty:
        return 400, {"error": "subcounty is required for level=subcounty"}

    base = {
        "topic": topic,
        "provider": "google_earth_engine",
        "level": level,
        "county": county,
        "subcounty": subcounty,
        "regions": [],
        "tile": None,
        "generated_at": domain.now_iso(),
    }

    ready, error = _ensure_initialised()
    if not ready:
        base["status"] = "not_configured" if error == "not_configured" else "provider_unavailable"
        if error and error != "not_configured":
            base["message"] = error
        return 200, base  # 200 + null values → frontend falls back to scaffolding

    cache_key = f"gee_metric:{topic}:{level}:{county or ''}:{subcounty or ''}"
    cached = cache.get(cache_key)
    if cached is not None:
        return 200, {**cached, "cached": True}

    try:
        import ee  # noqa: F401

        config = _config()[topic]
        image = config["image"]()
        targets = _target_features(level, county, subcounty)
        collection = _feature_collection(targets)

        reduced = image.reduceRegions(
            collection=collection,
            reducer=config["reducer"],
            scale=config["scale"],
        ).getInfo()

        regions = []
        for feature in reduced.get("features", []):
            props = feature.get("properties", {})
            # reduceRegions names the output after the reducer for single inputs.
            raw = props.get("mean")
            if raw is None:
                raw = props.get("sum")
            regions.append(
                {
                    "name": props.get("aeis_name"),
                    "value": _round(raw, config["metric"]),
                    "provider": "google_earth_engine",
                }
            )
        regions.sort(key=lambda r: (r.get("value") is None, -(r.get("value") or 0)))

        tile = None
        try:
            map_id = image.getMapId(config["vis"])
            tile = {
                "url": map_id["tile_fetcher"].url_format,
                "opacity": 0.7,
                "unit": config["unit"],
            }
        except Exception:
            tile = None  # data still returns even if the tile render fails

        live = sum(1 for r in regions if isinstance(r.get("value"), (int, float)))
        payload = {
            **base,
            "unit": config["unit"],
            "metric": config["metric"],
            "aggregation": config["aggregation"],
            "source": config["source"],
            "regions": regions,
            "tile": tile,
            "coverage": {"regions": len(regions), "live_regions": live},
            "status": "ok",
        }
        cache.set(cache_key, payload, _TTL_SECONDS)
        return 200, payload
    except Exception as exc:  # keep the endpoint alive; frontend falls back
        base["status"] = "provider_unavailable"
        base["message"] = str(exc)
        return 200, base


def status_payload() -> dict:
    """Lightweight readiness report for the data-sources catalog / diagnostics."""
    try:
        import ee  # noqa: F401

        sdk = True
    except ImportError:
        sdk = False
    return {
        "provider": "Google Earth Engine",
        "sdk_installed": sdk,
        "credentials_present": _credentials_present(),
        "status": "connected" if configured() and _INIT_STATE["ready"] else (
            "configured" if configured() else "not_configured"
        ),
        "supported_topics": list(SUPPORTED_TOPICS),
        "environment_variables": [
            "KLA_GEE_PROJECT",
            "KLA_GEE_SERVICE_ACCOUNT",
            "KLA_GEE_SA_KEY_FILE",
        ],
        "generated_at": domain.now_iso(),
    }
