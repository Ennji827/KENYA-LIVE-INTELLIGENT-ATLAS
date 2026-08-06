from __future__ import annotations

import csv
import io
import json
from datetime import date

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from openpyxl import Workbook
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

from aeis_dashboard.models import AEISUser, IntelligenceReport, ReportAudit

from . import intelligence


class ReportError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def report_payload(report: IntelligenceReport, include_content: bool = True) -> dict:
    payload = {
        "id": report.pk,
        "title": report.title,
        "report_type": report.report_type,
        "status": report.status,
        "scope_level": report.scope_level,
        "scope_name": report.scope_name,
        "scope_code": report.scope_code,
        "date_start": report.date_start.isoformat() if report.date_start else None,
        "date_end": report.date_end.isoformat() if report.date_end else None,
        "crop_type": report.crop_type,
        "risk_level": report.risk_level,
        "filters": report.filters,
        "ai_summary": report.ai_summary,
        "data_sources": report.data_sources,
        "confidence": report.confidence,
        "generated_by": report.generated_by.get_full_name() or report.generated_by.username,
        "reviewed_by": report.reviewed_by.username if report.reviewed_by else "",
        "approved_by": report.approved_by.username if report.approved_by else "",
        "published_by": report.published_by.username if report.published_by else "",
        "created_at": report.created_at.isoformat(),
        "updated_at": report.updated_at.isoformat(),
    }
    if include_content:
        payload["content"] = report.content
        payload["audit_events"] = [
            {
                "action": event.action,
                "from_status": event.from_status,
                "to_status": event.to_status,
                "actor": event.actor.username if event.actor else "",
                "note": event.note,
                "created_at": event.created_at.isoformat(),
            }
            for event in report.audit_events.select_related("actor").all()
        ]
    return payload


def scoped_reports(user: AEISUser):
    queryset = IntelligenceReport.objects.select_related(
        "generated_by", "reviewed_by", "approved_by", "published_by"
    )
    if user.role in {AEISUser.Role.COUNTY, AEISUser.Role.FIELD_OFFICER, AEISUser.Role.FARMER}:
        queryset = queryset.filter(scope_name__iexact=user.county_name)
    return queryset


def list_reports(user: AEISUser, query) -> dict:
    queryset = scoped_reports(user)
    status = str(query.get("status") or "").strip()
    scope_level = str(query.get("scope_level") or "").strip()
    county = str(query.get("county") or "").strip()
    crop_type = str(query.get("crop_type") or "").strip()
    risk_level = str(query.get("risk_level") or "").strip()
    data_source = str(query.get("data_source") or "").strip().lower()
    date_from = _parse_date(query.get("date_from"))
    date_to = _parse_date(query.get("date_to"))
    search = str(query.get("search") or "").strip()
    if status:
        queryset = queryset.filter(status=status)
    if scope_level:
        queryset = queryset.filter(scope_level=scope_level)
    if county:
        queryset = queryset.filter(scope_name__iexact=county)
    if crop_type:
        queryset = queryset.filter(crop_type__icontains=crop_type)
    if risk_level:
        queryset = queryset.filter(risk_level__iexact=risk_level)
    if date_from:
        queryset = queryset.filter(created_at__date__gte=date_from)
    if date_to:
        queryset = queryset.filter(created_at__date__lte=date_to)
    if search:
        queryset = queryset.filter(
            Q(title__icontains=search)
            | Q(report_type__icontains=search)
            | Q(scope_name__icontains=search)
        )
    try:
        page = max(1, int(query.get("page", "1")))
        page_size = max(1, min(100, int(query.get("page_size", "20"))))
    except ValueError:
        raise ReportError("page and page_size must be numeric.")
    start = (page - 1) * page_size
    if data_source:
        filtered = [
            report
            for report in queryset
            if data_source in json.dumps(report.data_sources, ensure_ascii=False).lower()
        ]
        total = len(filtered)
        rows = filtered[start : start + page_size]
    else:
        total = queryset.count()
        rows = queryset[start : start + page_size]
    return {
        "results": [report_payload(row, include_content=False) for row in rows],
        "pagination": {
            "page": page,
            "page_size": page_size,
            "total": total,
            "pages": max(1, (total + page_size - 1) // page_size),
        },
    }


@transaction.atomic
def create_report(user: AEISUser, payload: dict) -> IntelligenceReport:
    intelligence_result = intelligence.generate_intelligence(
        user,
        {
            "question": payload.get("question")
            or "Generate a professional report using the available climate, water, land-use, GIS, road, soil, and field evidence.",
            "scope_level": payload.get("scope_level") or "national",
            "scope_name": payload.get("scope_name") or payload.get("county") or "",
            "insight_type": "report",
            "provider": payload.get("provider") or "auto",
        },
    )
    scope = intelligence_result["scope"]
    content = {
        "executive_summary": intelligence_result["executive_summary"],
        "key_observations": intelligence_result["key_observations"],
        "risk_areas": intelligence_result["risk_areas"],
        "affected_areas": intelligence_result["affected_areas"],
        "climate_and_satellite_evidence": intelligence_result["evidence"],
        "recommended_actions": intelligence_result["recommended_actions"],
        "confidence_level": intelligence_result["confidence"],
        "data_sources_used": intelligence_result["data_sources"],
        "missing_data": intelligence_result["missing_data"],
        "explainability": intelligence_result["explainability"],
    }
    report = IntelligenceReport.objects.create(
        title=str(payload.get("title") or f"{scope['name']} Intelligence Brief")[:220],
        report_type=str(payload.get("report_type") or "intelligence_brief")[:80],
        scope_level=scope["level"],
        scope_name=scope["name"],
        scope_code=scope.get("code", ""),
        date_start=_parse_date(payload.get("date_start")),
        date_end=_parse_date(payload.get("date_end")),
        crop_type=str(payload.get("crop_type") or "")[:100],
        risk_level=str(payload.get("risk_level") or "")[:32],
        filters=payload.get("filters") if isinstance(payload.get("filters"), dict) else {},
        content=content,
        ai_summary=intelligence_result["executive_summary"],
        data_sources=intelligence_result["data_sources"],
        confidence=intelligence_result["confidence"],
        generated_by=user,
    )
    ReportAudit.objects.create(report=report, action="generated", to_status=report.status, actor=user)
    return report


def _parse_date(value) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value))
    except ValueError as exc:
        raise ReportError("Report dates must use YYYY-MM-DD.") from exc


TRANSITIONS = {
    IntelligenceReport.Status.DRAFT: {IntelligenceReport.Status.REVIEWED},
    IntelligenceReport.Status.REVIEWED: {
        IntelligenceReport.Status.DRAFT,
        IntelligenceReport.Status.APPROVED,
    },
    IntelligenceReport.Status.APPROVED: {
        IntelligenceReport.Status.REVIEWED,
        IntelligenceReport.Status.PUBLISHED,
    },
    IntelligenceReport.Status.PUBLISHED: set(),
}


@transaction.atomic
def transition_report(user: AEISUser, report_id: int, target: str, note: str = "") -> IntelligenceReport:
    report = scoped_reports(user).filter(pk=report_id).first()
    if not report:
        raise ReportError("Report not found.", 404)
    if target not in TRANSITIONS.get(report.status, set()):
        raise ReportError(f"Cannot move report from {report.status} to {target}.", 409)

    required_roles = {
        IntelligenceReport.Status.REVIEWED: {AEISUser.Role.MINISTRY, AEISUser.Role.ANALYST, AEISUser.Role.COUNTY},
        IntelligenceReport.Status.APPROVED: {AEISUser.Role.MINISTRY},
        IntelligenceReport.Status.PUBLISHED: {AEISUser.Role.MINISTRY},
        IntelligenceReport.Status.DRAFT: {AEISUser.Role.MINISTRY, AEISUser.Role.ANALYST},
    }
    if user.role not in required_roles.get(target, set()):
        raise ReportError("Your role cannot perform this report transition.", 403)

    old = report.status
    now = timezone.now()
    report.status = target
    if target == IntelligenceReport.Status.REVIEWED:
        report.reviewed_by = user
        report.reviewed_at = now
    elif target == IntelligenceReport.Status.APPROVED:
        report.approved_by = user
        report.approved_at = now
    elif target == IntelligenceReport.Status.PUBLISHED:
        report.published_by = user
        report.published_at = now
    report.save()
    ReportAudit.objects.create(
        report=report,
        action="status_changed",
        from_status=old,
        to_status=target,
        actor=user,
        note=note[:1000],
    )
    return report


def report_csv(report: IntelligenceReport) -> bytes:
    stream = io.StringIO()
    writer = csv.writer(stream)
    writer.writerow(["section", "value"])
    writer.writerow(["title", report.title])
    writer.writerow(["scope", f"{report.scope_level}: {report.scope_name}"])
    writer.writerow(["status", report.status])
    for section, value in report.content.items():
        if isinstance(value, list):
            for item in value:
                writer.writerow([section, json_value(item)])
        else:
            writer.writerow([section, json_value(value)])
    return stream.getvalue().encode("utf-8-sig")


def report_xlsx(report: IntelligenceReport) -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Kenya Live Atlas Report"
    sheet.append(["Kenya Live Atlas Intelligence Report", report.title])
    sheet.append(["Scope", f"{report.scope_level}: {report.scope_name}"])
    sheet.append(["Status", report.status])
    sheet.append(["Confidence", report.confidence])
    sheet.append([])
    sheet.append(["Section", "Value"])
    for section, value in report.content.items():
        if isinstance(value, list):
            for item in value:
                sheet.append([section.replace("_", " ").title(), json_value(item)])
        else:
            sheet.append([section.replace("_", " ").title(), json_value(value)])
    sheet.column_dimensions["A"].width = 32
    sheet.column_dimensions["B"].width = 110
    stream = io.BytesIO()
    workbook.save(stream)
    return stream.getvalue()


def report_pdf(report: IntelligenceReport) -> bytes:
    stream = io.BytesIO()
    styles = getSampleStyleSheet()
    document = SimpleDocTemplate(
        stream,
        pagesize=A4,
        rightMargin=18 * mm,
        leftMargin=18 * mm,
        topMargin=16 * mm,
        bottomMargin=16 * mm,
        title=report.title,
        author="Kenya Live Atlas",
    )
    story = [
        Paragraph("Kenya Live Atlas Intelligence Report", styles["Title"]),
        Paragraph(report.title, styles["Heading1"]),
        Paragraph(
            f"Scope: {report.scope_level.title()} - {report.scope_name} | "
            f"Status: {report.status.title()} | Confidence: {report.confidence.title()}",
            styles["Normal"],
        ),
        Spacer(1, 8),
    ]
    for section, value in report.content.items():
        story.append(Paragraph(section.replace("_", " ").title(), styles["Heading2"]))
        values = value if isinstance(value, list) else [value]
        for item in values:
            story.append(Paragraph(f"- {json_value(item)}", styles["BodyText"]))
        story.append(Spacer(1, 6))
    document.build(story)
    return stream.getvalue()


def json_value(value) -> str:
    if isinstance(value, dict):
        return "; ".join(f"{key}: {item}" for key, item in value.items())
    return str(value)
