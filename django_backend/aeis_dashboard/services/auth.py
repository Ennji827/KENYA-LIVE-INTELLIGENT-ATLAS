from __future__ import annotations

import re
import secrets
from datetime import timedelta

from django.db.models import Q
from django.utils import timezone

from aeis_dashboard.models import AEISUser, AccessSession, AuthAudit, SystemSetting

from . import domain


COUNTY_PERMISSIONS = [
    "county_boundary_read",
    "county_intelligence_read",
    "county_farm_tools",
]

ROLE_PERMISSIONS = {
    AEISUser.Role.MINISTRY: [
        "national_command_center",
        "all_county_read",
        "county_user_manage",
        "report_generate",
        "report_review",
        "report_approve",
        "report_publish",
        "intelligence_use",
        "alert_manage",
        "field_report_verify",
        "audit_read",
        "data_quality_read",
    ],
    AEISUser.Role.ANALYST: [
        "all_county_read",
        "map_intelligence_read",
        "report_read",
        "report_generate",
        "report_review",
        "intelligence_use",
        "weather_read",
        "data_quality_read",
    ],
    AEISUser.Role.COUNTY: [
        *COUNTY_PERMISSIONS,
        "report_read",
        "report_generate",
        "intelligence_use",
        "field_report_read",
        "field_report_verify",
    ],
    AEISUser.Role.FIELD_OFFICER: [
        "county_boundary_read",
        "county_intelligence_read",
        "field_report_create",
        "field_report_read",
        "intelligence_use",
    ],
    AEISUser.Role.FARMER: [
        "own_farm_read",
        "weather_read",
        "field_report_create",
        "intelligence_use_limited",
    ],
    AEISUser.Role.AUDITOR: [
        "audit_read",
        "report_read",
        "data_quality_read",
        "system_health_read",
    ],
    AEISUser.Role.PUBLIC: [
        "intelligence_use_limited",
        "weather_read",
        "report_read",
    ],
}


def slugify(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_") or "county"


def _make_username(email: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "_", email.split("@")[0].lower()).strip("_") or "user"
    username, counter = base, 1
    while AEISUser.objects.filter(username=username).exists():
        username = f"{base}_{counter}"
        counter += 1
    return username


def county_email(name: str) -> str:
    return f"{slugify(name)}@county.aeis-k.local"


def seed_default_accounts() -> dict:
    county_count = AEISUser.objects.filter(role=AEISUser.Role.COUNTY).count()
    national_count = AEISUser.objects.filter(
        role__in=[AEISUser.Role.MINISTRY, AEISUser.Role.ANALYST, AEISUser.Role.AUDITOR]
    ).count()
    if county_count >= 47 and national_count >= 3:
        SystemSetting.objects.get_or_create(
            key="public_access_locked",
            defaults={"value": "1" if domain.public_access_mode() else "0"},
        )
        return {"created": 0, "total": county_count + national_count}

    created = 0
    for feature in domain.counties():
        name = domain.county_name(feature)
        code = domain.county_code(feature)
        user, was_created = AEISUser.objects.get_or_create(
            username=f"{slugify(name)}_county",
            defaults={
                "email": county_email(name),
                "county_code": code,
                "county_name": name,
                "role": AEISUser.Role.COUNTY,
                "provider": "password",
                "is_active": True,
            },
        )
        if was_created:
            user.set_password(domain.DEFAULT_COUNTY_PASSWORD)
            user.save(update_fields=["password"])
            created += 1

    for profile in domain.NATIONAL_AUTH_ACCOUNTS:
        user, was_created = AEISUser.objects.get_or_create(
            username=profile["username"],
            defaults={
                "email": profile["email"],
                "county_code": profile["county_code"],
                "county_name": profile["county_name"],
                "role": profile["role"],
                "provider": profile["provider"],
                "is_active": True,
            },
        )
        changed = False
        for field in ("email", "county_code", "county_name", "role", "provider"):
            if getattr(user, field) != profile[field]:
                setattr(user, field, profile[field])
                changed = True
        if was_created:
            user.set_password(profile["password"])
            created += 1
            changed = True
        if changed:
            user.save()

    SystemSetting.objects.get_or_create(
        key="public_access_locked",
        defaults={"value": "1" if domain.public_access_mode() else "0"},
    )
    return {"created": created, "total": AEISUser.objects.count()}


def _profile(user: AEISUser) -> dict | None:
    return domain.national_account_for_role(user.role)


def _remaining_seconds(expires_at) -> int:
    return max(0, int((expires_at - timezone.now()).total_seconds()))


def session_payload(session: AccessSession) -> dict:
    user = session.user
    full_name = f"{user.first_name} {user.last_name}".strip() or user.username

    if user.role == AEISUser.Role.PUBLIC:
        return {
            "token": session.token,
            "role": user.role,
            "position": user.position,
            "full_name": full_name,
            "county": "",
            "county_code": "",
            "username": user.username,
            "email": user.email,
            "provider": session.provider,
            "command_center": "AEIS-K Public Portal",
            "gps_status": "not_required",
            "boundary_scope": "public_read",
            "permissions": ROLE_PERMISSIONS.get(user.role, []),
            "expires_at": session.expires_at.isoformat(),
            "expires_in_seconds": _remaining_seconds(session.expires_at),
        }

    profile = _profile(user)
    if profile:
        return {
            "token": session.token,
            "role": user.role,
            "county": "",
            "county_code": "",
            "username": user.username,
            "email": user.email,
            "provider": session.provider,
            "command_center": profile["command_center"],
            "gps_status": "not_required",
            "boundary_scope": profile["boundary_scope"],
            "permissions": ROLE_PERMISSIONS.get(user.role, profile["permissions"]),
            "expires_at": session.expires_at.isoformat(),
            "expires_in_seconds": _remaining_seconds(session.expires_at),
        }

    demo = session.provider == "password_demo"
    if user.role == AEISUser.Role.AUDITOR:
        boundary_scope = "national_read_only"
        command_center = "AEIS-K National Audit Workspace"
        gps_status = "not_required"
    elif user.role == AEISUser.Role.FARMER:
        boundary_scope = "own_field_site_only"
        command_center = f"{user.county_name} Field Site Workspace"
        gps_status = "demo_remote_access" if demo else "inside_county"
    elif user.role == AEISUser.Role.FIELD_OFFICER:
        boundary_scope = "assigned_county_field"
        command_center = f"{user.county_name} Field Operations"
        gps_status = "demo_remote_access" if demo else "inside_county"
    else:
        boundary_scope = "county_demo_remote" if demo else "county_only"
        command_center = f"{user.county_name} County Command Center"
        gps_status = "demo_remote_access" if demo else "inside_county"
    return {
        "token": session.token,
        "role": user.role,
        "county": user.county_name,
        "county_code": user.county_code,
        "username": user.username,
        "email": user.email,
        "provider": session.provider,
        "command_center": command_center,
        "gps_status": gps_status,
        "boundary_scope": boundary_scope,
        "demo_remote_access": demo,
        "permissions": ROLE_PERMISSIONS.get(user.role, []),
        "expires_at": session.expires_at.isoformat(),
        "expires_in_seconds": _remaining_seconds(session.expires_at),
    }


def _audit(event_type: str, status: str, payload: dict, **fields) -> None:
    AuthAudit.objects.create(
        event_type=event_type,
        status=status,
        ip_address=payload.get("_client_ip") or None,
        user_agent=payload.get("_user_agent") or "",
        **fields,
    )


def _find_user(identifier: str, roles: list[str], county_code: str | None = None) -> AEISUser | None:
    users = AEISUser.objects.filter(is_active=True, role__in=roles).filter(
        Q(email__iexact=identifier) | Q(username__iexact=identifier)
    )
    if county_code:
        users = users.filter(county_code=county_code)
    return users.first()


def _create_session(user: AEISUser, provider: str, latitude: float, longitude: float) -> AccessSession:
    AccessSession.objects.filter(expires_at__lte=timezone.now()).delete()
    return AccessSession.objects.create(
        token=secrets.token_urlsafe(32),
        user=user,
        provider=provider,
        latitude=latitude,
        longitude=longitude,
        expires_at=timezone.now() + timedelta(seconds=domain.SESSION_SECONDS),
    )


def validate_session(payload: dict) -> tuple[int, dict]:
    token = str(payload.get("token") or "").strip()
    if not token:
        return 400, {"error": "token is required"}
    session = AccessSession.objects.select_related("user").filter(token=token).first()
    if not session:
        return 401, {"error": "County session is not active"}
    if session.expires_at <= timezone.now():
        session.delete()
        return 401, {"error": "County session has expired"}
    return 200, session_payload(session)


def active_session(token: str, roles: list[str] | None = None) -> AccessSession | None:
    if not token:
        return None
    session = AccessSession.objects.select_related("user").filter(
        token=token,
        expires_at__gt=timezone.now(),
        user__is_active=True,
    ).first()
    if session and roles and session.user.role not in roles:
        return None
    return session


def session_has_permission(session: AccessSession | None, permission: str) -> bool:
    return bool(session and permission in ROLE_PERMISSIONS.get(session.user.role, []))


def logout_session(payload: dict) -> tuple[int, dict]:
    token = str(payload.get("token") or "").strip()
    if not token:
        return 400, {"error": "token is required"}
    session = AccessSession.objects.select_related("user").filter(token=token).first()
    if session:
        user = session.user
        _audit(
            "logout",
            "success",
            payload,
            county_code=user.county_code,
            county_name=user.county_name,
            username=user.username,
            email=user.email,
            role=user.role,
            provider=session.provider,
            latitude=session.latitude,
            longitude=session.longitude,
        )
        session.delete()
    return 200, {"status": "signed_out"}


def update_public_access(payload: dict) -> tuple[int, dict]:
    token = str(payload.get("token") or "").strip()
    session = AccessSession.objects.select_related("user").filter(
        token=token, expires_at__gt=timezone.now()
    ).first()
    if not session:
        return 401, {"error": "A valid Ministry session token is required"}
    if session.user.role != AEISUser.Role.MINISTRY:
        return 403, {"error": "Only Ministry command sessions can change public access lock"}
    locked = bool(payload.get("locked", True))
    domain.set_system_setting("public_access_locked", "1" if locked else "0")
    _audit(
        "public_access_lock",
        "success",
        payload,
        county_code=session.user.county_code,
        county_name=session.user.county_name,
        username=session.user.username,
        email=session.user.email,
        role=session.user.role,
        provider=session.provider,
        reason="locked" if locked else "unlocked",
    )
    return 200, {
        "status": "locked" if locked else "unlocked",
        "public_access": domain.system_access_payload()["public_access"],
        "generated_at": domain.now_iso(),
    }


def county_login_accounts() -> list[dict]:
    seed_default_accounts()
    return [
        {
            "county": user.county_name,
            "county_code": user.county_code,
            "username": user.username,
            "email": user.email,
            "role": user.role,
            "provider": user.provider,
            "is_active": user.is_active,
            "command_center": f"{user.county_name} County Command Center",
            "boundary_scope": "county_only",
            "gps_required": True,
            "created_at": user.date_joined.isoformat(),
        }
        for user in AEISUser.objects.filter(role=AEISUser.Role.COUNTY).order_by("county_code")
    ]


def national_login_accounts() -> list[dict]:
    seed_default_accounts()
    accounts = []
    for user in AEISUser.objects.filter(
        role__in=[AEISUser.Role.MINISTRY, AEISUser.Role.ANALYST, AEISUser.Role.AUDITOR]
    ):
        profile = _profile(user) or {}
        accounts.append(
            {
                "county": user.county_name,
                "county_code": user.county_code,
                "username": user.username,
                "email": user.email,
                "role": user.role,
                "provider": user.provider,
                "is_active": user.is_active,
                "command_center": profile.get("command_center", "AEIS-K National Access"),
                "boundary_scope": profile.get("boundary_scope", "national"),
                "permissions": profile.get("permissions", []),
                "created_at": user.date_joined.isoformat(),
            }
        )
    return accounts


def access_model_payload() -> dict:
    county_accounts = county_login_accounts()
    national_accounts = national_login_accounts()
    reveal = domain.show_demo_credentials()
    return {
        "auth_model": "django_role_based_access_control",
        "storage": "Django ORM",
        "session_seconds": domain.SESSION_SECONDS,
        "county_password": domain.DEFAULT_COUNTY_PASSWORD if reveal else "",
        "national_passwords": {
            profile["role"]: profile["password"] if reveal else ""
            for profile in domain.NATIONAL_AUTH_ACCOUNTS
        },
        "roles": [
            {"role": "ministry", "label": "Ministry command officer", "scope": "National command center", "permissions": domain.national_account_for_role("ministry")["permissions"]},
            {"role": "analyst", "label": "National intelligence analyst", "scope": "National read-only intelligence", "permissions": domain.national_account_for_role("analyst")["permissions"]},
            {"role": "county", "label": "County officer", "scope": "Locked county workspace", "permissions": ROLE_PERMISSIONS[AEISUser.Role.COUNTY]},
            {"role": "field_officer", "label": "Field officer", "scope": "Assigned county field operations", "permissions": ROLE_PERMISSIONS[AEISUser.Role.FIELD_OFFICER]},
            {"role": "farmer", "label": "Farmer / user", "scope": "Own or assigned farm", "permissions": ROLE_PERMISSIONS[AEISUser.Role.FARMER]},
            {"role": "auditor", "label": "Auditor", "scope": "National read-only audit", "permissions": ROLE_PERMISSIONS[AEISUser.Role.AUDITOR]},
        ],
        "national_accounts": national_accounts,
        "county_accounts": county_accounts,
        "county_account_count": len(county_accounts),
        "audit": {"enabled": True, "events": ["login", "logout", "invalid_credentials", "outside_county_geofence"]},
    }


def register_user(payload: dict) -> tuple[int, dict]:
    first_name = str(payload.get("first_name") or "").strip()
    last_name = str(payload.get("last_name") or "").strip()
    email = str(payload.get("email") or "").strip().lower()
    password = str(payload.get("password") or "")
    position = str(payload.get("position") or "").strip()

    if not first_name or not email or not password:
        return 400, {"error": "first_name, email, and password are required"}
    if len(password) < 8:
        return 400, {"error": "Password must be at least 8 characters"}
    valid_positions = [p[0] for p in AEISUser.Position.choices]
    if position not in valid_positions:
        return 400, {"error": f"position must be one of: {', '.join(valid_positions)}"}
    if AEISUser.objects.filter(email__iexact=email).exists():
        return 409, {"error": "An account with this email already exists"}

    username = _make_username(email)
    user = AEISUser(
        username=username,
        email=email,
        first_name=first_name,
        last_name=last_name,
        role=AEISUser.Role.PUBLIC,
        position=position,
        provider="password",
        is_active=True,
    )
    user.set_password(password)
    user.save()
    session = _create_session(user, "password", 0, 0)
    _audit("register", "success", payload, email=email, username=username, role="public", provider="password")
    return 201, session_payload(session)


def authenticate_public_login(payload: dict) -> tuple[int, dict]:
    email = str(payload.get("email") or "").strip()
    password = str(payload.get("password") or "")

    if not email or not password:
        return 400, {"error": "email and password are required"}

    user = _find_user(email, [AEISUser.Role.PUBLIC])
    if not user or not user.check_password(password):
        _audit("login", "failed", payload, email=email, role="public", provider="password", reason="invalid_credentials")
        return 401, {"error": "Invalid email or password"}

    session = _create_session(user, "password", 0, 0)
    _audit("login", "success", payload, email=user.email, username=user.username, role=user.role, provider="password")
    return 200, session_payload(session)


def authenticate_google_login(payload: dict) -> tuple[int, dict]:
    import json as _json
    import urllib.error
    import urllib.request

    id_token = str(payload.get("id_token") or "").strip()
    position = str(payload.get("position") or "").strip()

    if not id_token:
        return 400, {"error": "Google id_token is required"}

    try:
        url = f"https://oauth2.googleapis.com/tokeninfo?id_token={id_token}"
        with urllib.request.urlopen(url, timeout=8) as resp:
            google_data = _json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        try:
            body = _json.loads(exc.read())
            return 401, {"error": body.get("error_description", "Invalid Google token")}
        except Exception:
            return 401, {"error": "Invalid Google token"}
    except Exception as exc:
        return 401, {"error": f"Google token verification failed: {exc}"}

    if "error" in google_data:
        return 401, {"error": "Invalid Google token"}

    email = google_data.get("email", "").lower()
    if not email or not google_data.get("email_verified"):
        return 401, {"error": "Google account email is not verified"}

    first_name = google_data.get("given_name", "")
    last_name = google_data.get("family_name", "")

    user = AEISUser.objects.filter(email__iexact=email).first()
    if user:
        staff_roles = {AEISUser.Role.MINISTRY, AEISUser.Role.COUNTY, AEISUser.Role.ANALYST, AEISUser.Role.AUDITOR, AEISUser.Role.FIELD_OFFICER}
        if user.role in staff_roles:
            return 403, {"error": "Staff accounts cannot sign in with Google. Use your assigned credentials."}
        if not user.is_active:
            return 403, {"error": "Your account has been deactivated"}
    else:
        valid_positions = [p[0] for p in AEISUser.Position.choices]
        if position not in valid_positions:
            position = ""
        username = _make_username(email)
        user = AEISUser(
            username=username,
            email=email,
            first_name=first_name,
            last_name=last_name,
            role=AEISUser.Role.PUBLIC,
            position=position,
            provider="google",
            is_active=True,
        )
        user.set_unusable_password()
        user.save()

    session = _create_session(user, "google", 0, 0)
    _audit("login", "success", payload, email=user.email, username=user.username, role=user.role, provider="google")
    return 200, session_payload(session)


def audit_log(limit: int = 80) -> list[dict]:
    limit = max(1, min(300, int(limit)))
    fields = [
        "event_type", "status", "county_code", "county_name", "username", "email",
        "role", "provider", "latitude", "longitude", "ip_address", "reason", "created_at",
    ]
    return [
        {**row, "created_at": row["created_at"].isoformat()}
        for row in AuthAudit.objects.values(*fields)[:limit]
    ]
