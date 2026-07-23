from django.apps import AppConfig


class AeisDashboardConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "aeis_dashboard"
    verbose_name = "K-L-I-A Dashboard"

    def ready(self):
        from . import database  # noqa: F401
