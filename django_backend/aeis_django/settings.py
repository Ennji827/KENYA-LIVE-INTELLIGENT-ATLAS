import os
import secrets
import sys
from pathlib import Path

from .env import env


BASE_DIR = Path(__file__).resolve().parents[1]
PROJECT_ROOT = BASE_DIR.parent
RUNTIME_DIR = PROJECT_ROOT / ".runtime"
RUNTIME_DIR.mkdir(exist_ok=True)
CACHE_DIR = RUNTIME_DIR / "cache"
CACHE_DIR.mkdir(exist_ok=True)


def _load_env_files(*names: str) -> None:
    """Minimal, dependency-free ``.env`` loader.

    Populates ``os.environ`` from ``KEY=VALUE`` lines in the given files (each
    resolved under ``PROJECT_ROOT``) using ``setdefault``, so a variable already
    present in the real environment is never overridden. Files are applied in
    order, so an earlier file wins over a later one; the real environment always
    wins over both — deployment secrets are never clobbered by a local file.
    """

    for name in names:
        path = PROJECT_ROOT / name
        if not path.exists():
            continue
        for raw_line in path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            if key.startswith("export "):
                key = key[len("export ") :].strip()
            if not key:
                continue
            # Strip one layer of matching surrounding quotes, if present.
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
                value = value[1:-1]
            os.environ.setdefault(key, value)


# Load local secrets before any setting reads os.environ. `.env.local` (the
# gitignored real-secrets file) takes precedence over an optional plain `.env`.
_load_env_files(".env.local", ".env")

DEBUG = env("KLA_DJANGO_DEBUG", "1").lower() in {"1", "true", "yes", "on"}
SECRET_KEY = env("KLA_DJANGO_SECRET_KEY", "")
if not SECRET_KEY:
    if not DEBUG:
        raise RuntimeError("KLA_DJANGO_SECRET_KEY must be set when KLA_DJANGO_DEBUG=0.")
    secret_path = RUNTIME_DIR / "django-secret-key"
    if secret_path.exists():
        SECRET_KEY = secret_path.read_text(encoding="utf-8").strip()
    else:
        SECRET_KEY = secrets.token_urlsafe(64)
        secret_path.write_text(SECRET_KEY, encoding="utf-8")

default_hosts = "localhost,127.0.0.1,[::1],*" if DEBUG else "localhost,127.0.0.1,[::1]"
ALLOWED_HOSTS = [
    host.strip()
    for host in env("KLA_ALLOWED_HOSTS", default_hosts).split(",")
    if host.strip()
]

ROOT_URLCONF = "aeis_django.urls"
WSGI_APPLICATION = "aeis_django.wsgi.application"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
APPEND_SLASH = False

INSTALLED_APPS = [
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.staticfiles",
    "aeis_dashboard.apps.AeisDashboardConfig",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.middleware.gzip.GZipMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "django.middleware.common.CommonMiddleware",
    "aeis_dashboard.middleware.RequestTelemetryMiddleware",
]

database_engine = env("KLA_DB_ENGINE", "sqlite").strip().lower()
if database_engine in {"postgres", "postgresql", "postgis"}:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": env("KLA_DB_NAME", "aeis_k"),
            "USER": env("KLA_DB_USER", "aeis_k"),
            "PASSWORD": env("KLA_DB_PASSWORD", ""),
            "HOST": env("KLA_DB_HOST", "127.0.0.1"),
            "PORT": env("KLA_DB_PORT", "5432"),
            "CONN_MAX_AGE": int(env("KLA_DB_CONN_MAX_AGE", "60")),
            "CONN_HEALTH_CHECKS": True,
            "OPTIONS": {
                "sslmode": env("KLA_DB_SSLMODE", "prefer"),
            },
        }
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": env("KLA_DB_PATH", str(RUNTIME_DIR / "aeis.sqlite3")),
            "OPTIONS": {"timeout": 20},
        }
    }

AUTH_USER_MODEL = "aeis_dashboard.AEISUser"
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2SHA1PasswordHasher",
    "aeis_dashboard.hashers.LegacyAEISPasswordHasher",
]
STATIC_URL = "/static/"
STATICFILES_DIRS = [PROJECT_ROOT / "frontend" / "dist" / "assets"]
MEDIA_ROOT = RUNTIME_DIR / "uploads"
MEDIA_URL = "/media/"
USE_TZ = True
TIME_ZONE = "Africa/Nairobi"
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG
X_FRAME_OPTIONS = "DENY"
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "strict-origin-when-cross-origin"
SECURE_SSL_REDIRECT = env("KLA_SECURE_SSL_REDIRECT", "0").lower() in {"1", "true", "yes", "on"}
SECURE_HSTS_SECONDS = int(env("KLA_SECURE_HSTS_SECONDS", "0"))
SECURE_HSTS_INCLUDE_SUBDOMAINS = SECURE_HSTS_SECONDS > 0
SECURE_HSTS_PRELOAD = SECURE_HSTS_SECONDS > 0

if "test" in sys.argv:
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            "LOCATION": "aeis-k-tests",
            "TIMEOUT": 900,
        }
    }
else:
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.filebased.FileBasedCache",
            "LOCATION": str(CACHE_DIR),
            "TIMEOUT": 900,
            "OPTIONS": {
                "MAX_ENTRIES": 3000,
                "CULL_FREQUENCY": 3,
            },
        }
    }

CORS_ALLOWED_ORIGIN = env("KLA_CORS_ALLOWED_ORIGIN", "").strip()

# ── M-PESA / Safaricom Daraja payment gateway ───────────────────────────
# When the consumer key/secret/passkey are absent the payment service runs
# in simulation mode so the report-payment flow is fully demoable.
MPESA_ENV = env("KLA_MPESA_ENV", "sandbox").strip().lower()
MPESA_CONSUMER_KEY = env("KLA_MPESA_CONSUMER_KEY", "").strip()
MPESA_CONSUMER_SECRET = env("KLA_MPESA_CONSUMER_SECRET", "").strip()
MPESA_SHORTCODE = env("KLA_MPESA_SHORTCODE", "174379").strip()
MPESA_PAYBILL = env("KLA_MPESA_PAYBILL", "").strip() or MPESA_SHORTCODE
MPESA_PASSKEY = env("KLA_MPESA_PASSKEY", "").strip()
MPESA_CALLBACK_URL = env("KLA_MPESA_CALLBACK_URL", "").strip()
MPESA_ACCOUNT_PREFIX = env("KLA_MPESA_ACCOUNT_PREFIX", "AEISK").strip()
MPESA_BUSINESS_NAME = env("KLA_MPESA_BUSINESS_NAME", "Kenya Space Agency").strip()
try:
    REPORT_PRICE_KES = int(env("KLA_REPORT_PRICE_KES", "50"))
except ValueError:
    REPORT_PRICE_KES = 50
FILE_UPLOAD_MAX_MEMORY_SIZE = 5 * 1024 * 1024
DATA_UPLOAD_MAX_MEMORY_SIZE = 110 * 1024 * 1024

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "json": {
            "()": "aeis_dashboard.middleware.JsonLogFormatter",
        }
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "json",
        }
    },
    "loggers": {
        "aeis.request": {
            "handlers": ["console"],
            "level": env("KLA_LOG_LEVEL", "INFO"),
            "propagate": False,
        },
        "aeis.jobs": {
            "handlers": ["console"],
            "level": env("KLA_LOG_LEVEL", "INFO"),
            "propagate": False,
        }
    },
}
