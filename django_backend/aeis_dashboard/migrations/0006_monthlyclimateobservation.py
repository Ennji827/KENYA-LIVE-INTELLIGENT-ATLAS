from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("aeis_dashboard", "0005_aeisuser_position_public_role"),
    ]

    operations = [
        migrations.CreateModel(
            name="MonthlyClimateObservation",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("source_slug", models.SlugField(default="reviewed-local-climate")),
                ("source_name", models.CharField(max_length=180)),
                ("provider", models.CharField(blank=True, max_length=140)),
                ("county_name", models.CharField(db_index=True, max_length=100)),
                ("county_code", models.CharField(blank=True, db_index=True, max_length=8)),
                ("observation_month", models.DateField(db_index=True)),
                ("rainfall_mm", models.FloatField(blank=True, null=True)),
                ("temperature_c", models.FloatField(blank=True, null=True)),
                ("temperature_max_c", models.FloatField(blank=True, null=True)),
                ("temperature_min_c", models.FloatField(blank=True, null=True)),
                ("humidity_pct", models.FloatField(blank=True, null=True)),
                ("wind_ms", models.FloatField(blank=True, null=True)),
                ("solar_mj_m2_day", models.FloatField(blank=True, null=True)),
                ("station_count", models.PositiveSmallIntegerField(blank=True, null=True)),
                ("quality_flag", models.CharField(blank=True, default="reviewed", max_length=32)),
                ("notes", models.TextField(blank=True)),
                ("metadata", models.JSONField(blank=True, default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "imported_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="imported_monthly_climate_observations",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "ordering": ["observation_month", "county_name"],
            },
        ),
        migrations.AddIndex(
            model_name="monthlyclimateobservation",
            index=models.Index(fields=["county_name", "observation_month"], name="aeis_mco_county_month_idx"),
        ),
        migrations.AddIndex(
            model_name="monthlyclimateobservation",
            index=models.Index(fields=["source_slug", "observation_month"], name="aeis_mco_source_month_idx"),
        ),
        migrations.AddConstraint(
            model_name="monthlyclimateobservation",
            constraint=models.UniqueConstraint(
                fields=("source_slug", "county_code", "county_name", "observation_month"),
                name="aeis_mco_src_scope_month_uq",
            ),
        ),
    ]
