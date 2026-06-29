from __future__ import annotations

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
from django.utils.text import slugify

from aeis_dashboard.models import DataAsset, DataQualityAssessment, ExternalDataSource

from . import domain


NASA_POWER_URL = "https://power.larc.nasa.gov/api/temporal"
COPERNICUS_STAC_SEARCH_URL = "https://stac.dataspace.copernicus.eu/v1/search"
LANDSAT_STAC_SEARCH_URL = "https://landsatlook.usgs.gov/stac-server/search"
DEAFRICA_STAC_SEARCH_URL = "https://explorer.digitalearth.africa/stac/search"
DEAFRICA_WMS_URL = "https://ows.digitalearth.africa/wms"
DEAFRICA_WMS_CAPABILITIES_URL = f"{DEAFRICA_WMS_URL}?service=WMS&request=GetCapabilities&version=1.3.0"
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
        "access": "source_required",
        "endpoints": {
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
        "access": "source_required",
        "endpoints": {
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
        "sources": [*BUILTIN_SOURCES, *custom],
        "summary": {
            "connected_apis": sum(1 for source in BUILTIN_SOURCES if source["access"].startswith("connected")),
            "registered_apis": len(custom),
            "uploaded_assets": assets.count(),
            "latest_upload": _iso(assets.first().created_at) if assets.exists() else None,
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
            request = Request(url, headers={"User-Agent": "AEIS-K/1.0 historical climate connector"})
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
                headers={"Content-Type": "application/json", "User-Agent": "AEIS-K/1.0 imagery catalogue"},
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
                    headers={"Content-Type": "application/json", "User-Agent": "AEIS-K/1.0 Landsat latest scene"},
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
