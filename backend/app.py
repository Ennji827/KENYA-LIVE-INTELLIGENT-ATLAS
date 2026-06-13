from __future__ import annotations

import hashlib
import json
import re
import secrets
import sqlite3
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse


HOST = "0.0.0.0"
PORT = 5000
PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = PROJECT_ROOT / "frontend" / "public" / "data"
DB_PATH = PROJECT_ROOT / "backend" / "aeis.sqlite"

_GEOJSON_CACHE: dict[str, dict] = {}
_COUNTY_WARD_CACHE: dict[str, int] = {}
_WARD_CENTER_CACHE: list[tuple[float, float]] | None = None


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def slugify(value: str) -> str:
    text = re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")
    return text or "county"


def password_hash(password: str, salt: str) -> str:
    return hashlib.sha256(f"{salt}:{password}".encode("utf-8")).hexdigest()


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

        existing = conn.execute("SELECT COUNT(*) FROM county_users").fetchone()[0]
        if existing:
            return

        for feature in counties():
            name = county_name(feature)
            code = county_code(feature)
            salt = secrets.token_hex(12)
            username = f"{slugify(name)}_county"
            conn.execute(
                """
                INSERT INTO county_users
                    (county_code, county_name, username, password_hash, salt, role, created_at)
                VALUES (?, ?, ?, ?, ?, 'county', ?)
                """,
                (code, name, username, password_hash("county123", salt), salt, now_iso()),
            )


def authenticate_county_login(payload: dict) -> tuple[int, dict]:
    county_identifier = str(payload.get("county_code") or payload.get("county") or "").strip()
    username = str(payload.get("username") or "").strip()
    password = str(payload.get("password") or "")
    latitude = payload.get("latitude")
    longitude = payload.get("longitude")

    if not county_identifier or not username or not password:
        return 400, {"error": "county_code, username, and password are required"}

    if latitude is None or longitude is None:
        return 400, {"error": "GPS latitude and longitude are required"}

    try:
        lat = float(latitude)
        lon = float(longitude)
    except (TypeError, ValueError):
        return 400, {"error": "GPS latitude and longitude must be numbers"}

    feature = find_county(county_identifier)
    if not feature:
        return 404, {"error": "County not found"}

    if not point_in_feature((lon, lat), feature):
        return 403, {
            "error": "GPS check failed. Login is allowed only from inside the county boundary.",
            "gps_status": "outside_county",
            "county": county_name(feature),
            "county_code": county_code(feature),
        }

    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT * FROM county_users WHERE username = ? AND county_code = ?",
            (username, county_code(feature)),
        ).fetchone()

    if not row or password_hash(password, row["salt"]) != row["password_hash"]:
        return 401, {"error": "Invalid county credentials"}

    token_seed = f"{row['username']}:{row['county_code']}:{now_iso()}:{secrets.token_hex(8)}"
    token = hashlib.sha256(token_seed.encode("utf-8")).hexdigest()
    return 200, {
        "token": token,
        "role": "county",
        "county": row["county_name"],
        "county_code": row["county_code"],
        "username": row["username"],
        "gps_status": "inside_county",
        "boundary_scope": "county_only",
        "expires_in_seconds": 28800,
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
    return feature.get("properties", {}).get("ADM1_PCODE", "")


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
        if needle in {name, code}:
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
        "data_mode": "demo_baseline",
        "method": "Deterministic baseline values for setup. Replace provider with Sentinel/NASA/live field data for production.",
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
    handler.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


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

            json_response(self, 404, {"error": "Not found", "path": path})
        except Exception as exc:
            json_response(self, 500, {"error": str(exc)})

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"

        try:
            if path == "/":
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

            if path == "/api/metadata":
                json_response(
                    self,
                    200,
                    {
                        "country": "Kenya",
                        "admin_levels": ["county", "subcounty", "ward", "farm"],
                        "auth": {
                            "county_login": True,
                            "gps_geofence": True,
                            "storage": "sqlite",
                        },
                        "analysis_layers": [
                            "crop_health",
                            "soil_moisture",
                            "crop_strength",
                            "land_use",
                            "ndbi",
                            "ndwi",
                            "weather",
                            "forest_trend",
                            "roads",
                        ],
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
