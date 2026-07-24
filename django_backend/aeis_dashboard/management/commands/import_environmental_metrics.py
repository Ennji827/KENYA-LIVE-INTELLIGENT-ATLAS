from __future__ import annotations

import csv
from datetime import date
from pathlib import Path

from django.core.cache import cache
from django.core.management.base import BaseCommand, CommandError
from django.utils.text import slugify

from aeis_dashboard.models import AEISUser, DataQualityAssessment, EnvironmentalMetricObservation
from aeis_dashboard.services import domain
from aeis_dashboard.services.data_sources import ENVIRONMENTAL_METRIC_CATALOG


FIELD_ALIASES = {
    "scope_level": ["scope_level", "scope", "level"],
    "scope_name": ["scope_name", "county", "county_name", "county name", "name"],
    "scope_code": ["scope_code", "county_code", "county code", "code"],
    "metric_key": ["metric_key", "metric", "indicator", "indicator_key"],
    "metric_label": ["metric_label", "label", "indicator_label"],
    "category": ["category", "console", "module"],
    "unit": ["unit", "units"],
    "value": ["value", "metric_value", "amount"],
    "period_start": ["period_start", "start", "date", "year"],
    "period_end": ["period_end", "end"],
    "period_grain": ["period_grain", "grain", "frequency"],
    "source_slug": ["source_slug", "source key"],
    "source_name": ["source_name", "source", "source name"],
    "provider": ["provider", "agency", "organisation", "organization"],
    "confidence": ["confidence"],
    "method": ["method", "processing_method", "zonal_method"],
    "quality_flag": ["quality_flag", "quality", "flag"],
    "notes": ["notes", "comment", "comments"],
    "land_use_class": ["land_use_class", "class", "land_cover_class"],
}


def _normalise_header(value: str) -> str:
    return str(value or "").strip().replace("_", " ").lower()


def _value(row: dict, field: str) -> str:
    normalised = {_normalise_header(key): value for key, value in row.items()}
    for alias in FIELD_ALIASES[field]:
        if _normalise_header(alias) in normalised:
            return str(normalised[_normalise_header(alias)] or "").strip()
    return ""


def _parse_period(value: str, default_end: bool = False) -> date:
    cleaned = str(value or "").strip()
    if not cleaned:
        raise ValueError("period_start is required")
    if len(cleaned) == 4 and cleaned.isdigit():
        return date(int(cleaned), 12 if default_end else 1, 31 if default_end else 1)
    if len(cleaned) == 7:
        year = int(cleaned[:4])
        month = int(cleaned[5:7])
        if default_end:
            if month == 12:
                return date(year, 12, 31)
            return date(year, month + 1, 1).replace(day=1) - date.resolution
        return date(year, month, 1)
    return date.fromisoformat(cleaned)


def _parse_value(raw: str, metric_key: str) -> float:
    cleaned = str(raw or "").strip().replace(",", "")
    if not cleaned:
        raise ValueError("value is required")
    try:
        parsed = float(cleaned)
    except ValueError as exc:
        raise ValueError("value must be numeric") from exc
    config = ENVIRONMENTAL_METRIC_CATALOG[metric_key]
    if parsed < config["min"] or parsed > config["max"]:
        raise ValueError(f"{metric_key} must be between {config['min']} and {config['max']} {config['unit']}")
    return parsed


class Command(BaseCommand):
    help = "Import real source-backed environmental metric observations for Intelligence Hub consoles."

    def add_arguments(self, parser):
        parser.add_argument("csv_path", help="Path to a reviewed environmental metric CSV file.")
        parser.add_argument("--source-slug", default="", help="Default source slug when CSV rows do not include one.")
        parser.add_argument("--source-name", default="", help="Default real source name when CSV rows do not include one.")
        parser.add_argument("--provider", default="", help="Default provider/agency name.")
        parser.add_argument("--imported-by-email", default="", help="Optional AEIS-K user email to attach as importer.")
        parser.add_argument("--dry-run", action="store_true", help="Validate the file without writing rows.")

    def handle(self, *args, **options):
        path = Path(options["csv_path"]).expanduser().resolve()
        if not path.is_file():
            raise CommandError(f"CSV file not found: {path}")

        importer = None
        if options["imported_by_email"]:
            importer = AEISUser.objects.filter(email__iexact=options["imported_by_email"]).first()
            if not importer:
                raise CommandError(f"No AEIS-K user found for {options['imported_by_email']}")

        created = 0
        updated = 0
        valid = 0
        skipped = 0
        errors: list[str] = []
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            if not reader.fieldnames:
                raise CommandError("CSV has no header row.")
            for row_number, row in enumerate(reader, start=2):
                try:
                    metric_key = slugify(_value(row, "metric_key")).replace("-", "_")
                    if metric_key not in ENVIRONMENTAL_METRIC_CATALOG:
                        raise ValueError(f"unknown metric_key: {metric_key or '(blank)'}")
                    config = ENVIRONMENTAL_METRIC_CATALOG[metric_key]
                    source_slug = slugify(_value(row, "source_slug") or options["source_slug"])
                    source_name = _value(row, "source_name") or str(options["source_name"] or "").strip()
                    if not source_slug or not source_name:
                        raise ValueError("source_slug and source_name are required")
                    period_start = _parse_period(_value(row, "period_start"))
                    period_end_raw = _value(row, "period_end")
                    period_end = _parse_period(period_end_raw, default_end=True) if period_end_raw else period_start
                    if period_start > period_end:
                        raise ValueError("period_start must be on or before period_end")

                    scope_level = (_value(row, "scope_level") or "county").lower()
                    scope_name = _value(row, "scope_name")
                    scope_code = _value(row, "scope_code")
                    if scope_level == "county":
                        county_feature = domain.find_county(scope_code or scope_name)
                        if not county_feature:
                            raise ValueError(f"county not found: {scope_name or scope_code}")
                        scope_name = domain.county_name(county_feature)
                        scope_code = domain.county_code(county_feature)
                    elif scope_level == "national":
                        scope_name = scope_name or "Kenya"
                        scope_code = scope_code or "000"
                    else:
                        raise ValueError("scope_level must be county or national")

                    confidence = (_value(row, "confidence") or DataQualityAssessment.Confidence.MEDIUM).lower()
                    if confidence not in DataQualityAssessment.Confidence.values:
                        raise ValueError("confidence must be high, medium, low, or unknown")
                    period_grain = (_value(row, "period_grain") or EnvironmentalMetricObservation.PeriodGrain.ANNUAL).lower()
                    if period_grain not in EnvironmentalMetricObservation.PeriodGrain.values:
                        raise ValueError("period_grain must be daily, monthly, seasonal, annual, or survey")

                    valid += 1
                    defaults = {
                        "source_name": source_name,
                        "provider": _value(row, "provider") or str(options["provider"] or "").strip(),
                        "metric_label": _value(row, "metric_label") or config["label"],
                        "category": (_value(row, "category") or config["category"]).lower(),
                        "unit": _value(row, "unit") or config["unit"],
                        "value": _parse_value(_value(row, "value"), metric_key),
                        "period_start": period_start,
                        "period_end": period_end,
                        "period_grain": period_grain,
                        "scope_level": scope_level,
                        "scope_name": scope_name,
                        "scope_code": scope_code,
                        "confidence": confidence,
                        "method": _value(row, "method"),
                        "quality_flag": _value(row, "quality_flag") or "reviewed",
                        "notes": _value(row, "notes"),
                        "metadata": {
                            "import_file": path.name,
                            "row_number": row_number,
                            "land_use_class": _value(row, "land_use_class"),
                            "source_rule": "reviewed source import; no synthetic values generated",
                        },
                        "imported_by": importer,
                    }
                    if defaults["category"] != config["category"]:
                        raise ValueError(f"{metric_key} belongs to category {config['category']}")
                    if defaults["unit"] != config["unit"]:
                        raise ValueError(f"{metric_key} unit must be {config['unit']}")

                    if not options["dry_run"]:
                        _, was_created = EnvironmentalMetricObservation.objects.update_or_create(
                            source_slug=source_slug,
                            metric_key=metric_key,
                            scope_level=scope_level,
                            scope_code=scope_code,
                            scope_name=scope_name,
                            period_start=period_start,
                            period_end=period_end,
                            defaults=defaults,
                        )
                        created += 1 if was_created else 0
                        updated += 0 if was_created else 1
                except (ValueError, TypeError) as exc:
                    skipped += 1
                    if len(errors) < 12:
                        errors.append(f"row {row_number}: {exc}")

        if errors:
            self.stdout.write(self.style.WARNING("Skipped rows:"))
            for error in errors:
                self.stdout.write(f"  - {error}")
        if not options["dry_run"]:
            cache.clear()
        verb = "Validated" if options["dry_run"] else "Imported"
        total = valid if options["dry_run"] else created + updated
        self.stdout.write(
            self.style.SUCCESS(
                f"{verb} {total} environmental metric row(s): {created} created, {updated} updated, {skipped} skipped."
            )
        )
