from __future__ import annotations

import json
import mimetypes
from datetime import date
from pathlib import Path

from django.conf import settings
from django.core.cache import cache
from django.core.exceptions import BadRequest
from django.db import IntegrityError, connection
from django.db.models import Q
from django.http import FileResponse, Http404, HttpRequest, HttpResponse, JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from .models import AEISUser, Alert, DataAsset, FieldReport, ProcessingJob
from .services import auth, data_sources, domain, intelligence, jobs, osm_metrics, payments, reports


FRONTEND_DIST_DIR = settings.PROJECT_ROOT / "frontend" / "dist"
FRONTEND_PUBLIC_DIR = settings.PROJECT_ROOT / "frontend" / "public"


def with_cors(response: HttpResponse) -> HttpResponse:
    if settings.CORS_ALLOWED_ORIGIN:
        response["Access-Control-Allow-Origin"] = settings.CORS_ALLOWED_ORIGIN
        response["Access-Control-Allow-Methods"] = "GET, POST, PATCH, OPTIONS"
        response["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
        response["Vary"] = "Origin"
    return response


def api_json(payload, status: int = 200) -> JsonResponse:
    response = JsonResponse(payload, status=status, safe=not isinstance(payload, list), json_dumps_params={"ensure_ascii": False})
    return with_cors(response)


def request_json(request: HttpRequest) -> dict:
    if not request.body:
        return {}
    try:
        payload = json.loads(request.body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise BadRequest("Request body must be a valid JSON object.") from exc
    if not isinstance(payload, dict):
        return {}
    payload["_client_ip"] = request.META.get("REMOTE_ADDR", "")
    payload["_user_agent"] = request.META.get("HTTP_USER_AGENT", "")
    return payload


def request_token(request: HttpRequest) -> str:
    authorization = request.headers.get("Authorization", "")
    if authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return str(request.POST.get("token") or request.GET.get("token") or "").strip()


def data_source_error(exc: data_sources.DataSourceError) -> JsonResponse:
    return api_json({"error": str(exc)}, status=exc.status)


def intelligence_error(exc: intelligence.IntelligenceError) -> JsonResponse:
    return api_json({"error": str(exc)}, status=exc.status)


def report_error(exc: reports.ReportError) -> JsonResponse:
    return api_json({"error": str(exc)}, status=exc.status)


def job_error(exc: jobs.JobError) -> JsonResponse:
    return api_json({"error": str(exc)}, status=exc.status)


def payment_error(exc: payments.PaymentError) -> JsonResponse:
    return api_json({"error": str(exc)}, status=exc.status)


# ── M-PESA payment gateway (report generation) ──────────────────────────

@require_http_methods(["GET", "OPTIONS"])
def payments_config(request: HttpRequest) -> JsonResponse:
    if request.method == "OPTIONS":
        return api_json({"status": "ok"})
    config = payments.gateway_config()
    # Hand the client a fresh account reference to show against the Paybill.
    config["account_ref"] = payments.account_reference(request.GET.get("ref", ""))
    return api_json(config)


@csrf_exempt
@require_http_methods(["POST", "OPTIONS"])
def payments_stk_push(request: HttpRequest) -> JsonResponse:
    if request.method == "OPTIONS":
        return api_json({"status": "ok"})
    payload = request_json(request)
    phone = str(payload.get("phone") or "").strip()
    if not phone:
        return api_json({"error": "A phone number is required."}, status=400)
    account_ref = str(payload.get("account_ref") or "").strip() or payments.account_reference()
    description = str(payload.get("description") or "AEIS-K intelligence report").strip()
    try:
        result = payments.initiate_stk(phone=phone, account_ref=account_ref, description=description)
    except payments.PaymentError as exc:
        return payment_error(exc)
    result["account_ref"] = account_ref
    return api_json(result, status=201)


@require_http_methods(["GET", "OPTIONS"])
def payments_status(request: HttpRequest) -> JsonResponse:
    if request.method == "OPTIONS":
        return api_json({"status": "ok"})
    checkout_id = str(request.GET.get("checkout_id") or "").strip()
    try:
        return api_json(payments.query_status(checkout_id))
    except payments.PaymentError as exc:
        return payment_error(exc)


@csrf_exempt
@require_http_methods(["POST", "OPTIONS"])
def payments_mpesa_callback(request: HttpRequest) -> JsonResponse:
    if request.method == "OPTIONS":
        return api_json({"status": "ok"})
    payload = request_json(request)
    return api_json(payments.handle_callback(payload))


def protected_session(request: HttpRequest, permission: str | None = None):
    session = auth.active_session(request_token(request))
    if not session:
        return None
    if permission and not auth.session_has_permission(session, permission):
        return None
    return session


def safe_file(root: Path, request_path: str) -> Path | None:
    try:
        candidate = (root / request_path.lstrip("/")).resolve()
        if root.resolve() not in candidate.parents and candidate != root.resolve():
            return None
        return candidate if candidate.is_file() else None
    except OSError:
        return None


def file_response(path: Path, cache: bool = False) -> FileResponse:
    content_type, _ = mimetypes.guess_type(str(path))
    response = FileResponse(path.open("rb"), content_type=content_type or "application/octet-stream")
    response["Cache-Control"] = "public, max-age=31536000, immutable" if cache else "no-cache"
    return with_cors(response)


def frontend_index(request: HttpRequest) -> HttpResponse:
    index_path = FRONTEND_DIST_DIR / "index.html"
    if index_path.exists():
        return file_response(index_path)
    return api_json(
        {
            "project": "AEIS-K",
            "name": "Agro-Environmental Intelligence System for Kenya",
            "status": "django_ready",
            "message": "Build the React frontend with npm --prefix frontend run build.",
        }
    )


def frontend_asset(request: HttpRequest, asset_path: str) -> HttpResponse:
    path = safe_file(FRONTEND_DIST_DIR / "assets", asset_path)
    if not path:
        raise Http404("Asset not found")
    return file_response(path, cache=True)


def frontend_data(request: HttpRequest, data_path: str) -> HttpResponse:
    path = safe_file(FRONTEND_DIST_DIR / "data", data_path) or safe_file(FRONTEND_PUBLIC_DIR / "data", data_path)
    if not path:
        raise Http404("Data file not found")
    return file_response(path, cache=True)


def frontend_catchall(request: HttpRequest, request_path: str) -> HttpResponse:
    if request_path.startswith("api/"):
        return api_json({"error": "Not found", "path": f"/{request_path}"}, status=404)

    path = safe_file(FRONTEND_DIST_DIR, request_path) or safe_file(FRONTEND_PUBLIC_DIR, request_path)
    if path:
        return file_response(path, cache=request_path.startswith("assets/"))
    return frontend_index(request)


@require_http_methods(["GET", "OPTIONS"])
def health(request: HttpRequest) -> JsonResponse:
    checks = {}
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            checks["database"] = cursor.fetchone()[0] == 1
    except Exception:
        checks["database"] = False

    try:
        request_id = getattr(request, "aeis_request_id", "probe")
        cache_key = f"health:cache:{request_id}"
        cache.set(cache_key, "ok", 10)
        checks["cache"] = cache.get(cache_key) == "ok"
        cache.delete(cache_key)
    except Exception:
        checks["cache"] = False

    try:
        ProcessingJob.objects.only("pk").first()
        checks["job_queue"] = True
        queue = {
            "queued": ProcessingJob.objects.filter(status=ProcessingJob.Status.QUEUED).count(),
            "running": ProcessingJob.objects.filter(status=ProcessingJob.Status.RUNNING).count(),
            "failed": ProcessingJob.objects.filter(status=ProcessingJob.Status.FAILED).count(),
        }
    except Exception:
        checks["job_queue"] = False
        queue = {"queued": None, "running": None, "failed": None}

    checks["boundaries"] = all(
        path.exists()
        for path in [
            domain.DATA_DIR / "counties.geojson",
            domain.DATA_DIR / "sub_Counties.geojson",
            domain.DATA_DIR / "wards.geojson",
        ]
    )
    healthy = all(checks.values())
    return api_json(
        {
            "status": "healthy" if healthy else "degraded",
            "runtime": "django",
            "checks": checks,
            "processing_queue": queue,
            "server": request.META.get("SERVER_SOFTWARE", ""),
            "generated_at": domain.now_iso(),
        },
        status=200 if healthy else 503,
    )


@require_http_methods(["GET", "OPTIONS"])
def dashboard_summary(request: HttpRequest) -> JsonResponse:
    return api_json(domain.dashboard_summary_payload())


@require_http_methods(["GET", "OPTIONS"])
def dashboard_realtime(request: HttpRequest) -> JsonResponse:
    return api_json(domain.realtime_operations_payload(request.GET.get("county") or None))


@require_http_methods(["GET", "OPTIONS"])
def dashboard_county(request: HttpRequest, identifier: str) -> JsonResponse:
    status, result = domain.dashboard_county_payload(identifier)
    return api_json(result, status=status)


@require_http_methods(["GET", "OPTIONS"])
def dashboard_alerts(request: HttpRequest) -> JsonResponse:
    session = protected_session(request)
    if not session:
        return api_json({"error": "An active AEIS-K session is required."}, status=403)
    queryset = Alert.objects.exclude(status=Alert.Status.RESOLVED)
    if session.user.role in {
        AEISUser.Role.COUNTY,
        AEISUser.Role.FIELD_OFFICER,
        AEISUser.Role.FARMER,
    }:
        queryset = queryset.filter(scope_name__iexact=session.user.county_name)
    return api_json(
        {
            "alerts": [
                {
                    "id": alert.pk,
                    "severity": alert.severity.title(),
                    "title": alert.title,
                    "county": alert.scope_name or "National",
                    "message": alert.description,
                    "action": f"Status: {alert.status}. Confidence: {alert.confidence}.",
                }
                for alert in queryset[:20]
            ],
            "generated_at": domain.now_iso(),
        }
    )


@require_http_methods(["GET", "OPTIONS"])
def dashboard_reports(request: HttpRequest) -> JsonResponse:
    session = protected_session(request)
    if not session:
        return api_json({"error": "An active AEIS-K session is required."}, status=403)
    queryset = reports.scoped_reports(session.user)
    return api_json(
        {
            "reports": [
                {
                    "id": report.pk,
                    "type": report.title,
                    "scope": report.scope_name or "Kenya",
                    "status": report.status,
                    "updatedAt": report.updated_at.isoformat(),
                }
                for report in queryset[:10]
            ],
            "generated_at": domain.now_iso(),
        }
    )


@require_http_methods(["GET", "OPTIONS"])
def weather_forecast(request: HttpRequest) -> JsonResponse:
    status, result = domain.weather_forecast_payload(request.GET.get("county") or None)
    return api_json(result, status=status)


@require_http_methods(["GET", "OPTIONS"])
def metadata(request: HttpRequest) -> JsonResponse:
    response = api_json(
        {
            "country": "Kenya",
            "admin_levels": ["county", "subcounty", "ward", "farm"],
            "runtime": "django",
            "auth": {
                "county_login": True,
                "national_login": True,
                "role_based_access": True,
                "gps_geofence": True,
                "county_sessions": True,
                "storage": "django_orm",
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
                "nasa_power_history",
                "copernicus_sentinel_catalogue",
                "usgs_landsat_latest",
                "forest_trend",
                "roads",
            ],
        }
    )
    response["Cache-Control"] = "public, max-age=300, stale-while-revalidate=3600"
    return response


@require_http_methods(["GET", "OPTIONS"])
def system_access(request: HttpRequest) -> JsonResponse:
    return api_json(domain.system_access_payload())


@require_http_methods(["GET", "OPTIONS"])
def system_actualization(request: HttpRequest) -> JsonResponse:
    return api_json(domain.system_actualization_payload())


@csrf_exempt
@require_http_methods(["POST", "OPTIONS"])
def system_public_access(request: HttpRequest) -> JsonResponse:
    if request.method == "OPTIONS":
        return api_json({"status": "ok"})
    status, result = auth.update_public_access(request_json(request))
    return api_json(result, status=status)


@require_http_methods(["GET", "OPTIONS"])
def gee_layers(request: HttpRequest) -> JsonResponse:
    return api_json(domain.gee_layers_payload())


@csrf_exempt
@require_http_methods(["GET", "POST", "OPTIONS"])
def data_catalog(request: HttpRequest) -> JsonResponse:
    if request.method == "OPTIONS":
        return api_json({"status": "ok"})
    if request.method == "GET":
        return api_json(data_sources.source_catalog())
    session = auth.active_session(request_token(request), roles=["ministry"])
    if not session:
        return api_json({"error": "A valid Ministry session is required to register an API source."}, status=403)
    try:
        source = data_sources.register_source(request_json(request), session.user)
    except data_sources.DataSourceError as exc:
        return data_source_error(exc)
    return api_json({"status": "registered", "slug": source.slug, "catalog": data_sources.source_catalog()}, status=201)


@require_http_methods(["GET", "OPTIONS"])
def data_assets(request: HttpRequest) -> JsonResponse:
    if not auth.active_session(request_token(request)):
        return api_json({"error": "An active AEIS-K session is required to list GIS assets."}, status=403)
    try:
        limit = int(request.GET.get("limit", "100"))
    except ValueError:
        limit = 100
    return api_json({"assets": data_sources.asset_list(limit), "generated_at": domain.now_iso()})


@csrf_exempt
@require_http_methods(["POST", "OPTIONS"])
def data_asset_upload(request: HttpRequest) -> JsonResponse:
    if request.method == "OPTIONS":
        return api_json({"status": "ok"})
    session = auth.active_session(request_token(request), roles=["ministry"])
    if not session:
        return api_json({"error": "A valid Ministry session is required to upload GIS data."}, status=403)
    try:
        asset = data_sources.create_asset(request.FILES.get("file"), request.POST, session.user)
    except data_sources.DataSourceError as exc:
        return data_source_error(exc)
    return api_json({"status": "uploaded", "asset": data_sources.asset_payload(asset)}, status=201)


@require_http_methods(["GET", "OPTIONS"])
def data_asset_download(request: HttpRequest, asset_id) -> HttpResponse:
    session = auth.active_session(request_token(request))
    if not session:
        return api_json({"error": "An active AEIS-K session is required to download GIS data."}, status=403)
    try:
        asset = data_sources.DataAsset.objects.get(pk=asset_id)
    except data_sources.DataAsset.DoesNotExist:
        raise Http404("GIS asset not found")
    response = FileResponse(asset.file.open("rb"), as_attachment=True, filename=asset.original_filename)
    response["Cache-Control"] = "private, no-store"
    return with_cors(response)


@require_http_methods(["GET", "OPTIONS"])
def nasa_power_history(request: HttpRequest) -> JsonResponse:
    if not auth.active_session(request_token(request)):
        return api_json({"error": "An active AEIS-K session is required to query historical data."}, status=403)
    try:
        return api_json(data_sources.nasa_power_history(request.GET))
    except data_sources.DataSourceError as exc:
        return data_source_error(exc)


@require_http_methods(["GET", "OPTIONS"])
def sentinel_2_search(request: HttpRequest) -> JsonResponse:
    if not auth.active_session(request_token(request)):
        return api_json({"error": "An active AEIS-K session is required to search imagery."}, status=403)
    try:
        return api_json(data_sources.sentinel_2_search(request.GET))
    except data_sources.DataSourceError as exc:
        return data_source_error(exc)


@require_http_methods(["GET", "OPTIONS"])
def landsat_latest(request: HttpRequest) -> JsonResponse:
    try:
        return api_json(data_sources.landsat_latest(request.GET))
    except data_sources.DataSourceError as exc:
        return data_source_error(exc)


@require_http_methods(["GET", "OPTIONS"])
def landsat_map(request: HttpRequest) -> HttpResponse:
    try:
        content, content_type = data_sources.landsat_map_image(request.GET)
    except data_sources.DataSourceError as exc:
        return data_source_error(exc)
    response = HttpResponse(content, content_type=content_type)
    response["Cache-Control"] = "public, max-age=1800"
    return with_cors(response)


@require_http_methods(["GET", "OPTIONS"])
def auth_county_accounts(request: HttpRequest) -> JsonResponse:
    return api_json(
        {
            "auth_model": "django_users",
            "session_seconds": domain.SESSION_SECONDS,
            "local_seed_password": domain.DEFAULT_COUNTY_PASSWORD if domain.show_demo_credentials() else "",
            "accounts": auth.county_login_accounts(),
        }
    )


@require_http_methods(["GET", "OPTIONS"])
def auth_access_model(request: HttpRequest) -> JsonResponse:
    return api_json(auth.access_model_payload())


@require_http_methods(["GET", "OPTIONS"])
def auth_audit_log(request: HttpRequest) -> JsonResponse:
    session = protected_session(request, "audit_read")
    if not session:
        return api_json({"error": "A Ministry or auditor session is required to view audit events."}, status=403)
    try:
        limit = int(request.GET.get("limit", "80"))
    except ValueError:
        limit = 80
    return api_json({"audit_model": "django_auth_audit", "events": auth.audit_log(limit), "generated_at": domain.now_iso()})


@csrf_exempt
@require_http_methods(["POST", "OPTIONS"])
def auth_county_login(request: HttpRequest) -> JsonResponse:
    if request.method == "OPTIONS":
        return api_json({"status": "ok"})
    status, result = auth.authenticate_county_login(request_json(request))
    return api_json(result, status=status)


@csrf_exempt
@require_http_methods(["POST", "OPTIONS"])
def auth_national_login(request: HttpRequest) -> JsonResponse:
    if request.method == "OPTIONS":
        return api_json({"status": "ok"})
    status, result = auth.authenticate_national_login(request_json(request))
    return api_json(result, status=status)


@csrf_exempt
@require_http_methods(["POST", "OPTIONS"])
def auth_validate_session(request: HttpRequest) -> JsonResponse:
    if request.method == "OPTIONS":
        return api_json({"status": "ok"})
    status, result = auth.validate_session(request_json(request))
    return api_json(result, status=status)


@csrf_exempt
@require_http_methods(["POST", "OPTIONS"])
def auth_logout(request: HttpRequest) -> JsonResponse:
    if request.method == "OPTIONS":
        return api_json({"status": "ok"})
    status, result = auth.logout_session(request_json(request))
    return api_json(result, status=status)


@csrf_exempt
@require_http_methods(["POST", "OPTIONS"])
def auth_register(request: HttpRequest) -> JsonResponse:
    if request.method == "OPTIONS":
        return api_json({"status": "ok"})
    status, result = auth.register_user(request_json(request))
    return api_json(result, status=status)


@csrf_exempt
@require_http_methods(["POST", "OPTIONS"])
def auth_public_login(request: HttpRequest) -> JsonResponse:
    if request.method == "OPTIONS":
        return api_json({"status": "ok"})
    status, result = auth.authenticate_public_login(request_json(request))
    return api_json(result, status=status)


@csrf_exempt
@require_http_methods(["POST", "OPTIONS"])
def auth_google_login(request: HttpRequest) -> JsonResponse:
    if request.method == "OPTIONS":
        return api_json({"status": "ok"})
    status, result = auth.authenticate_google_login(request_json(request))
    return api_json(result, status=status)


@csrf_exempt
@require_http_methods(["POST", "OPTIONS"])
def auth_forgot_password(request: HttpRequest) -> JsonResponse:
    if request.method == "OPTIONS":
        return api_json({"status": "ok"})
    email = str(request_json(request).get("email") or "").strip().lower()
    if not email:
        return api_json({"error": "email is required"}, status=400)
    # Always return success — avoids email enumeration
    return api_json({"status": "ok", "message": "If that email is registered you will receive a reset link shortly."})


def user_payload(user: AEISUser) -> dict:
    return {
        "id": user.pk,
        "username": user.username,
        "email": user.email,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "role": user.role,
        "county_name": user.county_name,
        "county_code": user.county_code,
        "provider": user.provider,
        "is_active": user.is_active,
        "date_joined": user.date_joined.isoformat(),
        "last_login": user.last_login.isoformat() if user.last_login else None,
    }


@csrf_exempt
@require_http_methods(["GET", "POST", "OPTIONS"])
def users_collection(request: HttpRequest) -> JsonResponse:
    if request.method == "OPTIONS":
        return api_json({"status": "ok"})
    session = protected_session(request, "county_user_manage")
    if not session:
        return api_json({"error": "A Ministry administrator session is required."}, status=403)

    if request.method == "GET":
        queryset = AEISUser.objects.all().order_by("role", "county_code", "username")
        role = str(request.GET.get("role") or "").strip()
        county = str(request.GET.get("county") or "").strip()
        search = str(request.GET.get("search") or "").strip()
        if role:
            queryset = queryset.filter(role=role)
        if county:
            queryset = queryset.filter(county_name__iexact=county)
        if search:
            queryset = queryset.filter(
                Q(username__icontains=search)
                | Q(email__icontains=search)
                | Q(first_name__icontains=search)
                | Q(last_name__icontains=search)
            )
        try:
            page = max(1, int(request.GET.get("page", "1")))
            page_size = max(1, min(100, int(request.GET.get("page_size", "50"))))
        except ValueError:
            return api_json({"error": "page and page_size must be numeric."}, status=400)
        total = queryset.count()
        start = (page - 1) * page_size
        return api_json(
            {
                "results": [user_payload(user) for user in queryset[start : start + page_size]],
                "pagination": {
                    "page": page,
                    "page_size": page_size,
                    "total": total,
                    "pages": max(1, (total + page_size - 1) // page_size),
                },
            }
        )

    payload = request_json(request)
    role = str(payload.get("role") or AEISUser.Role.COUNTY)
    if role not in AEISUser.Role.values:
        return api_json({"error": "Invalid AEIS-K role."}, status=400)
    username = str(payload.get("username") or "").strip()
    email = str(payload.get("email") or "").strip().lower()
    password = str(payload.get("password") or "")
    if not username or not email or len(password) < 8:
        return api_json(
            {"error": "username, email, and a password of at least 8 characters are required."},
            status=400,
        )
    county_name = str(payload.get("county_name") or "").strip()
    county_code = ""
    if role in {AEISUser.Role.COUNTY, AEISUser.Role.FIELD_OFFICER, AEISUser.Role.FARMER}:
        feature = domain.find_county(county_name)
        if not feature:
            return api_json({"error": "A valid assigned county is required for this role."}, status=400)
        county_name = domain.county_name(feature)
        county_code = domain.county_code(feature)
    else:
        county_name = "National"
        county_code = "000"
    try:
        user = AEISUser.objects.create_user(
            username=username,
            email=email,
            password=password,
            first_name=str(payload.get("first_name") or "")[:150],
            last_name=str(payload.get("last_name") or "")[:150],
            role=role,
            county_name=county_name,
            county_code=county_code,
            provider="password",
            is_active=bool(payload.get("is_active", True)),
        )
    except IntegrityError:
        return api_json({"error": "Username or email already exists."}, status=409)
    return api_json({"user": user_payload(user)}, status=201)


@csrf_exempt
@require_http_methods(["PATCH", "OPTIONS"])
def user_detail(request: HttpRequest, user_id: int) -> JsonResponse:
    if request.method == "OPTIONS":
        return api_json({"status": "ok"})
    session = protected_session(request, "county_user_manage")
    if not session:
        return api_json({"error": "A Ministry administrator session is required."}, status=403)
    user = AEISUser.objects.filter(pk=user_id).first()
    if not user:
        return api_json({"error": "User not found."}, status=404)
    if user.pk == session.user.pk:
        return api_json({"error": "Use a separate administrator to change your own access state."}, status=409)
    payload = request_json(request)
    update_fields = []
    if "is_active" in payload:
        user.is_active = bool(payload["is_active"])
        update_fields.append("is_active")
    if payload.get("password"):
        if len(str(payload["password"])) < 8:
            return api_json({"error": "Password must contain at least 8 characters."}, status=400)
        user.set_password(str(payload["password"]))
        update_fields.append("password")
    if update_fields:
        user.save(update_fields=update_fields)
    return api_json({"user": user_payload(user)})


@require_http_methods(["GET", "OPTIONS"])
def intelligence_status(request: HttpRequest) -> JsonResponse:
    session = protected_session(request)
    if not session:
        return api_json({"error": "An active AEIS-K session is required."}, status=403)
    return api_json(
        {
            "assistant": "AEIS-K Intelligence Assistant",
            "provider": intelligence.provider_status(),
            "permissions": session.user.role,
            "supported_scopes": ["national", "county", "subcounty", "ward"],
            "report_sections": [
                "Executive Summary",
                "Key Observations",
                "Risk Areas",
                "Affected Counties/Wards",
                "Climate and Satellite Evidence",
                "Recommended Actions",
                "Confidence Level",
                "Data Sources Used",
            ],
            "generated_at": domain.now_iso(),
        }
    )


@csrf_exempt
@require_http_methods(["POST", "OPTIONS"])
def intelligence_query(request: HttpRequest) -> JsonResponse:
    if request.method == "OPTIONS":
        return api_json({"status": "ok"})
    session = protected_session(request)
    if not session or not any(
        permission in session_payload_permissions(session)
        for permission in ("intelligence_use", "intelligence_use_limited")
    ):
        return api_json({"error": "Your role cannot use the intelligence assistant."}, status=403)
    payload = request_json(request)
    if bool(payload.get("async")):
        try:
            job = jobs.enqueue(session.user, ProcessingJob.JobType.INTELLIGENCE, payload)
        except jobs.JobError as exc:
            return job_error(exc)
        return api_json({"job": jobs.payload(job)}, status=202)
    try:
        result = intelligence.generate_intelligence(session.user, payload)
    except intelligence.IntelligenceError as exc:
        return intelligence_error(exc)
    return api_json(result, status=201)


def session_payload_permissions(session) -> list[str]:
    return auth.ROLE_PERMISSIONS.get(session.user.role, [])


@require_http_methods(["GET", "OPTIONS"])
def intelligence_insights(request: HttpRequest) -> JsonResponse:
    session = protected_session(request)
    if not session:
        return api_json({"error": "An active AEIS-K session is required."}, status=403)
    try:
        limit = int(request.GET.get("limit", "20"))
    except ValueError:
        limit = 20
    return api_json(
        {
            "results": intelligence.recent_insights(session.user, limit),
            "generated_at": domain.now_iso(),
        }
    )


@csrf_exempt
@require_http_methods(["GET", "POST", "OPTIONS"])
def intelligence_reports(request: HttpRequest) -> JsonResponse:
    if request.method == "OPTIONS":
        return api_json({"status": "ok"})
    session = protected_session(request)
    if not session:
        return api_json({"error": "An active AEIS-K session is required."}, status=403)
    if request.method == "GET":
        if not auth.session_has_permission(session, "report_read") and not auth.session_has_permission(
            session, "report_generate"
        ):
            return api_json({"error": "Your role cannot access reports."}, status=403)
        try:
            return api_json(reports.list_reports(session.user, request.GET))
        except reports.ReportError as exc:
            return report_error(exc)

    if not auth.session_has_permission(session, "report_generate"):
        return api_json({"error": "Your role cannot generate reports."}, status=403)
    payload = request_json(request)
    if bool(payload.get("async")):
        try:
            job = jobs.enqueue(session.user, ProcessingJob.JobType.REPORT, payload)
        except jobs.JobError as exc:
            return job_error(exc)
        return api_json({"job": jobs.payload(job)}, status=202)
    try:
        report = reports.create_report(session.user, payload)
    except (reports.ReportError, intelligence.IntelligenceError) as exc:
        if isinstance(exc, intelligence.IntelligenceError):
            return intelligence_error(exc)
        return report_error(exc)
    return api_json({"report": reports.report_payload(report)}, status=201)


@require_http_methods(["GET", "OPTIONS"])
def processing_jobs(request: HttpRequest) -> JsonResponse:
    session = protected_session(request)
    if not session:
        return api_json({"error": "An active AEIS-K session is required."}, status=403)
    try:
        limit = max(1, min(100, int(request.GET.get("limit", "30"))))
    except ValueError:
        return api_json({"error": "limit must be numeric."}, status=400)
    queryset = jobs.scoped_jobs(session.user)
    status = str(request.GET.get("status") or "").strip()
    if status:
        if status not in ProcessingJob.Status.values:
            return api_json({"error": "Invalid processing-job status."}, status=400)
        queryset = queryset.filter(status=status)
    return api_json(
        {
            "results": [jobs.payload(job) for job in queryset[:limit]],
            "generated_at": domain.now_iso(),
        }
    )


@csrf_exempt
@require_http_methods(["GET", "POST", "OPTIONS"])
def processing_job_detail(request: HttpRequest, job_id) -> JsonResponse:
    if request.method == "OPTIONS":
        return api_json({"status": "ok"})
    session = protected_session(request)
    if not session:
        return api_json({"error": "An active AEIS-K session is required."}, status=403)
    job = jobs.scoped_jobs(session.user).filter(pk=job_id).first()
    if not job:
        return api_json({"error": "Processing job not found."}, status=404)
    if request.method == "POST":
        try:
            job = jobs.cancel(session.user, job_id)
        except jobs.JobError as exc:
            return job_error(exc)
    return api_json({"job": jobs.payload(job)})


@require_http_methods(["GET", "OPTIONS"])
def intelligence_report_detail(request: HttpRequest, report_id: int) -> JsonResponse:
    session = protected_session(request)
    if not session:
        return api_json({"error": "An active AEIS-K session is required."}, status=403)
    report = reports.scoped_reports(session.user).filter(pk=report_id).first()
    if not report:
        return api_json({"error": "Report not found."}, status=404)
    return api_json({"report": reports.report_payload(report)})


@csrf_exempt
@require_http_methods(["POST", "OPTIONS"])
def intelligence_report_transition(request: HttpRequest, report_id: int) -> JsonResponse:
    if request.method == "OPTIONS":
        return api_json({"status": "ok"})
    session = protected_session(request)
    if not session:
        return api_json({"error": "An active AEIS-K session is required."}, status=403)
    payload = request_json(request)
    try:
        report = reports.transition_report(
            session.user,
            report_id,
            str(payload.get("status") or "").strip(),
            str(payload.get("note") or ""),
        )
    except reports.ReportError as exc:
        return report_error(exc)
    return api_json({"report": reports.report_payload(report)})


@require_http_methods(["GET", "OPTIONS"])
def intelligence_report_export(request: HttpRequest, report_id: int, export_format: str) -> HttpResponse:
    session = protected_session(request)
    if not session:
        return api_json({"error": "An active AEIS-K session is required."}, status=403)
    report = reports.scoped_reports(session.user).filter(pk=report_id).first()
    if not report:
        return api_json({"error": "Report not found."}, status=404)
    export_format = export_format.lower()
    if export_format == "csv":
        content = reports.report_csv(report)
        content_type = "text/csv; charset=utf-8"
    elif export_format == "xlsx":
        content = reports.report_xlsx(report)
        content_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    elif export_format == "pdf":
        content = reports.report_pdf(report)
        content_type = "application/pdf"
    elif export_format == "geojson":
        feature = domain.find_county(report.scope_name) if report.scope_level == "county" else None
        content = json.dumps(
            {
                "type": "FeatureCollection",
                "features": [feature] if feature else [],
                "properties": {"report_id": report.pk, "title": report.title},
            },
            ensure_ascii=False,
        ).encode("utf-8")
        content_type = "application/geo+json"
    else:
        return api_json({"error": "Supported exports: pdf, csv, xlsx, geojson."}, status=400)
    response = HttpResponse(content, content_type=content_type)
    response["Content-Disposition"] = f'attachment; filename="aeis-report-{report.pk}.{export_format}"'
    response["Cache-Control"] = "private, no-store"
    return with_cors(response)


@csrf_exempt
@require_http_methods(["GET", "POST", "OPTIONS"])
def operational_alerts(request: HttpRequest) -> JsonResponse:
    if request.method == "OPTIONS":
        return api_json({"status": "ok"})
    session = protected_session(request)
    if not session:
        return api_json({"error": "An active AEIS-K session is required."}, status=403)
    queryset = Alert.objects.all()
    if session.user.role in {
        AEISUser.Role.COUNTY,
        AEISUser.Role.FIELD_OFFICER,
        AEISUser.Role.FARMER,
    }:
        queryset = queryset.filter(scope_name__iexact=session.user.county_name)
    if request.method == "POST":
        if not auth.session_has_permission(session, "alert_manage"):
            return api_json({"error": "Your role cannot create operational alerts."}, status=403)
        payload = request_json(request)
        alert = Alert.objects.create(
            title=str(payload.get("title") or "Operational alert")[:200],
            description=str(payload.get("description") or ""),
            alert_type=str(payload.get("alert_type") or "operational")[:80],
            severity=str(payload.get("severity") or Alert.Severity.MEDIUM),
            scope_level=str(payload.get("scope_level") or "national")[:20],
            scope_name=str(payload.get("scope_name") or "")[:160],
            scope_code=str(payload.get("scope_code") or "")[:40],
            evidence=payload.get("evidence") if isinstance(payload.get("evidence"), dict) else {},
            data_sources=payload.get("data_sources") if isinstance(payload.get("data_sources"), list) else [],
            confidence=str(payload.get("confidence") or "low")[:16],
            created_by=session.user,
        )
        return api_json({"id": alert.pk, "status": "created"}, status=201)
    return api_json(
        {
            "results": [
                {
                    "id": alert.pk,
                    "title": alert.title,
                    "description": alert.description,
                    "alert_type": alert.alert_type,
                    "severity": alert.severity,
                    "status": alert.status,
                    "scope_level": alert.scope_level,
                    "scope_name": alert.scope_name,
                    "confidence": alert.confidence,
                    "data_sources": alert.data_sources,
                    "created_at": alert.created_at.isoformat(),
                }
                for alert in queryset[:100]
            ]
        }
    )


@csrf_exempt
@require_http_methods(["GET", "POST", "OPTIONS"])
def field_reports(request: HttpRequest) -> JsonResponse:
    if request.method == "OPTIONS":
        return api_json({"status": "ok"})
    session = protected_session(request)
    if not session:
        return api_json({"error": "An active AEIS-K session is required."}, status=403)
    queryset = FieldReport.objects.select_related("submitted_by", "verified_by")
    if session.user.role in {
        AEISUser.Role.COUNTY,
        AEISUser.Role.FIELD_OFFICER,
        AEISUser.Role.FARMER,
    }:
        queryset = queryset.filter(county_name__iexact=session.user.county_name)
    if request.method == "POST":
        permissions = session_payload_permissions(session)
        if "field_report_create" not in permissions and "field_report_verify" not in permissions:
            return api_json({"error": "Your role cannot submit field reports."}, status=403)
        payload = request_json(request)
        county_name = str(payload.get("county_name") or session.user.county_name).strip()
        if session.user.county_name and county_name.lower() != session.user.county_name.lower():
            return api_json({"error": "Field report county is outside your assigned scope."}, status=403)
        try:
            observation_date = (
                date.fromisoformat(str(payload["observation_date"]))
                if payload.get("observation_date")
                else timezone.localdate()
            )
            report = FieldReport.objects.create(
                title=str(payload.get("title") or "Field observation")[:200],
                report_type=str(payload.get("report_type") or "field_observation")[:80],
                county_name=county_name,
                county_code=str(payload.get("county_code") or session.user.county_code)[:8],
                subcounty_name=str(payload.get("subcounty_name") or "")[:120],
                ward_name=str(payload.get("ward_name") or "")[:120],
                farm_reference=str(payload.get("farm_reference") or "")[:160],
                crop_type=str(payload.get("crop_type") or "")[:100],
                observation_date=observation_date,
                latitude=float(payload["latitude"]) if payload.get("latitude") not in {None, ""} else None,
                longitude=float(payload["longitude"]) if payload.get("longitude") not in {None, ""} else None,
                observations=str(payload.get("observations") or ""),
                verification_status=FieldReport.VerificationStatus.SUBMITTED,
                submitted_by=session.user,
            )
        except (TypeError, ValueError):
            return api_json({"error": "Invalid field-report date or coordinates."}, status=400)
        return api_json({"id": report.pk, "status": report.verification_status}, status=201)
    return api_json(
        {
            "results": [
                {
                    "id": row.pk,
                    "title": row.title,
                    "county_name": row.county_name,
                    "subcounty_name": row.subcounty_name,
                    "ward_name": row.ward_name,
                    "crop_type": row.crop_type,
                    "observation_date": row.observation_date.isoformat(),
                    "observations": row.observations,
                    "verification_status": row.verification_status,
                    "submitted_by": row.submitted_by.username,
                }
                for row in queryset[:100]
            ]
        }
    )


@csrf_exempt
@require_http_methods(["POST", "OPTIONS"])
def field_report_verify(request: HttpRequest, report_id: int) -> JsonResponse:
    if request.method == "OPTIONS":
        return api_json({"status": "ok"})
    session = protected_session(request, "field_report_verify")
    if not session:
        return api_json({"error": "Your role cannot verify field reports."}, status=403)
    report = FieldReport.objects.filter(pk=report_id).first()
    if not report:
        return api_json({"error": "Field report not found."}, status=404)
    if (
        session.user.role == AEISUser.Role.COUNTY
        and report.county_name.lower() != session.user.county_name.lower()
    ):
        return api_json({"error": "Field report is outside your assigned county."}, status=403)
    payload = request_json(request)
    target = str(payload.get("status") or FieldReport.VerificationStatus.VERIFIED).strip()
    if target not in {
        FieldReport.VerificationStatus.VERIFIED,
        FieldReport.VerificationStatus.REJECTED,
    }:
        return api_json({"error": "Verification status must be verified or rejected."}, status=400)
    report.verification_status = target
    report.verified_by = session.user
    report.save(update_fields=["verification_status", "verified_by", "updated_at"])
    return api_json(
        {
            "id": report.pk,
            "verification_status": report.verification_status,
            "verified_by": session.user.username,
        }
    )


@require_http_methods(["GET", "OPTIONS"])
def data_quality(request: HttpRequest) -> JsonResponse:
    session = protected_session(request)
    if not session or not auth.session_has_permission(session, "data_quality_read"):
        return api_json({"error": "Your role cannot view data-quality records."}, status=403)
    assets = DataAsset.objects.select_related("quality", "uploaded_by")
    results = []
    for asset in assets[:100]:
        quality = getattr(asset, "quality", None)
        results.append(
            {
                "id": str(asset.pk),
                "name": asset.name,
                "source_name": getattr(quality, "source_name", "AEIS-K upload"),
                "file_format": asset.file_format,
                "spatial_coverage": getattr(quality, "spatial_coverage", asset.scope_name),
                "temporal_coverage": getattr(quality, "temporal_coverage", ""),
                "coordinate_reference_system": getattr(
                    quality, "coordinate_reference_system", ""
                ),
                "confidence": getattr(quality, "confidence", "unknown"),
                "processing_status": getattr(quality, "processing_status", asset.status),
                "missing_data_warning": getattr(quality, "missing_data_warning", ""),
                "projection_warning": getattr(quality, "projection_warning", ""),
                "duplicate_warning": getattr(quality, "duplicate_warning", ""),
                "validation_errors": getattr(quality, "validation_errors", []),
                "updated_at": asset.updated_at.isoformat(),
            }
        )
    return api_json({"results": results, "generated_at": domain.now_iso()})


@require_http_methods(["GET", "OPTIONS"])
def boundary_counties(request: HttpRequest) -> JsonResponse:
    response = api_json({"counties": domain.county_list()})
    response["Cache-Control"] = "public, max-age=3600, stale-while-revalidate=86400"
    return response


@require_http_methods(["GET", "OPTIONS"])
def boundary_county(request: HttpRequest, identifier: str) -> JsonResponse:
    feature = domain.find_county(identifier)
    if not feature:
        return api_json({"error": "County not found"}, status=404)
    response = api_json(feature)
    response["Cache-Control"] = "public, max-age=3600, stale-while-revalidate=86400"
    return response


@require_http_methods(["GET", "OPTIONS"])
def analysis_live_status(request: HttpRequest) -> JsonResponse:
    return api_json(
        {
            "status": "ready_for_provider",
            "active_provider": None,
            "message": "Django API is running. Connect Sentinel Hub, Google Earth Engine, NASA POWER, or field sensors next.",
        }
    )


@require_http_methods(["GET", "OPTIONS"])
def automation_status(request: HttpRequest) -> JsonResponse:
    return api_json(domain.automation_status())


@require_http_methods(["GET", "OPTIONS"])
def analysis_country(request: HttpRequest) -> JsonResponse:
    return api_json(domain.country_analysis())


@require_http_methods(["GET", "OPTIONS"])
def osm_metric(request: HttpRequest, topic: str) -> JsonResponse:
    # Live per-county topic values from OpenStreetMap (roads/forests/water).
    # No county -> national aggregate over all counties; ?county=<name> -> one.
    status, result = osm_metrics.metric_payload(topic, request.GET.get("county") or None)
    return api_json(result, status=status)


@require_http_methods(["GET", "OPTIONS"])
def segmentation(request: HttpRequest, segment_class: str) -> JsonResponse:
    try:
        limit = max(1, min(1500, int(request.GET.get("limit", "700"))))
    except ValueError:
        limit = 700
    identifier = request.GET.get("id", "")
    if not identifier:
        return api_json({"error": "Missing segmentation scope id"}, status=400)
    return api_json(domain.real_segmentation(segment_class, request.GET.get("level", "county"), identifier, limit))


@require_http_methods(["GET", "OPTIONS"])
def analysis_county(request: HttpRequest, identifier: str) -> JsonResponse:
    feature = domain.find_county(identifier)
    if not feature:
        return api_json({"error": "County not found"}, status=404)
    return api_json(domain.county_analysis(feature))


@require_http_methods(["GET", "OPTIONS"])
def analysis_subcounty(request: HttpRequest, identifier: str) -> JsonResponse:
    feature = domain.find_subcounty(identifier)
    if not feature:
        return api_json({"error": "Sub-county not found"}, status=404)
    return api_json(domain.subcounty_analysis(feature))


@require_http_methods(["GET", "OPTIONS"])
def analysis_ward(request: HttpRequest, identifier: str) -> JsonResponse:
    feature = domain.find_ward(identifier)
    if not feature:
        return api_json({"error": "Ward not found"}, status=404)
    return api_json(domain.ward_analysis(feature))


@csrf_exempt
@require_http_methods(["POST", "OPTIONS"])
def analysis_area(request: HttpRequest) -> JsonResponse:
    if request.method == "OPTIONS":
        return api_json({"status": "ok"})
    payload = request_json(request)
    geometry = payload.get("geometry")
    if not geometry:
        return api_json({"error": "Missing geometry in payload"}, status=400)
    return api_json(domain.calculate_area_metrics(geometry))


@csrf_exempt
@require_http_methods(["POST", "OPTIONS"])
def indices_evaluate(request: HttpRequest) -> JsonResponse:
    if request.method == "OPTIONS":
        return api_json({"status": "ok"})
    status, result = domain.evaluate_indices_payload(request_json(request))
    return api_json(result, status=status)
