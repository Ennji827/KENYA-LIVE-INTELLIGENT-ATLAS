from __future__ import annotations

from calendar import monthrange
from concurrent.futures import ThreadPoolExecutor, as_completed
import csv
import hashlib
import json
import math
import re
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import UploadedFile
from django.core.validators import URLValidator
from django.db import transaction
from django.db.models import Count as models_count, Max as models_max, Q
from django.utils.text import slugify

from aeis_dashboard.models import (
    Alert,
    DataAsset,
    DataQualityAssessment,
    EnvironmentalMetricObservation,
    ExternalDataSource,
    FieldReport,
    IntelligenceReport,
    MonthlyClimateObservation,
)

from . import domain


NASA_POWER_URL = "https://power.larc.nasa.gov/api/temporal"
COPERNICUS_STAC_SEARCH_URL = "https://stac.dataspace.copernicus.eu/v1/search"
LANDSAT_STAC_SEARCH_URL = "https://landsatlook.usgs.gov/stac-server/search"
DEAFRICA_STAC_SEARCH_URL = "https://explorer.digitalearth.africa/stac/search"
DEAFRICA_WMS_URL = "https://ows.digitalearth.africa/wms"
DEAFRICA_WMS_CAPABILITIES_URL = f"{DEAFRICA_WMS_URL}?service=WMS&request=GetCapabilities&version=1.3.0"
SOILGRIDS_PROPERTIES_URL = "https://rest.isric.org/soilgrids/v2.0/properties/query"
MAX_HISTORY_DAYS = 366 * 22
MAX_UPLOAD_BYTES = 100 * 1024 * 1024
GEOJSON_PARSE_LIMIT = 30 * 1024 * 1024
ALLOWED_PARAMETERS = {
    "PRECTOTCORR",
    "T2M",
    "T2M_MAX",
    "T2M_MIN",
    "RH2M",
    "WS2M",
    "ALLSKY_SFC_SW_DWN",
}
DEFAULT_PARAMETERS = ["PRECTOTCORR", "T2M", "T2M_MAX", "T2M_MIN", "RH2M", "WS2M"]
MONTHLY_INTELLIGENCE_PARAMETERS = [
    "PRECTOTCORR",
    "T2M",
    "T2M_MAX",
    "T2M_MIN",
    "RH2M",
    "WS2M",
    "ALLSKY_SFC_SW_DWN",
]
ENVIRONMENTAL_METRIC_CATALOG = {
    "ndvi": {"label": "NDVI", "category": "vegetation", "unit": "index", "min": -1, "max": 1},
    "ndwi": {"label": "NDWI", "category": "water", "unit": "index", "min": -1, "max": 1},
    "lst_c": {"label": "Land surface temperature", "category": "vegetation", "unit": "Â°C", "min": -30, "max": 80},
    "water_extent_ha": {"label": "Surface water extent", "category": "water", "unit": "ha", "min": 0, "max": 10000000},
    "water_extent_pct": {"label": "Surface water share", "category": "water", "unit": "%", "min": 0, "max": 100},
    "forest_cover_ha": {"label": "Forest cover", "category": "forest", "unit": "ha", "min": 0, "max": 10000000},
    "forest_cover_pct": {"label": "Forest cover share", "category": "forest", "unit": "%", "min": 0, "max": 100},
    "tree_cover_pct": {"label": "Tree cover share", "category": "forest", "unit": "%", "min": 0, "max": 100},
    "cropland_pct": {"label": "Cropland share", "category": "landuse", "unit": "%", "min": 0, "max": 100},
    "built_up_pct": {"label": "Built-up / housing share", "category": "landuse", "unit": "%", "min": 0, "max": 100},
    "grassland_pct": {"label": "Grassland / shrubland share", "category": "landuse", "unit": "%", "min": 0, "max": 100},
    "bare_land_pct": {"label": "Bare / sparse land share", "category": "landuse", "unit": "%", "min": 0, "max": 100},
    "land_use_share_pct": {"label": "Land-use class share", "category": "landuse", "unit": "%", "min": 0, "max": 100},
    "tarmac_road_km": {"label": "Tarmac road length", "category": "roads", "unit": "km", "min": 0, "max": 1000000},
    "all_weather_road_km": {"label": "All-weather road length", "category": "roads", "unit": "km", "min": 0, "max": 1000000},
    "road_density_km_per_100sqkm": {"label": "Road density", "category": "roads", "unit": "km/100 kmÂ²", "min": 0, "max": 5000},
    "soil_organic_carbon_pct": {"label": "Soil organic carbon", "category": "soil", "unit": "%", "min": 0, "max": 30},
    "soil_ph": {"label": "Soil pH", "category": "soil", "unit": "pH", "min": 0, "max": 14},
    "soil_moisture_pct": {"label": "Soil moisture", "category": "soil", "unit": "%", "min": 0, "max": 100},
}
FILE_FORMATS = {
    ".geojson": ("geojson", DataAsset.AssetType.VECTOR),
    ".json": ("geojson", DataAsset.AssetType.VECTOR),
    ".gpkg": ("gpkg", DataAsset.AssetType.VECTOR),
    ".tif": ("geotiff", DataAsset.AssetType.RASTER),
    ".tiff": ("geotiff", DataAsset.AssetType.RASTER),
    ".csv": ("csv", DataAsset.AssetType.TABULAR),
    ".zip": ("shapefile_zip", DataAsset.AssetType.ARCHIVE),
}


class DataSourceError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


BUILTIN_SOURCES = [
    {
        "slug": "open-meteo",
        "name": "Open-Meteo live forecast",
        "provider": "Open-Meteo",
        "source_type": "climate",
        "coverage_start": None,
        "coverage_end": None,
        "latest_available": "live",
        "requires_auth": False,
        "enabled": True,
        "access": "connected",
        "endpoints": {
            "forecast": "/api/weather/forecast",
            "documentation": "https://open-meteo.com/en/docs",
        },
        "description": "Key-free ten-day weather forecasts using the provider's best-match model.",
    },
    {
        "slug": "kenya-meteorological-department",
        "name": "Kenya Meteorological Department official weather and climate data",
        "provider": "Kenya Meteorological Department",
        "source_type": "climate",
        "coverage_start": None,
        "coverage_end": None,
        "latest_available": "publication-dependent",
        "requires_auth": False,
        "enabled": True,
        "access": "source_required",
        "endpoints": {
            "website": "https://meteo.go.ke/",
            "maproom": "http://kmddl.meteo.go.ke:8081/",
            "climate_data_management": "https://meteo.go.ke/",
        },
        "description": "Preferred local source for official station rainfall, monthly forecasts, seasonal forecasts, agrometeorological bulletins, and climate data management. Connect via API, reviewed CSV, or licensed data export before publishing official county figures.",
    },
    {
        "slug": "kalro-kaop-weather",
        "name": "KALRO / KAOP agro-weather and advisory data",
        "provider": "Kenya Agricultural and Livestock Research Organization",
        "source_type": "climate",
        "coverage_start": None,
        "coverage_end": None,
        "latest_available": "publication-dependent",
        "requires_auth": False,
        "enabled": True,
        "access": "source_required",
        "endpoints": {
            "kaop": "https://kaop.co.ke/",
            "documentation": "https://www.kalro.org/",
        },
        "description": "Preferred local agro-weather and advisory source when KALRO/KAOP data access is available. Use for county and crop-zone weather context after an API key, data-sharing agreement, or reviewed export is connected.",
    },
    {
        "slug": "county-field-site-registry",
        "name": "County field and site registry",
        "provider": "County Government / Ministry of Agriculture",
        "source_type": "registry",
        "coverage_start": None,
        "coverage_end": None,
        "latest_available": "county-dependent",
        "requires_auth": False,
        "enabled": True,
        "access": "source_required",
        "endpoints": {
            "nakuru_county": "https://www.nakuru.go.ke/",
            "upload": "/api/data/assets/upload",
        },
        "description": "Verified county field, farm, irrigation, soil-test, site-boundary, and mapped-area records. Import reviewed CSV/GeoJSON/GPKG records before publishing county site counts or mapped area.",
    },
    {
        "slug": "moald-kamis-kiamis",
        "name": "MoALD KAMIS/KIAMIS agricultural registry feeds",
        "provider": "Ministry of Agriculture and Livestock Development",
        "source_type": "registry",
        "coverage_start": None,
        "coverage_end": None,
        "latest_available": "access-dependent",
        "requires_auth": True,
        "enabled": True,
        "access": "source_required",
        "endpoints": {
            "ministry": "https://kilimo.go.ke/",
            "upload": "/api/data/assets/upload",
        },
        "description": "Potential official farmer/site/production registry source. Connect only after authorized access or reviewed exports are available.",
    },
    {
        "slug": "nasa-power",
        "name": "NASA POWER climate history",
        "provider": "NASA Langley Research Center",
        "source_type": "climate",
        "coverage_start": "1981-01-01",
        "coverage_end": None,
        "latest_available": "near-real-time",
        "requires_auth": False,
        "enabled": True,
        "access": "connected",
        "endpoints": {
            "history": "/api/data/history/nasa-power",
            "monthly_intelligence": "/api/data/intelligence/monthly",
            "documentation": "https://power.larc.nasa.gov/docs/services/api/temporal/",
        },
        "description": "Daily and monthly precipitation, temperature, humidity, wind, and solar data.",
    },
    {
        "slug": "copernicus-sentinel-2",
        "name": "Copernicus Sentinel-2 catalogue",
        "provider": "Copernicus Data Space Ecosystem",
        "source_type": "imagery",
        "coverage_start": "2015-06-27",
        "coverage_end": None,
        "latest_available": "present",
        "requires_auth": False,
        "enabled": True,
        "access": "connected_catalogue",
        "endpoints": {
            "search": "/api/data/imagery/sentinel-2",
            "documentation": "https://documentation.dataspace.copernicus.eu/APIs/STAC.html",
        },
        "description": "Sentinel-2 Level-1C and Level-2A scene discovery with acquisition and cloud metadata.",
    },
    {
        "slug": "usgs-landsat",
        "name": "USGS Landsat Collection 2",
        "provider": "U.S. Geological Survey",
        "source_type": "imagery",
        "coverage_start": "1972-01-01",
        "coverage_end": None,
        "latest_available": "present",
        "requires_auth": False,
        "enabled": True,
        "access": "connected_catalogue",
        "endpoints": {
            "latest": "/api/data/imagery/landsat/latest",
            "documentation": "https://landsatlook.usgs.gov/stac-server/",
        },
        "description": "Public Collection 2 scene search and dated browse imagery from the official USGS LandsatLook STAC API.",
    },
    {
        "slug": "google-earth-engine",
        "name": "Google Earth Engine raster layers",
        "provider": "Google Earth Engine",
        "source_type": "imagery",
        "coverage_start": "2015-06-27",
        "coverage_end": None,
        "latest_available": "present",
        "requires_auth": True,
        "enabled": True,
        "access": "configured" if domain.gee_layers_payload()["configured_layers"] else "configuration_required",
        "endpoints": {
            "status": "/api/gee/layers",
            "documentation": "https://developers.google.com/earth-engine/datasets/catalog/sentinel-2",
        },
        "description": "Provider-rendered NDVI, NDWI, and land-surface-temperature tile layers.",
    },
    {
        "slug": "dynamic-world",
        "name": "Dynamic World near-real-time land cover",
        "provider": "Google / World Resources Institute",
        "source_type": "landcover",
        "coverage_start": "2015-06-27",
        "coverage_end": None,
        "latest_available": "near-real-time",
        "requires_auth": True,
        "enabled": True,
        "access": "source_required",
        "endpoints": {
            "documentation": "https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_DYNAMICWORLD_V1",
            "metric_import": "/api/data/intelligence/metrics",
        },
        "description": "Near-real-time global land-cover probabilities derived from Sentinel-2. Use reviewed zonal statistics before publishing land-use percentages.",
    },
    {
        "slug": "knbs-statistical-portals",
        "name": "KNBS statistical and county data portals",
        "provider": "Kenya National Bureau of Statistics",
        "source_type": "other",
        "coverage_start": None,
        "coverage_end": None,
        "latest_available": "publication-dependent",
        "requires_auth": False,
        "enabled": True,
        "access": "source_required",
        "endpoints": {
            "documentation": "https://www.knbs.or.ke/",
        },
        "description": "Official statistical tables for county indicators, land use, population, housing, and infrastructure. Connect as reviewed CSV/API extracts before publishing official county percentages.",
    },
    {
        "slug": "jrc-global-surface-water",
        "name": "Global Surface Water history",
        "provider": "European Commission Joint Research Centre",
        "source_type": "water",
        "coverage_start": "1984-03-01",
        "coverage_end": None,
        "latest_available": "annual product",
        "requires_auth": False,
        "enabled": True,
        "access": "source_required",
        "endpoints": {
            "documentation": "https://global-surface-water.appspot.com/",
        },
        "description": "Long-running global surface-water occurrence, seasonality, transitions, and yearly history for water expansion/shrinkage consoles.",
    },
    {
        "slug": "esa-worldcover",
        "name": "ESA WorldCover land-cover classes",
        "provider": "European Space Agency",
        "source_type": "landcover",
        "coverage_start": "2020-01-01",
        "coverage_end": None,
        "latest_available": "latest annual release",
        "requires_auth": False,
        "enabled": True,
        "access": "source_required",
        "endpoints": {
            "documentation": "https://esa-worldcover.org/",
        },
        "description": "Global land-cover products for cropland, tree cover, built-up area, grassland, bare/sparse land, and water classification.",
    },
    {
        "slug": "isric-soilgrids",
        "name": "SoilGrids soil properties",
        "provider": "ISRIC - World Soil Information",
        "source_type": "soil",
        "coverage_start": None,
        "coverage_end": None,
        "latest_available": "current model",
        "requires_auth": False,
        "enabled": True,
        "access": "connected_catalogue",
        "endpoints": {
            "point": "/api/data/soil/soilgrids",
            "documentation": "https://soilgrids.org/",
        },
        "description": "Global gridded soil organic carbon, texture, pH, bulk density, and related soil-property layers.",
    },
    {
        "slug": "openstreetmap-roads",
        "name": "OpenStreetMap road network",
        "provider": "OpenStreetMap contributors",
        "source_type": "infrastructure",
        "coverage_start": None,
        "coverage_end": None,
        "latest_available": "community-updated",
        "requires_auth": False,
        "enabled": True,
        "access": "connected_catalogue",
        "endpoints": {
            "segmentation": "/api/segmentation/roads",
            "documentation": "https://wiki.openstreetmap.org/wiki/Map_features#Highway",
        },
        "description": "Road geometry and tags for highway class, surface, and access. Use with QA before publishing tarmac/all-weather road metrics.",
    },
    {
        "slug": "kenya-roads-board",
        "name": "Kenya road classification records",
        "provider": "Kenya Roads Board / official road agencies",
        "source_type": "infrastructure",
        "coverage_start": None,
        "coverage_end": None,
        "latest_available": "publication-dependent",
        "requires_auth": False,
        "enabled": True,
        "access": "source_required",
        "endpoints": {
            "documentation": "https://krb.go.ke/",
        },
        "description": "Authoritative national/county road classifications and road condition records, recommended for tarmac and all-weather road dashboards.",
    },
]


def _iso(value) -> str | None:
    return value.isoformat() if value else None


def source_catalog() -> dict:
    today = date.today()
    recommended_start = date(today.year - 20, 1, 1)
    monthly_sources = {
        row["source_slug"]: row
        for row in MonthlyClimateObservation.objects.values("source_slug")
        .annotate(count=models_count("id"), latest=models_max("observation_month"))
    }
    metric_sources = {
        row["source_slug"]: row
        for row in EnvironmentalMetricObservation.objects.values("source_slug")
        .annotate(count=models_count("id"), latest=models_max("period_end"))
    }
    builtin_sources = []
    for source in BUILTIN_SOURCES:
        source_payload = dict(source)
        local_monthly = monthly_sources.get(source["slug"])
        local_metrics = metric_sources.get(source["slug"])
        if local_monthly or local_metrics:
            latest_candidates = [
                item["latest"]
                for item in [local_monthly, local_metrics]
                if item and item.get("latest")
            ]
            count = int((local_monthly or {}).get("count") or 0) + int((local_metrics or {}).get("count") or 0)
            source_payload["access"] = "connected"
            source_payload["latest_available"] = max(latest_candidates).isoformat() if latest_candidates else None
            source_payload["description"] = (
                f"{source['description']} K-L-I-A has {count} reviewed observation(s) "
                "imported from this source."
            )
        builtin_sources.append(source_payload)
    custom = [
        {
            "slug": source.slug,
            "name": source.name,
            "provider": source.provider,
            "source_type": source.source_type,
            "coverage_start": _iso(source.coverage_start),
            "coverage_end": _iso(source.coverage_end),
            "latest_available": _iso(source.latest_available),
            "requires_auth": source.requires_auth,
            "enabled": source.enabled,
            "access": "registered",
            "endpoints": {"base_url": source.base_url},
            "description": source.description,
            "custom": True,
        }
        for source in ExternalDataSource.objects.all()
    ]
    assets = DataAsset.objects.all()
    return {
        "sources": [*builtin_sources, *custom],
        "summary": {
            "connected_apis": sum(1 for source in builtin_sources if source["access"].startswith("connected")),
            "registered_apis": len(custom),
            "uploaded_assets": assets.count(),
            "latest_upload": _iso(assets.first().created_at) if assets.exists() else None,
            "reviewed_monthly_climate_records": MonthlyClimateObservation.objects.count(),
            "reviewed_environmental_metric_records": EnvironmentalMetricObservation.objects.count(),
        },
        "history_window": {
            "recommended_start": recommended_start.isoformat(),
            "end": today.isoformat(),
        },
        "generated_at": domain.now_iso(),
    }


def asset_payload(asset: DataAsset) -> dict:
    quality = getattr(asset, "quality", None)
    return {
        "id": str(asset.id),
        "name": asset.name,
        "original_filename": asset.original_filename,
        "file_format": asset.file_format,
        "asset_type": asset.asset_type,
        "size_bytes": asset.size_bytes,
        "sha256": asset.sha256,
        "scope_level": asset.scope_level,
        "scope_name": asset.scope_name,
        "scope_code": asset.scope_code,
        "acquisition_start": _iso(asset.acquisition_start),
        "acquisition_end": _iso(asset.acquisition_end),
        "feature_count": asset.feature_count,
        "geometry_types": asset.geometry_types,
        "bbox": asset.bbox,
        "metadata": asset.metadata,
        "status": asset.status,
        "uploaded_by": asset.uploaded_by.username if asset.uploaded_by else "",
        "created_at": asset.created_at.isoformat(),
        "download_endpoint": f"/api/data/assets/{asset.id}/download",
        "quality": {
            "source_name": quality.source_name,
            "spatial_coverage": quality.spatial_coverage,
            "temporal_coverage": quality.temporal_coverage,
            "coordinate_reference_system": quality.coordinate_reference_system,
            "confidence": quality.confidence,
            "processing_status": quality.processing_status,
            "missing_data_warning": quality.missing_data_warning,
            "projection_warning": quality.projection_warning,
            "duplicate_warning": quality.duplicate_warning,
            "validation_errors": quality.validation_errors,
        }
        if quality
        else None,
    }


def asset_list(limit: int = 100) -> list[dict]:
    return [
        asset_payload(asset)
        for asset in DataAsset.objects.select_related("uploaded_by", "quality")[: max(1, min(limit, 300))]
    ]


def _parse_date(value: str | None, default: date) -> date:
    if not value:
        return default
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise DataSourceError("Dates must use YYYY-MM-DD format.") from exc


def _location(county: str | None, latitude: str | None, longitude: str | None) -> tuple[float, float, str]:
    if county:
        feature = domain.find_county(county)
        if not feature:
            raise DataSourceError("County not found.", 404)
        lat, lon = domain.county_weather_center(feature)
        return lat, lon, domain.county_name(feature)
    try:
        lat = float(latitude)
        lon = float(longitude)
    except (TypeError, ValueError) as exc:
        raise DataSourceError("Provide a county or numeric latitude and longitude.") from exc
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise DataSourceError("Latitude or longitude is outside the valid range.")
    return lat, lon, "Custom point"


def _parameters(raw: str | None) -> list[str]:
    requested = [value.strip().upper() for value in (raw or ",".join(DEFAULT_PARAMETERS)).split(",") if value.strip()]
    unsupported = sorted(set(requested) - ALLOWED_PARAMETERS)
    if unsupported:
        raise DataSourceError(f"Unsupported NASA POWER parameters: {', '.join(unsupported)}")
    return list(dict.fromkeys(requested))[:8]


def nasa_power_history(query) -> dict:
    temporal = str(query.get("temporal") or "monthly").lower()
    if temporal not in {"daily", "monthly"}:
        raise DataSourceError("temporal must be daily or monthly.")
    today = date.today()
    requested_start = _parse_date(query.get("start"), today - timedelta(days=3652))
    requested_end = _parse_date(query.get("end"), today)
    if requested_start > requested_end:
        raise DataSourceError("start must be on or before end.")
    if (requested_end - requested_start).days > MAX_HISTORY_DAYS:
        raise DataSourceError("One request may cover at most twenty-two years.")

    lat, lon, scope = _location(query.get("county"), query.get("latitude"), query.get("longitude"))
    parameters = _parameters(query.get("parameters"))
    if temporal == "monthly":
        provider_end = date(min(requested_end.year, today.year - 1), 12, 31)
        if requested_start.year > provider_end.year:
            raise DataSourceError("NASA POWER monthly data is available through the previous completed year. Use daily mode for current-year data.")
        start_value = str(requested_start.year)
        end_value = str(provider_end.year)
    else:
        provider_end = min(requested_end, today)
        start_value = requested_start.strftime("%Y%m%d")
        end_value = provider_end.strftime("%Y%m%d")

    params = {
        "parameters": ",".join(parameters),
        "community": "AG",
        "longitude": round(lon, 5),
        "latitude": round(lat, 5),
        "format": "JSON",
        "start": start_value,
        "end": end_value,
    }
    if temporal == "daily":
        params["time-standard"] = "UTC"
    url = f"{NASA_POWER_URL}/{temporal}/point?{urlencode(params)}"
    cache_key = f"nasa-power:{hashlib.sha256(url.encode()).hexdigest()}"
    payload = cache.get(cache_key)
    if payload is None:
        try:
            request = Request(url, headers={"User-Agent": "K-L-I-A/1.0 historical climate connector"})
            with urlopen(request, timeout=30) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise DataSourceError(f"NASA POWER rejected the request: {detail[:300]}", 502) from exc
        except (URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
            raise DataSourceError(f"NASA POWER is unavailable: {exc}", 503) from exc
        cache.set(cache_key, payload, 3600)

    fill_value = payload.get("header", {}).get("fill_value", -999)
    series = payload.get("properties", {}).get("parameter", {})
    keys = sorted({key for values in series.values() for key in values})
    records = []
    for key in keys:
        if temporal == "monthly" and key.endswith("13"):
            continue
        record_date = datetime.strptime(key, "%Y%m%d" if temporal == "daily" else "%Y%m").date()
        if record_date < requested_start or record_date > requested_end:
            continue
        values = {
            parameter: value
            for parameter in parameters
            if (value := series.get(parameter, {}).get(key)) not in {None, fill_value, -999, -999.0}
        }
        if values:
            records.append({"date": record_date.isoformat(), **values})

    units = {
        key: {"units": value.get("units"), "label": value.get("longname")}
        for key, value in payload.get("parameters", {}).items()
        if key in parameters
    }
    return {
        "provider": "NASA POWER",
        "source": "NASA Langley Research Center",
        "scope": scope,
        "latitude": lat,
        "longitude": lon,
        "temporal": temporal,
        "requested_start": requested_start.isoformat(),
        "requested_end": requested_end.isoformat(),
        "provider_end": provider_end.isoformat(),
        "latest_available": records[-1]["date"] if records else None,
        "earliest_available": records[0]["date"] if records else None,
        "parameters": units,
        "record_count": len(records),
        "records": records,
        "source_url": url,
        "generated_at": domain.now_iso(),
    }


def _clamp(value: float | None, minimum: float = 0, maximum: float = 100) -> float | None:
    if value is None or not math.isfinite(value):
        return None
    return round(max(minimum, min(maximum, value)), 1)


def _mean(values: list[float | int | None]) -> float | None:
    valid = [float(value) for value in values if isinstance(value, (int, float)) and math.isfinite(float(value))]
    if not valid:
        return None
    return sum(valid) / len(valid)


def _sum(values: list[float | int | None]) -> float | None:
    valid = [float(value) for value in values if isinstance(value, (int, float)) and math.isfinite(float(value))]
    if not valid:
        return None
    return sum(valid)


def _round(value: float | None, digits: int = 1) -> float | None:
    if value is None or not math.isfinite(value):
        return None
    return round(value, digits)


def _parameter_units(history: dict, parameter: str) -> str:
    return str((history.get("parameters") or {}).get(parameter, {}).get("units") or "").lower()


def _monthly_rainfall_mm(row: dict, units: str) -> float | None:
    raw = row.get("PRECTOTCORR")
    if not isinstance(raw, (int, float)) or not math.isfinite(float(raw)):
        return None
    try:
        parsed = date.fromisoformat(str(row.get("date")))
    except (TypeError, ValueError):
        return _round(float(raw))
    if "mm/day" in units or "mm d" in units:
        return _round(float(raw) * monthrange(parsed.year, parsed.month)[1])
    return _round(float(raw))


def _monthly_record_from_values(
    parsed: date,
    rainfall_mm: float | None,
    temp: float | None,
    temp_max: float | None,
    temp_min: float | None,
    humidity: float | None,
    wind: float | None,
    solar: float | None,
    county_name: str | None = None,
    source_payload: dict | None = None,
) -> dict:
    rainfall_score = 0 if rainfall_mm is None else min(100, rainfall_mm / 220 * 100)
    humidity_score = 50 if humidity is None else humidity
    heat_penalty = 0 if temp is None else max(0, temp - 26) * 2.8
    water_pressure = _clamp((rainfall_score * 0.64) + (humidity_score * 0.36) - heat_penalty)
    temp_support = 55 if temp is None else max(0, 100 - abs(temp - 24) * 7)
    vegetation_support = _clamp(((water_pressure or 0) * 0.68) + (temp_support * 0.32))
    soil_moisture_proxy = _clamp(((water_pressure or 0) * 0.78) + (humidity_score * 0.22) - heat_penalty / 2)
    dryness_pressure = _clamp(100 - (water_pressure or 0) + max(0, (temp or 24) - 28) * 2 + max(0, (wind or 2) - 4) * 3)

    record = {
        "date": parsed.isoformat(),
        "month": parsed.strftime("%b %Y"),
        "year": parsed.year,
        "month_index": parsed.month,
        "rainfall_mm": rainfall_mm,
        "temperature_c": temp,
        "temperature_max_c": temp_max,
        "temperature_min_c": temp_min,
        "humidity_pct": humidity,
        "wind_ms": wind,
        "solar_mj_m2_day": solar,
        "water_pressure_index": water_pressure,
        "vegetation_support_index": vegetation_support,
        "soil_moisture_proxy": soil_moisture_proxy,
        "dryness_pressure_index": dryness_pressure,
    }
    if county_name:
        record["county"] = county_name
    if source_payload:
        record.update(source_payload)
    return record


def _monthly_record(row: dict, rainfall_units: str, county_name: str | None = None) -> dict:
    parsed = date.fromisoformat(str(row["date"]))
    return _monthly_record_from_values(
        parsed=parsed,
        rainfall_mm=_monthly_rainfall_mm(row, rainfall_units),
        temp=_round(float(row["T2M"]), 1) if isinstance(row.get("T2M"), (int, float)) else None,
        temp_max=_round(float(row["T2M_MAX"]), 1) if isinstance(row.get("T2M_MAX"), (int, float)) else None,
        temp_min=_round(float(row["T2M_MIN"]), 1) if isinstance(row.get("T2M_MIN"), (int, float)) else None,
        humidity=_round(float(row["RH2M"]), 1) if isinstance(row.get("RH2M"), (int, float)) else None,
        wind=_round(float(row["WS2M"]), 1) if isinstance(row.get("WS2M"), (int, float)) else None,
        solar=_round(float(row["ALLSKY_SFC_SW_DWN"]), 1)
        if isinstance(row.get("ALLSKY_SFC_SW_DWN"), (int, float))
        else None,
        county_name=county_name,
        source_payload={
            "data_mode": "open_provider",
            "source": "NASA POWER",
            "source_slug": "nasa-power",
            "provider": "NASA Langley Research Center",
            "quality_flag": "provider_record",
        },
    )


def _local_monthly_record(observation: MonthlyClimateObservation) -> dict:
    return _monthly_record_from_values(
        parsed=observation.observation_month,
        rainfall_mm=_round(observation.rainfall_mm),
        temp=_round(observation.temperature_c, 1),
        temp_max=_round(observation.temperature_max_c, 1),
        temp_min=_round(observation.temperature_min_c, 1),
        humidity=_round(observation.humidity_pct, 1),
        wind=_round(observation.wind_ms, 1),
        solar=_round(observation.solar_mj_m2_day, 1),
        county_name=observation.county_name,
        source_payload={
            "data_mode": "official_reviewed",
            "source": observation.source_name,
            "source_slug": observation.source_slug,
            "provider": observation.provider or observation.source_name,
            "county_code": observation.county_code,
            "quality_flag": observation.quality_flag or "reviewed",
            "station_count": observation.station_count,
            "notes": observation.notes,
        },
    )


def _annual_summaries(records: list[dict]) -> list[dict]:
    annual: dict[int, list[dict]] = {}
    for row in records:
        annual.setdefault(int(row["year"]), []).append(row)
    return [
        {
            "year": year,
            "rainfall_mm": _round(_sum([row.get("rainfall_mm") for row in rows])),
            "temperature_c": _round(_mean([row.get("temperature_c") for row in rows])),
            "water_pressure_index": _round(_mean([row.get("water_pressure_index") for row in rows])),
            "vegetation_support_index": _round(_mean([row.get("vegetation_support_index") for row in rows])),
            "soil_moisture_proxy": _round(_mean([row.get("soil_moisture_proxy") for row in rows])),
            "dryness_pressure_index": _round(_mean([row.get("dryness_pressure_index") for row in rows])),
        }
        for year, rows in sorted(annual.items())
    ]


def _monthly_normals(records: list[dict]) -> list[dict]:
    monthly: dict[int, list[dict]] = {}
    for row in records:
        monthly.setdefault(int(row["month_index"]), []).append(row)
    return [
        {
            "month_index": month,
            "month": date(2024, month, 1).strftime("%b"),
            "rainfall_mm": _round(_mean([row.get("rainfall_mm") for row in rows])),
            "temperature_c": _round(_mean([row.get("temperature_c") for row in rows])),
            "water_pressure_index": _round(_mean([row.get("water_pressure_index") for row in rows])),
            "vegetation_support_index": _round(_mean([row.get("vegetation_support_index") for row in rows])),
            "soil_moisture_proxy": _round(_mean([row.get("soil_moisture_proxy") for row in rows])),
            "dryness_pressure_index": _round(_mean([row.get("dryness_pressure_index") for row in rows])),
        }
        for month, rows in sorted(monthly.items())
    ]


def _six_month_outlook(normals: list[dict]) -> list[dict]:
    normal_by_month = {row["month_index"]: row for row in normals}
    today = date.today()
    outlook = []
    for offset in range(1, 7):
        month = ((today.month - 1 + offset) % 12) + 1
        year = today.year + ((today.month - 1 + offset) // 12)
        normal = normal_by_month.get(month, {})
        outlook.append(
            {
                "date": date(year, month, 1).isoformat(),
                "month": date(2024, month, 1).strftime("%b"),
                "rainfall_mm": normal.get("rainfall_mm"),
                "temperature_c": normal.get("temperature_c"),
                "water_pressure_index": normal.get("water_pressure_index"),
                "vegetation_support_index": normal.get("vegetation_support_index"),
                "soil_moisture_proxy": normal.get("soil_moisture_proxy"),
                "method": "historical monthly normal",
            }
        )
    return outlook


def _console_readiness(
    records: list[dict],
    scope: str,
    climate_source_label: str = "source-backed monthly records",
    rainfall_status: str = "source_backed",
) -> dict:
    has_monthly = bool(records)
    scope_text = "county" if scope == "county" else "national"
    return {
        "rainfall": {
            "status": rainfall_status if has_monthly else "source_required",
            "metric": "Monthly rainfall history",
            "source": climate_source_label,
            "note": f"{scope_text.title()} monthly rainfall is populated from source records.",
        },
        "water": {
            "status": "partial" if has_monthly else "source_required",
            "metric": "Monthly water-pressure proxy",
            "source": f"{climate_source_label} rainfall, humidity, and temperature",
            "note": "True surface-water extent still requires JRC Global Surface Water or Earth Engine NDWI zonal statistics.",
        },
        "vegetation": {
            "status": "partial" if has_monthly else "source_required",
            "metric": "Monthly vegetation-support proxy",
            "source": f"{climate_source_label} rainfall and temperature",
            "note": "True NDVI/NDWI anomalies still require Sentinel/Landsat raster processing.",
        },
        "forest": {
            "status": "partial" if has_monthly else "source_required",
            "metric": "Monthly dryness-pressure proxy",
            "source": f"{climate_source_label} rainfall, temperature, and wind",
            "note": "True forest cover/loss still requires ESA WorldCover or Earth Engine classification.",
        },
        "soil": {
            "status": "partial" if has_monthly else "source_required",
            "metric": "Monthly soil-moisture proxy",
            "source": f"{climate_source_label} rainfall, humidity, and temperature",
            "note": "True soil properties should be connected through SoilGrids or verified soil-test uploads.",
        },
        "landuse": {
            "status": "source_required",
            "metric": "Land-use shares",
            "source": "KNBS, ESA WorldCover, Sentinel/Landsat classification",
            "note": "Monthly climate context is available, but land-use percentages must come from classified land-cover products.",
        },
        "roads": {
            "status": "source_required",
            "metric": "Road length and road surface",
            "source": "Kenya Roads Board and OpenStreetMap QA extracts",
            "note": "Monthly rainfall exposure is available, but road length/surface metrics need official or QA-reviewed OSM extraction.",
        },
        "county": {
            "status": "live" if has_monthly else "source_required",
            "metric": "Monthly county/national climate profile",
            "source": "NASA POWER plus K-L-I-A county boundaries",
            "note": f"{scope_text.title()} monthly context is available for decision briefs.",
        },
    }


def _normalise_history(history: dict, county_name: str | None = None) -> list[dict]:
    rainfall_units = _parameter_units(history, "PRECTOTCORR")
    return [_monthly_record(row, rainfall_units, county_name) for row in history.get("records", [])]


def _local_monthly_observations(start: date, end: date, county: str | None = None) -> tuple[list[dict], dict]:
    queryset = MonthlyClimateObservation.objects.filter(observation_month__gte=start, observation_month__lte=end)
    scope_name = "Kenya"
    center = {"latitude": None, "longitude": None}
    if county:
        feature = domain.find_county(county)
        if not feature:
            raise DataSourceError("County not found.", 404)
        scope_name = domain.county_name(feature)
        county_code = domain.county_code(feature)
        lat, lon = domain.county_weather_center(feature)
        center = {"latitude": lat, "longitude": lon}
        queryset = queryset.filter(Q(county_name__iexact=scope_name) | Q(county_code=county_code))

    observations = list(queryset.order_by("observation_month", "county_name", "source_slug", "id"))
    records = [_local_monthly_record(row) for row in observations]
    source_names = sorted({row.source_name for row in observations if row.source_name})
    source_slugs = sorted({row.source_slug for row in observations if row.source_slug})
    return records, {
        "scope_name": scope_name,
        "center": center,
        "source_names": source_names,
        "source_slugs": source_slugs,
        "observation_count": len(observations),
    }


def _source_priority(row: dict) -> tuple[int, str]:
    slug = str(row.get("source_slug") or "").strip().lower()
    mode = str(row.get("data_mode") or "").strip().lower()
    priority = {
        "kenya-meteorological-department": 0,
        "kalro-kaop-weather": 1,
        "reviewed-local-climate": 2,
        "knbs-statistical-portals": 3,
        "nasa-power": 10,
    }.get(slug, 4 if mode == "official_reviewed" else 20)
    return priority, slug


def _preferred_county_month_records(records: list[dict]) -> list[dict]:
    preferred: dict[tuple[str, str], dict] = {}
    for row in records:
        county_name = str(row.get("county") or "").strip()
        record_date = str(row.get("date") or "").strip()
        if not county_name or not record_date:
            continue
        key = (county_name.lower(), record_date)
        current = preferred.get(key)
        if current is None or _source_priority(row) < _source_priority(current):
            preferred[key] = row
    return sorted(preferred.values(), key=lambda row: (row["date"], row.get("county") or ""))


def _aggregate_monthly_records(county_records: list[dict]) -> list[dict]:
    grouped: dict[str, list[dict]] = {}
    for row in county_records:
        grouped.setdefault(str(row["date"]), []).append(row)
    records = []
    for date_key, rows in sorted(grouped.items()):
        parsed = date.fromisoformat(date_key)
        records.append(
            {
                "date": parsed.isoformat(),
                "month": parsed.strftime("%b %Y"),
                "year": parsed.year,
                "month_index": parsed.month,
                "county_count": len({row.get("county") for row in rows if row.get("county")}),
                "data_mode": "mixed_source_backed"
                if len({row.get("data_mode") for row in rows if row.get("data_mode")}) > 1
                else next((row.get("data_mode") for row in rows if row.get("data_mode")), "source_backed"),
                "source": "Mixed source-backed county records"
                if len({row.get("source") for row in rows if row.get("source")}) > 1
                else next((row.get("source") for row in rows if row.get("source")), ""),
                "source_slugs": sorted({row.get("source_slug") for row in rows if row.get("source_slug")}),
                "rainfall_mm": _round(_mean([row.get("rainfall_mm") for row in rows])),
                "temperature_c": _round(_mean([row.get("temperature_c") for row in rows])),
                "temperature_max_c": _round(_mean([row.get("temperature_max_c") for row in rows])),
                "temperature_min_c": _round(_mean([row.get("temperature_min_c") for row in rows])),
                "humidity_pct": _round(_mean([row.get("humidity_pct") for row in rows])),
                "wind_ms": _round(_mean([row.get("wind_ms") for row in rows])),
                "solar_mj_m2_day": _round(_mean([row.get("solar_mj_m2_day") for row in rows])),
                "water_pressure_index": _round(_mean([row.get("water_pressure_index") for row in rows])),
                "vegetation_support_index": _round(_mean([row.get("vegetation_support_index") for row in rows])),
                "soil_moisture_proxy": _round(_mean([row.get("soil_moisture_proxy") for row in rows])),
                "dryness_pressure_index": _round(_mean([row.get("dryness_pressure_index") for row in rows])),
            }
        )
    return records


def _county_statistics(county_records: list[dict], county_names: list[str]) -> list[dict]:
    grouped: dict[str, list[dict]] = {}
    for row in county_records:
        county = str(row.get("county") or "").strip()
        if county:
            grouped.setdefault(county, []).append(row)

    statistics = []
    for index, county_name in enumerate(county_names):
        rows = sorted(grouped.get(county_name, []), key=lambda row: row["date"])
        annual = _annual_summaries(rows)
        latest_annual = annual[-1] if annual else {}
        recent_rows = rows[-12:] if rows else []
        source_slugs = sorted({str(row.get("source_slug") or "").strip() for row in rows if row.get("source_slug")})
        source_names = sorted({str(row.get("source") or "").strip() for row in rows if row.get("source")})
        data_modes = {str(row.get("data_mode") or "").strip() for row in rows}
        feature = domain.find_county(county_name)
        boundary_code = domain.county_code(feature) if feature else ""
        imported_code = next((str(row.get("county_code") or "").strip() for row in rows if row.get("county_code")), "")
        statistics.append(
            {
                "county": county_name,
                "county_code": imported_code or boundary_code or f"{index + 1:03d}",
                "record_count": len(rows),
                "latest_available": rows[-1]["date"] if rows else None,
                "latest_year": latest_annual.get("year"),
                "latest_annual_rainfall_mm": latest_annual.get("rainfall_mm"),
                "average_monthly_rainfall_mm": _round(_mean([row.get("rainfall_mm") for row in rows])),
                "recent_12_month_rainfall_mm": _round(_sum([row.get("rainfall_mm") for row in recent_rows])),
                "average_temperature_c": _round(_mean([row.get("temperature_c") for row in rows])),
                "water_pressure_index": _round(_mean([row.get("water_pressure_index") for row in rows])),
                "vegetation_support_index": _round(_mean([row.get("vegetation_support_index") for row in rows])),
                "soil_moisture_proxy": _round(_mean([row.get("soil_moisture_proxy") for row in rows])),
                "dryness_pressure_index": _round(_mean([row.get("dryness_pressure_index") for row in rows])),
                "status": "official_reviewed"
                if "official_reviewed" in data_modes
                else "source_backed"
                if rows
                else "source_required",
                "source": "; ".join(source_names[:3]) if source_names else "Source required",
                "source_slugs": source_slugs,
            }
        )
    return statistics


def _monthly_intelligence_window(query) -> tuple[int, date, date]:
    today = date.today()
    try:
        years = max(1, min(20, int(query.get("years", "20"))))
    except ValueError as exc:
        raise DataSourceError("years must be numeric.") from exc
    provider_end = date(today.year - 1, 12, 31)
    start = date(provider_end.year - years + 1, 1, 1)
    return years, start, provider_end


def monthly_intelligence(query) -> dict:
    years, start, end = _monthly_intelligence_window(query)
    county = str(query.get("county") or "").strip()
    source_preference = str(query.get("source") or "auto").strip().lower()
    if source_preference not in {"auto", "local", "open", "nasa", "nasa-power"}:
        raise DataSourceError("source must be auto, local, open, nasa, or nasa-power.")
    scope_key = f"{county.lower() or 'national'}:{source_preference}"
    cache_key = f"monthly-intelligence:{scope_key}:{start.isoformat()}:{end.isoformat()}:{','.join(MONTHLY_INTELLIGENCE_PARAMETERS)}"
    cached = cache.get(cache_key)
    if cached:
        return cached

    common_query = {
        "temporal": "monthly",
        "start": start.isoformat(),
        "end": end.isoformat(),
        "parameters": ",".join(MONTHLY_INTELLIGENCE_PARAMETERS),
    }

    source_errors = []
    source_urls = []
    county_statistics = []
    local_records: list[dict] = []
    local_meta = {"scope_name": "Kenya", "center": {"latitude": None, "longitude": None}, "source_names": []}
    use_open_fallback = source_preference in {"auto", "open", "nasa", "nasa-power"}
    use_local_records = source_preference in {"auto", "local"}
    if use_local_records:
        local_records, local_meta = _local_monthly_observations(start, end, county or None)

    if county:
        if local_records:
            scope = "county"
            scope_name = str(local_meta.get("scope_name") or county)
            center = local_meta["center"]
            open_records: list[dict] = []
            if use_open_fallback:
                try:
                    history = nasa_power_history({**common_query, "county": county})
                    open_records = _normalise_history(history, history["scope"])
                    source_urls.append(history["source_url"])
                    center = {"latitude": history["latitude"], "longitude": history["longitude"]}
                except DataSourceError as exc:
                    source_errors.append({"county": scope_name, "error": str(exc), "status": exc.status})
            records = _preferred_county_month_records([*local_records, *open_records])
            county_statistics = _county_statistics(records, [scope_name])
            if open_records:
                source_label = "Reviewed local monthly records + NASA POWER fallback"
                provider = "Reviewed local records + NASA POWER fallback"
                source = "K-L-I-A verified monthly observation store and NASA Langley Research Center"
                rainfall_status = "mixed_source_backed"
            else:
                source_label = "; ".join(local_meta.get("source_names")[:3]) or "Reviewed local monthly climate records"
                provider = "Reviewed local monthly climate records"
                source = "K-L-I-A verified monthly observation store"
                rainfall_status = "official_reviewed"
            aggregation = {
                "method": "reviewed monthly county observations with open fallback for missing county-months"
                if open_records
                else "reviewed monthly county observations",
                "county_count": 1,
                "official_record_count": len(local_records),
                "open_fallback_record_count": len(open_records),
                "warning": "Rainfall and climate values come from reviewed imported records. Water, vegetation, forest, and soil metrics shown from these records are K-L-I-A proxy indices, not direct raster measurements.",
            }
        elif use_open_fallback:
            history = nasa_power_history({**common_query, "county": county})
            records = _normalise_history(history)
            county_statistics = _county_statistics(
                [{**row, "county": history["scope"]} for row in records],
                [history["scope"]],
            )
            scope = "county"
            scope_name = history["scope"]
            center = {"latitude": history["latitude"], "longitude": history["longitude"]}
            source_urls.append(history["source_url"])
            source_label = "NASA POWER monthly point data"
            provider = "NASA POWER"
            source = "NASA Langley Research Center"
            rainfall_status = "source_backed"
            aggregation = {
                "method": "county centroid point",
                "county_count": 1,
                "open_fallback_count": 1,
                "warning": "This is a real NASA POWER county-center climate time series, not an area-weighted zonal statistic.",
            }
        else:
            raise DataSourceError(
                f"No reviewed local monthly records are available for {county}. Use source=auto to allow NASA POWER open-source fallback.",
                404,
            )
    else:
        county_names = domain.dashboard_county_names()
        county_records: list[dict] = _preferred_county_month_records(local_records)

        def fetch_county(name: str) -> dict:
            return nasa_power_history({**common_query, "county": name})

        missing_county_names = county_names
        if use_open_fallback:
            with ThreadPoolExecutor(max_workers=6) as executor:
                futures = {executor.submit(fetch_county, name): name for name in missing_county_names}
                for future in as_completed(futures):
                    name = futures[future]
                    try:
                        history = future.result()
                        source_urls.append(history["source_url"])
                        county_records.extend(_normalise_history(history, name))
                    except DataSourceError as exc:
                        source_errors.append({"county": name, "error": str(exc), "status": exc.status})
        county_records = _preferred_county_month_records(county_records)
        official_counties_used = {
            row["county"] for row in county_records if row.get("county") and row.get("data_mode") == "official_reviewed"
        }
        fallback_counties_used = {
            row["county"] for row in county_records if row.get("county") and row.get("source_slug") == "nasa-power"
        }
        if not county_records:
            if source_preference == "local":
                raise DataSourceError("No reviewed local monthly climate records have been imported yet.", 404)
            raise DataSourceError("National monthly aggregation could not load any source-backed county records.", 503)
        records = _aggregate_monthly_records(county_records)
        county_statistics = _county_statistics(county_records, county_names)
        scope = "national"
        scope_name = "Kenya"
        center = {"latitude": None, "longitude": None}
        has_local = bool(official_counties_used)
        has_fallback = bool(fallback_counties_used)
        if has_local and has_fallback:
            provider = "Reviewed local records + NASA POWER fallback"
            source = "K-L-I-A verified monthly observation store and NASA Langley Research Center"
            source_label = "Reviewed local monthly records + NASA POWER fallback"
            rainfall_status = "mixed_source_backed"
        elif has_local:
            provider = "Reviewed local monthly climate records"
            source = "K-L-I-A verified monthly observation store"
            source_label = "; ".join(local_meta.get("source_names")[:3]) or "Reviewed local monthly climate records"
            rainfall_status = "official_reviewed"
        else:
            provider = "NASA POWER"
            source = "NASA Langley Research Center"
            source_label = "NASA POWER monthly point data"
            rainfall_status = "source_backed"
        aggregation = {
            "method": "mean of available county monthly records",
            "county_count": len({row["county"] for row in county_records if row.get("county")}),
            "expected_county_count": len(county_names),
            "official_county_count": len(official_counties_used),
            "open_fallback_county_count": len(fallback_counties_used),
            "warning": "National values are averaged from available source-backed county records. Open fallback counties use real NASA POWER county-centre point data and are not area-weighted zonal statistics.",
        }

    annual = _annual_summaries(records)
    normals = _monthly_normals(records)
    latest = records[-1] if records else None
    observed_metrics = environmental_metrics_summary(start, date.today(), county or None)
    console_readiness = _console_readiness(records, scope, source_label, rainfall_status)
    for category, metric_rows in observed_metrics.get("latest_by_category", {}).items():
        if category in console_readiness and metric_rows:
            source_names = sorted({row.get("source_name") for row in metric_rows if row.get("source_name")})
            console_readiness[category]["status"] = "official_reviewed"
            console_readiness[category]["source"] = "; ".join(source_names[:3]) or "Reviewed source-backed metric observations"
            console_readiness[category]["note"] = (
                "Real reviewed metric observations are available for this console. "
                "Climate-derived proxy charts remain labelled separately."
            )
    payload = {
        "provider": provider,
        "source": source,
        "source_type": "monthly_climate_intelligence",
        "scope": scope,
        "scope_name": scope_name,
        "center": center,
        "window_years": years,
        "requested_start": start.isoformat(),
        "requested_end": end.isoformat(),
        "latest_available": latest["date"] if latest else None,
        "earliest_available": records[0]["date"] if records else None,
        "record_count": len(records),
        "parameters": {
            "rainfall_mm": "Monthly precipitation total from the selected source-backed record.",
            "temperature_c": "Monthly mean 2 m air temperature.",
            "humidity_pct": "Monthly mean relative humidity.",
            "wind_ms": "Monthly mean wind speed.",
            "water_pressure_index": "K-L-I-A proxy from monthly rainfall, humidity, and temperature.",
            "vegetation_support_index": "K-L-I-A proxy from monthly rainfall and temperature.",
            "soil_moisture_proxy": "K-L-I-A proxy from monthly rainfall, humidity, and temperature.",
            "dryness_pressure_index": "K-L-I-A proxy from monthly water pressure, heat, and wind.",
        },
        "aggregation": aggregation,
        "records": records,
        "annual": annual,
        "monthly_normals": normals,
        "six_month_outlook": _six_month_outlook(normals),
        "county_statistics": county_statistics,
        "observed_metrics": observed_metrics,
        "console_readiness": console_readiness,
        "source_urls": source_urls[:5],
        "source_error_count": len(source_errors),
        "source_errors": source_errors[:12],
        "source_note": "All displayed monthly values are source-backed. K-L-I-A prefers reviewed Kenya-local KMD/KALRO/KNBS-style imports when present and uses NASA POWER only as a real open-source fallback. Water extent, NDVI/NDWI, forest cover, land-use shares, and road lengths remain source-gated until raster/vector zonal processing is connected.",
        "generated_at": domain.now_iso(),
    }
    cache.set(cache_key, payload, 12 * 60 * 60)
    return payload


def _metric_window(query) -> tuple[int, date, date]:
    today = date.today()
    try:
        years = max(1, min(30, int(query.get("years", "20"))))
    except ValueError as exc:
        raise DataSourceError("years must be numeric.") from exc
    start = _parse_date(query.get("start"), date(today.year - years + 1, 1, 1))
    end = _parse_date(query.get("end"), today)
    if start > end:
        raise DataSourceError("start must be on or before end.")
    return years, start, end


def _metric_payload(observation: EnvironmentalMetricObservation) -> dict:
    return {
        "id": observation.pk,
        "source_slug": observation.source_slug,
        "source_name": observation.source_name,
        "provider": observation.provider,
        "metric_key": observation.metric_key,
        "metric_label": observation.metric_label,
        "category": observation.category,
        "unit": observation.unit,
        "value": _round(observation.value, 3),
        "period_start": observation.period_start.isoformat(),
        "period_end": observation.period_end.isoformat(),
        "period_grain": observation.period_grain,
        "scope_level": observation.scope_level,
        "scope_name": observation.scope_name,
        "scope_code": observation.scope_code,
        "confidence": observation.confidence,
        "method": observation.method,
        "quality_flag": observation.quality_flag,
        "notes": observation.notes,
    }


def environmental_metrics_summary(start: date, end: date, county: str | None = None, category: str | None = None) -> dict:
    queryset = EnvironmentalMetricObservation.objects.filter(period_end__gte=start, period_start__lte=end)
    scope_name = "Kenya"
    scope = "national"
    if county:
        feature = domain.find_county(county)
        if not feature:
            raise DataSourceError("County not found.", 404)
        scope = "county"
        scope_name = domain.county_name(feature)
        county_code = domain.county_code(feature)
        queryset = queryset.filter(
            scope_level="county",
        ).filter(Q(scope_name__iexact=scope_name) | Q(scope_code=county_code))
    if category:
        queryset = queryset.filter(category=category)

    ordered = list(queryset.order_by("-period_end", "-period_start", "category", "metric_key", "scope_name")[:500])
    latest_by_key: dict[tuple[str, str, str], dict] = {}
    for observation in ordered:
        key = (observation.category, observation.metric_key, f"{observation.scope_level}:{observation.scope_code}:{observation.scope_name}")
        if key not in latest_by_key:
            latest_by_key[key] = _metric_payload(observation)

    latest_by_category: dict[str, list[dict]] = {}
    for row in latest_by_key.values():
        latest_by_category.setdefault(row["category"], []).append(row)
    for rows in latest_by_category.values():
        rows.sort(key=lambda item: (item["metric_label"], item["scope_name"]))

    coverage = [
        {
            "category": row["category"],
            "record_count": row["record_count"],
            "latest_available": row["latest"].isoformat() if row["latest"] else None,
            "scope_count": row["scope_count"],
        }
        for row in queryset.values("category").annotate(
            record_count=models_count("id"),
            latest=models_max("period_end"),
            scope_count=models_count("scope_name", distinct=True),
        ).order_by("category")
    ]
    return {
        "provider": "K-L-I-A reviewed environmental metric store",
        "scope": scope,
        "scope_name": scope_name,
        "requested_start": start.isoformat(),
        "requested_end": end.isoformat(),
        "record_count": queryset.count(),
        "coverage": coverage,
        "latest_by_category": latest_by_category,
        "records": [_metric_payload(observation) for observation in ordered],
        "source_note": "Only imported, reviewed, source-backed environmental metrics are returned. Missing categories remain source-required.",
    }


def environmental_metrics(query) -> dict:
    _, start, end = _metric_window(query)
    category = str(query.get("category") or "").strip().lower()
    if category and category not in {item["category"] for item in ENVIRONMENTAL_METRIC_CATALOG.values()}:
        raise DataSourceError("Unknown environmental metric category.")
    metric_key = str(query.get("metric") or "").strip().lower()
    summary = environmental_metrics_summary(start, end, str(query.get("county") or "").strip() or None, category or None)
    if metric_key:
        if metric_key not in ENVIRONMENTAL_METRIC_CATALOG:
            raise DataSourceError("Unknown environmental metric.")
        summary["records"] = [row for row in summary["records"] if row["metric_key"] == metric_key]
        summary["record_count"] = len(summary["records"])
        latest_by_category: dict[str, list[dict]] = {}
        for category_key, rows in summary["latest_by_category"].items():
            filtered = [row for row in rows if row["metric_key"] == metric_key]
            if filtered:
                latest_by_category[category_key] = filtered
        summary["latest_by_category"] = latest_by_category
    return summary


def _scope_filter(queryset, field_name: str, scope_name: str):
    if not scope_name:
        return queryset
    return queryset.filter(**{f"{field_name}__iexact": scope_name})


def _boundary_context(county: str = "") -> dict:
    county_feature = domain.find_county(county) if county else None
    if county and not county_feature:
        raise DataSourceError("County not found.", 404)
    scope_name = domain.county_name(county_feature) if county_feature else "Kenya"
    scope_code = domain.county_code(county_feature) if county_feature else ""

    if county_feature:
        subcounty_features = domain.boundary_subcounties_collection(scope_name)["features"]
        ward_features = domain.boundary_wards_collection(county=scope_name)["features"]
    else:
        subcounty_features = domain.subcounties()
        ward_features = domain.boundary_wards_collection()["features"]

    subcounty_rows = []
    ward_count_by_subcounty: dict[str, int] = {}
    for ward in ward_features:
        properties = ward.get("properties") or {}
        parent = properties.get("ADM2_EN") or properties.get("SubCounty") or ""
        if parent:
            ward_count_by_subcounty[parent] = ward_count_by_subcounty.get(parent, 0) + 1

    for feature in subcounty_features:
        name = domain.subcounty_name(feature)
        subcounty_rows.append(
            {
                "name": name,
                "code": domain.subcounty_code(feature),
                "county": (feature.get("properties") or {}).get("ADM1_EN") or scope_name,
                "area_km2": round(domain.estimate_area_ha(feature) / 100, 2),
                "ward_count": ward_count_by_subcounty.get(name, 0),
                "status": "boundary_ready",
            }
        )
    subcounty_rows.sort(key=lambda row: (row["county"], row["name"]))

    ward_rows = [
        {
            "name": domain.ward_name(feature),
            "code": domain.ward_code(feature),
            "subcounty": (feature.get("properties") or {}).get("ADM2_EN") or (feature.get("properties") or {}).get("SubCounty") or "",
            "county": (feature.get("properties") or {}).get("ADM1_EN") or scope_name,
            "area_km2": round(domain.estimate_area_ha(feature) / 100, 2),
            "status": "boundary_ready",
        }
        for feature in ward_features
    ]
    ward_rows.sort(key=lambda row: (row["county"], row["subcounty"], row["name"]))

    county_rows = [
        {
            "name": domain.county_name(feature),
            "code": domain.county_code(feature),
            "area_km2": round(domain.estimate_area_ha(feature) / 100, 2),
            "subcounty_count": domain.county_subcounty_count(domain.county_name(feature)),
            "ward_count": domain.ward_count_for_county(feature),
            "status": "boundary_ready",
        }
        for feature in (domain.counties() if not county_feature else [county_feature])
    ]

    return {
        "scope": "county" if county_feature else "national",
        "scope_name": scope_name,
        "scope_code": scope_code,
        "counties": county_rows,
        "subcounties": subcounty_rows,
        "wards": ward_rows,
        "summary": {
            "counties": len(county_rows),
            "subcounties": len(subcounty_rows),
            "wards": len(ward_rows),
        },
    }


def _field_report_event(row: FieldReport) -> dict:
    location = " / ".join(
        part
        for part in [row.county_name, row.subcounty_name, row.ward_name]
        if part
    )
    return {
        "type": "field_report",
        "title": row.title,
        "date": row.observation_date.isoformat(),
        "location": location or row.county_name,
        "county": row.county_name,
        "subcounty": row.subcounty_name,
        "ward": row.ward_name,
        "status": row.verification_status,
        "detail": row.observations[:260],
        "source": "K-L-I-A field report",
    }


def _alert_event(row: Alert) -> dict:
    return {
        "type": "alert",
        "title": row.title,
        "date": row.created_at.date().isoformat(),
        "location": row.scope_name or "National",
        "status": row.status,
        "severity": row.severity,
        "detail": row.description[:260],
        "source": ", ".join(row.data_sources[:2]) if row.data_sources else "K-L-I-A operational alert",
    }


def _report_event(row: IntelligenceReport) -> dict:
    return {
        "type": "intelligence_report",
        "title": row.title,
        "date": row.updated_at.date().isoformat(),
        "location": row.scope_name or "Kenya",
        "status": row.status,
        "severity": row.risk_level,
        "detail": (row.ai_summary or str((row.content or {}).get("executive_summary") or ""))[:260],
        "source": "K-L-I-A intelligence report",
    }


def _asset_event(row: DataAsset) -> dict:
    quality = getattr(row, "quality", None)
    return {
        "type": "data_asset",
        "title": row.name,
        "date": (row.acquisition_end or row.acquisition_start or row.created_at.date()).isoformat(),
        "location": row.scope_name or row.scope_level,
        "status": row.status,
        "severity": getattr(quality, "confidence", ""),
        "detail": f"{row.asset_type} {row.file_format} asset; {row.feature_count or 'metadata'} feature count.",
        "source": getattr(quality, "source_name", "") or "K-L-I-A data asset",
    }


def _coverage_rows(queryset, date_field: str, scope_field: str = "scope_name") -> list[dict]:
    rows = []
    for row in queryset.values(scope_field).annotate(
        record_count=models_count("id"),
        latest=models_max(date_field),
    ).order_by(scope_field):
        rows.append(
            {
                "scope_name": row.get(scope_field) or "Unscoped",
                "record_count": row["record_count"],
                "latest_available": row["latest"].isoformat() if row.get("latest") else None,
            }
        )
    return rows


def research_context(query) -> dict:
    county = str(query.get("county") or "").strip()
    try:
        limit = max(5, min(100, int(query.get("limit", "40") or 40)))
    except ValueError as exc:
        raise DataSourceError("limit must be numeric.") from exc
    boundaries = _boundary_context(county)
    scope_name = boundaries["scope_name"] if boundaries["scope"] == "county" else ""

    field_reports = FieldReport.objects.select_related("submitted_by", "verified_by")
    alerts = Alert.objects.all()
    reports_qs = IntelligenceReport.objects.all()
    assets = DataAsset.objects.select_related("quality")
    monthly = MonthlyClimateObservation.objects.all()
    metrics = EnvironmentalMetricObservation.objects.all()

    if scope_name:
        field_reports = field_reports.filter(county_name__iexact=scope_name)
        alerts = alerts.filter(Q(scope_name__iexact=scope_name) | Q(scope_level="national"))
        reports_qs = reports_qs.filter(Q(scope_name__iexact=scope_name) | Q(scope_level="national"))
        assets = assets.filter(Q(scope_name__iexact=scope_name) | Q(scope_level="national"))
        monthly = monthly.filter(county_name__iexact=scope_name)
        metrics = metrics.filter(Q(scope_name__iexact=scope_name) | Q(scope_level="national"))

    events = [
        *[_field_report_event(row) for row in field_reports[:limit]],
        *[_alert_event(row) for row in alerts[:limit]],
        *[_report_event(row) for row in reports_qs[:limit]],
        *[_asset_event(row) for row in assets[:limit]],
    ]
    events.sort(key=lambda row: row.get("date") or "", reverse=True)

    subcounty_activity = []
    if scope_name:
        report_counts = {
            row["subcounty_name"] or "Unspecified": row["count"]
            for row in field_reports.values("subcounty_name").annotate(count=models_count("id"))
        }
        for row in boundaries["subcounties"][:80]:
            subcounty_activity.append(
                {
                    **row,
                    "field_report_count": report_counts.get(row["name"], 0),
                    "status": "has_field_reports" if report_counts.get(row["name"], 0) else "boundary_ready_source_required",
                }
            )

    ward_activity = []
    if scope_name:
        report_counts = {
            row["ward_name"] or "Unspecified": row["count"]
            for row in field_reports.values("ward_name").annotate(count=models_count("id"))
        }
        for row in boundaries["wards"][:120]:
            ward_activity.append(
                {
                    **row,
                    "field_report_count": report_counts.get(row["name"], 0),
                    "status": "has_field_reports" if report_counts.get(row["name"], 0) else "boundary_ready_source_required",
                }
            )

    latest_month = monthly.order_by("-observation_month").first()
    latest_metric = metrics.order_by("-period_end").first()
    return {
        "scope": boundaries["scope"],
        "scope_name": boundaries["scope_name"],
        "scope_code": boundaries["scope_code"],
        "boundary_summary": boundaries["summary"],
        "counties": boundaries["counties"],
        "subcounties": subcounty_activity or boundaries["subcounties"][:80],
        "wards": ward_activity or boundaries["wards"][:120],
        "previous_happenings": events[:limit],
        "coverage": {
            "field_reports": {
                "record_count": field_reports.count(),
                "verified_count": field_reports.filter(verification_status=FieldReport.VerificationStatus.VERIFIED).count(),
                "latest_available": field_reports.order_by("-observation_date").first().observation_date.isoformat()
                if field_reports.exists()
                else None,
                "by_subcounty": _coverage_rows(field_reports, "observation_date", "subcounty_name")[:40],
                "by_ward": _coverage_rows(field_reports, "observation_date", "ward_name")[:60],
            },
            "alerts": {
                "record_count": alerts.count(),
                "open_count": alerts.exclude(status=Alert.Status.RESOLVED).count(),
                "latest_available": alerts.order_by("-created_at").first().created_at.date().isoformat()
                if alerts.exists()
                else None,
            },
            "reports": {
                "record_count": reports_qs.count(),
                "published_count": reports_qs.filter(status=IntelligenceReport.Status.PUBLISHED).count(),
                "latest_available": reports_qs.order_by("-updated_at").first().updated_at.date().isoformat()
                if reports_qs.exists()
                else None,
            },
            "data_assets": {
                "record_count": assets.count(),
                "latest_available": assets.order_by("-created_at").first().created_at.date().isoformat()
                if assets.exists()
                else None,
            },
            "monthly_climate": {
                "record_count": monthly.count(),
                "latest_available": latest_month.observation_month.isoformat() if latest_month else None,
            },
            "environmental_metrics": {
                "record_count": metrics.count(),
                "latest_available": latest_metric.period_end.isoformat() if latest_metric else None,
            },
        },
        "source_note": (
            "Research context combines official boundary files with K-L-I-A alerts, reports, field reports, data assets, "
            "reviewed monthly climate records, and imported environmental metrics. Empty sub-county or ward records are "
            "shown as boundary-ready/source-required rather than filled with invented events."
        ),
        "generated_at": domain.now_iso(),
    }


def sentinel_2_search(query) -> dict:
    today = date.today()
    start = _parse_date(query.get("start"), today - timedelta(days=3652))
    end = _parse_date(query.get("end"), today)
    if start > end:
        raise DataSourceError("start must be on or before end.")
    if (end - start).days > MAX_HISTORY_DAYS:
        raise DataSourceError("One imagery search may cover at most twenty-two years.")
    county = str(query.get("county") or "").strip()
    feature = domain.find_county(county)
    if not feature:
        raise DataSourceError("A valid county is required for imagery search.", 404)
    try:
        cloud = max(0, min(100, float(query.get("max_cloud", "30"))))
        limit = max(1, min(50, int(query.get("limit", "20"))))
    except ValueError as exc:
        raise DataSourceError("max_cloud and limit must be numeric.") from exc
    collection = str(query.get("collection") or "sentinel-2-l2a")
    if collection not in {"sentinel-2-l1c", "sentinel-2-l2a"}:
        raise DataSourceError("collection must be sentinel-2-l1c or sentinel-2-l2a.")

    body = {
        "collections": [collection],
        "bbox": list(domain.bbox(feature)),
        "datetime": f"{start.isoformat()}T00:00:00Z/{end.isoformat()}T23:59:59Z",
        "limit": limit,
        "query": {"eo:cloud_cover": {"lte": cloud}},
        "sortby": [{"field": "properties.datetime", "direction": "desc"}],
    }
    encoded = json.dumps(body, separators=(",", ":")).encode("utf-8")
    cache_key = f"copernicus-stac:{hashlib.sha256(encoded).hexdigest()}"
    payload = cache.get(cache_key)
    if payload is None:
        try:
            request = Request(
                COPERNICUS_STAC_SEARCH_URL,
                data=encoded,
                method="POST",
                headers={"Content-Type": "application/json", "User-Agent": "K-L-I-A/1.0 imagery catalogue"},
            )
            with urlopen(request, timeout=30) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise DataSourceError(f"Copernicus STAC rejected the request: {detail[:300]}", 502) from exc
        except (URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
            raise DataSourceError(f"Copernicus STAC is unavailable: {exc}", 503) from exc
        cache.set(cache_key, payload, 1800)

    items = []
    for feature_item in payload.get("features", []):
        properties = feature_item.get("properties", {})
        assets = feature_item.get("assets", {})
        self_link = next((link.get("href") for link in feature_item.get("links", []) if link.get("rel") == "self"), "")
        items.append(
            {
                "id": feature_item.get("id"),
                "collection": feature_item.get("collection"),
                "datetime": properties.get("datetime"),
                "cloud_cover": properties.get("eo:cloud_cover"),
                "platform": properties.get("platform"),
                "instruments": properties.get("instruments") or [],
                "bbox": feature_item.get("bbox") or [],
                "thumbnail": (assets.get("thumbnail") or {}).get("href", ""),
                "product": (assets.get("Product") or {}).get("href", ""),
                "metadata": self_link,
            }
        )
    return {
        "provider": "Copernicus Data Space Ecosystem",
        "catalog": "STAC",
        "county": domain.county_name(feature),
        "county_code": domain.county_code(feature),
        "collection": collection,
        "start": start.isoformat(),
        "end": end.isoformat(),
        "max_cloud": cloud,
        "item_count": len(items),
        "items": items,
        "source_url": COPERNICUS_STAC_SEARCH_URL,
        "generated_at": domain.now_iso(),
    }


def landsat_latest(query) -> dict:
    county = str(query.get("county") or "").strip()
    if county:
        feature = domain.find_county(county)
        if not feature:
            raise DataSourceError("County not found.", 404)
        scope_name = domain.county_name(feature)
        scope_code = domain.county_code(feature)
        search_bounds = list(domain.bbox(feature))
    else:
        features = domain.counties()
        search_bounds = [
            min(domain.bbox(feature)[0] for feature in features),
            min(domain.bbox(feature)[1] for feature in features),
            max(domain.bbox(feature)[2] for feature in features),
            max(domain.bbox(feature)[3] for feature in features),
        ]
        scope_name = "Kenya"
        scope_code = "000"

    try:
        max_cloud = max(0, min(100, float(query.get("max_cloud", "35"))))
        lookback_days = max(30, min(730, int(query.get("lookback_days", "180"))))
    except ValueError as exc:
        raise DataSourceError("max_cloud and lookback_days must be numeric.") from exc

    end = date.today()
    start = end - timedelta(days=lookback_days)
    body = {
        "collections": ["landsat-c2l2-sr"],
        "bbox": search_bounds,
        "datetime": f"{start.isoformat()}T00:00:00Z/{end.isoformat()}T23:59:59Z",
        "limit": 1,
        "query": {"eo:cloud_cover": {"lte": max_cloud}},
        "sortby": [{"field": "properties.datetime", "direction": "desc"}],
    }
    encoded = json.dumps(body, separators=(",", ":")).encode("utf-8")
    cache_key = f"landsat-latest:{hashlib.sha256(encoded).hexdigest()}"
    payload = cache.get(cache_key)
    if payload is None:
        lock_key = f"{cache_key}:refreshing"
        owns_lock = cache.add(lock_key, "1", 45)
        if not owns_lock:
            for _ in range(250):
                time.sleep(0.1)
                payload = cache.get(cache_key)
                if payload is not None:
                    break
        if payload is None:
            try:
                request = Request(
                    LANDSAT_STAC_SEARCH_URL,
                    data=encoded,
                    method="POST",
                    headers={"Content-Type": "application/json", "User-Agent": "K-L-I-A/1.0 Landsat latest scene"},
                )
                with urlopen(request, timeout=30) as response:
                    payload = json.loads(response.read().decode("utf-8"))
            except HTTPError as exc:
                detail = exc.read().decode("utf-8", errors="replace")
                raise DataSourceError(f"USGS LandsatLook rejected the request: {detail[:300]}", 502) from exc
            except (URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
                raise DataSourceError(f"USGS LandsatLook is unavailable: {exc}", 503) from exc
            finally:
                if owns_lock:
                    cache.delete(lock_key)
            cache.set(cache_key, payload, 1800)

    features = payload.get("features") or []
    if not features:
        return {
            "provider": "USGS LandsatLook",
            "collection": "landsat-c2l2-sr",
            "scope": scope_name,
            "scope_code": scope_code,
            "status": "no_scene_in_window",
            "scene": None,
            "search_start": start.isoformat(),
            "search_end": end.isoformat(),
            "max_cloud": max_cloud,
            "generated_at": domain.now_iso(),
        }

    item = features[0]
    properties = item.get("properties", {})
    assets = item.get("assets", {})
    self_link = next((link.get("href") for link in item.get("links", []) if link.get("rel") == "self"), "")
    overlay_bounds = search_bounds if county else (item.get("bbox") or search_bounds)
    map_overlay = _latest_renderable_landsat(overlay_bounds, max_cloud, lookback_days)
    return {
        "provider": "USGS LandsatLook",
        "collection": "landsat-c2l2-sr",
        "scope": scope_name,
        "scope_code": scope_code,
        "status": "available",
        "scene": {
            "id": item.get("id"),
            "datetime": properties.get("datetime"),
            "date": str(properties.get("datetime") or "")[:10],
            "cloud_cover": properties.get("eo:cloud_cover"),
            "platform": properties.get("platform"),
            "bbox": item.get("bbox") or [],
            "usgs_thumbnail": (assets.get("thumbnail") or {}).get("href", ""),
            "usgs_browse_image": (assets.get("reduced_resolution_browse") or {}).get("href", ""),
            "download_requires_usgs_login": True,
            "red_cog": (assets.get("red") or {}).get("href", ""),
            "nir_cog": (assets.get("nir08") or {}).get("href", ""),
            "swir1_cog": (assets.get("swir16") or {}).get("href", ""),
            "metadata": self_link,
        },
        "map_overlay": map_overlay,
        "search_start": start.isoformat(),
        "search_end": end.isoformat(),
        "max_cloud": max_cloud,
        "generated_at": domain.now_iso(),
    }


def _soilgrids_value(layer: dict, depth_label: str = "0-5cm") -> float | None:
    unit = layer.get("unit_measure") or {}
    divisor = float(unit.get("d_factor") or 1)
    if not math.isfinite(divisor) or divisor == 0:
        divisor = 1
    for depth in layer.get("depths") or []:
        if depth.get("label") != depth_label:
            continue
        value = (depth.get("values") or {}).get("mean")
        if value is None:
            return None
        try:
            number = float(value) / divisor
        except (TypeError, ValueError):
            return None
        return number if math.isfinite(number) else None
    return None


def soilgrids_point(query) -> dict:
    county = str(query.get("county") or "").strip()
    scope_name = "Custom point"
    scope_code = ""
    if county:
        feature = domain.find_county(county)
        if not feature:
            raise DataSourceError("County not found.", 404)
        latitude, longitude = domain.county_weather_center(feature)
        scope_name = domain.county_name(feature)
        scope_code = domain.county_code(feature)
    else:
        try:
            latitude = float(query.get("lat") or query.get("latitude"))
            longitude = float(query.get("lon") or query.get("longitude"))
        except (TypeError, ValueError) as exc:
            raise DataSourceError("Provide a valid county or numeric lat/lon for SoilGrids.") from exc

    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        raise DataSourceError("SoilGrids latitude/longitude is out of range.")

    params = {
        "lon": f"{longitude:.6f}",
        "lat": f"{latitude:.6f}",
        "property": ["phh2o", "soc"],
        "depth": str(query.get("depth") or "0-5cm"),
        "value": "mean",
    }
    encoded = urlencode(params, doseq=True)
    cache_key = f"soilgrids:{hashlib.sha256(encoded.encode()).hexdigest()}"
    payload = cache.get(cache_key)
    if payload is None:
        try:
            request = Request(
                f"{SOILGRIDS_PROPERTIES_URL}?{encoded}",
                headers={"User-Agent": "K-L-I-A/1.0 SoilGrids point connector"},
            )
            with urlopen(request, timeout=12) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise DataSourceError(f"SoilGrids rejected the request: {detail[:300]}", 502) from exc
        except (URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
            raise DataSourceError(f"SoilGrids is unavailable: {exc}", 503) from exc
        cache.set(cache_key, payload, 86400)

    layers = {layer.get("name"): layer for layer in (payload.get("properties") or {}).get("layers") or []}
    depth = str(query.get("depth") or "0-5cm")
    ph = _soilgrids_value(layers.get("phh2o") or {}, depth)
    soc_g_kg = _soilgrids_value(layers.get("soc") or {}, depth)
    clay_g_kg = _soilgrids_value(layers.get("clay") or {}, depth)
    sand_g_kg = _soilgrids_value(layers.get("sand") or {}, depth)
    silt_g_kg = _soilgrids_value(layers.get("silt") or {}, depth)
    bulk_density = _soilgrids_value(layers.get("bdod") or {}, depth)

    properties = {
        "soil_ph": round(ph, 2) if ph is not None else None,
        "soil_organic_carbon_g_kg": round(soc_g_kg, 2) if soc_g_kg is not None else None,
        "soil_organic_carbon_pct": round(soc_g_kg / 10, 2) if soc_g_kg is not None else None,
        "clay_g_kg": round(clay_g_kg, 1) if clay_g_kg is not None else None,
        "sand_g_kg": round(sand_g_kg, 1) if sand_g_kg is not None else None,
        "silt_g_kg": round(silt_g_kg, 1) if silt_g_kg is not None else None,
        "bulk_density_cg_cm3": round(bulk_density, 1) if bulk_density is not None else None,
    }
    has_values = any(value is not None for value in properties.values())
    return {
        "provider": "ISRIC SoilGrids",
        "source_url": SOILGRIDS_PROPERTIES_URL,
        "scope": scope_name,
        "scope_code": scope_code,
        "latitude": latitude,
        "longitude": longitude,
        "depth": depth,
        "status": "source_backed" if has_values else "no_model_value_at_point",
        "properties": properties,
        "raw_layers": list(layers),
        "method": "SoilGrids point estimate at county centre; not an area-weighted county zonal statistic.",
        "generated_at": domain.now_iso(),
    }


def landsat_map_image(query) -> tuple[bytes, str]:
    normalized = {str(key).lower(): str(value) for key, value in query.items()}
    try:
        bbox_values = [float(value) for value in normalized.get("bbox", "").split(",")]
        width = int(normalized.get("width", "256"))
        height = int(normalized.get("height", "256"))
    except ValueError as exc:
        raise DataSourceError("Landsat map bbox, width, and height must be numeric.") from exc

    if len(bbox_values) != 4 or not all(math.isfinite(value) for value in bbox_values):
        raise DataSourceError("Landsat map bbox must contain four finite coordinates.")
    if not 1 <= width <= 1024 or not 1 <= height <= 1024:
        raise DataSourceError("Landsat map width and height must be between 1 and 1024 pixels.")

    render_date = normalized.get("time", "")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", render_date):
        raise DataSourceError("Landsat map time must be an ISO date.")

    crs = normalized.get("crs") or normalized.get("srs") or "EPSG:3857"
    if crs.upper() not in {"EPSG:3857", "EPSG:4326"}:
        raise DataSourceError("Landsat map supports EPSG:3857 and EPSG:4326 only.")

    upstream_params = {
        "service": "WMS",
        "request": "GetMap",
        "version": "1.3.0",
        "layers": "ls9_sr",
        "styles": "simple_rgb",
        "format": "image/png",
        "transparent": normalized.get("transparent", "true").lower() in {"1", "true", "yes"},
        "crs": crs.upper(),
        "bbox": ",".join(str(value) for value in bbox_values),
        "width": width,
        "height": height,
        "time": render_date,
    }
    encoded = urlencode(upstream_params)
    cache_key = f"deafrica-landsat-tile:{hashlib.sha256(encoded.encode()).hexdigest()}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached["content"], cached["content_type"]

    try:
        request = Request(
            f"{DEAFRICA_WMS_URL}?{encoded}",
            headers={"User-Agent": "curl/8.0", "Accept": "image/png,*/*"},
        )
        with urlopen(request, timeout=45) as response:
            content = response.read()
            content_type = response.headers.get_content_type()
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise DataSourceError(f"Landsat map provider rejected the request: {detail[:200]}", 502) from exc
    except (URLError, TimeoutError, OSError) as exc:
        raise DataSourceError(f"Landsat map provider is unavailable: {exc}", 503) from exc

    if content_type != "image/png" or not content:
        raise DataSourceError("Landsat map provider returned an invalid image.", 502)
    cache.set(cache_key, {"content": content, "content_type": content_type}, 1800)
    return content, content_type


def _deafrica_wms_latest_date() -> date | None:
    cache_key = "deafrica-wms:ls9-sr-latest-date"
    cached = cache.get(cache_key)
    if cached:
        return date.fromisoformat(cached)

    capabilities_request = Request(
        DEAFRICA_WMS_CAPABILITIES_URL,
        headers={"User-Agent": "curl/8.0", "Accept": "application/xml,*/*"},
    )
    with urlopen(capabilities_request, timeout=20) as response:
        capabilities = response.read().decode("utf-8", errors="replace")
    layer_start = capabilities.index("<Name>ls9_sr</Name>")
    layer_end = capabilities.index("</Layer>", layer_start)
    layer_xml = capabilities[layer_start:layer_end]
    default_match = re.search(r'<Dimension name="time"[^>]*default="(\d{4}-\d{2}-\d{2})"', layer_xml)
    if not default_match:
        return None

    latest = date.fromisoformat(default_match.group(1))
    cache.set(cache_key, latest.isoformat(), 6 * 60 * 60)
    return latest


def _latest_renderable_landsat(search_bounds: list[float], max_cloud: float, lookback_days: int) -> dict | None:
    cache_key = f"deafrica-landsat-map:{hashlib.sha256(json.dumps([search_bounds, max_cloud, lookback_days]).encode()).hexdigest()}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached
    lock_key = f"{cache_key}:refreshing"
    owns_lock = cache.add(lock_key, "1", 45)
    if not owns_lock:
        for _ in range(250):
            time.sleep(0.1)
            cached = cache.get(cache_key)
            if cached is not None:
                return cached
    try:
        wms_end = _deafrica_wms_latest_date()
        if not wms_end:
            return None
        start = wms_end - timedelta(days=lookback_days)
        body = {
            "collections": ["ls9_sr"],
            "bbox": search_bounds,
            "datetime": f"{start.isoformat()}T00:00:00Z/{wms_end.isoformat()}T23:59:59Z",
            "limit": 50,
            "sortby": [{"field": "datetime", "direction": "desc"}],
        }
        encoded = json.dumps(body, separators=(",", ":")).encode("utf-8")
        request = Request(
            DEAFRICA_STAC_SEARCH_URL,
            data=encoded,
            method="POST",
            headers={"Content-Type": "application/json", "User-Agent": "curl/8.0"},
        )
        with urlopen(request, timeout=25) as response:
            payload = json.loads(response.read().decode("utf-8"))
        candidates = [
            item
            for item in payload.get("features", [])
            if float((item.get("properties") or {}).get("eo:cloud_cover") or 100) <= max_cloud
        ]
        if not candidates:
            cache.set(cache_key, None, 900)
            return None
        item = candidates[0]
        properties = item.get("properties") or {}
        render_date = str(properties.get("datetime") or "")[:10]
        bbox_value = item.get("bbox") or search_bounds
        west, south, east, north = bbox_value

        def mercator(longitude, latitude):
            latitude = max(-85.05112878, min(85.05112878, latitude))
            x = longitude * 20037508.34 / 180
            y = math.log(math.tan((90 + latitude) * math.pi / 360)) / (math.pi / 180)
            return x, y * 20037508.34 / 180

        min_x, min_y = mercator(west, south)
        max_x, max_y = mercator(east, north)
        preview_params = {
            "service": "WMS",
            "request": "GetMap",
            "version": "1.3.0",
            "layers": "ls9_sr",
            "styles": "simple_rgb",
            "format": "image/png",
            "transparent": "false",
            "crs": "EPSG:3857",
            "bbox": f"{min_x},{min_y},{max_x},{max_y}",
            "width": 512,
            "height": 512,
            "time": render_date,
        }
        result = {
            "provider": "Digital Earth Africa OGC WMS",
            "source": "USGS Landsat Collection 2 Level-2 Surface Reflectance",
            "url": "/api/data/imagery/landsat/map",
            "provider_url": DEAFRICA_WMS_URL,
            "layers": "ls9_sr",
            "styles": "simple_rgb",
            "format": "image/png",
            "transparent": True,
            "version": "1.3.0",
            "date": render_date,
            "cloud_cover": properties.get("eo:cloud_cover"),
            "bbox": bbox_value,
            "preview_url": f"/api/data/imagery/landsat/map?{urlencode(preview_params)}",
        }
        cache.set(cache_key, result, 1800)
        return result
    except (ValueError, HTTPError, URLError, TimeoutError, OSError, json.JSONDecodeError):
        return None
    finally:
        if owns_lock:
            cache.delete(lock_key)


def _bbox_and_geometry_types(features: list[dict]) -> tuple[list[float], list[str]]:
    coordinates = []
    geometry_types = set()

    def collect(value):
        if isinstance(value, list) and len(value) >= 2 and all(isinstance(item, (int, float)) for item in value[:2]):
            coordinates.append(value)
        elif isinstance(value, list):
            for item in value:
                collect(item)

    for feature in features:
        geometry = feature.get("geometry") or {}
        if geometry.get("type"):
            geometry_types.add(geometry["type"])
        collect(geometry.get("coordinates") or [])
    if not coordinates:
        return [], sorted(geometry_types)
    longitudes = [point[0] for point in coordinates]
    latitudes = [point[1] for point in coordinates]
    return [min(longitudes), min(latitudes), max(longitudes), max(latitudes)], sorted(geometry_types)


def _inspect_upload(upload: UploadedFile, file_format: str) -> dict:
    result = {"feature_count": None, "geometry_types": [], "bbox": [], "metadata": {}}
    if file_format == "geojson" and upload.size <= GEOJSON_PARSE_LIMIT:
        try:
            upload.seek(0)
            payload = json.load(upload)
            upload.seek(0)
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise DataSourceError("The uploaded GeoJSON is not valid JSON.") from exc
        payload_type = payload.get("type")
        if payload_type == "FeatureCollection":
            features = payload.get("features") or []
        elif payload_type == "Feature":
            features = [payload]
        else:
            raise DataSourceError("GeoJSON must be a FeatureCollection or Feature.")
        bbox, geometry_types = _bbox_and_geometry_types(features)
        result.update(
            {
                "feature_count": len(features),
                "geometry_types": geometry_types,
                "bbox": bbox,
                "metadata": {"geojson_type": payload_type},
            }
        )
    elif file_format == "csv" and upload.size <= GEOJSON_PARSE_LIMIT:
        upload.seek(0)
        text = upload.read().decode("utf-8-sig", errors="replace").splitlines()
        upload.seek(0)
        reader = csv.reader(text)
        rows = list(reader)
        result["feature_count"] = max(0, len(rows) - 1)
        result["metadata"] = {"columns": rows[0][:100] if rows else []}
    return result


@transaction.atomic
def create_asset(upload: UploadedFile, fields: dict, user) -> DataAsset:
    if not upload:
        raise DataSourceError("A GIS file is required.")
    if upload.size <= 0:
        raise DataSourceError("The uploaded file is empty.")
    if upload.size > MAX_UPLOAD_BYTES:
        raise DataSourceError("GIS uploads are limited to 100 MB. Use object storage or a catalog API for larger rasters.", 413)
    suffix = Path(upload.name).suffix.lower()
    if suffix not in FILE_FORMATS:
        raise DataSourceError("Supported formats: GeoJSON, GeoPackage, GeoTIFF, CSV, and zipped Shapefile.")
    file_format, asset_type = FILE_FORMATS[suffix]
    inspection = _inspect_upload(upload, file_format)
    upload.seek(0)
    digest = hashlib.sha256()
    for chunk in upload.chunks():
        digest.update(chunk)
    upload.seek(0)

    acquisition_start = _parse_date(fields.get("acquisition_start"), date.today()) if fields.get("acquisition_start") else None
    acquisition_end = _parse_date(fields.get("acquisition_end"), acquisition_start or date.today()) if fields.get("acquisition_end") else acquisition_start
    if acquisition_start and acquisition_end and acquisition_start > acquisition_end:
        raise DataSourceError("acquisition_start must be on or before acquisition_end.")
    scope_level = str(fields.get("scope_level") or DataAsset.ScopeLevel.NATIONAL)
    if scope_level not in DataAsset.ScopeLevel.values:
        raise DataSourceError("Invalid scope_level.")

    digest_value = digest.hexdigest()
    duplicate = DataAsset.objects.filter(sha256=digest_value).first()
    asset = DataAsset.objects.create(
        name=str(fields.get("name") or Path(upload.name).stem)[:180],
        file=upload,
        original_filename=Path(upload.name).name[:255],
        file_format=file_format,
        content_type=str(getattr(upload, "content_type", "") or "")[:120],
        asset_type=asset_type,
        size_bytes=upload.size,
        sha256=digest_value,
        scope_level=scope_level,
        scope_name=str(fields.get("scope_name") or "")[:160],
        scope_code=str(fields.get("scope_code") or "")[:40],
        acquisition_start=acquisition_start,
        acquisition_end=acquisition_end,
        feature_count=inspection["feature_count"],
        geometry_types=inspection["geometry_types"],
        bbox=inspection["bbox"],
        metadata=inspection["metadata"],
        status="ready" if inspection["feature_count"] is not None or asset_type != DataAsset.AssetType.VECTOR else "metadata_only",
        uploaded_by=user,
    )
    crs = str(fields.get("coordinate_reference_system") or fields.get("crs") or "").strip()
    if file_format == "geojson" and not crs:
        crs = "EPSG:4326 (assumed from GeoJSON standard)"
    projection_warning = ""
    if asset_type in {DataAsset.AssetType.VECTOR, DataAsset.AssetType.RASTER} and not crs:
        projection_warning = "Coordinate reference system was not supplied; verify projection before spatial analysis."
    temporal = ""
    if acquisition_start:
        temporal = acquisition_start.isoformat()
        if acquisition_end and acquisition_end != acquisition_start:
            temporal = f"{temporal} to {acquisition_end.isoformat()}"
    DataQualityAssessment.objects.create(
        asset=asset,
        source_name=str(fields.get("source_name") or f"Uploaded by {user.username}")[:160],
        spatial_coverage=asset.scope_name or asset.scope_level,
        temporal_coverage=temporal,
        coordinate_reference_system=crs[:120],
        confidence=(
            DataQualityAssessment.Confidence.HIGH
            if file_format == "geojson" and inspection["feature_count"] is not None
            else DataQualityAssessment.Confidence.MEDIUM
        ),
        processing_status=(
            DataQualityAssessment.ProcessingStatus.READY
            if asset.status == "ready"
            else DataQualityAssessment.ProcessingStatus.WARNING
        ),
        missing_data_warning=(
            "Acquisition dates were not supplied." if not acquisition_start else ""
        ),
        projection_warning=projection_warning,
        duplicate_warning=(
            f"Duplicate content matches existing asset {duplicate.id} ({duplicate.name})."
            if duplicate
            else ""
        ),
    )
    return asset


def register_source(payload: dict, user) -> ExternalDataSource:
    required = ["slug", "name", "provider", "base_url"]
    missing = [field for field in required if not str(payload.get(field) or "").strip()]
    if missing:
        raise DataSourceError(f"Missing required fields: {', '.join(missing)}")
    source_type = str(payload.get("source_type") or ExternalDataSource.SourceType.OTHER)
    if source_type not in ExternalDataSource.SourceType.values:
        raise DataSourceError("Invalid source_type.")
    source_slug = slugify(str(payload["slug"]).strip())
    if not source_slug:
        raise DataSourceError("slug must contain letters or numbers.")
    base_url = str(payload["base_url"]).strip()
    try:
        URLValidator(schemes=["http", "https"])(base_url)
    except ValidationError as exc:
        raise DataSourceError("base_url must be a valid HTTP or HTTPS URL.") from exc
    coverage_start = _parse_date(payload.get("coverage_start"), date.today()) if payload.get("coverage_start") else None
    coverage_end = _parse_date(payload.get("coverage_end"), date.today()) if payload.get("coverage_end") else None
    source, _ = ExternalDataSource.objects.update_or_create(
        slug=source_slug,
        defaults={
            "name": str(payload["name"]).strip(),
            "provider": str(payload["provider"]).strip(),
            "base_url": base_url,
            "source_type": source_type,
            "coverage_start": coverage_start,
            "coverage_end": coverage_end,
            "requires_auth": bool(payload.get("requires_auth")),
            "enabled": bool(payload.get("enabled", True)),
            "description": str(payload.get("description") or ""),
            "metadata": payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {},
            "created_by": user,
        },
    )
    return source
