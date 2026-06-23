import uuid
from pathlib import Path

from django.contrib.auth.models import AbstractUser
from django.db import models
from django.utils import timezone


class AEISUser(AbstractUser):
    class Role(models.TextChoices):
        COUNTY = "county", "County officer"
        MINISTRY = "ministry", "Ministry command officer"
        ANALYST = "analyst", "National analyst"
        FIELD_OFFICER = "field_officer", "Field officer"
        FARMER = "farmer", "Farmer / user"
        AUDITOR = "auditor", "Auditor"

    email = models.EmailField(unique=True)
    county_code = models.CharField(max_length=8, blank=True)
    county_name = models.CharField(max_length=100, blank=True)
    role = models.CharField(max_length=16, choices=Role.choices, default=Role.COUNTY, db_index=True)
    provider = models.CharField(max_length=32, default="password")

    def __str__(self) -> str:
        return f"{self.username} ({self.role})"


class AccessSession(models.Model):
    token = models.CharField(max_length=96, primary_key=True)
    user = models.ForeignKey(AEISUser, on_delete=models.CASCADE, related_name="access_sessions")
    provider = models.CharField(max_length=32, default="password")
    latitude = models.FloatField(default=0)
    longitude = models.FloatField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(db_index=True)

    class Meta:
        ordering = ["-created_at"]


class AuthAudit(models.Model):
    event_type = models.CharField(max_length=40)
    status = models.CharField(max_length=20)
    county_code = models.CharField(max_length=8, blank=True)
    county_name = models.CharField(max_length=100, blank=True)
    username = models.CharField(max_length=150, blank=True)
    email = models.EmailField(blank=True)
    role = models.CharField(max_length=20, blank=True)
    provider = models.CharField(max_length=32, blank=True)
    latitude = models.FloatField(null=True, blank=True)
    longitude = models.FloatField(null=True, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True)
    reason = models.CharField(max_length=160, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at", "-id"]


class SystemSetting(models.Model):
    key = models.CharField(max_length=80, primary_key=True)
    value = models.TextField()
    updated_at = models.DateTimeField(auto_now=True)


class ExternalDataSource(models.Model):
    class SourceType(models.TextChoices):
        CLIMATE = "climate", "Climate time series"
        IMAGERY = "imagery", "Satellite imagery"
        VECTOR = "vector", "Vector GIS"
        RASTER = "raster", "Raster GIS"
        REGISTRY = "registry", "Registry"
        OTHER = "other", "Other"

    slug = models.SlugField(unique=True)
    name = models.CharField(max_length=160)
    provider = models.CharField(max_length=120)
    base_url = models.URLField()
    source_type = models.CharField(max_length=20, choices=SourceType.choices, default=SourceType.OTHER)
    coverage_start = models.DateField(null=True, blank=True)
    coverage_end = models.DateField(null=True, blank=True)
    latest_available = models.DateField(null=True, blank=True)
    requires_auth = models.BooleanField(default=False)
    enabled = models.BooleanField(default=True)
    description = models.TextField(blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    created_by = models.ForeignKey(
        AEISUser,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_data_sources",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]


def data_asset_upload_path(instance, filename: str) -> str:
    suffix = Path(filename).suffix.lower()
    return f"gis/{timezone.now():%Y/%m}/{uuid.uuid4().hex}{suffix}"


class DataAsset(models.Model):
    class AssetType(models.TextChoices):
        VECTOR = "vector", "Vector GIS"
        RASTER = "raster", "Raster GIS"
        TABULAR = "tabular", "Tabular"
        ARCHIVE = "archive", "Archive"

    class ScopeLevel(models.TextChoices):
        NATIONAL = "national", "National"
        COUNTY = "county", "County"
        SUBCOUNTY = "subcounty", "Sub-county"
        WARD = "ward", "Ward"
        FARM = "farm", "Farm"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=180)
    file = models.FileField(upload_to=data_asset_upload_path)
    original_filename = models.CharField(max_length=255)
    file_format = models.CharField(max_length=20)
    content_type = models.CharField(max_length=120, blank=True)
    asset_type = models.CharField(max_length=16, choices=AssetType.choices)
    size_bytes = models.PositiveBigIntegerField()
    sha256 = models.CharField(max_length=64, db_index=True)
    scope_level = models.CharField(max_length=20, choices=ScopeLevel.choices, default=ScopeLevel.NATIONAL)
    scope_name = models.CharField(max_length=160, blank=True)
    scope_code = models.CharField(max_length=40, blank=True)
    acquisition_start = models.DateField(null=True, blank=True)
    acquisition_end = models.DateField(null=True, blank=True)
    feature_count = models.PositiveIntegerField(null=True, blank=True)
    geometry_types = models.JSONField(default=list, blank=True)
    bbox = models.JSONField(default=list, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    status = models.CharField(max_length=24, default="ready")
    uploaded_by = models.ForeignKey(
        AEISUser,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="uploaded_data_assets",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]


class DataQualityAssessment(models.Model):
    class Confidence(models.TextChoices):
        HIGH = "high", "High"
        MEDIUM = "medium", "Medium"
        LOW = "low", "Low"
        UNKNOWN = "unknown", "Unknown"

    class ProcessingStatus(models.TextChoices):
        PENDING = "pending", "Pending"
        READY = "ready", "Ready"
        WARNING = "warning", "Warning"
        FAILED = "failed", "Failed"

    asset = models.OneToOneField(DataAsset, on_delete=models.CASCADE, related_name="quality")
    source_name = models.CharField(max_length=160)
    spatial_coverage = models.CharField(max_length=240, blank=True)
    temporal_coverage = models.CharField(max_length=240, blank=True)
    coordinate_reference_system = models.CharField(max_length=120, blank=True)
    confidence = models.CharField(max_length=16, choices=Confidence.choices, default=Confidence.UNKNOWN)
    processing_status = models.CharField(
        max_length=16,
        choices=ProcessingStatus.choices,
        default=ProcessingStatus.PENDING,
        db_index=True,
    )
    missing_data_warning = models.TextField(blank=True)
    projection_warning = models.TextField(blank=True)
    duplicate_warning = models.TextField(blank=True)
    validation_errors = models.JSONField(default=list, blank=True)
    assessed_at = models.DateTimeField(auto_now=True)


class Alert(models.Model):
    class Severity(models.TextChoices):
        LOW = "low", "Low"
        MEDIUM = "medium", "Medium"
        HIGH = "high", "High"
        CRITICAL = "critical", "Critical"

    class Status(models.TextChoices):
        OPEN = "open", "Open"
        ACKNOWLEDGED = "acknowledged", "Acknowledged"
        RESOLVED = "resolved", "Resolved"

    title = models.CharField(max_length=200)
    description = models.TextField()
    alert_type = models.CharField(max_length=80, db_index=True)
    severity = models.CharField(max_length=16, choices=Severity.choices, db_index=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.OPEN, db_index=True)
    scope_level = models.CharField(max_length=20, default="national", db_index=True)
    scope_name = models.CharField(max_length=160, blank=True, db_index=True)
    scope_code = models.CharField(max_length=40, blank=True)
    geometry = models.JSONField(default=dict, blank=True)
    evidence = models.JSONField(default=dict, blank=True)
    data_sources = models.JSONField(default=list, blank=True)
    confidence = models.CharField(max_length=16, default="low")
    created_by = models.ForeignKey(
        AEISUser,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_alerts",
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]


class FieldReport(models.Model):
    class VerificationStatus(models.TextChoices):
        DRAFT = "draft", "Draft"
        SUBMITTED = "submitted", "Submitted"
        VERIFIED = "verified", "Verified"
        REJECTED = "rejected", "Rejected"

    title = models.CharField(max_length=200)
    report_type = models.CharField(max_length=80, default="field_observation")
    county_name = models.CharField(max_length=100, db_index=True)
    county_code = models.CharField(max_length=8, blank=True)
    subcounty_name = models.CharField(max_length=120, blank=True)
    ward_name = models.CharField(max_length=120, blank=True)
    farm_reference = models.CharField(max_length=160, blank=True)
    crop_type = models.CharField(max_length=100, blank=True)
    observation_date = models.DateField(default=timezone.localdate)
    latitude = models.FloatField(null=True, blank=True)
    longitude = models.FloatField(null=True, blank=True)
    observations = models.TextField()
    attachments = models.JSONField(default=list, blank=True)
    verification_status = models.CharField(
        max_length=16,
        choices=VerificationStatus.choices,
        default=VerificationStatus.DRAFT,
        db_index=True,
    )
    submitted_by = models.ForeignKey(AEISUser, on_delete=models.PROTECT, related_name="field_reports")
    verified_by = models.ForeignKey(
        AEISUser,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="verified_field_reports",
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-observation_date", "-created_at"]


class IntelligenceInsight(models.Model):
    class Confidence(models.TextChoices):
        HIGH = "high", "High"
        MEDIUM = "medium", "Medium"
        LOW = "low", "Low"

    insight_type = models.CharField(max_length=80, default="brief")
    scope_level = models.CharField(max_length=20, default="national", db_index=True)
    scope_name = models.CharField(max_length=160, blank=True, db_index=True)
    scope_code = models.CharField(max_length=40, blank=True)
    question = models.TextField(blank=True)
    executive_summary = models.TextField()
    key_observations = models.JSONField(default=list)
    risk_areas = models.JSONField(default=list)
    affected_areas = models.JSONField(default=list)
    evidence = models.JSONField(default=list)
    recommended_actions = models.JSONField(default=list)
    confidence = models.CharField(max_length=16, choices=Confidence.choices, default=Confidence.LOW)
    explainability = models.TextField(blank=True)
    data_sources = models.JSONField(default=list)
    missing_data = models.JSONField(default=list)
    provider = models.CharField(max_length=40, default="local_rule_based")
    model = models.CharField(max_length=80, blank=True)
    created_by = models.ForeignKey(
        AEISUser,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="intelligence_insights",
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at", "-id"]


class IntelligenceMessage(models.Model):
    conversation_id = models.UUIDField(default=uuid.uuid4, db_index=True)
    user = models.ForeignKey(AEISUser, on_delete=models.CASCADE, related_name="intelligence_messages")
    role = models.CharField(max_length=16)
    content = models.TextField()
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["created_at", "id"]


class IntelligenceReport(models.Model):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        REVIEWED = "reviewed", "Reviewed"
        APPROVED = "approved", "Approved"
        PUBLISHED = "published", "Published"

    title = models.CharField(max_length=220)
    report_type = models.CharField(max_length=80, default="intelligence_brief", db_index=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.DRAFT, db_index=True)
    scope_level = models.CharField(max_length=20, default="national", db_index=True)
    scope_name = models.CharField(max_length=160, blank=True, db_index=True)
    scope_code = models.CharField(max_length=40, blank=True)
    date_start = models.DateField(null=True, blank=True)
    date_end = models.DateField(null=True, blank=True)
    crop_type = models.CharField(max_length=100, blank=True)
    risk_level = models.CharField(max_length=32, blank=True)
    filters = models.JSONField(default=dict, blank=True)
    content = models.JSONField(default=dict)
    ai_summary = models.TextField(blank=True)
    data_sources = models.JSONField(default=list, blank=True)
    confidence = models.CharField(max_length=16, default="low")
    generated_by = models.ForeignKey(AEISUser, on_delete=models.PROTECT, related_name="generated_reports")
    reviewed_by = models.ForeignKey(
        AEISUser,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="reviewed_reports",
    )
    approved_by = models.ForeignKey(
        AEISUser,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="approved_reports",
    )
    published_by = models.ForeignKey(
        AEISUser,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="published_reports",
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    approved_at = models.DateTimeField(null=True, blank=True)
    published_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-updated_at", "-id"]


class ReportAudit(models.Model):
    report = models.ForeignKey(IntelligenceReport, on_delete=models.CASCADE, related_name="audit_events")
    action = models.CharField(max_length=40)
    from_status = models.CharField(max_length=16, blank=True)
    to_status = models.CharField(max_length=16, blank=True)
    actor = models.ForeignKey(AEISUser, on_delete=models.SET_NULL, null=True, blank=True)
    note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at", "-id"]


class ProcessingJob(models.Model):
    class JobType(models.TextChoices):
        INTELLIGENCE = "intelligence", "Intelligence analysis"
        REPORT = "report", "Report generation"

    class Status(models.TextChoices):
        QUEUED = "queued", "Queued"
        RUNNING = "running", "Running"
        SUCCEEDED = "succeeded", "Succeeded"
        FAILED = "failed", "Failed"
        CANCELLED = "cancelled", "Cancelled"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    job_type = models.CharField(max_length=32, choices=JobType.choices, db_index=True)
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.QUEUED,
        db_index=True,
    )
    payload = models.JSONField(default=dict)
    result = models.JSONField(default=dict, blank=True)
    error = models.TextField(blank=True)
    progress = models.PositiveSmallIntegerField(default=0)
    status_message = models.CharField(max_length=240, blank=True)
    attempts = models.PositiveSmallIntegerField(default=0)
    max_attempts = models.PositiveSmallIntegerField(default=2)
    requested_by = models.ForeignKey(
        AEISUser,
        on_delete=models.CASCADE,
        related_name="processing_jobs",
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)
    started_at = models.DateTimeField(null=True, blank=True)
    locked_at = models.DateTimeField(null=True, blank=True, db_index=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["status", "created_at"], name="aeis_job_queue_idx"),
            models.Index(fields=["requested_by", "status"], name="aeis_job_user_idx"),
        ]
