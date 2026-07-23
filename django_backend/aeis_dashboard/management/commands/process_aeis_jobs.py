from __future__ import annotations

import json
import os
import time

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import close_old_connections
from django.utils import timezone

from aeis_dashboard.services import jobs


def write_heartbeat(status: str) -> None:
    heartbeat_path = settings.RUNTIME_DIR / "worker.heartbeat"
    payload = {
        "status": status,
        "pid": os.getpid(),
        "updated_at": timezone.now().isoformat(),
    }
    heartbeat_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


class Command(BaseCommand):
    help = "Process durable K-L-I-A intelligence and report jobs."

    def add_arguments(self, parser):
        parser.add_argument("--once", action="store_true", help="Process at most one job and exit.")
        parser.add_argument("--sleep", type=float, default=1.0, help="Idle polling interval in seconds.")

    def handle(self, *args, **options):
        once = bool(options["once"])
        sleep_seconds = max(0.2, float(options["sleep"]))
        self.stdout.write("K-L-I-A processing worker ready.")
        write_heartbeat("running")
        try:
            while True:
                close_old_connections()
                write_heartbeat("running")
                job = jobs.process_next()
                if job:
                    self.stdout.write(f"{job.pk} {job.job_type}: {job.status}")
                if once:
                    write_heartbeat("stopped")
                    return
                if not job:
                    time.sleep(sleep_seconds)
        except KeyboardInterrupt:
            write_heartbeat("stopped")
            self.stdout.write("K-L-I-A processing worker stopped.")
