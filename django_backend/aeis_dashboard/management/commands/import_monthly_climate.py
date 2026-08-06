from __future__ import annotations

import csv
from datetime import date
from pathlib import Path

from django.core.cache import cache
from django.core.management.base import BaseCommand, CommandError
from django.utils.text import slugify

from aeis_dashboard.models import AEISUser, MonthlyClimateObservation
from aeis_dashboard.services import domain


FIELD_ALIASES = {
    "county": ["county", "county_name", "county name", "countyName"],
    "county_code": ["county_code", "county code", "code", "countyCode"],
    "month": ["observation_month", "month", "date", "year_month", "year-month"],
    "year": ["year"],
    "month_number": ["month_number", "month_index", "month_no"],
    "rainfall_mm": ["rainfall_mm", "rainfall", "rain_mm", "precipitation_mm"],
    "temperature_c": ["temperature_c", "temperature", "mean_temperature_c", "temp_c"],
    "temperature_max_c": ["temperature_max_c", "tmax_c", "max_temperature_c"],
    "temperature_min_c": ["temperature_min_c", "tmin_c", "min_temperature_c"],
    "humidity_pct": ["humidity_pct", "relative_humidity", "rh_pct", "humidity"],
    "wind_ms": ["wind_ms", "wind_speed_ms", "wind"],
    "solar_mj_m2_day": ["solar_mj_m2_day", "solar", "solar_radiation"],
    "station_count": ["station_count", "stations", "station_no"],
    "quality_flag": ["quality_flag", "quality", "flag"],
    "notes": ["notes", "comment", "comments"],
}

NUMERIC_RULES = {
    "rainfall_mm": (0, 5000),
    "temperature_c": (-20, 60),
    "temperature_max_c": (-20, 70),
    "temperature_min_c": (-30, 60),
    "humidity_pct": (0, 100),
    "wind_ms": (0, 100),
    "solar_mj_m2_day": (0, 60),
}


def _normalise_header(value: str) -> str:
    return str(value or "").strip().replace("_", " ").lower()


def _value(row: dict, field: str) -> str:
    normalised = {_normalise_header(key): value for key, value in row.items()}
    for alias in FIELD_ALIASES[field]:
        if _normalise_header(alias) in normalised:
            return str(normalised[_normalise_header(alias)] or "").strip()
    return ""


def _parse_float(value: str, field: str) -> float | None:
    cleaned = str(value or "").strip().replace(",", "")
    if not cleaned or cleaned.lower() in {"na", "n/a", "null", "none", "-"}:
        return None
    try:
        parsed = float(cleaned)
    except ValueError as exc:
        raise ValueError(f"{field} must be numeric") from exc
    lower, upper = NUMERIC_RULES[field]
    if parsed < lower or parsed > upper:
        raise ValueError(f"{field} must be between {lower} and {upper}")
    return parsed


def _parse_station_count(value: str) -> int | None:
    cleaned = str(value or "").strip()
    if not cleaned:
        return None
    try:
        parsed = int(float(cleaned))
    except ValueError as exc:
        raise ValueError("station_count must be numeric") from exc
    if parsed < 0 or parsed > 500:
        raise ValueError("station_count must be between 0 and 500")
    return parsed


def _parse_month(row: dict) -> date:
    raw = _value(row, "month")
    if raw:
        cleaned = raw.strip()
        if len(cleaned) == 7:
            cleaned = f"{cleaned}-01"
        parsed = date.fromisoformat(cleaned)
        return date(parsed.year, parsed.month, 1)

    year = _value(row, "year")
    month = _value(row, "month_number")
    if not year or not month:
        raise ValueError("month/date is required, or provide year and month_number")
    return date(int(float(year)), int(float(month)), 1)


class Command(BaseCommand):
    help = "Import real reviewed monthly county climate records from KMD/KALRO/KNBS-style CSV exports."

    def add_arguments(self, parser):
        parser.add_argument("csv_path", help="Path to a reviewed monthly climate CSV file.")
        parser.add_argument("--source-slug", default="reviewed-local-climate", help="Stable source slug, e.g. kenya-meteorological-department.")
        parser.add_argument("--source-name", required=True, help="Human-readable real source name printed on dashboards.")
        parser.add_argument("--provider", default="", help="Provider name, e.g. Kenya Meteorological Department.")
        parser.add_argument("--imported-by-email", default="", help="Optional Kenya Live Atlas user email to attach as importer.")
        parser.add_argument("--dry-run", action="store_true", help="Validate the file without writing rows.")

    def handle(self, *args, **options):
        path = Path(options["csv_path"]).expanduser().resolve()
        if not path.is_file():
            raise CommandError(f"CSV file not found: {path}")

        source_slug = slugify(str(options["source_slug"] or "").strip())
        if not source_slug:
            raise CommandError("--source-slug must contain letters or numbers.")
        source_name = str(options["source_name"] or "").strip()
        if not source_name:
            raise CommandError("--source-name is required so the dashboard can show the real source.")

        importer = None
        if options["imported_by_email"]:
            importer = AEISUser.objects.filter(email__iexact=options["imported_by_email"]).first()
            if not importer:
                raise CommandError(f"No Kenya Live Atlas user found for {options['imported_by_email']}")

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
                    county_lookup = _value(row, "county") or _value(row, "county_code")
                    if not county_lookup:
                        raise ValueError("county or county_code is required")
                    county_feature = domain.find_county(county_lookup)
                    if not county_feature:
                        raise ValueError(f"county not found: {county_lookup}")
                    observation_month = _parse_month(row)
                    values = {
                        field: _parse_float(_value(row, field), field)
                        for field in NUMERIC_RULES
                    }
                    if all(value is None for value in values.values()):
                        raise ValueError("at least one climate metric is required")
                    valid += 1
                    defaults = {
                        "source_name": source_name,
                        "provider": str(options["provider"] or "").strip(),
                        "county_name": domain.county_name(county_feature),
                        "county_code": domain.county_code(county_feature),
                        "observation_month": observation_month,
                        **values,
                        "station_count": _parse_station_count(_value(row, "station_count")),
                        "quality_flag": _value(row, "quality_flag") or "reviewed",
                        "notes": _value(row, "notes"),
                        "metadata": {
                            "import_file": path.name,
                            "row_number": row_number,
                            "source_rule": "reviewed source import; no synthetic values generated",
                        },
                        "imported_by": importer,
                    }
                    if not options["dry_run"]:
                        _, was_created = MonthlyClimateObservation.objects.update_or_create(
                            source_slug=source_slug,
                            county_code=defaults["county_code"],
                            county_name=defaults["county_name"],
                            observation_month=observation_month,
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
                f"{verb} {total} monthly climate row(s): {created} created, {updated} updated, {skipped} skipped."
            )
        )
