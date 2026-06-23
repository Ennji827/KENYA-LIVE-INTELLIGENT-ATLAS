from __future__ import annotations

import logging
from datetime import timedelta

from django.core.cache import cache
from django.db import transaction
from django.db.models import F, Q
from django.utils import timezone

from aeis_dashboard.models import AEISUser, ProcessingJob


logger = logging.getLogger("aeis.jobs")


class JobError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def _safe_payload(payload: dict) -> dict:
    return {
        str(key): value
        for key, value in payload.items()
        if not str(key).startswith("_") and key not in {"async"}
    }


def enqueue(user: AEISUser, job_type: str, payload: dict) -> ProcessingJob:
    if job_type not in ProcessingJob.JobType.values:
        raise JobError("Unsupported processing job type.")

    active_count = ProcessingJob.objects.filter(
        requested_by=user,
        status__in=[ProcessingJob.Status.QUEUED, ProcessingJob.Status.RUNNING],
    ).count()
    if active_count >= 5:
        raise JobError("Five jobs are already queued or running for this account.", 429)

    rate_key = f"job-enqueue-rate:{user.pk}"
    rate = int(cache.get(rate_key) or 0)
    if rate >= 20:
        raise JobError("Job submission limit reached. Try again in one minute.", 429)
    cache.set(rate_key, rate + 1, 60)

    label = "Intelligence analysis queued" if job_type == "intelligence" else "Report generation queued"
    return ProcessingJob.objects.create(
        job_type=job_type,
        payload=_safe_payload(payload),
        requested_by=user,
        status_message=label,
    )


def scoped_jobs(user: AEISUser):
    queryset = ProcessingJob.objects.select_related("requested_by")
    if user.role not in {AEISUser.Role.MINISTRY, AEISUser.Role.AUDITOR}:
        queryset = queryset.filter(requested_by=user)
    return queryset


def payload(job: ProcessingJob) -> dict:
    return {
        "id": str(job.pk),
        "job_type": job.job_type,
        "status": job.status,
        "progress": job.progress,
        "status_message": job.status_message,
        "result": job.result if job.status == ProcessingJob.Status.SUCCEEDED else {},
        "error": job.error if job.status == ProcessingJob.Status.FAILED else "",
        "attempts": job.attempts,
        "max_attempts": job.max_attempts,
        "requested_by": job.requested_by.username,
        "created_at": job.created_at.isoformat(),
        "updated_at": job.updated_at.isoformat(),
        "started_at": job.started_at.isoformat() if job.started_at else None,
        "finished_at": job.finished_at.isoformat() if job.finished_at else None,
    }


@transaction.atomic
def claim_next() -> ProcessingJob | None:
    stale_before = timezone.now() - timedelta(minutes=15)
    queryset = ProcessingJob.objects.select_for_update().filter(
        Q(status=ProcessingJob.Status.QUEUED)
        | Q(status=ProcessingJob.Status.RUNNING, locked_at__lt=stale_before),
        attempts__lt=F("max_attempts"),
    ).order_by("created_at")
    job = queryset.first()
    if not job:
        return None
    now = timezone.now()
    claim_filter = {"pk": job.pk, "status": job.status}
    if job.status == ProcessingJob.Status.RUNNING:
        claim_filter["locked_at"] = job.locked_at
    claimed = ProcessingJob.objects.filter(**claim_filter).update(
        status=ProcessingJob.Status.RUNNING,
        progress=10,
        status_message="Worker accepted the job",
        attempts=F("attempts") + 1,
        started_at=job.started_at or now,
        locked_at=now,
        error="",
    )
    if not claimed:
        return None
    return ProcessingJob.objects.select_related("requested_by").get(pk=job.pk)

def _execute(job: ProcessingJob) -> dict:
    if job.job_type == ProcessingJob.JobType.INTELLIGENCE:
        from . import intelligence

        result = intelligence.generate_intelligence(job.requested_by, job.payload)
        return {"intelligence": result}

    if job.job_type == ProcessingJob.JobType.REPORT:
        from . import reports

        report = reports.create_report(job.requested_by, job.payload)
        return {"report_id": report.pk}

    raise JobError("Unsupported processing job type.")


def process_job(job: ProcessingJob) -> ProcessingJob:
    ProcessingJob.objects.filter(pk=job.pk).update(
        progress=35,
        status_message="Collecting trusted data and generating the result",
        locked_at=timezone.now(),
    )
    try:
        result = _execute(job)
    except Exception as exc:
        status_code = int(getattr(exc, "status", 500))
        retryable = status_code >= 500 and job.attempts < job.max_attempts
        ProcessingJob.objects.filter(pk=job.pk).update(
            status=ProcessingJob.Status.QUEUED if retryable else ProcessingJob.Status.FAILED,
            progress=0 if retryable else 100,
            status_message="External provider unavailable; queued for retry" if retryable else "Job failed",
            error=str(exc)[:4000],
            locked_at=None,
            finished_at=None if retryable else timezone.now(),
        )
        logger.exception("processing_job_failed", extra={"job_id": str(job.pk), "job_type": job.job_type})
    else:
        ProcessingJob.objects.filter(pk=job.pk).update(
            status=ProcessingJob.Status.SUCCEEDED,
            progress=100,
            status_message="Completed",
            result=result,
            error="",
            locked_at=None,
            finished_at=timezone.now(),
        )
        logger.info(
            "processing_job_completed",
            extra={"job_id": str(job.pk), "job_type": job.job_type},
        )
    return ProcessingJob.objects.select_related("requested_by").get(pk=job.pk)


def process_next() -> ProcessingJob | None:
    job = claim_next()
    return process_job(job) if job else None


@transaction.atomic
def cancel(user: AEISUser, job_id) -> ProcessingJob:
    job = scoped_jobs(user).select_for_update().filter(pk=job_id).first()
    if not job:
        raise JobError("Processing job not found.", 404)
    if job.status != ProcessingJob.Status.QUEUED:
        raise JobError("Only queued jobs can be cancelled.", 409)
    job.status = ProcessingJob.Status.CANCELLED
    job.progress = 100
    job.status_message = "Cancelled"
    job.finished_at = timezone.now()
    job.save(update_fields=["status", "progress", "status_message", "finished_at", "updated_at"])
    return job
