from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
import math
import mimetypes
import os
import re
import secrets
import socket
import sqlite3
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, unquote, urlencode, urlparse
from urllib.request import Request, urlopen


HOST = "0.0.0.0"
PORT = 5000
PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = PROJECT_ROOT / "frontend" / "public" / "data"
FRONTEND_DIST_DIR = PROJECT_ROOT / "frontend" / "dist"
FRONTEND_PUBLIC_DIR = PROJECT_ROOT / "frontend" / "public"
DB_PATH = PROJECT_ROOT / "backend" / "aeis.sqlite"
SESSION_SECONDS = 8 * 60 * 60
DEFAULT_COUNTY_PASSWORD = "county123"
DEFAULT_MINISTRY_PASSWORD = "ministry123"
DEFAULT_ANALYST_PASSWORD = "analyst123"


def env_flag(name: str, default: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def public_access_mode() -> bool:
    return env_flag("AEIS_PUBLIC_ACCESS", False)


def get_system_setting(key: str, default: str = "") -> str:
    try:
        with sqlite3.connect(DB_PATH) as conn:
            row = conn.execute("SELECT value FROM system_settings WHERE key = ?", (key,)).fetchone()
            return row[0] if row else default
    except sqlite3.Error:
        return default


def set_system_setting(key: str, value: str) -> None:
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            INSERT INTO system_settings (key, value, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
            """,
            (key, value, now_iso()),
        )


def public_access_locked() -> bool:
    default_value = "1" if public_access_mode() else "0"
    return get_system_setting("public_access_locked", default_value) == "1"


def show_demo_credentials() -> bool:
    if os.environ.get("AEIS_SHOW_DEMO_CREDENTIALS") is not None:
        return env_flag("AEIS_SHOW_DEMO_CREDENTIALS", False)
    return not public_access_locked()


def remote_county_demo_enabled() -> bool:
    if os.environ.get("AEIS_ALLOW_REMOTE_DEMO") is not None:
        return env_flag("AEIS_ALLOW_REMOTE_DEMO", False)
    return not public_access_locked()

NATIONAL_AUTH_ACCOUNTS = [
    {
        "county_code": "000",
        "county_name": "National",
        "username": "ministry_command",
        "email": "ministry.command@aeis-k.local",
        "role": "ministry",
        "provider": "password",
        "password": DEFAULT_MINISTRY_PASSWORD,
        "command_center": "AEIS-K National Command Center",
        "boundary_scope": "national",
        "permissions": [
            "national_command_center",
            "all_county_read",
            "county_user_manage",
            "report_generate",
            "audit_read",
        ],
    },
    {
        "county_code": "000",
        "county_name": "National",
        "username": "national_analyst",
        "email": "national.analyst@aeis-k.local",
        "role": "analyst",
        "provider": "password",
        "password": DEFAULT_ANALYST_PASSWORD,
        "command_center": "AEIS-K National Intelligence Analyst",
        "boundary_scope": "national_read_only",
        "permissions": [
            "all_county_read",
            "map_intelligence_read",
            "report_read",
            "weather_read",
        ],
    },
]

KENYA_COUNTY_NAMES = [
    "Mombasa",
    "Kwale",
    "Kilifi",
    "Tana River",
    "Lamu",
    "Taita Taveta",
    "Garissa",
    "Wajir",
    "Mandera",
    "Marsabit",
    "Isiolo",
    "Meru",
    "Tharaka-Nithi",
    "Embu",
    "Kitui",
    "Machakos",
    "Makueni",
    "Nyandarua",
    "Nyeri",
    "Kirinyaga",
    "Murang'a",
    "Kiambu",
    "Turkana",
    "West Pokot",
    "Samburu",
    "Trans Nzoia",
    "Uasin Gishu",
    "Elgeyo-Marakwet",
    "Nandi",
    "Baringo",
    "Laikipia",
    "Nakuru",
    "Narok",
    "Kajiado",
    "Kericho",
    "Bomet",
    "Kakamega",
    "Vihiga",
    "Bungoma",
    "Busia",
    "Siaya",
    "Kisumu",
    "Homa Bay",
    "Migori",
    "Kisii",
    "Nyamira",
    "Nairobi",
]

_GEOJSON_CACHE: dict[str, dict] = {}
_COUNTY_WARD_CACHE: dict[str, int] = {}
_WARD_CENTER_CACHE: list[tuple[float, float]] | None = None
_OSM_SEGMENT_CACHE: dict[str, dict] = {}
_WEATHER_CACHE: dict[str, dict] = {}

GEE_LAYER_CONFIG = {
    "geeNdvi": {
        "label": "GEE Sentinel-2 NDVI",
        "env": "AEIS_GEE_NDVI_TILE_URL",
        "type": "vegetation",
        "opacity": 0.72,
        "note": "Earth Engine Sentinel-2 NDVI tile URL from image.getMapId(...).tile_fetcher.url_format.",
    },
    "geeNdwi": {
        "label": "GEE Sentinel-2 NDWI",
        "env": "AEIS_GEE_NDWI_TILE_URL",
        "type": "moisture",
        "opacity": 0.72,
        "note": "Earth Engine Sentinel-2 NDWI or agricultural NDWI tile URL from an authenticated backend.",
    },
    "geeLst": {
        "label": "GEE Landsat LST",
        "env": "AEIS_GEE_LST_TILE_URL",
        "type": "thermal",
        "opacity": 0.68,
        "note": "Earth Engine Landsat land-surface-temperature tile URL from an authenticated backend.",
    },
}

DASHBOARD_ALERTS = []

DASHBOARD_REPORTS = []


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def expiry_iso(seconds: int = SESSION_SECONDS) -> str:
    return (datetime.now(timezone.utc) + timedelta(seconds=seconds)).isoformat()


def parse_iso(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed


def remaining_seconds(expires_at: str) -> int:
    try:
        return max(0, int((parse_iso(expires_at) - datetime.now(timezone.utc)).total_seconds()))
    except (TypeError, ValueError):
        return 0


def dashboard_county_names() -> list[str]:
    try:
        available = {county_name(feature) for feature in counties() if county_name(feature) != "Unknown"}
        ordered = [name for name in KENYA_COUNTY_NAMES if name in available]
        if ordered:
            return ordered
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        pass
    return KENYA_COUNTY_NAMES


def dashboard_source_required_intelligence(county: str) -> dict:
    return {
        "priority": "Source required",
        "riskScore": None,
        "confidenceScore": None,
        "actionWindow": "Blocked until source",
        "verificationCoverage": None,
        "drivers": [
            {"label": "Admin boundary", "value": "Loaded from GeoJSON"},
            {"label": "Live forecast", "value": "Shown below map"},
            {"label": "NDVI/NDWI values", "value": "Source required"},
            {"label": "Farmer registry", "value": "Source required"},
        ],
        "sourceReadiness": [
            {"label": "Admin boundaries", "score": 100, "status": "Loaded"},
            {"label": "Live weather forecast", "score": 100, "status": "Connected"},
            {"label": "County farmer registry", "score": 0, "status": "Source required"},
            {"label": "NDVI/NDWI raster source", "score": 0, "status": "Source required"},
            {"label": "Land-cover classification", "score": 0, "status": "Source required"},
        ],
        "anomalyFlags": [
            {
                "type": "Operational analytics",
                "detail": "No county stress, NDVI, NDWI, rainfall-history, or fertilizer decisions are published without a connected source.",
                "tone": "medium",
            }
        ],
        "recommendations": [
            {
                "priority": "Required",
                "title": "Connect official data",
                "detail": f"Connect {county} farmer registry, farm boundaries, NDVI/NDWI rasters, land-cover classification, and official rainfall history before publishing county decisions.",
            }
        ],
    }


def dashboard_source_required_stats(county: str, county_number: int, county_code_display: str) -> dict:
    return {
        "registeredFarms": None,
        "mappedAreaHa": None,
        "averageNdvi": None,
        "cropStressLevel": "Source required",
        "rainfallRisk": "Live forecast below map",
        "fertilizerDemandTonnes": None,
        "croplandPct": None,
        "bareLandPct": None,
        "builtUpPct": None,
        "grasslandPct": None,
        "moistureStatus": "Source required",
        "rainfallForecastMm": None,
        "cropStressScore": None,
        "averageRainfall": None,
        "rainfallHistory": [],
        "rainfallDataSource": "Source required: official historical rainfall feed not connected",
        "trends": [],
        "farmerRegistrationTrend": [],
        "subcountyFarmDistribution": [],
        "imageryStatus": {
            "satellite": "Real map imagery available",
            "ndvi": "Connect GEE/Sentinel/Landsat raster provider for county NDVI values",
            "ndwi": "Connect GEE/Sentinel/Landsat raster provider for county NDWI values",
        },
        "countyRank": county_number,
        "countyNumber": county_number,
        "countyCode": county_code_display,
        "intelligence": dashboard_source_required_intelligence(county),
    }


def dashboard_county_rows() -> list[dict]:
    rows = []
    for index, name in enumerate(dashboard_county_names()):
        county_number = index + 1
        county_code_display = f"{county_number:03d}"
        stats = dashboard_source_required_stats(name, county_number, county_code_display)
        rows.append(
            {
                "name": name,
                "countyNumber": county_number,
                "countyCode": county_code_display,
                "displayName": f"{county_code_display} {name}",
                "stats": stats,
            }
        )
    return rows


def dashboard_summary_payload() -> dict:
    county_rows = dashboard_county_rows()
    count = len(county_rows)
    return {
        "summary": {
            "title": "AEIS-K Intelligence Dashboard",
            "subtitle": "Agro-Environmental Intelligence System for Kenya",
            "registeredFarms": None,
            "totalMappedAreaHa": None,
            "averageNdvi": None,
            "cropStressLevel": "Source required",
            "rainfallRisk": "Live forecast below map",
            "fertilizerDemandTonnes": None,
            "croplandPct": None,
            "bareLandPct": None,
            "builtUpPct": None,
            "grasslandPct": None,
            "reportsReady": 0,
            "countiesTracked": count,
            "rainfallDataStatus": "Live forecast connected; official historical station feed required",
        },
        "counties": county_rows,
        "generated_at": now_iso(),
    }


def dashboard_county_payload(identifier: str) -> tuple[int, dict]:
    needle = unquote(identifier).strip().lower()
    for county in dashboard_county_rows():
        if county["name"].lower() == needle:
            return 200, {"county": county, "generated_at": now_iso()}
    return 404, {"error": "County dashboard data not found", "county": identifier}


def active_session_count(county_name_value: str | None = None) -> int:
    try:
        with sqlite3.connect(DB_PATH) as conn:
            if county_name_value:
                row = conn.execute(
                    "SELECT COUNT(*) FROM county_sessions WHERE expires_at > ? AND county_name = ?",
                    (now_iso(), county_name_value),
                ).fetchone()
            else:
                row = conn.execute(
                    "SELECT COUNT(*) FROM county_sessions WHERE expires_at > ?",
                    (now_iso(),),
                ).fetchone()
        return int(row[0] if row else 0)
    except sqlite3.Error:
        return 0


def realtime_operations_payload(identifier: str | None = None) -> dict:
    county_rows = dashboard_county_rows()
    selected = None
    if identifier:
        needle = unquote(identifier).strip().lower()
        selected = next(
            (
                row
                for row in county_rows
                if row["name"].lower() == needle
                or row["countyCode"].lower() == needle
                or f"ke{row['countyCode']}".lower() == needle
            ),
            None,
        )

    now = datetime.now(timezone.utc)
    gee_status = gee_layers_payload()
    scope_name = selected["displayName"] if selected else "National Command Center"
    scope_county = selected["name"] if selected else "Kenya"
    scope_code = selected["countyCode"] if selected else "000"
    events = [
        {
            "id": "SRC-BOUNDARIES",
            "time": now.isoformat(),
            "county": scope_county,
            "county_code": scope_code,
            "signal": "Boundaries",
            "severity": "Low",
            "message": "County, sub-county, and ward boundaries are loaded from local GeoJSON.",
        },
        {
            "id": "SRC-WEATHER",
            "time": now.isoformat(),
            "county": scope_county,
            "county_code": scope_code,
            "signal": "Weather",
            "severity": "Low",
            "message": "Live forecast is available below the map from the weather endpoint.",
        },
        {
            "id": "SRC-GEE",
            "time": now.isoformat(),
            "county": scope_county,
            "county_code": scope_code,
            "signal": "GEE",
            "severity": "Medium" if gee_status["configured_layers"] == 0 else "Low",
            "message": f"{gee_status['configured_layers']} Google Earth Engine raster layer(s) configured.",
        },
        {
            "id": "SRC-OPS",
            "time": now.isoformat(),
            "county": scope_county,
            "county_code": scope_code,
            "signal": "Operational alerts",
            "severity": "Medium",
            "message": "No official operational alert feed is connected yet.",
        },
    ]

    return {
        "mode": "source_status",
        "scope": scope_name,
        "generated_at": now.isoformat(),
        "refresh_seconds": 60,
        "metrics": {
            "activeCountySessions": active_session_count(selected["name"] if selected else None),
            "forecastStatus": "Connected",
            "geeLayersConfigured": gee_status["configured_layers"],
            "alertFeedStatus": "Source required",
            "ingestedCounties": 1 if selected else len(county_rows),
        },
        "events": events,
        "source_note": "Rainfall, NDVI, NDWI, crop-stress, fertilizer, and farmer-registry events require official connected feeds before they are published.",
    }


def local_lan_ip() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.connect(("8.8.8.8", 80))
            return probe.getsockname()[0]
    except OSError:
        try:
            return socket.gethostbyname(socket.gethostname())
        except OSError:
            return "127.0.0.1"


def system_access_payload() -> dict:
    lan_ip = local_lan_ip()
    reveal_demo = show_demo_credentials()
    return {
        "host": socket.gethostname(),
        "lan_ip": lan_ip,
        "live_url": f"http://{lan_ip}:5000",
        "local_live_url": "http://127.0.0.1:5000",
        "frontend_dev_url": f"http://{lan_ip}:5173",
        "backend_url": f"http://{lan_ip}:5000",
        "public_url": os.environ.get("AEIS_PUBLIC_URL", "").strip(),
        "public_access": {
            "enabled": public_access_mode(),
            "locked": public_access_locked(),
            "show_demo_credentials": reveal_demo,
            "remote_county_demo_enabled": remote_county_demo_enabled(),
            "lock_meaning": "Locked public mode hides test passwords and blocks remote county GPS bypass.",
        },
        "same_network": "Other machines on the same Wi-Fi/LAN can use the live URL when firewall allows port 5000.",
        "outside_network": "Use start-public-tunnel.ps1 to publish a temporary HTTPS Cloudflare Quick Tunnel link for outside-network testing.",
        "demo_county_password": DEFAULT_COUNTY_PASSWORD if reveal_demo else "",
        "demo_ministry_password": DEFAULT_MINISTRY_PASSWORD if reveal_demo else "",
        "demo_analyst_password": DEFAULT_ANALYST_PASSWORD if reveal_demo else "",
        "national_demo_logins": [
            {
                "role": account["role"],
                "email": account["email"],
                "username": account["username"],
                "password": account["password"] if reveal_demo else "",
                "command_center": account["command_center"],
                "boundary_scope": account["boundary_scope"],
            }
            for account in NATIONAL_AUTH_ACCOUNTS
        ],
        "county_login": "Choose county, use the auto-filled county email, enter the county password, then approve browser GPS or remote demo access.",
        "national_login": "Use an approved national officer or analyst email with password. National sessions are audited in SQLite.",
        "live_mode": "Run npm build for the frontend, then run python backend/app.py. The backend serves the built dashboard and API from one URL.",
    }


def gee_layers_payload() -> dict:
    layers = {}
    configured_count = 0
    for key, config in GEE_LAYER_CONFIG.items():
        url_template = os.environ.get(config["env"], "").strip()
        configured = bool(url_template)
        if configured:
            configured_count += 1
        layers[key] = {
            "key": key,
            "label": config["label"],
            "type": config["type"],
            "provider": "Google Earth Engine",
            "configured": configured,
            "tile_url": url_template if configured else "",
            "opacity": config["opacity"],
            "env": config["env"],
            "note": config["note"],
        }

    return {
        "provider": "Google Earth Engine",
        "status": "connected" if configured_count else "not_configured",
        "configured_layers": configured_count,
        "layers": layers,
        "setup": {
            "required": [
                "Google Cloud project with Earth Engine API enabled",
                "Earth Engine account or service account registered for Earth Engine",
                "Backend-generated tile_fetcher.url_format for each visualization layer",
            ],
            "environment_variables": [config["env"] for config in GEE_LAYER_CONFIG.values()],
        },
        "generated_at": now_iso(),
    }


WEATHER_CODE_LABELS = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    71: "Slight snow",
    73: "Moderate snow",
    75: "Heavy snow",
    80: "Slight rain showers",
    81: "Moderate rain showers",
    82: "Violent rain showers",
    95: "Thunderstorm",
    96: "Thunderstorm with hail",
    99: "Severe thunderstorm with hail",
}


def weather_code_label(code: int | None) -> str:
    if code is None:
        return "Unavailable"
    return WEATHER_CODE_LABELS.get(int(code), f"Weather code {code}")


def weather_risk(daily: list[dict]) -> str:
    if not daily:
        return "Unavailable"
    max_probability = max((row.get("precipitation_probability_max") or 0) for row in daily[:3])
    max_rain = max((row.get("precipitation_sum") or 0) for row in daily[:3])
    max_temp = max((row.get("temperature_2m_max") or 0) for row in daily[:3])
    max_wind = max((row.get("wind_speed_10m_max") or 0) for row in daily[:3])
    if max_rain >= 35 or max_probability >= 80 or max_wind >= 45:
        return "High"
    if max_temp >= 34 and max_rain < 5:
        return "Heat / dry watch"
    if max_rain >= 12 or max_probability >= 55:
        return "Medium"
    return "Low"


def weather_advisory(risk: str, daily: list[dict]) -> str:
    next_rain = sum((row.get("precipitation_sum") or 0) for row in daily[:3])
    if risk == "High":
        return "Issue rainfall watch, protect fertilizer distribution from runoff risk, and prepare field advisories."
    if risk == "Heat / dry watch":
        return "Prioritize moisture conservation advice and delay nitrogen-heavy recommendations until rain improves."
    if risk == "Medium":
        return "Proceed with advisory planning, but verify rain timing before top-dressing or spraying operations."
    if next_rain <= 2:
        return "Low rainfall expected in the next three days; monitor moisture stress and irrigation demand."
    return "Favorable short-term forecast; continue staged county operations and routine monitoring."


def county_weather_center(feature: dict) -> tuple[float, float]:
    west, south, east, north = bbox(feature)
    return round((south + north) / 2, 5), round((west + east) / 2, 5)


def open_meteo_url(latitude: float, longitude: float) -> str:
    query = urlencode(
        {
            "latitude": latitude,
            "longitude": longitude,
            "current": "temperature_2m,relative_humidity_2m,precipitation,rain,weather_code,wind_speed_10m",
            "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max",
            "forecast_days": 7,
            "timezone": "Africa/Nairobi",
        }
    )
    return f"https://api.open-meteo.com/v1/forecast?{query}"


def parse_open_meteo_daily(payload: dict) -> list[dict]:
    daily = payload.get("daily") or {}
    dates = daily.get("time") or []
    rows = []
    for index, date in enumerate(dates):
        code = (daily.get("weather_code") or [None] * len(dates))[index]
        row = {
            "date": date,
            "condition": weather_code_label(code),
            "weather_code": code,
            "temperature_2m_max": (daily.get("temperature_2m_max") or [None] * len(dates))[index],
            "temperature_2m_min": (daily.get("temperature_2m_min") or [None] * len(dates))[index],
            "precipitation_sum": (daily.get("precipitation_sum") or [None] * len(dates))[index],
            "precipitation_probability_max": (daily.get("precipitation_probability_max") or [None] * len(dates))[index],
            "wind_speed_10m_max": (daily.get("wind_speed_10m_max") or [None] * len(dates))[index],
        }
        rows.append(row)
    return rows


def fetch_weather_for_county(feature: dict) -> dict:
    name = county_name(feature)
    code = county_code(feature)
    cache_key = f"weather:{code}"
    cached = _WEATHER_CACHE.get(cache_key)
    if cached and (datetime.now(timezone.utc) - parse_iso(cached["cached_at"])).total_seconds() < 900:
        return {**cached["payload"], "cached": True}

    latitude, longitude = county_weather_center(feature)
    try:
        request = Request(
            open_meteo_url(latitude, longitude),
            headers={"User-Agent": "AEIS-K/0.1 county weather forecast"},
        )
        with urlopen(request, timeout=12) as response:
            provider_payload = json.loads(response.read().decode("utf-8"))
        current = provider_payload.get("current") or {}
        daily = parse_open_meteo_daily(provider_payload)
        risk = weather_risk(daily)
        result = {
            "provider": "Open-Meteo forecast API",
            "provider_status": "live",
            "source_url": "https://open-meteo.com/en/docs",
            "county": name,
            "county_code": code,
            "latitude": latitude,
            "longitude": longitude,
            "current": {
                "time": current.get("time"),
                "temperature_2m": current.get("temperature_2m"),
                "relative_humidity_2m": current.get("relative_humidity_2m"),
                "precipitation": current.get("precipitation"),
                "rain": current.get("rain"),
                "weather_code": current.get("weather_code"),
                "condition": weather_code_label(current.get("weather_code")),
                "wind_speed_10m": current.get("wind_speed_10m"),
            },
            "daily": daily,
            "risk": risk,
            "advisory": weather_advisory(risk, daily),
            "generated_at": now_iso(),
            "cached": False,
        }
        _WEATHER_CACHE[cache_key] = {"cached_at": now_iso(), "payload": result}
        return result
    except (HTTPError, URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError) as exc:
        return {
            "provider": "Open-Meteo forecast API",
            "provider_status": "unavailable",
            "county": name,
            "county_code": code,
            "latitude": latitude,
            "longitude": longitude,
            "current": {},
            "daily": [],
            "risk": "Unavailable",
            "advisory": "Live forecast provider is unavailable. Use county station reports or retry.",
            "error": str(exc),
            "generated_at": now_iso(),
            "cached": False,
        }


def weather_forecast_payload(identifier: str | None = None) -> tuple[int, dict]:
    if identifier:
        feature = find_county(identifier)
        if not feature:
            return 404, {"error": "County not found", "county": identifier}
        forecast = fetch_weather_for_county(feature)
        return 200, {
            "mode": "county_live_forecast",
            "provider": forecast["provider"],
            "provider_status": forecast["provider_status"],
            "forecast": forecast,
            "generated_at": now_iso(),
        }

    features = sorted(counties(), key=lambda feature: county_code(feature))
    forecasts = []
    with ThreadPoolExecutor(max_workers=8) as executor:
        future_map = {executor.submit(fetch_weather_for_county, feature): feature for feature in features}
        for future in as_completed(future_map):
            forecasts.append(future.result())

    forecasts.sort(key=lambda row: row.get("county_code") or "")
    live_count = sum(1 for row in forecasts if row.get("provider_status") == "live")
    watch_counties = [
        row
        for row in forecasts
        if row.get("risk") in {"High", "Medium", "Heat / dry watch"}
    ][:10]
    total_rain = sum(
        sum((day.get("precipitation_sum") or 0) for day in row.get("daily", [])[:3])
        for row in forecasts
    )

    return 200, {
        "mode": "national_live_forecast",
        "provider": "Open-Meteo forecast API",
        "provider_status": "live" if live_count else "unavailable",
        "summary": {
            "counties": len(forecasts),
            "live_counties": live_count,
            "watch_counties": len(watch_counties),
            "three_day_rainfall_total_mm": round(total_rain, 1),
        },
        "watch_counties": watch_counties,
        "counties": forecasts,
        "generated_at": now_iso(),
    }


def classify_ndvi_value(value: float) -> dict:
    if value < 0.15:
        return {
            "label": "Non-crop / bare signal",
            "tone": "high",
            "meaning": "Likely water, built-up area, bare ground, cloud shadow, or crop failure. Verify with source imagery.",
        }
    if value < 0.35:
        return {
            "label": "Sparse or stressed vegetation",
            "tone": "high",
            "meaning": "Weak canopy activity. Could be early crop stage, harvested field, dry crop, or degraded vegetation.",
        }
    if value < 0.55:
        return {
            "label": "Moderate vegetation",
            "tone": "medium",
            "meaning": "Crop cover exists, but vigor is not strong. Compare with crop calendar and rainfall.",
        }
    if value < 0.72:
        return {
            "label": "Healthy crop canopy",
            "tone": "low",
            "meaning": "Strong greenness and active vegetation signal.",
        }
    return {
        "label": "Very dense vegetation",
        "tone": "low",
        "meaning": "Very strong vegetation signal. Confirm crop versus forest or wet vegetation.",
    }


def classify_ndwi_value(value: float) -> dict:
    if value < 0:
        return {
            "label": "Very dry canopy",
            "tone": "high",
            "meaning": "Strong water-stress signal. Avoid nitrogen-heavy recommendations until moisture improves.",
        }
    if value < 0.15:
        return {
            "label": "Low crop moisture",
            "tone": "high",
            "meaning": "Canopy water is low. Check rainfall, irrigation, and soil moisture before fertilizer action.",
        }
    if value < 0.35:
        return {
            "label": "Adequate moisture",
            "tone": "low",
            "meaning": "Moisture signal is generally acceptable for active crop growth.",
        }
    if value < 0.55:
        return {
            "label": "High moisture",
            "tone": "medium",
            "meaning": "Moisture is high. Check wet soils, waterlogging, wetlands, or recent rain.",
        }
    return {
        "label": "Very high water signal",
        "tone": "medium",
        "meaning": "Very wet signal. Verify water bodies, clouds, wetlands, or saturated fields.",
    }


def index_action(ndvi: float, ndwi: float) -> str:
    if ndvi < 0.35 and ndwi < 0.15:
        return "High stress. Validate fields, issue moisture advisory, and delay top-dressing until water status improves."
    if ndvi >= 0.55 and ndwi < 0.15:
        return "Green canopy but moisture is weak. Monitor closely and delay nitrogen-heavy action until moisture is confirmed."
    if ndvi >= 0.55 and 0.15 <= ndwi <= 0.55:
        return "Vegetation and moisture support staged fertilizer planning, subject to crop stage and soil test verification."
    if ndwi > 0.55:
        return "Verify waterlogging, wetland, cloud, or water contamination before using this as crop health evidence."
    return "Use as planning evidence with rainfall, crop calendar, field reports, and raster metadata."


def evaluate_indices_payload(payload: dict) -> tuple[int, dict]:
    try:
        nir = float(payload.get("nir"))
        red = float(payload.get("red"))
        swir = float(payload.get("swir"))
    except (TypeError, ValueError):
        return 400, {"error": "nir, red, and swir numeric reflectance values are required"}

    ndvi_denominator = nir + red
    ndwi_denominator = nir + swir
    if ndvi_denominator == 0 or ndwi_denominator == 0:
        return 400, {"error": "Band denominators cannot be zero"}

    ndvi = round((nir - red) / ndvi_denominator, 3)
    ndwi = round((nir - swir) / ndwi_denominator, 3)
    cloud_cover = payload.get("cloud_cover")
    try:
        cloud_cover_value = float(cloud_cover) if cloud_cover is not None else None
    except (TypeError, ValueError):
        cloud_cover_value = None

    confidence = 88
    warnings = []
    if cloud_cover_value is not None and cloud_cover_value > 20:
        confidence -= min(35, int(cloud_cover_value - 20))
        warnings.append("Cloud cover is high; verify masked pixels before operational use.")
    if not payload.get("acquired_at"):
        confidence -= 12
        warnings.append("Acquisition date is missing.")
    if not payload.get("source"):
        confidence -= 10
        warnings.append("Raster source or sensor name is missing.")

    stress_score = int(
        round(
            max(
                0,
                min(
                    100,
                    (1 - ndvi) * 42 + max(0, 0.28 - ndwi) * 92,
                ),
            )
        )
    )

    return 200, {
        "mode": "actual_band_evaluation",
        "county": payload.get("county") or "",
        "source": payload.get("source") or "unspecified",
        "acquired_at": payload.get("acquired_at") or "",
        "cloud_cover": cloud_cover_value,
        "inputs": {"nir": nir, "red": red, "swir": swir},
        "indices": {
            "ndvi": ndvi,
            "ndwi": ndwi,
            "ndvi_formula": "NDVI = (NIR - Red) / (NIR + Red)",
            "ndwi_formula": "Agricultural NDWI = (NIR - SWIR) / (NIR + SWIR)",
        },
        "classification": {
            "ndvi": classify_ndvi_value(ndvi),
            "ndwi": classify_ndwi_value(ndwi),
            "stress_score": stress_score,
            "outcome": "High stress outcome" if stress_score >= 68 else "Watch outcome" if stress_score >= 45 else "Operationally healthy outcome",
        },
        "action": index_action(ndvi, ndwi),
        "confidence": max(20, min(95, confidence)),
        "warnings": warnings,
        "generated_at": now_iso(),
    }


def system_actualization_payload() -> dict:
    county_count = len(dashboard_county_rows())
    active_sessions = active_session_count()
    providers = [
        {
            "name": "County boundaries and official county codes",
            "status": "actual",
            "readiness": 95,
            "evidence": f"{county_count} counties loaded with 001-047 county codes",
        },
        {
            "name": "County login, sessions, and audit",
            "status": "actual",
            "readiness": 88,
            "evidence": f"SQLite auth active; {active_sessions} active county sessions",
        },
        {
            "name": "NDVI/NDWI interpretation engine",
            "status": "actualizable",
            "readiness": 72,
            "evidence": "Formula-based evaluator is ready for NIR/Red/SWIR raster band values",
        },
        {
            "name": "NDVI/NDWI raster source",
            "status": "provider_needed",
            "readiness": 42,
            "evidence": "Connect Sentinel-2, Landsat, drone, or Earth Engine raster bands for actual pixel-backed outputs",
        },
        {
            "name": "Rainfall and weather observations",
            "status": "actualizable",
            "readiness": 68,
            "evidence": "Open-Meteo live forecast endpoint connected; official county station/KMD feed still recommended",
        },
        {
            "name": "Farmer registry and farm boundaries",
            "status": "baseline",
            "readiness": 55,
            "evidence": "County-level baseline exists; replace with verified county farm records",
        },
        {
            "name": "Reports and exports",
            "status": "partial",
            "readiness": 58,
            "evidence": "Report workflow exists; final PDF/Excel generation remains a production task",
        },
    ]
    readiness = round(sum(row["readiness"] for row in providers) / len(providers))
    blockers = [
        "Connect actual NDVI/NDWI raster bands with source date, cloud mask, sensor, and processing method.",
        "Connect official rainfall/weather provider or county station observations.",
        "Replace baseline farmer counts with verified county farmer registry and farm boundaries.",
        "Move demo passwords to a production identity provider or managed password reset workflow.",
    ]
    next_actions = [
        "Use /api/indices/evaluate to validate real band values from a sample county raster.",
        "Start with Nyandarua actual raster sample, then compare AEIS-K outcome against field reports.",
        "Keep demo remote access for presentation only; use GPS/login audit for operational county access.",
    ]
    return {
        "mode": "actualization_readiness",
        "system": "AEIS-K Intelligence Dashboard",
        "readiness": readiness,
        "status": "field_test_ready" if readiness >= 65 else "setup_in_progress",
        "providers": providers,
        "blockers": blockers,
        "next_actions": next_actions,
        "index_evaluator": {
            "endpoint": "/api/indices/evaluate",
            "method": "POST",
            "required_fields": ["nir", "red", "swir"],
            "optional_fields": ["county", "source", "acquired_at", "cloud_cover"],
        },
        "generated_at": now_iso(),
    }


def slugify(value: str) -> str:
    text = re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")
    return text or "county"


def password_hash(password: str, salt: str) -> str:
    return hashlib.sha256(f"{salt}:{password}".encode("utf-8")).hexdigest()


def county_email(name: str) -> str:
    return f"{slugify(name)}@county.aeis-k.local"


def sqlite_columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {row[1] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}


def init_auth_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS county_users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                county_code TEXT NOT NULL,
                county_name TEXT NOT NULL,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                salt TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'county',
                created_at TEXT NOT NULL
            )
            """
        )
        user_columns = sqlite_columns(conn, "county_users")
        if "email" not in user_columns:
            conn.execute("ALTER TABLE county_users ADD COLUMN email TEXT")
        if "provider" not in user_columns:
            conn.execute("ALTER TABLE county_users ADD COLUMN provider TEXT NOT NULL DEFAULT 'password'")
        if "is_active" not in user_columns:
            conn.execute("ALTER TABLE county_users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1")

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS county_sessions (
                token TEXT PRIMARY KEY,
                county_code TEXT NOT NULL,
                county_name TEXT NOT NULL,
                username TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'county',
                latitude REAL NOT NULL,
                longitude REAL NOT NULL,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL
            )
            """
        )
        session_columns = sqlite_columns(conn, "county_sessions")
        if "email" not in session_columns:
            conn.execute("ALTER TABLE county_sessions ADD COLUMN email TEXT")
        if "provider" not in session_columns:
            conn.execute("ALTER TABLE county_sessions ADD COLUMN provider TEXT NOT NULL DEFAULT 'password'")

        conn.execute("UPDATE county_users SET county_code = substr(county_code, -3) WHERE county_code LIKE 'KE___'")
        conn.execute("UPDATE county_sessions SET county_code = substr(county_code, -3) WHERE county_code LIKE 'KE___'")

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS auth_audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_type TEXT NOT NULL,
                status TEXT NOT NULL,
                county_code TEXT,
                county_name TEXT,
                username TEXT,
                email TEXT,
                role TEXT,
                provider TEXT,
                latitude REAL,
                longitude REAL,
                ip_address TEXT,
                user_agent TEXT,
                reason TEXT,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS system_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        if not conn.execute("SELECT 1 FROM system_settings WHERE key = 'public_access_locked'").fetchone():
            conn.execute(
                "INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)",
                ("public_access_locked", "1" if public_access_mode() else "0", now_iso()),
            )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_auth_audit_created_at ON auth_audit_log (created_at)"
        )
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_county_users_email ON county_users (email)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_county_users_role ON county_users (role)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_county_sessions_expires_at ON county_sessions (expires_at)"
        )
        conn.execute("DELETE FROM county_sessions WHERE expires_at <= ?", (now_iso(),))

        existing_codes = {
            row[0]
            for row in conn.execute("SELECT county_code FROM county_users").fetchall()
        }

        for feature in counties():
            name = county_name(feature)
            code = county_code(feature)
            if code in existing_codes:
                continue

            salt = secrets.token_hex(12)
            username = f"{slugify(name)}_county"
            email = county_email(name)
            conn.execute(
                """
                INSERT INTO county_users
                    (county_code, county_name, username, email, password_hash, salt, role, provider, is_active, created_at)
                VALUES (?, ?, ?, ?, ?, ?, 'county', 'password', 1, ?)
                """,
                (code, name, username, email, password_hash(DEFAULT_COUNTY_PASSWORD, salt), salt, now_iso()),
            )

        for row in conn.execute("SELECT id, county_name FROM county_users WHERE email IS NULL OR email = ''").fetchall():
            conn.execute("UPDATE county_users SET email = ? WHERE id = ?", (county_email(row[1]), row[0]))

        for account in NATIONAL_AUTH_ACCOUNTS:
            existing = conn.execute(
                """
                SELECT id FROM county_users
                WHERE lower(email) = lower(?) OR lower(username) = lower(?)
                """,
                (account["email"], account["username"]),
            ).fetchone()
            if existing:
                conn.execute(
                    """
                    UPDATE county_users
                    SET county_code = ?, county_name = ?, role = ?, provider = ?, is_active = 1
                    WHERE id = ?
                    """,
                    (
                        account["county_code"],
                        account["county_name"],
                        account["role"],
                        account["provider"],
                        existing[0],
                    ),
                )
                continue

            salt = secrets.token_hex(12)
            conn.execute(
                """
                INSERT INTO county_users
                    (county_code, county_name, username, email, password_hash, salt, role, provider, is_active, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
                """,
                (
                    account["county_code"],
                    account["county_name"],
                    account["username"],
                    account["email"],
                    password_hash(account["password"], salt),
                    salt,
                    account["role"],
                    account["provider"],
                    now_iso(),
                ),
            )


def national_account_for_role(role: str) -> dict | None:
    normalized = str(role or "").lower()
    return next((account for account in NATIONAL_AUTH_ACCOUNTS if account["role"] == normalized), None)


def county_session_payload(row: sqlite3.Row) -> dict:
    national_account = national_account_for_role(row["role"])
    if national_account:
        return {
            "token": row["token"],
            "role": row["role"],
            "county": "",
            "county_code": "",
            "username": row["username"],
            "email": row["email"],
            "provider": row["provider"],
            "command_center": national_account["command_center"],
            "gps_status": "not_required",
            "boundary_scope": national_account["boundary_scope"],
            "permissions": national_account["permissions"],
            "expires_at": row["expires_at"],
            "expires_in_seconds": remaining_seconds(row["expires_at"]),
        }

    demo_remote_access = row["provider"] == "password_demo"
    return {
        "token": row["token"],
        "role": row["role"],
        "county": row["county_name"],
        "county_code": row["county_code"],
        "username": row["username"],
        "email": row["email"],
        "provider": row["provider"],
        "command_center": f"{row['county_name']} County Command Center",
        "gps_status": "demo_remote_access" if demo_remote_access else "inside_county",
        "boundary_scope": "county_demo_remote" if demo_remote_access else "county_only",
        "demo_remote_access": demo_remote_access,
        "permissions": [
            "county_boundary_read",
            "county_intelligence_read",
            "county_farm_tools",
        ],
        "expires_at": row["expires_at"],
        "expires_in_seconds": remaining_seconds(row["expires_at"]),
    }


def county_login_accounts() -> list[dict]:
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT county_code, county_name, username, email, role, provider, is_active, created_at
            FROM county_users
            WHERE role = 'county'
            ORDER BY county_code
            """
        ).fetchall()

    return [
        {
            "county": row["county_name"],
            "county_code": row["county_code"],
            "username": row["username"],
            "email": row["email"],
            "role": row["role"],
            "provider": row["provider"],
            "is_active": bool(row["is_active"]),
            "command_center": f"{row['county_name']} County Command Center",
            "boundary_scope": "county_only",
            "gps_required": True,
            "created_at": row["created_at"],
        }
        for row in rows
    ]


def national_login_accounts() -> list[dict]:
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT county_code, county_name, username, email, role, provider, is_active, created_at
            FROM county_users
            WHERE role IN ('ministry', 'analyst')
            ORDER BY role DESC, username
            """
        ).fetchall()

    accounts = []
    for row in rows:
        profile = national_account_for_role(row["role"]) or {}
        accounts.append(
            {
                "county": row["county_name"],
                "county_code": row["county_code"],
                "username": row["username"],
                "email": row["email"],
                "role": row["role"],
                "provider": row["provider"],
                "is_active": bool(row["is_active"]),
                "command_center": profile.get("command_center", "AEIS-K National Access"),
                "boundary_scope": profile.get("boundary_scope", "national"),
                "permissions": profile.get("permissions", []),
                "created_at": row["created_at"],
            }
        )
    return accounts


def auth_access_model_payload() -> dict:
    county_accounts = county_login_accounts()
    national_accounts = national_login_accounts()
    reveal_demo = show_demo_credentials()
    return {
        "auth_model": "sqlite_role_based_access_control",
        "storage": str(DB_PATH),
        "session_seconds": SESSION_SECONDS,
        "county_password": DEFAULT_COUNTY_PASSWORD if reveal_demo else "",
        "national_passwords": {
            account["role"]: account["password"] if reveal_demo else "" for account in NATIONAL_AUTH_ACCOUNTS
        },
        "roles": [
            {
                "role": "ministry",
                "label": "Ministry command officer",
                "scope": "National command center",
                "permissions": national_account_for_role("ministry")["permissions"],
            },
            {
                "role": "analyst",
                "label": "National intelligence analyst",
                "scope": "National read-only intelligence",
                "permissions": national_account_for_role("analyst")["permissions"],
            },
            {
                "role": "county",
                "label": "County officer",
                "scope": "Locked county workspace",
                "permissions": ["county_boundary_read", "county_intelligence_read", "county_farm_tools"],
            },
        ],
        "national_accounts": national_accounts,
        "county_accounts": county_accounts,
        "county_account_count": len(county_accounts),
        "audit": {
            "enabled": True,
            "events": ["login", "logout", "invalid_credentials", "outside_county_geofence"],
        },
    }


def audit_auth_event(
    event_type: str,
    status: str,
    *,
    county_code_value: str | None = None,
    county_name_value: str | None = None,
    username: str | None = None,
    email: str | None = None,
    role: str | None = None,
    provider: str | None = None,
    latitude: float | None = None,
    longitude: float | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
    reason: str | None = None,
) -> None:
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            INSERT INTO auth_audit_log
                (event_type, status, county_code, county_name, username, email, role, provider,
                 latitude, longitude, ip_address, user_agent, reason, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                event_type,
                status,
                county_code_value,
                county_name_value,
                username,
                email,
                role,
                provider,
                latitude,
                longitude,
                ip_address,
                user_agent,
                reason,
                now_iso(),
            ),
        )


def auth_audit_log(limit: int = 80) -> list[dict]:
    limit = max(1, min(300, int(limit)))
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT event_type, status, county_code, county_name, username, email, role, provider,
                   latitude, longitude, ip_address, reason, created_at
            FROM auth_audit_log
            ORDER BY id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()

    return [dict(row) for row in rows]


def validate_county_session(payload: dict) -> tuple[int, dict]:
    token = str(payload.get("token") or "").strip()
    if not token:
        return 400, {"error": "token is required"}

    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT * FROM county_sessions WHERE token = ?",
            (token,),
        ).fetchone()

        if not row:
            return 401, {"error": "County session is not active"}

        if remaining_seconds(row["expires_at"]) <= 0:
            conn.execute("DELETE FROM county_sessions WHERE token = ?", (token,))
            return 401, {"error": "County session has expired"}

        return 200, county_session_payload(row)


def logout_county_session(payload: dict) -> tuple[int, dict]:
    token = str(payload.get("token") or "").strip()
    if not token:
        return 400, {"error": "token is required"}

    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute("SELECT * FROM county_sessions WHERE token = ?", (token,)).fetchone()
        conn.execute("DELETE FROM county_sessions WHERE token = ?", (token,))

    if row:
        audit_auth_event(
            "logout",
            "success",
            county_code_value=row["county_code"],
            county_name_value=row["county_name"],
            username=row["username"],
            email=row["email"],
            role=row["role"],
            provider=row["provider"],
            latitude=row["latitude"],
            longitude=row["longitude"],
            ip_address=payload.get("_client_ip"),
            user_agent=payload.get("_user_agent"),
        )

    return 200, {"status": "signed_out"}


def session_row_for_token(token: str) -> sqlite3.Row | None:
    if not token:
        return None

    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute("SELECT * FROM county_sessions WHERE token = ?", (token,)).fetchone()
        if row and remaining_seconds(row["expires_at"]) <= 0:
            conn.execute("DELETE FROM county_sessions WHERE token = ?", (token,))
            return None
        return row


def update_public_access_payload(payload: dict) -> tuple[int, dict]:
    token = str(payload.get("token") or "").strip()
    row = session_row_for_token(token)
    if not row:
        return 401, {"error": "A valid Ministry session token is required"}
    if row["role"] != "ministry":
        return 403, {"error": "Only Ministry command sessions can change public access lock"}

    locked = bool(payload.get("locked", True))
    set_system_setting("public_access_locked", "1" if locked else "0")
    audit_auth_event(
        "public_access_lock",
        "success",
        county_code_value=row["county_code"],
        county_name_value=row["county_name"],
        username=row["username"],
        email=row["email"],
        role=row["role"],
        provider=row["provider"],
        ip_address=payload.get("_client_ip"),
        user_agent=payload.get("_user_agent"),
        reason="locked" if locked else "unlocked",
    )
    access = system_access_payload()["public_access"]
    return 200, {"status": "locked" if locked else "unlocked", "public_access": access, "generated_at": now_iso()}


def authenticate_national_login(payload: dict) -> tuple[int, dict]:
    identifier = str(payload.get("email") or payload.get("username") or "").strip()
    password = str(payload.get("password") or "")

    if not identifier or not password:
        return 400, {"error": "national email or username and password are required"}

    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            """
            SELECT * FROM county_users
            WHERE role IN ('ministry', 'analyst')
              AND is_active = 1
              AND (lower(email) = lower(?) OR lower(username) = lower(?))
            """,
            (identifier, identifier),
        ).fetchone()

    if not row or password_hash(password, row["salt"]) != row["password_hash"]:
        audit_auth_event(
            "login",
            "failed",
            county_code_value="000",
            county_name_value="National",
            email=identifier if "@" in identifier else None,
            username=None if "@" in identifier else identifier,
            role="national",
            provider="password",
            latitude=0.0,
            longitude=0.0,
            ip_address=payload.get("_client_ip"),
            user_agent=payload.get("_user_agent"),
            reason="invalid_national_credentials",
        )
        return 401, {"error": "Invalid national access credentials"}

    profile = national_account_for_role(row["role"])
    if not profile:
        return 403, {"error": "National access profile is not configured"}

    token = secrets.token_urlsafe(32)
    created_at = now_iso()
    expires_at = expiry_iso()

    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("DELETE FROM county_sessions WHERE expires_at <= ?", (now_iso(),))
        conn.execute(
            """
            INSERT INTO county_sessions
                (token, county_code, county_name, username, email, role, provider, latitude, longitude, created_at, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0.0, 0.0, ?, ?)
            """,
            (
                token,
                row["county_code"],
                row["county_name"],
                row["username"],
                row["email"],
                row["role"],
                row["provider"],
                created_at,
                expires_at,
            ),
        )

    audit_auth_event(
        "login",
        "success",
        county_code_value=row["county_code"],
        county_name_value=row["county_name"],
        username=row["username"],
        email=row["email"],
        role=row["role"],
        provider=row["provider"],
        latitude=0.0,
        longitude=0.0,
        ip_address=payload.get("_client_ip"),
        user_agent=payload.get("_user_agent"),
    )

    return 200, {
        "token": token,
        "role": row["role"],
        "county": "",
        "county_code": "",
        "username": row["username"],
        "email": row["email"],
        "provider": row["provider"],
        "command_center": profile["command_center"],
        "gps_status": "not_required",
        "boundary_scope": profile["boundary_scope"],
        "permissions": profile["permissions"],
        "expires_at": expires_at,
        "expires_in_seconds": SESSION_SECONDS,
    }


def authenticate_county_login(payload: dict) -> tuple[int, dict]:
    county_identifier = str(payload.get("county_code") or payload.get("county") or "").strip()
    identifier = str(payload.get("email") or payload.get("username") or "").strip()
    password = str(payload.get("password") or "")
    demo_remote_access = bool(payload.get("demo_remote_access"))
    latitude = payload.get("latitude")
    longitude = payload.get("longitude")

    if not county_identifier or not identifier or not password:
        return 400, {"error": "county_code, email, and password are required"}

    if demo_remote_access and not remote_county_demo_enabled():
        audit_auth_event(
            "login",
            "failed",
            email=identifier if "@" in identifier else None,
            username=None if "@" in identifier else identifier,
            role="county",
            provider="password_demo",
            ip_address=payload.get("_client_ip"),
            user_agent=payload.get("_user_agent"),
            reason="public_access_locked",
        )
        return 403, {"error": "Remote county access is locked. Use browser GPS or unlock public presentation mode from the Ministry panel."}

    if not demo_remote_access and (latitude is None or longitude is None):
        return 400, {"error": "GPS latitude and longitude are required"}

    try:
        lat = float(latitude) if latitude is not None else 0.0
        lon = float(longitude) if longitude is not None else 0.0
    except (TypeError, ValueError):
        return 400, {"error": "GPS latitude and longitude must be numbers"}

    feature = find_county(county_identifier)
    if not feature:
        audit_auth_event(
            "login",
            "failed",
            email=identifier if "@" in identifier else None,
            username=None if "@" in identifier else identifier,
            latitude=lat,
            longitude=lon,
            ip_address=payload.get("_client_ip"),
            user_agent=payload.get("_user_agent"),
            reason="county_not_found",
        )
        return 404, {"error": "County not found"}

    if not demo_remote_access and not point_in_feature((lon, lat), feature):
        audit_auth_event(
            "login",
            "failed",
            county_code_value=county_code(feature),
            county_name_value=county_name(feature),
            email=identifier if "@" in identifier else None,
            username=None if "@" in identifier else identifier,
            latitude=lat,
            longitude=lon,
            ip_address=payload.get("_client_ip"),
            user_agent=payload.get("_user_agent"),
            reason="outside_county_geofence",
        )
        return 403, {
            "error": "GPS check failed. Login is allowed only from inside the county boundary.",
            "gps_status": "outside_county",
            "county": county_name(feature),
            "county_code": county_code(feature),
        }

    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            """
            SELECT * FROM county_users
            WHERE county_code = ?
              AND is_active = 1
              AND (lower(email) = lower(?) OR lower(username) = lower(?))
            """,
            (county_code(feature), identifier, identifier),
        ).fetchone()

    if not row or password_hash(password, row["salt"]) != row["password_hash"]:
        audit_auth_event(
            "login",
            "failed",
            county_code_value=county_code(feature),
            county_name_value=county_name(feature),
            email=identifier if "@" in identifier else None,
            username=None if "@" in identifier else identifier,
            latitude=lat,
            longitude=lon,
            ip_address=payload.get("_client_ip"),
            user_agent=payload.get("_user_agent"),
            reason="invalid_credentials",
        )
        return 401, {"error": "Invalid county credentials"}

    token = secrets.token_urlsafe(32)
    created_at = now_iso()
    expires_at = expiry_iso()

    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("DELETE FROM county_sessions WHERE expires_at <= ?", (now_iso(),))
        conn.execute(
            """
            INSERT INTO county_sessions
                (token, county_code, county_name, username, email, role, provider, latitude, longitude, created_at, expires_at)
            VALUES (?, ?, ?, ?, ?, 'county', ?, ?, ?, ?, ?)
            """,
            (
                token,
                row["county_code"],
                row["county_name"],
                row["username"],
                row["email"],
                "password_demo" if demo_remote_access else row["provider"],
                lat,
                lon,
                created_at,
                expires_at,
            ),
        )

    audit_auth_event(
        "login",
        "success",
        county_code_value=row["county_code"],
        county_name_value=row["county_name"],
        username=row["username"],
        email=row["email"],
        role="county",
        provider="password_demo" if demo_remote_access else row["provider"],
        latitude=lat,
        longitude=lon,
        ip_address=payload.get("_client_ip"),
        user_agent=payload.get("_user_agent"),
        reason="demo_remote_access" if demo_remote_access else None,
    )

    return 200, {
        "token": token,
        "role": "county",
        "county": row["county_name"],
        "county_code": row["county_code"],
        "username": row["username"],
        "email": row["email"],
        "provider": "password_demo" if demo_remote_access else row["provider"],
        "command_center": f"{row['county_name']} County Command Center",
        "gps_status": "demo_remote_access" if demo_remote_access else "inside_county",
        "boundary_scope": "county_demo_remote" if demo_remote_access else "county_only",
        "demo_remote_access": demo_remote_access,
        "permissions": [
            "county_boundary_read",
            "county_intelligence_read",
            "county_farm_tools",
        ],
        "expires_at": expires_at,
        "expires_in_seconds": SESSION_SECONDS,
    }


def load_geojson(*filenames: str) -> dict:
    cache_key = filenames[0]
    if cache_key not in _GEOJSON_CACHE:
        path = next((DATA_DIR / name for name in filenames if (DATA_DIR / name).exists()), None)
        if path is None:
            raise FileNotFoundError(f"None of these GeoJSON files exist: {', '.join(filenames)}")
        with path.open("r", encoding="utf-8") as file:
            _GEOJSON_CACHE[cache_key] = json.load(file)
    return _GEOJSON_CACHE[cache_key]


def counties() -> list[dict]:
    return load_geojson("counties.geojson").get("features", [])


def subcounties() -> list[dict]:
    return load_geojson("sub_Counties.geojson", "sub_counties.geojson").get("features", [])


def wards() -> list[dict]:
    return load_geojson("wards.geojson").get("features", [])


def county_name(feature: dict) -> str:
    return feature.get("properties", {}).get("ADM1_EN", "Unknown")


def county_code(feature: dict) -> str:
    code = str(feature.get("properties", {}).get("ADM1_PCODE", "") or "").strip()
    if code.upper().startswith("KE") and len(code) >= 5:
        return code[-3:]
    return code


def raw_county_code(feature: dict) -> str:
    return str(feature.get("properties", {}).get("ADM1_PCODE", "") or "").strip()


def subcounty_name(feature: dict) -> str:
    properties = feature.get("properties", {})
    return properties.get("ADM2_EN") or properties.get("NAME") or properties.get("NAME_2") or "Unknown"


def subcounty_code(feature: dict) -> str:
    return feature.get("properties", {}).get("ADM2_PCODE", "")


def ward_name(feature: dict) -> str:
    properties = feature.get("properties", {})
    return properties.get("shapeName") or properties.get("ADM3_EN") or properties.get("NAME") or "Unknown"


def ward_code(feature: dict) -> str:
    properties = feature.get("properties", {})
    return properties.get("shapeID") or properties.get("ADM3_PCODE") or ""


def find_county(identifier: str) -> dict | None:
    needle = unquote(identifier).strip().lower()
    for feature in counties():
        name = county_name(feature).lower()
        code = county_code(feature).lower()
        raw_code = raw_county_code(feature).lower()
        if needle in {name, code, raw_code}:
            return feature
    return None


def find_subcounty(identifier: str) -> dict | None:
    needle = unquote(identifier).strip().lower()
    for feature in subcounties():
        properties = feature.get("properties", {})
        candidates = [
            properties.get("ADM2_EN"),
            properties.get("ADM2_PCODE"),
            properties.get("NAME"),
            properties.get("NAME_2"),
        ]
        if needle in {str(value).strip().lower() for value in candidates if value}:
            return feature
    return None


def find_ward(identifier: str) -> dict | None:
    needle = unquote(identifier).strip().lower()
    for feature in wards():
        properties = feature.get("properties", {})
        candidates = [
            properties.get("shapeName"),
            properties.get("shapeID"),
            properties.get("ADM3_EN"),
            properties.get("ADM3_PCODE"),
            properties.get("NAME"),
        ]
        if needle in {str(value).strip().lower() for value in candidates if value}:
            return feature
    return None


SEGMENT_CLASSES = {
    "buildings": {
        "label": "Buildings",
        "color": "#dc2626",
        "selectors": [
            'node["building"]',
            'way["building"]',
            'relation["building"]',
        ],
    },
    "cropland": {
        "label": "Cropland",
        "color": "#16a34a",
        "selectors": [
            'node["landuse"~"farmland|orchard|vineyard|plantation|allotments"]',
            'way["landuse"~"farmland|orchard|vineyard|plantation|allotments"]',
            'relation["landuse"~"farmland|orchard|vineyard|plantation|allotments"]',
        ],
    },
    "water": {
        "label": "Water",
        "color": "#0284c7",
        "selectors": [
            'node["natural"="water"]',
            'way["natural"="water"]',
            'relation["natural"="water"]',
            'node["waterway"]',
            'way["waterway"]',
            'node["landuse"="reservoir"]',
            'way["landuse"="reservoir"]',
        ],
    },
    "forest": {
        "label": "Forest",
        "color": "#166534",
        "selectors": [
            'node["landuse"="forest"]',
            'way["landuse"="forest"]',
            'relation["landuse"="forest"]',
            'node["natural"="wood"]',
            'way["natural"="wood"]',
            'relation["natural"="wood"]',
        ],
    },
    "bare_land": {
        "label": "Bare land",
        "color": "#d97706",
        "selectors": [
            'node["natural"~"bare_rock|sand|scree"]',
            'way["natural"~"bare_rock|sand|scree"]',
            'relation["natural"~"bare_rock|sand|scree"]',
            'node["landuse"~"quarry|brownfield"]',
            'way["landuse"~"quarry|brownfield"]',
        ],
    },
}


def find_scope_feature(level: str, identifier: str) -> dict | None:
    if level == "ward":
        return find_ward(identifier)
    if level == "subcounty":
        return find_subcounty(identifier)
    if level == "county":
        return find_county(identifier)
    return None


def stable_number(seed: str, low: float, high: float, precision: int = 1) -> float:
    digest = hashlib.sha256(seed.encode("utf-8")).hexdigest()
    ratio = int(digest[:12], 16) / float(0xFFFFFFFFFFFF)
    return round(low + (high - low) * ratio, precision)


def land_use_mix(seed: str) -> dict[str, float]:
    categories = {
        "cropland": stable_number(seed + ":cropland", 24, 58),
        "grassland": stable_number(seed + ":grassland", 12, 34),
        "forest": stable_number(seed + ":forest", 5, 25),
        "water": stable_number(seed + ":water", 1, 8),
        "built_up": stable_number(seed + ":built", 2, 14),
        "bare_land": stable_number(seed + ":bare", 4, 22),
    }
    total = sum(categories.values())
    return {key: round((value / total) * 100, 1) for key, value in categories.items()}


def risk_level(score: float) -> str:
    if score >= 70:
        return "critical"
    if score >= 50:
        return "high"
    if score >= 30:
        return "watch"
    return "stable"


def risk_score(metrics: dict) -> float:
    ndvi = metrics["crop_health"]["ndvi"]
    ndbi = metrics.get("indices", {}).get("ndbi", 0)
    moisture = metrics["soil_moisture"]["index"]
    strength = metrics["crop_strength"]["index"]
    cropland = metrics["land_use"]["cropland"]
    built_up = metrics["land_use"].get("built_up", 0)

    score = 0
    score += max(0, 0.64 - ndvi) * 115
    score += max(0, ndbi - 0.36) * 60
    score += max(0, 50 - moisture) * 0.9
    score += max(0, 66 - strength) * 0.65
    score += max(0, 32 - cropland) * 0.5
    score += max(0, built_up - 10) * 1.2
    return round(min(100, score), 1)


def recommendations_for(metrics: dict, name: str = "area") -> list[str]:
    recommendations = []
    if metrics["crop_health"]["ndvi"] < 0.55:
        recommendations.append(f"Schedule field scouting in {name} to verify vegetation stress.")
    if metrics["soil_moisture"]["index"] < 42:
        recommendations.append(f"Prioritize soil-moisture checks and irrigation planning for {name}.")
    if metrics["crop_strength"]["index"] < 58:
        recommendations.append(f"Flag {name} for agronomist review before the next planting decision.")
    if metrics["land_use"]["cropland"] < 30:
        recommendations.append(f"Review land-use suitability before expanding cropland in {name}.")
    if not recommendations:
        recommendations.append(f"Keep {name} in routine monitoring; no urgent stress signal detected.")
    return recommendations[:3]


def trend_series(seed: str) -> list[dict]:
    months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"]
    return [
        {
            "month": month,
            "ndvi": stable_number(f"{seed}:trend:{month}:ndvi", 0.38, 0.84, 2),
            "ndwi": stable_number(f"{seed}:trend:{month}:ndwi", 0.12, 0.61, 2),
            "ndbi": stable_number(f"{seed}:trend:{month}:ndbi", 0.04, 0.48, 2),
            "moisture": stable_number(f"{seed}:trend:{month}:moisture", 24, 78, 1),
            "rainfall": stable_number(f"{seed}:trend:{month}:rainfall", 18, 220, 1),
            "forest": stable_number(f"{seed}:trend:{month}:forest", 6, 28, 1),
        }
        for month in months
    ]


def forest_trend(seed: str) -> list[dict]:
    current_year = datetime.now(timezone.utc).year
    return [
        {
            "year": year,
            "forest": stable_number(f"{seed}:forest:{year}", 4, 32, 1),
        }
        for year in range(current_year - 20, current_year)
    ]


def weather_profile(seed: str) -> dict:
    current_year = datetime.now(timezone.utc).year
    history = [
        {
            "year": year,
            "rainfall_mm": stable_number(f"{seed}:rain:{year}", 420, 1650, 1),
        }
        for year in range(current_year - 10, current_year)
    ]
    forecast = [
        {
            "day": f"Day {day}",
            "rainfall_mm": stable_number(f"{seed}:forecast:{day}:rain", 0, 42, 1),
            "temp_c": stable_number(f"{seed}:forecast:{day}:temp", 16, 32, 1),
        }
        for day in range(1, 15)
    ]
    avg_recent = round(sum(row["rainfall_mm"] for row in history[-3:]) / 3, 1)
    avg_long = round(sum(row["rainfall_mm"] for row in history) / len(history), 1)
    return {
        "history_10_year": history,
        "forecast_14_day": forecast,
        "rainfall_signal": "improving" if avg_recent >= avg_long else "declining",
        "average_annual_rainfall_mm": avg_long,
    }


def road_mix(seed: str, total_km: float) -> dict[str, float]:
    raw = {
        "tarmac": stable_number(f"{seed}:road:tarmac", 18, 55, 1),
        "all_weather": stable_number(f"{seed}:road:all_weather", 22, 60, 1),
        "marram": stable_number(f"{seed}:road:marram", 18, 50, 1),
    }
    total = sum(raw.values()) or 1
    return {key: round(total_km * value / total, 1) for key, value in raw.items()}


def classification_for(land_use: dict[str, float]) -> str:
    built = land_use.get("built_up", 0)
    cropland = land_use.get("cropland", 0)
    if built >= 12:
        return "Urban"
    if built >= 7:
        return "Peri-urban"
    if cropland >= 38:
        return "Agricultural"
    return "Rural"


def apply_built_up_calibration(metrics: dict, built_up: float, feature_count: dict) -> None:
    land_use = metrics["land_use"]
    built_up = round(max(land_use.get("built_up", 0), min(78, built_up)), 1)
    remaining = round(100 - built_up, 1)
    other_keys = [key for key in land_use if key != "built_up"]
    current_other_total = sum(land_use[key] for key in other_keys) or 1

    for key in other_keys:
        land_use[key] = round((land_use[key] / current_other_total) * remaining, 1)
    land_use["built_up"] = built_up

    metrics["indices"]["ndbi"] = max(metrics["indices"].get("ndbi", 0), round(0.45 + built_up / 180, 2))
    metrics["classification"] = classification_for(land_use)
    metrics["mapped_features"] = {
        "buildings": {
            "source": feature_count.get("source"),
            "provider": feature_count.get("provider"),
            "count": feature_count.get("count"),
            "effect": "built_up_calibrated",
        }
    }
    score = risk_score(metrics)
    metrics["risk"] = {
        "score": score,
        "level": risk_level(score),
    }


def bbox(feature: dict) -> tuple[float, float, float, float]:
    coords = []

    def collect(value):
        if isinstance(value, list) and value and isinstance(value[0], (int, float)):
            coords.append(value)
            return
        if isinstance(value, list):
            for item in value:
                collect(item)

    collect(feature.get("geometry", {}).get("coordinates", []))
    lngs = [point[0] for point in coords]
    lats = [point[1] for point in coords]
    return min(lngs), min(lats), max(lngs), max(lats)


def feature_center(feature: dict) -> tuple[float, float]:
    min_lng, min_lat, max_lng, max_lat = bbox(feature)
    return (min_lng + max_lng) / 2, (min_lat + max_lat) / 2


def estimate_area_ha(feature: dict) -> float:
    west, south, east, north = bbox(feature)
    approx_area = abs(east - west) * abs(north - south) * 1234567 
    return round(max(0.1, approx_area), 2)


def calculate_area_metrics(geometry: dict) -> dict:
    seed = hashlib.sha256(json.dumps(geometry, sort_keys=True).encode("utf-8")).hexdigest()
    area_ha = estimate_area_ha({"geometry": geometry})
    metrics = analysis_metrics(seed)
    score = risk_score(metrics)
    
    return {
        "generated_at": now_iso(),
        "area_ha": area_ha,
        "area_km2": round(area_ha / 100, 2),
        "risk": {
            "score": score,
            "level": risk_level(score),
        },
        "trend": trend_series(seed),
        "recommendations": recommendations_for(metrics, "drawn farm"),
        **metrics
    }


def point_in_ring(point: tuple[float, float], ring: list[list[float]]) -> bool:
    x, y = point
    inside = False
    j = len(ring) - 1
    for i, current in enumerate(ring):
        xi, yi = current[0], current[1]
        xj, yj = ring[j][0], ring[j][1]
        intersects = ((yi > y) != (yj > y)) and (
            x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi
        )
        if intersects:
            inside = not inside
        j = i
    return inside


def point_in_polygon(point: tuple[float, float], polygon: list) -> bool:
    if not polygon or not point_in_ring(point, polygon[0]):
        return False
    return not any(point_in_ring(point, hole) for hole in polygon[1:])


def point_in_feature(point: tuple[float, float], feature: dict) -> bool:
    geometry = feature.get("geometry", {})
    coordinates = geometry.get("coordinates", [])
    if geometry.get("type") == "Polygon":
        return point_in_polygon(point, coordinates)
    if geometry.get("type") == "MultiPolygon":
        return any(point_in_polygon(point, polygon) for polygon in coordinates)
    return False


def overpass_query(segment_class: str, feature: dict, limit: int) -> str:
    profile = SEGMENT_CLASSES[segment_class]
    west, south, east, north = bbox(feature)
    bbox_expr = f"({south},{west},{north},{east})"
    selectors = "\n".join(f"  {selector}{bbox_expr};" for selector in profile["selectors"])
    return f"""
[out:json][timeout:25];
(
{selectors}
);
out center {limit};
"""


def request_overpass(query: str) -> dict:
    body = urlencode({"data": query}).encode("utf-8")
    request = Request(
        "https://overpass-api.de/api/interpreter",
        data=body,
        headers={
            "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
            "User-Agent": "AEIS-K/0.1 local agricultural intelligence dashboard",
        },
        method="POST",
    )
    with urlopen(request, timeout=35) as response:
        return json.loads(response.read().decode("utf-8"))


def overpass_count_query(segment_class: str, feature: dict) -> str:
    profile = SEGMENT_CLASSES[segment_class]
    west, south, east, north = bbox(feature)
    bbox_expr = f"({south},{west},{north},{east})"
    selectors = "\n".join(f"  {selector}{bbox_expr};" for selector in profile["selectors"])
    return f"""
[out:json][timeout:25];
(
{selectors}
);
out count;
"""


def real_feature_count(segment_class: str, level: str, identifier: str) -> dict:
    feature = find_scope_feature(level, identifier)
    if not feature or segment_class not in SEGMENT_CLASSES:
        return {"status": "error", "count": None}

    cache_key = f"count:{segment_class}:{level}:{identifier}"
    if cache_key in _OSM_SEGMENT_CACHE:
        return dict(_OSM_SEGMENT_CACHE[cache_key])

    try:
        payload = request_overpass(overpass_count_query(segment_class, feature))
        tags = (payload.get("elements") or [{}])[0].get("tags") or {}
        total = int(tags.get("total") or 0)
        result = {
            "status": "ok",
            "source": "openstreetmap",
            "provider": "openstreetmap_overpass",
            "count": total,
        }
    except (HTTPError, URLError, TimeoutError, OSError, ValueError) as exc:
        result = {
            "status": "provider_unavailable",
            "source": "none",
            "provider": "openstreetmap_overpass",
            "count": None,
            "message": str(exc),
        }

    _OSM_SEGMENT_CACHE[cache_key] = result
    return result


def element_center(element: dict) -> tuple[float, float] | None:
    if "lat" in element and "lon" in element:
        return float(element["lon"]), float(element["lat"])
    center = element.get("center") or {}
    if "lat" in center and "lon" in center:
        return float(center["lon"]), float(center["lat"])
    return None


def element_label(element: dict, segment_class: str) -> str:
    tags = element.get("tags") or {}
    return (
        tags.get("name")
        or tags.get("building")
        or tags.get("landuse")
        or tags.get("natural")
        or tags.get("waterway")
        or SEGMENT_CLASSES[segment_class]["label"]
    )


def real_segmentation(segment_class: str, level: str, identifier: str, limit: int = 700) -> dict:
    if segment_class not in SEGMENT_CLASSES:
        return {
            "status": "error",
            "error": f"Unsupported segment class: {segment_class}",
            "supported_classes": sorted(SEGMENT_CLASSES),
        }

    feature = find_scope_feature(level, identifier)
    if not feature:
        return {"status": "error", "error": f"{level} boundary not found"}

    profile = SEGMENT_CLASSES[segment_class]
    cache_key = f"{segment_class}:{level}:{identifier}:{limit}"
    if cache_key in _OSM_SEGMENT_CACHE:
        cached = dict(_OSM_SEGMENT_CACHE[cache_key])
        cached["cached"] = True
        return cached

    try:
        payload = request_overpass(overpass_query(segment_class, feature, limit))
    except (HTTPError, URLError, TimeoutError, OSError) as exc:
        return {
            "status": "provider_unavailable",
            "provider": "openstreetmap_overpass",
            "source": "none",
            "message": f"OpenStreetMap provider unavailable: {exc}",
            "points": [],
            "count": 0,
            "segment_class": segment_class,
            "label": profile["label"],
            "level": level,
            "identifier": identifier,
            "generated_at": now_iso(),
        }

    points = []
    seen = set()
    for element in payload.get("elements", []):
        center = element_center(element)
        if not center:
            continue
        lon, lat = center
        if not point_in_feature((lon, lat), feature):
            continue
        key = (element.get("type"), element.get("id"))
        if key in seen:
            continue
        seen.add(key)
        points.append(
            {
                "lat": lat,
                "lon": lon,
                "similarity": 1,
                "label": element_label(element, segment_class),
                "color": profile["color"],
                "classKey": segment_class,
                "source": "openstreetmap",
                "osm_type": element.get("type"),
                "osm_id": element.get("id"),
                "tags": {
                    key: value
                    for key, value in (element.get("tags") or {}).items()
                    if key in {"name", "building", "landuse", "natural", "waterway", "amenity"}
                },
            }
        )

    result = {
        "status": "ok",
        "provider": "openstreetmap_overpass",
        "source": "openstreetmap",
        "segment_class": segment_class,
        "label": profile["label"],
        "level": level,
        "identifier": identifier,
        "generated_at": now_iso(),
        "count": len(points),
        "points": points[:limit],
        "cached": False,
    }
    _OSM_SEGMENT_CACHE[cache_key] = result
    return result


def county_ward_counts() -> dict[str, int]:
    return {county_name(feature): ward_count_for_county(feature) for feature in counties()}


def ward_centers() -> list[tuple[float, float]]:
    global _WARD_CENTER_CACHE
    if _WARD_CENTER_CACHE is None:
        _WARD_CENTER_CACHE = [feature_center(feature) for feature in wards()]
    return _WARD_CENTER_CACHE


def point_in_bbox(point: tuple[float, float], bounds: tuple[float, float, float, float]) -> bool:
    lng, lat = point
    min_lng, min_lat, max_lng, max_lat = bounds
    return min_lng <= lng <= max_lng and min_lat <= lat <= max_lat


def ward_count_for_county(feature: dict) -> int:
    name = county_name(feature)
    if name in _COUNTY_WARD_CACHE:
        return _COUNTY_WARD_CACHE[name]

    bounds = bbox(feature)
    count = sum(
        1
        for center in ward_centers()
        if point_in_bbox(center, bounds) and point_in_feature(center, feature)
    )
    _COUNTY_WARD_CACHE[name] = count
    return count


def county_subcounty_count(name: str) -> int:
    return sum(
        1
        for feature in subcounties()
        if feature.get("properties", {}).get("ADM1_EN") == name
    )


def analysis_metrics(seed: str) -> dict:
    ndvi = stable_number(seed + ":ndvi", 0.42, 0.81, 2)
    ndwi = stable_number(seed + ":ndwi", 0.1, 0.66, 2)
    ndbi = stable_number(seed + ":ndbi", 0.03, 0.5, 2)
    moisture = stable_number(seed + ":moisture", 28, 76, 1)
    strength = stable_number(seed + ":strength", 48, 91, 1)
    land_use = land_use_mix(seed)
    roads_km = stable_number(seed + ":roads", 15.0, 820.0, 1)

    metrics = {
        "indices": {
            "ndvi": ndvi,
            "ndwi": ndwi,
            "ndbi": ndbi,
        },
        "crop_health": {
            "ndvi": ndvi,
            "status": "good" if ndvi >= 0.62 else "watch" if ndvi >= 0.52 else "stress",
        },
        "soil_moisture": {
            "index": moisture,
            "status": "adequate" if moisture >= 50 else "watch" if moisture >= 38 else "dry",
        },
        "crop_strength": {
            "index": strength,
            "status": "strong" if strength >= 70 else "moderate" if strength >= 55 else "weak",
        },
        "land_use": land_use,
        "infrastructure": {
            "roads_km": roads_km,
            "road_types": road_mix(seed, roads_km),
        },
        "weather": weather_profile(seed),
        "forest_trend": forest_trend(seed),
        "classification": classification_for(land_use),
    }
    score = risk_score(metrics)
    metrics["risk"] = {
        "score": score,
        "level": risk_level(score),
    }
    metrics["trend"] = trend_series(seed)
    return metrics


def county_analysis(feature: dict) -> dict:
    name = county_name(feature)
    code = county_code(feature)
    seed = code or name
    area_ha = estimate_area_ha(feature)
    metrics = analysis_metrics(seed)
    building_count = real_feature_count("buildings", "county", code or name)
    if building_count.get("status") == "ok":
        count = building_count.get("count") or 0
        if count >= 10000:
            apply_built_up_calibration(metrics, 64, building_count)
        elif count >= 3500:
            apply_built_up_calibration(metrics, 46, building_count)
        elif count >= 1200:
            apply_built_up_calibration(metrics, 28, building_count)
    ndvi = metrics["crop_health"]["ndvi"]
    moisture = metrics["soil_moisture"]["index"]
    cropland = metrics["land_use"]["cropland"]

    alerts = []
    if ndvi < 0.55:
        alerts.append("vegetation stress")
    if moisture < 40:
        alerts.append("low soil moisture")
    if cropland < 30:
        alerts.append("limited cropland share")

    return {
        "county": name,
        "county_code": code,
        "admin_level": "county",
        "generated_at": now_iso(),
        "area_km2": round(area_ha / 100, 2),
        "area_ha": area_ha,
        "data_mode": "openstreetmap_assisted" if metrics.get("mapped_features") else "demo_baseline",
        "method": "OpenStreetMap building counts calibrate built-up classification when available; remaining remote-sensing indices are setup baselines until Sentinel/GHSL/WorldCover providers are connected.",
        "admin_units": {
            "subcounties": county_subcounty_count(name),
            "wards": ward_count_for_county(feature),
        },
        **metrics,
        "recommendations": recommendations_for(metrics, name),
        "alerts": alerts,
    }


def subcounty_analysis(feature: dict) -> dict:
    name = subcounty_name(feature)
    code = subcounty_code(feature)
    seed = code or name
    area_ha = estimate_area_ha(feature)
    metrics = analysis_metrics(seed)
    properties = feature.get("properties", {})
    return {
        "subcounty": name,
        "subcounty_code": code,
        "county": properties.get("ADM1_EN"),
        "county_code": properties.get("ADM1_PCODE"),
        "admin_level": "subcounty",
        "generated_at": now_iso(),
        "area_km2": round(area_ha / 100, 2),
        "area_ha": area_ha,
        "data_mode": "demo_baseline",
        "method": "Deterministic baseline values for setup. Replace provider with Sentinel/NASA/live field data for production.",
        "admin_units": {
            "wards": sum(
                1
                for ward in wards()
                if ward.get("properties", {}).get("ADM2_PCODE") == code
                or ward.get("properties", {}).get("ADM2_EN") == name
            ),
        },
        **metrics,
        "recommendations": recommendations_for(metrics, name),
        "alerts": [
            alert
            for alert, active in {
                "vegetation stress": metrics["crop_health"]["ndvi"] < 0.55,
                "low soil moisture": metrics["soil_moisture"]["index"] < 40,
                "built-up pressure": metrics["indices"]["ndbi"] > 0.38,
            }.items()
            if active
        ],
    }


def ward_analysis(feature: dict) -> dict:
    name = ward_name(feature)
    code = ward_code(feature)
    seed = code or name
    area_ha = estimate_area_ha(feature)
    metrics = analysis_metrics(seed)
    properties = feature.get("properties", {})
    return {
        "ward": name,
        "ward_code": code,
        "subcounty": properties.get("ADM2_EN") or properties.get("SubCounty"),
        "subcounty_code": properties.get("ADM2_PCODE"),
        "county": properties.get("ADM1_EN"),
        "county_code": properties.get("ADM1_PCODE"),
        "admin_level": "ward",
        "generated_at": now_iso(),
        "area_km2": round(area_ha / 100, 2),
        "area_ha": area_ha,
        "data_mode": "demo_baseline",
        "method": "Deterministic baseline values for setup. Replace provider with Sentinel/NASA/live field data for production.",
        **metrics,
        "recommendations": recommendations_for(metrics, name),
        "alerts": [
            alert
            for alert, active in {
                "vegetation stress": metrics["crop_health"]["ndvi"] < 0.55,
                "low soil moisture": metrics["soil_moisture"]["index"] < 40,
                "built-up pressure": metrics["indices"]["ndbi"] > 0.38,
            }.items()
            if active
        ],
    }


def country_analysis() -> dict:
    county_rows = []
    for feature in counties():
        area_ha = estimate_area_ha(feature)
        county_rows.append(
            {
                "county": county_name(feature),
                "county_code": county_code(feature),
                "area_km2": round(area_ha / 100, 2),
                "area_ha": area_ha,
                **analysis_metrics(county_code(feature) or county_name(feature)),
            }
        )
    count = len(county_rows) or 1
    avg_ndvi = round(sum(row["crop_health"]["ndvi"] for row in county_rows) / count, 2)
    avg_ndwi = round(sum(row["indices"]["ndwi"] for row in county_rows) / count, 2)
    avg_ndbi = round(sum(row["indices"]["ndbi"] for row in county_rows) / count, 2)
    avg_moisture = round(sum(row["soil_moisture"]["index"] for row in county_rows) / count, 1)
    avg_strength = round(sum(row["crop_strength"]["index"] for row in county_rows) / count, 1)
    avg_risk = round(sum(row["risk"]["score"] for row in county_rows) / count, 1)
    total_roads = round(sum(row["infrastructure"]["roads_km"] for row in county_rows), 1)
    road_types = {
        road_type: round(sum(row["infrastructure"]["road_types"][road_type] for row in county_rows), 1)
        for road_type in ["tarmac", "all_weather", "marram"]
    }
    ranked = sorted(county_rows, key=lambda row: row["risk"]["score"], reverse=True)
    land_use = {
        key: round(sum(row["land_use"][key] for row in county_rows) / count, 1)
        for key in county_rows[0]["land_use"]
    }
    country_seed = "Kenya"

    return {
        "country": "Kenya",
        "admin_level": "country",
        "generated_at": now_iso(),
        "data_mode": "demo_baseline",
        "area_km2": round(sum(row["area_km2"] for row in county_rows), 2),
        "admin_units": {
            "counties": len(counties()),
            "subcounties": len(subcounties()),
            "wards": len(wards()),
        },
        "indices": {
            "ndvi": avg_ndvi,
            "ndwi": avg_ndwi,
            "ndbi": avg_ndbi,
        },
        "crop_health": {
            "ndvi": avg_ndvi,
            "status": "good" if avg_ndvi >= 0.62 else "watch" if avg_ndvi >= 0.52 else "stress",
        },
        "soil_moisture": {
            "index": avg_moisture,
            "status": "adequate" if avg_moisture >= 50 else "watch" if avg_moisture >= 38 else "dry",
        },
        "crop_strength": {
            "index": avg_strength,
            "status": "strong" if avg_strength >= 70 else "moderate" if avg_strength >= 55 else "weak",
        },
        "land_use": land_use,
        "infrastructure": {
            "roads_km": total_roads,
            "road_types": road_types,
        },
        "weather": weather_profile(country_seed),
        "forest_trend": forest_trend(country_seed),
        "trend": trend_series(country_seed),
        "risk": {
            "score": avg_risk,
            "level": risk_level(avg_risk),
        },
        "priority_counties": [
            {
                "county": row["county"],
                "county_code": row["county_code"],
                "risk": row["risk"],
                "ndvi": row["crop_health"]["ndvi"],
                "ndbi": row["indices"]["ndbi"],
                "moisture": row["soil_moisture"]["index"],
                "roads_km": row["infrastructure"]["roads_km"],
            }
            for row in ranked[:5]
        ],
        "recommendations": recommendations_for(
            {
                "crop_health": {"ndvi": avg_ndvi},
                "soil_moisture": {"index": avg_moisture},
                "crop_strength": {"index": avg_strength},
                "land_use": land_use,
            },
            "Kenya",
        ),
        "counties": county_rows,
    }


def automation_status() -> dict:
    analysis = country_analysis()
    rows = analysis["counties"]
    distribution = {"critical": 0, "high": 0, "watch": 0, "stable": 0}
    for row in rows:
        distribution[row["risk"]["level"]] += 1

    return {
        "mode": "auto_monitor",
        "status": "running",
        "generated_at": now_iso(),
        "refresh_seconds": 30,
        "coverage": analysis["admin_units"],
        "national_risk": analysis["risk"],
        "risk_distribution": distribution,
        "priority_counties": analysis["priority_counties"],
        "automation_actions": [
            "Refresh national and selected-county intelligence on schedule.",
            "Rank counties by crop, moisture, strength, and cropland risk.",
            "Surface recommended field actions for high-risk areas.",
            "Track NDBI, NDWI, rainfall, forest trend, and road-condition signals.",
            "Keep boundary hierarchy ready for drill-down monitoring.",
        ],
    }


def county_list() -> list[dict]:
    return [
        {
            "name": county_name(feature),
            "code": county_code(feature),
            "area_km2": round(estimate_area_ha(feature) / 100, 2),
            "subcounties": county_subcounty_count(county_name(feature)),
            "wards": ward_count_for_county(feature),
            "bbox": bbox(feature),
        }
        for feature in sorted(counties(), key=county_name)
    ]


def json_response(handler: BaseHTTPRequestHandler, status: int, payload: dict | list) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def send_file_response(handler: BaseHTTPRequestHandler, file_path: Path, cache: bool = False) -> None:
    content = file_path.read_bytes()
    mime_type, _ = mimetypes.guess_type(str(file_path))
    if not mime_type:
        mime_type = "application/octet-stream"
    handler.send_response(200)
    handler.send_header("Content-Type", mime_type)
    handler.send_header("Content-Length", str(len(content)))
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Cache-Control", "public, max-age=31536000, immutable" if cache else "no-cache")
    handler.end_headers()
    handler.wfile.write(content)


def safe_static_path(root: Path, request_path: str) -> Path | None:
    relative = unquote(request_path).lstrip("/")
    try:
        candidate = (root / relative).resolve()
        if root.resolve() not in candidate.parents and candidate != root.resolve():
            return None
        if candidate.is_file():
            return candidate
    except OSError:
        return None
    return None


def serve_frontend_asset(handler: BaseHTTPRequestHandler, request_path: str) -> bool:
    if not FRONTEND_DIST_DIR.exists():
        return False

    if request_path.startswith("/assets/"):
        file_path = safe_static_path(FRONTEND_DIST_DIR, request_path)
        if file_path:
            send_file_response(handler, file_path, cache=True)
            return True

    if request_path.startswith("/data/"):
        file_path = safe_static_path(FRONTEND_PUBLIC_DIR, request_path)
        if file_path:
            send_file_response(handler, file_path, cache=True)
            return True

    public_path = safe_static_path(FRONTEND_PUBLIC_DIR, request_path)
    if public_path:
        send_file_response(handler, public_path, cache=False)
        return True

    dist_path = safe_static_path(FRONTEND_DIST_DIR, request_path)
    if dist_path:
        send_file_response(handler, dist_path, cache=request_path.startswith("/assets/"))
        return True

    index_path = FRONTEND_DIST_DIR / "index.html"
    if index_path.exists() and not request_path.startswith("/api/"):
        send_file_response(handler, index_path, cache=False)
        return True

    return False


class AEISHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self) -> None:
        json_response(self, 200, {"status": "ok"})

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"

        try:
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            payload = json.loads(post_data)
            if isinstance(payload, dict):
                payload["_client_ip"] = self.client_address[0] if self.client_address else ""
                payload["_user_agent"] = self.headers.get("User-Agent", "")

            if path == "/api/analysis/area":
                # Accepts a GeoJSON geometry object directly
                geometry = payload.get("geometry")
                if not geometry:
                    json_response(self, 400, {"error": "Missing geometry in payload"})
                    return
                
                result = calculate_area_metrics(geometry)
                json_response(self, 200, result)
                return

            if path == "/api/auth/county-login":
                status, result = authenticate_county_login(payload)
                json_response(self, status, result)
                return

            if path in {"/api/auth/national-login", "/api/auth/ministry-login"}:
                status, result = authenticate_national_login(payload)
                json_response(self, status, result)
                return

            if path == "/api/auth/validate-session":
                status, result = validate_county_session(payload)
                json_response(self, status, result)
                return

            if path == "/api/auth/logout":
                status, result = logout_county_session(payload)
                json_response(self, status, result)
                return

            if path == "/api/indices/evaluate":
                status, result = evaluate_indices_payload(payload)
                json_response(self, status, result)
                return

            if path == "/api/system/public-access":
                status, result = update_public_access_payload(payload)
                json_response(self, status, result)
                return

            json_response(self, 404, {"error": "Not found", "path": path})
        except Exception as exc:
            json_response(self, 500, {"error": str(exc)})

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"

        try:
            if path == "/":
                if serve_frontend_asset(self, "/"):
                    return
                json_response(
                    self,
                    200,
                    {
                        "project": "AEIS-K",
                        "name": "Agricultural Environmental Intelligence System - Kenya",
                        "status": "running",
                    },
                )
                return

            if path == "/health":
                json_response(self, 200, {"status": "healthy", "generated_at": now_iso()})
                return

            if path == "/api/dashboard/summary":
                json_response(self, 200, dashboard_summary_payload())
                return

            if path == "/api/dashboard/realtime":
                query = parse_qs(parsed.query)
                county_identifier = (query.get("county") or [""])[0]
                json_response(self, 200, realtime_operations_payload(county_identifier or None))
                return

            if path.startswith("/api/dashboard/county/"):
                identifier = path.split("/api/dashboard/county/", 1)[1]
                status, result = dashboard_county_payload(identifier)
                json_response(self, status, result)
                return

            if path == "/api/dashboard/alerts":
                json_response(self, 200, {"alerts": DASHBOARD_ALERTS, "generated_at": now_iso()})
                return

            if path == "/api/dashboard/reports":
                json_response(self, 200, {"reports": DASHBOARD_REPORTS, "generated_at": now_iso()})
                return

            if path == "/api/weather/forecast":
                query = parse_qs(parsed.query)
                county_identifier = (query.get("county") or [""])[0]
                status, result = weather_forecast_payload(county_identifier or None)
                json_response(self, status, result)
                return

            if path == "/api/metadata":
                json_response(
                    self,
                    200,
                    {
                        "country": "Kenya",
                        "admin_levels": ["county", "subcounty", "ward", "farm"],
                        "auth": {
                            "county_login": True,
                            "national_login": True,
                            "role_based_access": True,
                            "gps_geofence": True,
                            "county_sessions": True,
                            "storage": "sqlite",
                        },
                        "analysis_layers": [
                            "crop_health",
                            "soil_moisture",
                            "crop_strength",
                            "land_use",
                            "ndbi",
                            "ndwi",
                            "google_earth_engine_ready",
                            "weather",
                            "forest_trend",
                            "roads",
                        ],
                    },
                )
                return

            if path == "/api/system/access":
                json_response(self, 200, system_access_payload())
                return

            if path == "/api/gee/layers":
                json_response(self, 200, gee_layers_payload())
                return

            if path == "/api/system/actualization":
                json_response(self, 200, system_actualization_payload())
                return

            if path == "/api/auth/county-accounts":
                json_response(
                    self,
                    200,
                    {
                        "auth_model": "sqlite_county_users",
                        "session_seconds": SESSION_SECONDS,
                        "local_seed_password": DEFAULT_COUNTY_PASSWORD if show_demo_credentials() else "",
                        "accounts": county_login_accounts(),
                    },
                )
                return

            if path == "/api/auth/access-model":
                json_response(self, 200, auth_access_model_payload())
                return

            if path == "/api/auth/audit-log":
                query = parse_qs(parsed.query)
                try:
                    limit = int((query.get("limit") or ["80"])[0])
                except ValueError:
                    limit = 80
                json_response(
                    self,
                    200,
                    {
                        "audit_model": "sqlite_auth_audit_log",
                        "events": auth_audit_log(limit),
                        "generated_at": now_iso(),
                    },
                )
                return

            if path == "/api/boundary/counties":
                json_response(self, 200, {"counties": county_list()})
                return

            if path.startswith("/api/boundary/county/"):
                identifier = path.split("/api/boundary/county/", 1)[1]
                feature = find_county(identifier)
                if not feature:
                    json_response(self, 404, {"error": "County not found"})
                    return
                json_response(self, 200, feature)
                return

            if path == "/api/analysis/live/status":
                json_response(
                    self,
                    200,
                    {
                        "status": "ready_for_provider",
                        "active_provider": None,
                        "message": "Local setup API is running. Connect Sentinel Hub, Google Earth Engine, NASA POWER, or field sensors next.",
                    },
                )
                return

            if path == "/api/automation/status":
                json_response(self, 200, automation_status())
                return

            if path == "/api/analysis/country":
                json_response(self, 200, country_analysis())
                return

            if path.startswith("/api/segmentation/"):
                segment_class = path.split("/api/segmentation/", 1)[1]
                query = parse_qs(parsed.query)
                level = (query.get("level") or ["county"])[0]
                identifier = (query.get("id") or [""])[0]
                try:
                    limit = max(1, min(1500, int((query.get("limit") or ["700"])[0])))
                except ValueError:
                    limit = 700
                if not identifier:
                    json_response(self, 400, {"error": "Missing segmentation scope id"})
                    return
                json_response(self, 200, real_segmentation(segment_class, level, identifier, limit))
                return

            if path.startswith("/api/analysis/county/"):
                identifier = path.split("/api/analysis/county/", 1)[1]
                feature = find_county(identifier)
                if not feature:
                    json_response(self, 404, {"error": "County not found"})
                    return
                json_response(self, 200, county_analysis(feature))
                return

            if path.startswith("/api/analysis/subcounty/"):
                identifier = path.split("/api/analysis/subcounty/", 1)[1]
                feature = find_subcounty(identifier)
                if not feature:
                    json_response(self, 404, {"error": "Sub-county not found"})
                    return
                json_response(self, 200, subcounty_analysis(feature))
                return

            if path.startswith("/api/analysis/ward/"):
                identifier = path.split("/api/analysis/ward/", 1)[1]
                feature = find_ward(identifier)
                if not feature:
                    json_response(self, 404, {"error": "Ward not found"})
                    return
                json_response(self, 200, ward_analysis(feature))
                return

            if serve_frontend_asset(self, parsed.path):
                return

            json_response(self, 404, {"error": "Not found", "path": path})
        except Exception as exc:
            json_response(self, 500, {"error": str(exc)})

    def log_message(self, format: str, *args) -> None:
        print(f"[AEIS-K] {self.address_string()} - {format % args}")


def create_server(host: str = HOST, port: int = PORT) -> ThreadingHTTPServer:
    init_auth_db()
    return ThreadingHTTPServer((host, port), AEISHandler)


def main() -> None:
    server = create_server()
    print(f"AEIS-K backend running at http://{HOST}:{PORT}")
    print("Press Ctrl+C to stop.")
    server.serve_forever()


if __name__ == "__main__":
    main()
