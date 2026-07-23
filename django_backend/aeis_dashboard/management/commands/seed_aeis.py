from django.core.management.base import BaseCommand

from aeis_dashboard.services.auth import seed_default_accounts


class Command(BaseCommand):
    help = "Create the default K-L-I-A county and national access accounts."

    def handle(self, *args, **options):
        result = seed_default_accounts()
        self.stdout.write(self.style.SUCCESS(f"K-L-I-A accounts ready: {result['total']} total, {result['created']} created."))
