from __future__ import annotations

import json
import logging
import time
import uuid


logger = logging.getLogger("aeis.request")


class JsonLogFormatter(logging.Formatter):
    def format(self, record):
        payload = {
            "timestamp": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        for field in (
            "request_id",
            "method",
            "path",
            "status_code",
            "duration_ms",
            "job_id",
            "job_type",
        ):
            value = getattr(record, field, None)
            if value is not None:
                payload[field] = value
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


class RequestTelemetryMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex
        request.aeis_request_id = request_id
        started = time.perf_counter()
        try:
            response = self.get_response(request)
        except Exception:
            elapsed_ms = (time.perf_counter() - started) * 1000
            logger.exception(
                "request_failed",
                extra={
                    "request_id": request_id[:96],
                    "method": request.method,
                    "path": request.path,
                    "status_code": 500,
                    "duration_ms": round(elapsed_ms, 1),
                },
            )
            raise
        elapsed_ms = (time.perf_counter() - started) * 1000

        response["X-Request-ID"] = request_id[:96]
        response["Server-Timing"] = f"app;dur={elapsed_ms:.1f}"
        response["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(self)"
        response["X-Permitted-Cross-Domain-Policies"] = "none"
        logger.info(
            "request_complete",
            extra={
                "request_id": request_id[:96],
                "method": request.method,
                "path": request.path,
                "status_code": response.status_code,
                "duration_ms": round(elapsed_ms, 1),
            },
        )
        return response
