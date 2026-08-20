from django.core.management.base import BaseCommand

from aeis_dashboard.services.auth import seed_default_accounts


class Command(BaseCommand):
    help = "Create the default Kenya Live Atlas county and national access accounts."

    def handle(self, *args, **options):
        result = seed_default_accounts()
        self.stdout.write(self.style.SUCCESS(f"Kenya Live Atlas accounts ready: {result['total']} total, {result['created']} created."))
