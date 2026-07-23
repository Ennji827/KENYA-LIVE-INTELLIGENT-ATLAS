from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("aeis_dashboard", "0006_monthlyclimateobservation"),
    ]

    operations = [
        migrations.CreateModel(
            name="EnvironmentalMetricObservation",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("source_slug", models.SlugField()),
                ("source_name", models.CharField(max_length=180)),
                ("provider", models.CharField(blank=True, max_length=140)),
                ("metric_key", models.SlugField(db_index=True, max_length=80)),
                ("metric_label", models.CharField(max_length=160)),
                ("category", models.CharField(db_index=True, max_length=40)),
                ("unit", models.CharField(max_length=40)),
                ("value", models.FloatField()),
                ("period_start", models.DateField(db_index=True)),
                ("period_end", models.DateField(db_index=True)),
                (
                    "period_grain",
                    models.CharField(
                        choices=[
                            ("daily", "Daily"),
                            ("monthly", "Monthly"),
                            ("seasonal", "Seasonal"),
                            ("annual", "Annual"),
                            ("survey", "Survey / release"),
                        ],
                        default="annual",
                        max_length=16,
                    ),
                ),
                ("scope_level", models.CharField(db_index=True, default="county", max_length=20)),
                ("scope_name", models.CharField(blank=True, db_index=True, max_length=160)),
                ("scope_code", models.CharField(blank=True, db_index=True, max_length=40)),
                (
                    "confidence",
                    models.CharField(
                        choices=[
                            ("high", "High"),
                            ("medium", "Medium"),
                            ("low", "Low"),
                            ("unknown", "Unknown"),
                        ],
                        default="medium",
                        max_length=16,
                    ),
                ),
                ("method", models.CharField(blank=True, max_length=120)),
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
                        related_name="imported_environmental_metric_observations",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "ordering": ["period_start", "category", "metric_key", "scope_name"],
            },
        ),
        migrations.AddIndex(
            model_name="environmentalmetricobservation",
            index=models.Index(fields=["category", "metric_key", "period_start"], name="aeis_emo_category_metric_idx"),
        ),
        migrations.AddIndex(
            model_name="environmentalmetricobservation",
            index=models.Index(fields=["scope_level", "scope_name", "period_start"], name="aeis_emo_scope_period_idx"),
        ),
        migrations.AddIndex(
            model_name="environmentalmetricobservation",
            index=models.Index(fields=["source_slug", "period_start"], name="aeis_emo_source_period_idx"),
        ),
        migrations.AddConstraint(
            model_name="environmentalmetricobservation",
            constraint=models.UniqueConstraint(
                fields=("source_slug", "metric_key", "scope_level", "scope_code", "scope_name", "period_start", "period_end"),
                name="aeis_emo_src_metric_uq",
            ),
        ),
    ]
