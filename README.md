# K-L-I-A Intelligence Dashboard

Agro-Environmental Intelligence System for Kenya, powered by one Django backend and a React/Leaflet frontend.

## What is live

- Kenya county, sub-county, and ward GeoJSON boundaries
- County GPS geofencing and county-scoped access
- Django users, sessions, system settings, and authentication audit records
- Live Open-Meteo forecasts
- NASA POWER climate history, Sentinel-2 search, and Landsat 8/9 overlays
- Validated GIS uploads with CRS, duplicate, coverage, confidence, and processing indicators
- K-L-I-A Intelligence Assistant with evidence, confidence, missing-data, and explainability sections
- National/county report generation, preview, approval workflow, audit trail, and PDF/CSV/XLSX/GeoJSON exports
- Ministry user management for analyst, county, field officer, farmer, and auditor accounts
- Field-report submission, offline device drafts, county verification, and role-scoped access
- Light/dark interface, command search, system/data-source status, and print layouts
- OpenStreetMap segmentation overlays
- Optional Google Earth Engine raster tile configuration
- Source-required safeguards for analytics that do not yet have verified data

K-L-I-A does not generate official NDVI, NDWI, NDBI, land-cover, farmer-registry, rainfall-history, or crop-risk values without connected sources.

## Start

```powershell
.\aeis.ps1 start
```

For permanent automatic startup after Windows logon:

```powershell
.\aeis.ps1 install
```

The control script installs missing requirements, runs migrations, builds the frontend, starts Django/Waitress and the processing worker, prevents duplicate servers, and can register an auto-restarting Windows scheduled task.

- Dashboard and API: `http://127.0.0.1:8000`
- Runtime database: `%LOCALAPPDATA%\K-L-I-A\klia-live.sqlite3` by default on Windows, or `AEIS_DB_PATH` when set
- Runtime cache: `.runtime/cache`
- Server concurrency: 12 Waitress request threads
- Durable worker: database-backed AI and report processing outside request threads
- SQLite mode: WAL with tuned read concurrency and a 20-second busy timeout

Manual commands:

```powershell
python -m pip install -r django_backend\requirements.txt
python django_backend\manage.py migrate
python django_backend\manage.py seed_aeis
npm --prefix frontend run build
python django_backend\manage.py runserver 0.0.0.0:8000
python django_backend\manage.py process_aeis_jobs
```

## Development

Use:

```powershell
.\aeis.ps1 dev
```

Vite proxies `/api` and `/health` to Django.

Control commands:

```powershell
.\aeis.ps1 status
.\aeis.ps1 start
.\aeis.ps1 stop
.\aeis.ps1 restart
.\aeis.ps1 logs
.\aeis.ps1 uninstall
```

Running `npm run dev` from the `frontend` directory is now duplicate-safe. If port 5173 already belongs to K-L-I-A, it reports the existing URL instead of failing or starting on another port.

## Configuration

Useful environment variables:

```powershell
$env:AEIS_DJANGO_SECRET_KEY="replace-in-production"
$env:AEIS_DJANGO_DEBUG="0"
$env:AEIS_ALLOWED_HOSTS="dashboard.example.org"
$env:AEIS_CORS_ALLOWED_ORIGIN="https://frontend.example.org"
$env:AEIS_DB_PATH="C:\secure\aeis.sqlite3"
$env:AEIS_DB_ENGINE="postgresql"
$env:AEIS_DB_NAME="aeis_k"
$env:AEIS_DB_USER="aeis_k"
$env:AEIS_DB_PASSWORD="use-a-secret-manager"
$env:AEIS_DB_HOST="127.0.0.1"
$env:AEIS_DB_SSLMODE="require"
$env:OPENAI_API_KEY="use-a-secret-manager"
$env:AEIS_OPENAI_MODEL="gpt-5.4-mini"
$env:AEIS_LOG_LEVEL="INFO"
$env:AEIS_SECURE_SSL_REDIRECT="1"
$env:AEIS_SECURE_HSTS_SECONDS="31536000"
$env:AEIS_GEE_NDVI_TILE_URL="..."
$env:AEIS_GEE_NDWI_TILE_URL="..."
$env:AEIS_GEE_LST_TILE_URL="..."
```

For temporary outside-network testing:

```powershell
.\start-public-tunnel.ps1
```

Use the Ministry public-access lock before sharing a public URL.

## Historical and GIS Data

The Ministry panel includes a GIS Data Sources workspace:

- NASA POWER climate history: daily data from 1981 to near-real-time and monthly history through the latest completed year
- Reviewed local monthly climate imports: KMD/KALRO/KNBS-style CSV records can override open fallback data county-by-county and month-by-month
- Reviewed environmental metric imports: source-backed NDVI, NDWI, LST, water, forest, land-use, roads, and soil metrics can populate Intelligence Hub consoles
- Copernicus Sentinel-2 catalogue: Level-1C and Level-2A catalogue coverage from June 27, 2015 to present
- USGS Landsat Collection 2: the latest low-cloud Landsat 8/9 scene is discovered dynamically and shown as a dated map overlay
- OpenStreetMap is the default open basemap; OpenTopoMap terrain and a reference satellite basemap are also available
- Open-Meteo Best Match supplies a key-free, ten-day weather forecast
- Private GIS uploads: GeoJSON, GeoPackage, GeoTIFF, CSV, and zipped Shapefile, up to 100 MB
- Custom API source registration through `POST /api/data/sources`

Main endpoints:

```text
GET  /api/data/sources
GET  /api/data/history/nasa-power
GET  /api/data/intelligence/monthly
GET  /api/data/intelligence/metrics
GET  /api/data/imagery/sentinel-2
GET  /api/data/imagery/landsat/latest
GET  /api/data/imagery/landsat/map
GET  /api/data/assets
POST /api/data/assets/upload
```

Historical queries and asset access require an active K-L-I-A session. Uploads and API registration require a Ministry session.

Monthly intelligence rule: K-L-I-A shows only source-backed values. Reviewed Kenya-local records are preferred when imported; NASA POWER is used only as a real open-source fallback. If NDVI, NDWI, surface-water extent, forest cover, land-use share, road length, or soil properties are not connected, the dashboard must show source-required/proxy labels instead of invented values.

Import reviewed monthly climate CSV records:

```powershell
python django_backend\manage.py import_monthly_climate C:\path\kmd-monthly.csv --source-slug kenya-meteorological-department --source-name "KMD reviewed monthly county climate export" --provider "Kenya Meteorological Department"
```

Accepted CSV columns include `county` or `county_code`, `month` or `year` + `month_number`, `rainfall_mm`, `temperature_c`, `temperature_max_c`, `temperature_min_c`, `humidity_pct`, `wind_ms`, `solar_mj_m2_day`, `station_count`, `quality_flag`, and `notes`. Bad counties, bad dates, and impossible ranges are skipped and reported.

Import reviewed environmental metric CSV records:

```powershell
python django_backend\manage.py import_environmental_metrics C:\path\metrics.csv --source-slug esa-worldcover --source-name "ESA WorldCover county zonal statistics" --provider "European Space Agency"
```

Accepted environmental metric columns include `county` or `scope_name`, `county_code` or `scope_code`, `metric_key`, `value`, `period_start`, `period_end`, `period_grain`, `source_slug`, `source_name`, `provider`, `confidence`, `method`, `quality_flag`, and `notes`. Supported metric keys include `ndvi`, `ndwi`, `lst_c`, `water_extent_ha`, `water_extent_pct`, `forest_cover_ha`, `forest_cover_pct`, `cropland_pct`, `built_up_pct`, `grassland_pct`, `bare_land_pct`, `tarmac_road_km`, `all_weather_road_km`, `road_density_km_per_100sqkm`, `soil_organic_carbon_pct`, `soil_ph`, and `soil_moisture_pct`.

Example:

```text
GET /api/data/history/nasa-power?county=Mombasa&temporal=monthly&start=2016-01-01&end=2026-06-20
GET /api/data/history/nasa-power?county=Mombasa&temporal=daily&start=2026-01-01&end=2026-06-20
GET /api/data/intelligence/monthly?county=Mombasa&years=20&source=auto
GET /api/data/intelligence/monthly?years=20&source=local
GET /api/data/intelligence/metrics?county=Mombasa&category=landuse&years=20
GET /api/data/imagery/sentinel-2?county=Mombasa&start=2016-01-01&end=2026-06-20&max_cloud=30
GET /api/data/imagery/landsat/latest?county=Mombasa&lookback_days=365&max_cloud=35
```

Monthly NASA POWER data normally ends at the latest completed year. Daily mode reaches near-real-time and reports the actual latest non-missing date returned by NASA.

## Intelligence, Reports, and Roles

The Intelligence Assistant always returns structured evidence, data sources, missing data, a confidence level, and an explanation. Without `OPENAI_API_KEY`, it uses the deterministic local rules provider and never invents unavailable NDVI, crop-failure, drought, or land-cover values. With a key, it uses the OpenAI Responses API with strict structured output and falls back locally if the provider is unavailable.

Protected workflow endpoints:

```text
GET/POST /api/intelligence/query
GET      /api/intelligence/insights
GET/POST /api/reports
POST     /api/reports/{id}/transition
GET      /api/reports/{id}/export/{pdf|csv|xlsx|geojson}
GET/POST /api/users
PATCH    /api/users/{id}
GET/POST /api/field-reports
POST     /api/field-reports/{id}/verify
GET      /api/data/quality
GET      /api/jobs
GET/POST /api/jobs/{job-id}
```

The React interface submits intelligence and report generation as durable background jobs. Jobs survive browser refreshes and temporary API failures, expose progress, retry transient provider errors, and can be cancelled while queued. For separate production services, run:

```powershell
python django_backend\manage.py process_aeis_jobs --sleep 1
```

Local seeded national accounts are available only for development/presentation use. Use the Ministry user-management panel to create real scoped accounts and replace temporary passwords.

## Verify

```powershell
python django_backend\manage.py check
python django_backend\manage.py test aeis_dashboard.tests
npm --prefix frontend run build
```

The current automated suite contains 17 tests covering health, authentication, role scope, user management, AI fallback, durable background jobs, report approval/export, GIS quality, field verification, weather, and satellite connectors.
