from __future__ import annotations

import time

from django.core.management.base import BaseCommand
from django.db import close_old_connections

from aeis_dashboard.services import jobs


class Command(BaseCommand):
    help = "Process durable AEIS-K intelligence and report jobs."

    def add_arguments(self, parser):
        parser.add_argument("--once", action="store_true", help="Process at most one job and exit.")
        parser.add_argument("--sleep", type=float, default=1.0, help="Idle polling interval in seconds.")

    def handle(self, *args, **options):
        once = bool(options["once"])
        sleep_seconds = max(0.2, float(options["sleep"]))
        self.stdout.write("AEIS-K processing worker ready.")
        try:
            while True:
                close_old_connections()
                job = jobs.process_next()
                if job:
                    self.stdout.write(f"{job.pk} {job.job_type}: {job.status}")
                if once:
                    return
                if not job:
                    time.sleep(sleep_seconds)
        except KeyboardInterrupt:
            self.stdout.write("AEIS-K processing worker stopped.")
