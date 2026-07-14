import os
import secrets
import sys
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parents[1]
PROJECT_ROOT = BASE_DIR.parent
RUNTIME_DIR = PROJECT_ROOT / ".runtime"
RUNTIME_DIR.mkdir(exist_ok=True)
CACHE_DIR = RUNTIME_DIR / "cache"
CACHE_DIR.mkdir(exist_ok=True)

DEBUG = os.environ.get("AEIS_DJANGO_DEBUG", "1").lower() in {"1", "true", "yes", "on"}
SECRET_KEY = os.environ.get("AEIS_DJANGO_SECRET_KEY", "")
if not SECRET_KEY:
    if not DEBUG:
        raise RuntimeError("AEIS_DJANGO_SECRET_KEY must be set when AEIS_DJANGO_DEBUG=0.")
    secret_path = RUNTIME_DIR / "django-secret-key"
    if secret_path.exists():
        SECRET_KEY = secret_path.read_text(encoding="utf-8").strip()
    else:
        SECRET_KEY = secrets.token_urlsafe(64)
        secret_path.write_text(SECRET_KEY, encoding="utf-8")

default_hosts = "localhost,127.0.0.1,[::1],*" if DEBUG else "localhost,127.0.0.1,[::1]"
ALLOWED_HOSTS = [
    host.strip()
    for host in os.environ.get("AEIS_ALLOWED_HOSTS", default_hosts).split(",")
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

database_engine = os.environ.get("AEIS_DB_ENGINE", "sqlite").strip().lower()
if database_engine in {"postgres", "postgresql", "postgis"}:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": os.environ.get("AEIS_DB_NAME", "aeis_k"),
            "USER": os.environ.get("AEIS_DB_USER", "aeis_k"),
            "PASSWORD": os.environ.get("AEIS_DB_PASSWORD", ""),
            "HOST": os.environ.get("AEIS_DB_HOST", "127.0.0.1"),
            "PORT": os.environ.get("AEIS_DB_PORT", "5432"),
            "CONN_MAX_AGE": int(os.environ.get("AEIS_DB_CONN_MAX_AGE", "60")),
            "CONN_HEALTH_CHECKS": True,
            "OPTIONS": {
                "sslmode": os.environ.get("AEIS_DB_SSLMODE", "prefer"),
            },
        }
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": os.environ.get("AEIS_DB_PATH", str(RUNTIME_DIR / "aeis.sqlite3")),
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
SECURE_SSL_REDIRECT = os.environ.get("AEIS_SECURE_SSL_REDIRECT", "0").lower() in {"1", "true", "yes", "on"}
SECURE_HSTS_SECONDS = int(os.environ.get("AEIS_SECURE_HSTS_SECONDS", "0"))
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

CORS_ALLOWED_ORIGIN = os.environ.get("AEIS_CORS_ALLOWED_ORIGIN", "").strip()

# ── M-PESA / Safaricom Daraja payment gateway ───────────────────────────
# When the consumer key/secret/passkey are absent the payment service runs
# in simulation mode so the report-payment flow is fully demoable.
MPESA_ENV = os.environ.get("AEIS_MPESA_ENV", "sandbox").strip().lower()
MPESA_CONSUMER_KEY = os.environ.get("AEIS_MPESA_CONSUMER_KEY", "").strip()
MPESA_CONSUMER_SECRET = os.environ.get("AEIS_MPESA_CONSUMER_SECRET", "").strip()
MPESA_SHORTCODE = os.environ.get("AEIS_MPESA_SHORTCODE", "174379").strip()
MPESA_PAYBILL = os.environ.get("AEIS_MPESA_PAYBILL", "").strip() or MPESA_SHORTCODE
MPESA_PASSKEY = os.environ.get("AEIS_MPESA_PASSKEY", "").strip()
MPESA_CALLBACK_URL = os.environ.get("AEIS_MPESA_CALLBACK_URL", "").strip()
MPESA_ACCOUNT_PREFIX = os.environ.get("AEIS_MPESA_ACCOUNT_PREFIX", "AEISK").strip()
MPESA_BUSINESS_NAME = os.environ.get("AEIS_MPESA_BUSINESS_NAME", "Kenya Space Agency").strip()
try:
    REPORT_PRICE_KES = int(os.environ.get("AEIS_REPORT_PRICE_KES", "50"))
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
            "level": os.environ.get("AEIS_LOG_LEVEL", "INFO"),
            "propagate": False,
        },
        "aeis.jobs": {
            "handlers": ["console"],
            "level": os.environ.get("AEIS_LOG_LEVEL", "INFO"),
            "propagate": False,
        }
    },
}
