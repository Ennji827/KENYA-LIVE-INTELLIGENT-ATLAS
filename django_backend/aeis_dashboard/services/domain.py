from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import math
import os
import socket
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import unquote, urlencode
from urllib.request import Request, urlopen

from django.core.cache import cache

PROJECT_ROOT = Path(__file__).resolve().parents[3]
DATA_DIR = PROJECT_ROOT / "frontend" / "public" / "data"
SESSION_SECONDS = 8 * 60 * 60
DEFAULT_COUNTY_PASSWORD = "county123"
DEFAULT_MINISTRY_PASSWORD = "ministry123"
DEFAULT_ANALYST_PASSWORD = "analyst123"
DEFAULT_AUDITOR_PASSWORD = "auditor123"


def env_flag(name: str, default: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def public_access_mode() -> bool:
    return env_flag("AEIS_PUBLIC_ACCESS", False)


def get_system_setting(key: str, default: str = "") -> str:
    from aeis_dashboard.models import SystemSetting

    setting = SystemSetting.objects.filter(key=key).only("value").first()
    return setting.value if setting else default


def set_system_setting(key: str, value: str) -> None:
    from aeis_dashboard.models import SystemSetting

    SystemSetting.objects.update_or_create(key=key, defaults={"value": value})


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
    {
        "county_code": "000",
        "county_name": "National",
        "username": "national_auditor",
        "email": "national.auditor@aeis-k.local",
        "role": "auditor",
        "provider": "password",
        "password": DEFAULT_AUDITOR_PASSWORD,
        "command_center": "AEIS-K National Audit Workspace",
        "boundary_scope": "national_read_only",
        "permissions": [
            "audit_read",
            "report_read",
            "data_quality_read",
            "system_health_read",
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
_GEOJSON_LOCK = threading.RLock()
_COUNTY_WARD_CACHE: dict[str, int] = {}
_WARD_CENTER_CACHE: list[tuple[float, float]] | None = None
_OSM_SEGMENT_CACHE: dict[str, dict] = {}
_COUNTY_LIST_CACHE: list[dict] | None = None
_COUNTY_LIST_LOCK = threading.Lock()
_COUNTRY_ANALYSIS_CACHE: dict | None = None
_COUNTRY_ANALYSIS_LOCK = threading.Lock()

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
    from aeis_dashboard.models import (
        Alert,
        DataAsset,
        ExternalDataSource,
        FieldReport,
        IntelligenceInsight,
        IntelligenceReport,
        ProcessingJob,
    )

    county_rows = dashboard_county_rows()
    count = len(county_rows)
    configured_rasters = gee_layers_payload()["configured_layers"]
    connected_sources = 4 + ExternalDataSource.objects.filter(enabled=True).count()
    if configured_rasters:
        connected_sources += 1
    operational = {
        "connectedSources": connected_sources,
        "uploadedAssets": DataAsset.objects.count(),
        "reportsReady": IntelligenceReport.objects.count(),
        "publishedReports": IntelligenceReport.objects.filter(
            status=IntelligenceReport.Status.PUBLISHED
        ).count(),
        "openAlerts": Alert.objects.exclude(status=Alert.Status.RESOLVED).count(),
        "fieldReports": FieldReport.objects.count(),
        "verifiedFieldReports": FieldReport.objects.filter(
            verification_status=FieldReport.VerificationStatus.VERIFIED
        ).count(),
        "intelligenceInsights": IntelligenceInsight.objects.count(),
        "activeJobs": ProcessingJob.objects.filter(
            status__in=[ProcessingJob.Status.QUEUED, ProcessingJob.Status.RUNNING]
        ).count(),
        "configuredRasterLayers": configured_rasters,
    }
    return {
        "summary": {
            "title": "AEIS-K Intelligence Dashboard",
            "subtitle": "Agro-Environmental Intelligence System for Kenya",
            **operational,
            "countiesTracked": count,
            "weatherCoverage": count,
            "boundaryCoverage": count,
            "dataGaps": [
                "Provider-backed NDVI/NDWI analytical rasters",
                "Verified county farmer and farm-boundary registries",
                "Classified land-cover percentages",
                "Soil-test and fertilizer-demand records",
            ],
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
    from django.utils import timezone as django_timezone

    from aeis_dashboard.models import AccessSession

    sessions = AccessSession.objects.filter(expires_at__gt=django_timezone.now())
    if county_name_value:
        sessions = sessions.filter(user__county_name=county_name_value)
    return sessions.count()


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
        "live_url": f"http://{lan_ip}:8000",
        "local_live_url": "http://127.0.0.1:8000",
        "frontend_dev_url": f"http://{lan_ip}:5173",
        "backend_url": f"http://{lan_ip}:8000",
        "public_url": os.environ.get("AEIS_PUBLIC_URL", "").strip(),
        "public_access": {
            "enabled": public_access_mode(),
            "locked": public_access_locked(),
            "show_demo_credentials": reveal_demo,
            "remote_county_demo_enabled": remote_county_demo_enabled(),
            "lock_meaning": "Locked public mode hides test passwords and blocks remote county GPS bypass.",
        },
        "same_network": "Other machines on the same Wi-Fi/LAN can use the live URL when firewall allows port 8000.",
        "outside_network": "Use start-public-tunnel.ps1 to publish a temporary HTTPS Cloudflare Quick Tunnel link for outside-network testing.",
        "demo_county_password": DEFAULT_COUNTY_PASSWORD if reveal_demo else "",
        "demo_ministry_password": DEFAULT_MINISTRY_PASSWORD if reveal_demo else "",
        "demo_analyst_password": DEFAULT_ANALYST_PASSWORD if reveal_demo else "",
        "demo_auditor_password": DEFAULT_AUDITOR_PASSWORD if reveal_demo else "",
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
        "national_login": "Use an approved national officer or analyst email with password. National sessions are audited by Django.",
        "live_mode": "Run .\\start.ps1. Django serves the built dashboard and API from one URL.",
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
            "forecast_days": 10,
            "timezone": "Africa/Nairobi",
            "models": "best_match",
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
    cache_key = f"weather:county:{code}:v2"
    stale_key = f"{cache_key}:stale"
    cached = cache.get(cache_key)
    if cached:
        return {**cached, "cached": True}

    latitude, longitude = county_weather_center(feature)
    try:
        request = Request(
            open_meteo_url(latitude, longitude),
            headers={"User-Agent": "AEIS-K/0.1 county weather forecast"},
        )
        with urlopen(request, timeout=4) as response:
            provider_payload = json.loads(response.read().decode("utf-8"))
        current = provider_payload.get("current") or {}
        daily = parse_open_meteo_daily(provider_payload)
        risk = weather_risk(daily)
        result = {
            "provider": "Open-Meteo forecast API",
            "provider_status": "live",
            "access": "open_api_no_key",
            "model_selection": "best_match",
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
        cache.set(cache_key, result, 15 * 60)
        cache.set(stale_key, result, 6 * 60 * 60)
        return result
    except (HTTPError, URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError) as exc:
        stale = cache.get(stale_key)
        if stale:
            return {
                **stale,
                "provider_status": "stale",
                "cached": True,
                "warning": f"Live provider unavailable; serving the last successful forecast: {exc}",
            }
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

    cache_key = "weather:national:v2"
    stale_key = f"{cache_key}:stale"
    lock_key = f"{cache_key}:refreshing"
    cached = cache.get(cache_key)
    if cached:
        return 200, {**cached, "cached": True}

    owns_lock = cache.add(lock_key, "1", 60)
    if not owns_lock:
        for _ in range(60):
            time.sleep(0.1)
            cached = cache.get(cache_key)
            if cached:
                return 200, {**cached, "cached": True}
        stale = cache.get(stale_key)
        if stale:
            return 200, {**stale, "provider_status": "stale", "cached": True}

    try:
        features = sorted(counties(), key=lambda feature: county_code(feature))
        forecasts = []
        with ThreadPoolExecutor(max_workers=16) as executor:
            future_map = {executor.submit(fetch_weather_for_county, feature): feature for feature in features}
            for future in as_completed(future_map):
                forecasts.append(future.result())

        forecasts.sort(key=lambda row: row.get("county_code") or "")
        live_count = sum(1 for row in forecasts if row.get("provider_status") in {"live", "stale"})
        watch_counties = [
            row
            for row in forecasts
            if row.get("risk") in {"High", "Medium", "Heat / dry watch"}
        ][:10]
        total_rain = sum(
            sum((day.get("precipitation_sum") or 0) for day in row.get("daily", [])[:3])
            for row in forecasts
        )
        payload = {
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
        cache.set(cache_key, payload, 5 * 60)
        cache.set(stale_key, payload, 60 * 60)
        return 200, payload
    finally:
        if owns_lock:
            cache.delete(lock_key)


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
            "evidence": f"Django ORM auth active; {active_sessions} active county sessions",
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
        "Use /api/indices/evaluate to validate real band values from a verified county raster.",
        "Start with a verified Nyandarua raster extract, then compare AEIS-K outcome against field reports.",
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


def national_account_for_role(role: str) -> dict | None:
    normalized = str(role or "").lower()
    return next((account for account in NATIONAL_AUTH_ACCOUNTS if account["role"] == normalized), None)


def load_geojson(*filenames: str) -> dict:
    cache_key = filenames[0]
    if cache_key in _GEOJSON_CACHE:
        return _GEOJSON_CACHE[cache_key]

    with _GEOJSON_LOCK:
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
    "hospitals": {
        "label": "Hospitals",
        "color": "#dc2626",
        "selectors": [
            'node["amenity"~"hospital|clinic|health_centre"]',
            'way["amenity"~"hospital|clinic|health_centre"]',
            'relation["amenity"~"hospital|clinic|health_centre"]',
            'node["healthcare"~"hospital|clinic|centre"]',
            'way["healthcare"~"hospital|clinic|centre"]',
        ],
    },
    "roads": {
        "label": "Roads",
        "color": "#475569",
        "selectors": [
            'way["highway"~"motorway|trunk|primary|secondary|tertiary|unclassified|residential"]',
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


def _ring_area_square_metres(ring: list[list[float]]) -> float:
    if len(ring) < 3:
        return 0.0
    earth_radius = 6_378_137.0
    total = 0.0
    for index, point in enumerate(ring):
        next_point = ring[(index + 1) % len(ring)]
        lon1, lat1 = math.radians(point[0]), math.radians(point[1])
        lon2, lat2 = math.radians(next_point[0]), math.radians(next_point[1])
        total += (lon2 - lon1) * (2 + math.sin(lat1) + math.sin(lat2))
    return abs(total * earth_radius * earth_radius / 2)


def _polygon_area_square_metres(polygon: list) -> float:
    if not polygon:
        return 0.0
    outer = _ring_area_square_metres(polygon[0])
    holes = sum(_ring_area_square_metres(ring) for ring in polygon[1:])
    return max(0.0, outer - holes)


def geometry_area_square_metres(geometry: dict) -> float:
    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates") or []
    if geometry_type == "Polygon":
        return _polygon_area_square_metres(coordinates)
    if geometry_type == "MultiPolygon":
        return sum(_polygon_area_square_metres(polygon) for polygon in coordinates)
    return 0.0


def estimate_area_ha(feature: dict) -> float:
    square_metres = geometry_area_square_metres(feature.get("geometry") or {})
    return round(square_metres / 10_000, 2)


def calculate_area_metrics(geometry: dict) -> dict:
    area_ha = estimate_area_ha({"geometry": geometry})
    return {
        "generated_at": now_iso(),
        "area_ha": area_ha,
        "area_km2": round(area_ha / 100, 2),
        "area_method": "spherical_polygon",
        "data_mode": "source_required",
        "risk": {"score": None, "level": "source_required"},
        "trend": [],
        "indices": {"ndvi": None, "ndwi": None, "ndbi": None, "status": "source_required"},
        "crop_health": {"ndvi": None, "status": "source_required"},
        "soil_moisture": {"index": None, "status": "source_required"},
        "crop_strength": {"index": None, "status": "source_required"},
        "land_use": {"status": "source_required"},
        "recommendations": [
            "Area is calculated from the submitted GeoJSON. Connect raster and field sources before publishing crop or risk metrics."
        ],
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
    with urlopen(request, timeout=12) as response:
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


def county_analysis(feature: dict) -> dict:
    name = county_name(feature)
    code = county_code(feature)
    area_ha = estimate_area_ha(feature)
    return {
        "county": name,
        "county_code": code,
        "admin_level": "county",
        "generated_at": now_iso(),
        "area_km2": round(area_ha / 100, 2),
        "area_ha": area_ha,
        "data_mode": "source_required",
        "method": "Boundary metadata is loaded. NDVI, NDWI, NDBI, rainfall history, land-cover percentages, and crop-risk analytics require connected providers.",
        "admin_units": {
            "subcounties": county_subcounty_count(name),
            "wards": ward_count_for_county(feature),
        },
        "indices": {"ndvi": None, "ndwi": None, "ndbi": None, "status": "source_required"},
        "crop_health": {"ndvi": None, "status": "source_required"},
        "soil_moisture": {"index": None, "status": "source_required"},
        "crop_strength": {"index": None, "status": "source_required"},
        "land_use": {
            "cropland": None,
            "grassland": None,
            "forest": None,
            "water": None,
            "built_up": None,
            "bare_land": None,
            "status": "source_required",
        },
        "infrastructure": {
            "buildings": None,
            "roads_km": None,
            "road_types": {},
            "status": "use_segmentation_endpoint",
        },
        "weather": {"status": "use_live_forecast_endpoint", "endpoint": "/api/weather/forecast"},
        "forest_trend": [],
        "trend": [],
        "risk": {"score": None, "level": "source_required"},
        "recommendations": [
            f"Connect source-dated NDVI/NDWI rasters, land-cover classification, official rainfall history, and verified registry data for {name}."
        ],
        "alerts": [],
    }


def subcounty_analysis(feature: dict) -> dict:
    name = subcounty_name(feature)
    code = subcounty_code(feature)
    area_ha = estimate_area_ha(feature)
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
        "data_mode": "source_required",
        "method": "Boundary metadata is loaded. Sub-county analytics require connected raster, weather, land-cover, and registry providers.",
        "admin_units": {
            "wards": sum(
                1
                for ward in wards()
                if ward.get("properties", {}).get("ADM2_PCODE") == code
                or ward.get("properties", {}).get("ADM2_EN") == name
            ),
        },
        "indices": {"ndvi": None, "ndwi": None, "ndbi": None, "status": "source_required"},
        "crop_health": {"ndvi": None, "status": "source_required"},
        "soil_moisture": {"index": None, "status": "source_required"},
        "crop_strength": {"index": None, "status": "source_required"},
        "land_use": {"status": "source_required"},
        "weather": {"status": "use_live_forecast_endpoint", "endpoint": "/api/weather/forecast"},
        "trend": [],
        "risk": {"score": None, "level": "source_required"},
        "recommendations": [f"Connect provider-backed data before publishing sub-county analytics for {name}."],
        "alerts": [],
    }


def ward_analysis(feature: dict) -> dict:
    name = ward_name(feature)
    code = ward_code(feature)
    area_ha = estimate_area_ha(feature)
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
        "data_mode": "source_required",
        "method": "Boundary metadata is loaded. Ward analytics require connected raster, weather, land-cover, and registry providers.",
        "indices": {"ndvi": None, "ndwi": None, "ndbi": None, "status": "source_required"},
        "crop_health": {"ndvi": None, "status": "source_required"},
        "soil_moisture": {"index": None, "status": "source_required"},
        "crop_strength": {"index": None, "status": "source_required"},
        "land_use": {"status": "source_required"},
        "weather": {"status": "use_live_forecast_endpoint", "endpoint": "/api/weather/forecast"},
        "trend": [],
        "risk": {"score": None, "level": "source_required"},
        "recommendations": [f"Connect provider-backed data before publishing ward analytics for {name}."],
        "alerts": [],
    }


def country_analysis() -> dict:
    global _COUNTRY_ANALYSIS_CACHE
    if _COUNTRY_ANALYSIS_CACHE is not None:
        return _COUNTRY_ANALYSIS_CACHE

    with _COUNTRY_ANALYSIS_LOCK:
        if _COUNTRY_ANALYSIS_CACHE is not None:
            return _COUNTRY_ANALYSIS_CACHE

        _COUNTRY_ANALYSIS_CACHE = _build_country_analysis()
        return _COUNTRY_ANALYSIS_CACHE


def _build_country_analysis() -> dict:
    county_rows = []
    for feature in counties():
        area_ha = estimate_area_ha(feature)
        county_rows.append(
            {
                "county": county_name(feature),
                "county_code": county_code(feature),
                "area_km2": round(area_ha / 100, 2),
                "area_ha": area_ha,
                "indices": {"ndvi": None, "ndwi": None, "ndbi": None, "status": "source_required"},
                "crop_health": {"ndvi": None, "status": "source_required"},
                "soil_moisture": {"index": None, "status": "source_required"},
                "crop_strength": {"index": None, "status": "source_required"},
                "land_use": {"status": "source_required"},
                "risk": {"score": None, "level": "source_required"},
            }
        )

    return {
        "country": "Kenya",
        "admin_level": "country",
        "generated_at": now_iso(),
        "data_mode": "source_required",
        "method": "National boundary coverage is loaded. National NDVI, NDWI, NDBI, rainfall history, land-cover, and crop-risk analytics require connected providers.",
        "area_km2": round(sum(row["area_km2"] for row in county_rows), 2),
        "admin_units": {
            "counties": len(counties()),
            "subcounties": len(subcounties()),
            "wards": len(wards()),
        },
        "indices": {"ndvi": None, "ndwi": None, "ndbi": None, "status": "source_required"},
        "crop_health": {"ndvi": None, "status": "source_required"},
        "soil_moisture": {"index": None, "status": "source_required"},
        "crop_strength": {"index": None, "status": "source_required"},
        "land_use": {"status": "source_required"},
        "infrastructure": {"roads_km": None, "road_types": {}},
        "weather": {"status": "use_live_forecast_endpoint", "endpoint": "/api/weather/forecast"},
        "forest_trend": [],
        "trend": [],
        "risk": {"score": None, "level": "source_required"},
        "priority_counties": [],
        "recommendations": ["Connect provider-backed national datasets before publishing national risk ranking or crop decisions."],
        "counties": county_rows,
    }


def automation_status() -> dict:
    analysis = country_analysis()
    return {
        "mode": "source_status",
        "status": "source_required",
        "generated_at": now_iso(),
        "refresh_seconds": 60,
        "coverage": analysis["admin_units"],
        "national_risk": analysis["risk"],
        "risk_distribution": {"source_required": len(analysis["counties"])},
        "priority_counties": [],
        "automation_actions": [
            "Keep national boundary hierarchy ready for drill-down monitoring.",
            "Use /api/weather/forecast for live forecast context.",
            "Connect GEE/Sentinel/Landsat raster providers before ranking counties by crop, moisture, or built-up pressure.",
            "Connect official land-cover, rainfall history, registry, and field validation sources before publishing automation alerts.",
        ],
    }


def county_list() -> list[dict]:
    global _COUNTY_LIST_CACHE
    if _COUNTY_LIST_CACHE is not None:
        return _COUNTY_LIST_CACHE

    with _COUNTY_LIST_LOCK:
        if _COUNTY_LIST_CACHE is None:
            _COUNTY_LIST_CACHE = [
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
    return _COUNTY_LIST_CACHE
