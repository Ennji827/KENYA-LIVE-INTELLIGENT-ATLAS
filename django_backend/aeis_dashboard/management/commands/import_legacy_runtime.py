from __future__ import annotations

import sqlite3
from datetime import datetime, timezone as datetime_timezone
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from aeis_dashboard.models import AEISUser, AuthAudit, SystemSetting


class Command(BaseCommand):
    help = "Import users, audit records, and settings from the retired AEIS-K SQLite runtime."

    def add_arguments(self, parser):
        parser.add_argument("--path", type=Path, default=settings.PROJECT_ROOT / "backend" / "aeis.sqlite")

    def handle(self, *args, **options):
        source: Path = options["path"]
        if not source.exists():
            self.stdout.write("No legacy runtime database found; nothing to import.")
            return
        if SystemSetting.objects.filter(key="legacy_runtime_imported").exists():
            self.stdout.write("Legacy runtime was already imported.")
            return

        connection = sqlite3.connect(f"file:{source.resolve()}?mode=ro", uri=True)
        connection.row_factory = sqlite3.Row
        imported_users = 0
        imported_audits = 0
        try:
            for row in connection.execute("SELECT * FROM county_users"):
                email = row["email"] or f"{row['username']}@aeis-k.local"
                user, _ = AEISUser.objects.update_or_create(
                    username=row["username"],
                    defaults={
                        "email": email,
                        "county_code": str(row["county_code"] or "")[-3:],
                        "county_name": row["county_name"] or "",
                        "role": row["role"] or "county",
                        "provider": row["provider"] or "password",
                        "is_active": bool(row["is_active"]),
                        "password": f"legacy_aeis${row['salt']}${row['password_hash']}",
                    },
                )
                created_at = self._parse_datetime(row["created_at"])
                if created_at:
                    AEISUser.objects.filter(pk=user.pk).update(date_joined=created_at)
                imported_users += 1

            if not AuthAudit.objects.exists():
                for row in connection.execute("SELECT * FROM auth_audit_log ORDER BY id"):
                    audit = AuthAudit.objects.create(
                        event_type=row["event_type"],
                        status=row["status"],
                        county_code=row["county_code"] or "",
                        county_name=row["county_name"] or "",
                        username=row["username"] or "",
                        email=row["email"] or "",
                        role=row["role"] or "",
                        provider=row["provider"] or "",
                        latitude=row["latitude"],
                        longitude=row["longitude"],
                        ip_address=row["ip_address"] or None,
                        user_agent=row["user_agent"] or "",
                        reason=row["reason"] or "",
                    )
                    created_at = self._parse_datetime(row["created_at"])
                    if created_at:
                        AuthAudit.objects.filter(pk=audit.pk).update(created_at=created_at)
                    imported_audits += 1

            for row in connection.execute("SELECT key, value FROM system_settings"):
                SystemSetting.objects.update_or_create(key=row["key"], defaults={"value": row["value"]})
            SystemSetting.objects.update_or_create(
                key="legacy_runtime_imported",
                defaults={"value": timezone.now().isoformat()},
            )
        finally:
            connection.close()

        self.stdout.write(
            self.style.SUCCESS(
                f"Imported {imported_users} users and {imported_audits} audit records from {source}."
            )
        )

    @staticmethod
    def _parse_datetime(value):
        if not value:
            return None
        parsed = datetime.fromisoformat(value)
        if timezone.is_naive(parsed):
            parsed = timezone.make_aware(parsed, datetime_timezone.utc)
        return parsed
