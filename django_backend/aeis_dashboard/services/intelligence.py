from __future__ import annotations

import json
import os
import uuid
from datetime import date, timedelta
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from django.core.cache import cache
from django.db.models import Count

from aeis_dashboard.models import (
    AEISUser,
    Alert,
    DataAsset,
    FieldReport,
    IntelligenceInsight,
    IntelligenceMessage,
)

from . import data_sources, domain


INTELLIGENCE_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "executive_summary": {"type": "string"},
        "key_observations": {"type": "array", "items": {"type": "string"}},
        "risk_areas": {"type": "array", "items": {"type": "string"}},
        "affected_areas": {"type": "array", "items": {"type": "string"}},
        "evidence": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "source": {"type": "string"},
                    "observation": {"type": "string"},
                },
                "required": ["source", "observation"],
            },
        },
        "recommended_actions": {"type": "array", "items": {"type": "string"}},
        "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
        "explainability": {"type": "string"},
        "missing_data": {"type": "array", "items": {"type": "string"}},
    },
    "required": [
        "executive_summary",
        "key_observations",
        "risk_areas",
        "affected_areas",
        "evidence",
        "recommended_actions",
        "confidence",
        "explainability",
        "missing_data",
    ],
}


class IntelligenceError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def _scope_for_user(user: AEISUser, payload: dict) -> dict:
    requested_level = str(payload.get("scope_level") or "").strip().lower()
    requested_name = str(payload.get("scope_name") or payload.get("county") or "").strip()

    county_scoped_roles = {
        AEISUser.Role.COUNTY,
        AEISUser.Role.FIELD_OFFICER,
        AEISUser.Role.FARMER,
    }
    if user.role in county_scoped_roles:
        if requested_name and requested_name.lower() != user.county_name.lower():
            raise IntelligenceError("This account is restricted to its assigned county.", 403)
        return {
            "level": "county",
            "name": user.county_name,
            "code": user.county_code,
        }

    if not requested_name or requested_level == "national":
        return {"level": "national", "name": "Kenya", "code": "000"}

    if requested_level in {"ward", "subcounty"}:
        finder = domain.find_ward if requested_level == "ward" else domain.find_subcounty
        feature = finder(requested_name)
        if not feature:
            raise IntelligenceError(f"{requested_level.replace('county', '-county').title()} not found.", 404)
        properties = feature.get("properties") or {}
        return {
            "level": requested_level,
            "name": requested_name,
            "code": properties.get("shapeID") or properties.get("ADM2_PCODE") or "",
            "county": properties.get("ADM1_EN") or "",
        }

    feature = domain.find_county(requested_name)
    if not feature:
        raise IntelligenceError("County not found.", 404)
    return {
        "level": "county",
        "name": domain.county_name(feature),
        "code": domain.county_code(feature),
    }


def _three_day_rain(forecast: dict) -> float:
    return round(
        sum(float(day.get("precipitation_sum") or 0) for day in forecast.get("daily", [])[:3]),
        1,
    )


def _data_context(scope: dict) -> tuple[dict, list[dict], list[str]]:
    sources: list[dict] = []
    missing: list[str] = []
    context: dict = {
        "scope": scope,
        "generated_at": domain.now_iso(),
        "dashboard": domain.dashboard_summary_payload()["summary"],
    }

    weather_identifier = (
        scope["name"]
        if scope["level"] == "county"
        else scope.get("county")
        if scope["level"] in {"subcounty", "ward"}
        else None
    )
    weather_status, weather = domain.weather_forecast_payload(weather_identifier)
    if weather_status == 200:
        context["weather"] = weather
        sources.append(
            {
                "name": "Open-Meteo forecast API",
                "category": "weather",
                "freshness": weather.get("generated_at"),
                "status": weather.get("provider_status", "live"),
            }
        )
    else:
        missing.append("Live weather forecast")

    landsat_county = scope["name"] if scope["level"] == "county" else scope.get("county")
    if landsat_county:
        try:
            landsat = data_sources.landsat_latest(
                {"county": landsat_county, "max_cloud": "35", "lookback_days": "365"}
            )
            context["landsat"] = landsat
            if landsat.get("scene"):
                sources.append(
                    {
                        "name": "USGS Landsat Collection 2",
                        "category": "satellite",
                        "freshness": landsat["scene"].get("date"),
                        "status": landsat.get("status"),
                    }
                )
        except data_sources.DataSourceError as exc:
            context["landsat_error"] = str(exc)
            missing.append("Current Landsat catalogue result")
    else:
        missing.append("National seamless Landsat analytical composite")

    assets = DataAsset.objects.all()
    if scope["level"] != "national":
        assets = assets.filter(scope_name__iexact=scope["name"])
    context["gis_assets"] = {
        "count": assets.count(),
        "formats": list(
            assets.values("file_format").annotate(count=Count("id")).order_by("file_format")
        ),
        "latest": assets.values("name", "file_format", "created_at").first(),
    }
    if assets.exists():
        sources.append(
            {
                "name": "AEIS-K GIS asset catalogue",
                "category": "uploaded_gis",
                "freshness": assets.first().created_at.isoformat(),
                "status": "available",
            }
        )
    else:
        missing.append(f"Uploaded GIS assets for {scope['name']}")

    alerts = Alert.objects.exclude(status=Alert.Status.RESOLVED)
    field_reports = FieldReport.objects.all()
    if scope["level"] == "county":
        alerts = alerts.filter(scope_name__iexact=scope["name"])
        field_reports = field_reports.filter(county_name__iexact=scope["name"])
    elif scope["level"] == "subcounty":
        alerts = alerts.filter(scope_name__iexact=scope["name"])
        field_reports = field_reports.filter(subcounty_name__iexact=scope["name"])
    elif scope["level"] == "ward":
        alerts = alerts.filter(scope_name__iexact=scope["name"])
        field_reports = field_reports.filter(ward_name__iexact=scope["name"])
    context["alerts"] = list(
        alerts.values("title", "alert_type", "severity", "scope_name", "confidence")[:20]
    )
    context["field_reports"] = {
        "count": field_reports.count(),
        "verified": field_reports.filter(
            verification_status=FieldReport.VerificationStatus.VERIFIED
        ).count(),
        "latest": list(
            field_reports.values(
                "title",
                "county_name",
                "ward_name",
                "crop_type",
                "verification_status",
                "observation_date",
            )[:10]
        ),
    }
    if field_reports.exists():
        sources.append(
            {
                "name": "AEIS-K field reports",
                "category": "field_observations",
                "freshness": field_reports.first().updated_at.isoformat(),
                "status": "available",
            }
        )
    else:
        missing.append(f"Verified field observations for {scope['name']}")

    gee = domain.gee_layers_payload()
    context["raster_indices"] = gee
    if gee.get("configured_layers"):
        sources.append(
            {
                "name": "Configured Earth observation raster layers",
                "category": "indices",
                "freshness": domain.now_iso(),
                "status": "configured",
            }
        )
    else:
        missing.extend(
            [
                "Provider-backed NDVI values",
                "Provider-backed NDWI values",
                "Provider-backed NDBI or land-cover classification",
            ]
        )

    return context, sources, list(dict.fromkeys(missing))


def _local_analysis(question: str, scope: dict, context: dict, missing: list[str]) -> dict:
    observations: list[str] = []
    risks: list[str] = []
    affected: list[str] = []
    actions: list[str] = []
    evidence: list[dict] = []
    question_lower = question.lower()
    weather = context.get("weather") or {}

    if weather.get("mode") == "county_live_forecast":
        forecast = weather.get("forecast") or {}
        rain = _three_day_rain(forecast)
        risk = forecast.get("risk") or "Unavailable"
        forecast_scope = forecast.get("county") or scope["name"]
        observations.append(
            f"{scope['name']} uses the {forecast_scope} forecast reference: {rain:.1f} mm rainfall over the next three days with {risk} operational weather risk."
        )
        evidence.append(
            {
                "source": "Open-Meteo forecast API",
                "observation": f"Three-day forecast rainfall {rain:.1f} mm; risk {risk}.",
            }
        )
        if rain < 3:
            risks.append("Short-term rainfall is low; moisture stress should be verified in the field.")
            affected.append(scope["name"])
            actions.append("Prioritize moisture checks and irrigation planning in exposed production zones.")
        elif rain > 45:
            risks.append("Heavy short-term rainfall may disrupt field operations and increase localized flood risk.")
            affected.append(scope["name"])
            actions.append("Review drainage, river-adjacent farms, and field-access conditions.")
        else:
            actions.append("Continue routine monitoring and verify forecast timing before spraying or fertilizer application.")
    elif weather.get("mode") == "national_live_forecast":
        rows = weather.get("counties") or []
        driest = sorted(rows, key=_three_day_rain)[:5]
        wettest = sorted(rows, key=_three_day_rain, reverse=True)[:5]
        if driest:
            dry_names = ", ".join(f"{row.get('county')} ({_three_day_rain(row):.1f} mm)" for row in driest)
            observations.append(f"Lowest three-day forecast rainfall: {dry_names}.")
            evidence.append({"source": "Open-Meteo forecast API", "observation": f"Lowest forecast totals: {dry_names}."})
        if wettest:
            wet_names = ", ".join(f"{row.get('county')} ({_three_day_rain(row):.1f} mm)" for row in wettest)
            observations.append(f"Highest three-day forecast rainfall: {wet_names}.")
            evidence.append({"source": "Open-Meteo forecast API", "observation": f"Highest forecast totals: {wet_names}."})
        if "drought" in question_lower or "dry" in question_lower:
            affected = [row.get("county") for row in driest if row.get("county")]
            risks.append(
                "These are forecast-based dry-watch candidates, not confirmed drought-stress counties because rainfall history and NDVI anomalies are unavailable."
            )
            actions.append("Validate dry-watch counties with historical rainfall anomalies, NDVI change, soil moisture, and field reports.")
        if "flood" in question_lower or "rain" in question_lower:
            affected = [row.get("county") for row in wettest if row.get("county")]
            risks.append("Higher forecast rainfall warrants localized flood and field-access checks.")
            actions.append("Coordinate county verification for drainage, riverine exposure, and crop-stage sensitivity.")

    landsat = context.get("landsat") or {}
    if landsat.get("scene"):
        scene = landsat["scene"]
        observations.append(
            f"Latest catalogue scene is {scene.get('platform')} acquired {scene.get('date')} with {scene.get('cloud_cover')}% cloud."
        )
        evidence.append(
            {
                "source": "USGS Landsat Collection 2",
                "observation": f"{scene.get('platform')} scene {scene.get('date')}, cloud cover {scene.get('cloud_cover')}%.",
            }
        )

    field_summary = context.get("field_reports") or {}
    observations.append(
        f"AEIS-K contains {field_summary.get('count', 0)} field report(s), of which {field_summary.get('verified', 0)} are verified."
    )
    if field_summary.get("count", 0) == 0:
        actions.append("Assign field verification where satellite or forecast evidence is insufficient.")

    active_alerts = context.get("alerts") or []
    if active_alerts:
        risks.extend(
            f"{item.get('severity', 'unknown').title()} alert: {item.get('title')}"
            for item in active_alerts[:5]
        )
        affected.extend(item.get("scope_name") for item in active_alerts if item.get("scope_name"))

    if not observations:
        observations.append("Administrative boundaries and system metadata are available, but no decision-grade environmental metric was found for this question.")
    if not risks:
        risks.append("No decision-grade anomaly can be confirmed from the currently connected data.")
    if not actions:
        actions.append("Connect the missing datasets listed below before making operational decisions.")

    confidence = "medium" if len(evidence) >= 2 and len(missing) <= 3 else "low"
    if context.get("raster_indices", {}).get("configured_layers") and field_summary.get("verified", 0):
        confidence = "high"

    summary = (
        f"AEIS-K reviewed the available evidence for {scope['name']}. "
        f"{observations[0]} "
        "The result is intentionally limited to connected, source-dated data."
    )
    return {
        "executive_summary": summary,
        "key_observations": observations[:8],
        "risk_areas": list(dict.fromkeys(risks))[:8],
        "affected_areas": list(dict.fromkeys(filter(None, affected)))[:12],
        "evidence": evidence[:12],
        "recommended_actions": list(dict.fromkeys(actions))[:8],
        "confidence": confidence,
        "explainability": (
            "The local provider applies explicit rainfall thresholds, source availability checks, "
            "active-alert review, and field-verification coverage. It does not infer NDVI, drought, "
            "crop failure, or land cover when those measurements are missing."
        ),
        "missing_data": missing,
    }


def _output_text(response_payload: dict) -> str:
    texts = []
    for item in response_payload.get("output") or []:
        if item.get("type") != "message":
            continue
        for content in item.get("content") or []:
            if content.get("type") == "output_text" and content.get("text"):
                texts.append(content["text"])
    return "\n".join(texts)


def _openai_analysis(question: str, scope: dict, context: dict, missing: list[str]) -> tuple[dict, str]:
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise IntelligenceError("OpenAI provider is not configured.", 503)
    model = os.environ.get("AEIS_OPENAI_MODEL", "gpt-5.4-mini").strip()
    request_payload = {
        "model": model,
        "store": False,
        "reasoning": {"effort": "low"},
        "max_output_tokens": 1800,
        "instructions": (
            "You are the AEIS-K Intelligence Assistant for Kenya. Use only the supplied JSON evidence. "
            "Never invent measurements, trends, locations, or causes. Clearly separate forecast-based "
            "watch conditions from confirmed drought, crop stress, flood damage, or crop failure. "
            "List missing data and use plain professional language suitable for Ministry decisions."
        ),
        "input": (
            f"User question: {question}\n"
            f"Scope: {json.dumps(scope, ensure_ascii=False)}\n"
            f"Known missing data: {json.dumps(missing, ensure_ascii=False)}\n"
            f"Evidence context: {json.dumps(context, ensure_ascii=False, default=str)}"
        ),
        "text": {
            "format": {
                "type": "json_schema",
                "name": "aeis_intelligence",
                "strict": True,
                "schema": INTELLIGENCE_SCHEMA,
            }
        },
    }
    request = Request(
        "https://api.openai.com/v1/responses",
        data=json.dumps(request_payload).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "User-Agent": "AEIS-K/1.0 intelligence",
        },
    )
    try:
        with urlopen(request, timeout=60) as response:
            response_payload = json.loads(response.read().decode("utf-8"))
        parsed = json.loads(_output_text(response_payload))
        return parsed, model
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise IntelligenceError(f"OpenAI provider rejected the request: {detail[:300]}", 502) from exc
    except (URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError) as exc:
        raise IntelligenceError(f"OpenAI provider is unavailable: {exc}", 503) from exc


def provider_status() -> dict:
    configured = bool(os.environ.get("OPENAI_API_KEY", "").strip())
    return {
        "active": "openai_responses" if configured else "local_rule_based",
        "openai_configured": configured,
        "openai_model": os.environ.get("AEIS_OPENAI_MODEL", "gpt-5.4-mini"),
        "fallback": "local_rule_based",
        "safety_rule": "Answers use connected evidence only and must list missing data.",
    }


def generate_intelligence(user: AEISUser, payload: dict) -> dict:
    question = str(payload.get("question") or "").strip()
    if not question:
        question = "Generate a concise intelligence brief for the selected scope."
    if len(question) > 2000:
        raise IntelligenceError("Question is too long.")

    rate_key = f"intelligence-rate:{user.pk}"
    current = int(cache.get(rate_key) or 0)
    if current >= 20:
        raise IntelligenceError("Intelligence request limit reached. Try again in one minute.", 429)
    cache.set(rate_key, current + 1, 60)

    scope = _scope_for_user(user, payload)
    context, sources, missing = _data_context(scope)
    preferred = str(payload.get("provider") or "auto").lower()
    provider = "local_rule_based"
    model = ""
    provider_warning = ""

    if preferred in {"auto", "openai"} and provider_status()["openai_configured"]:
        try:
            analysis, model = _openai_analysis(question, scope, context, missing)
            provider = "openai_responses"
        except IntelligenceError as exc:
            if preferred == "openai":
                raise
            analysis = _local_analysis(question, scope, context, missing)
            provider_warning = str(exc)
    else:
        analysis = _local_analysis(question, scope, context, missing)

    insight = IntelligenceInsight.objects.create(
        insight_type=str(payload.get("insight_type") or "brief")[:80],
        scope_level=scope["level"],
        scope_name=scope["name"],
        scope_code=scope.get("code", ""),
        question=question,
        executive_summary=analysis["executive_summary"],
        key_observations=analysis["key_observations"],
        risk_areas=analysis["risk_areas"],
        affected_areas=analysis["affected_areas"],
        evidence=analysis["evidence"],
        recommended_actions=analysis["recommended_actions"],
        confidence=analysis["confidence"],
        explainability=analysis["explainability"],
        data_sources=sources,
        missing_data=analysis["missing_data"],
        provider=provider,
        model=model,
        created_by=user,
    )

    conversation_id = payload.get("conversation_id")
    try:
        conversation_uuid = uuid.UUID(str(conversation_id)) if conversation_id else uuid.uuid4()
    except ValueError:
        conversation_uuid = uuid.uuid4()
    IntelligenceMessage.objects.bulk_create(
        [
            IntelligenceMessage(
                conversation_id=conversation_uuid,
                user=user,
                role="user",
                content=question,
                metadata={"scope": scope},
            ),
            IntelligenceMessage(
                conversation_id=conversation_uuid,
                user=user,
                role="assistant",
                content=analysis["executive_summary"],
                metadata={"insight_id": insight.pk, "provider": provider},
            ),
        ]
    )
    return {
        "id": insight.pk,
        "conversation_id": str(conversation_uuid),
        "provider": provider,
        "model": model,
        "provider_warning": provider_warning,
        "scope": scope,
        **analysis,
        "data_sources": sources,
        "generated_at": insight.created_at.isoformat(),
    }


def recent_insights(user: AEISUser, limit: int = 20) -> list[dict]:
    queryset = IntelligenceInsight.objects.all()
    if user.role in {AEISUser.Role.COUNTY, AEISUser.Role.FIELD_OFFICER, AEISUser.Role.FARMER}:
        queryset = queryset.filter(scope_name__iexact=user.county_name)
    return [
        {
            "id": insight.pk,
            "scope_level": insight.scope_level,
            "scope_name": insight.scope_name,
            "question": insight.question,
            "executive_summary": insight.executive_summary,
            "confidence": insight.confidence,
            "provider": insight.provider,
            "data_sources": insight.data_sources,
            "missing_data": insight.missing_data,
            "created_at": insight.created_at.isoformat(),
        }
        for insight in queryset.select_related("created_by")[: max(1, min(limit, 100))]
    ]
