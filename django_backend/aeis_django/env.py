"""Environment-variable access with legacy-name fallback.

Configuration is read under the ``KLA_`` prefix (Kenya Live Atlas). The project
shipped as AEIS-K, so every name also resolves from its old ``AEIS_`` spelling:
an existing ``.env``, systemd unit, or CI secret store keeps working untouched
and can be migrated at its own pace. Each legacy name that is actually used
raises a ``DeprecationWarning`` once per process so the fallback stays visible
rather than becoming permanent.

Pure stdlib on purpose — ``settings`` imports this before Django is configured.
"""

import os
import warnings

PREFIX = "KLA_"
LEGACY_PREFIX = "AEIS_"

_legacy_warned: set[str] = set()


def legacy_name(name: str) -> str | None:
    """The pre-rename spelling of ``name``, or ``None`` if it has no ``KLA_`` prefix."""
    if not name.startswith(PREFIX):
        return None
    return LEGACY_PREFIX + name[len(PREFIX) :]


def env(name: str, default: str | None = None) -> str | None:
    """Read ``name``, falling back to its legacy ``AEIS_`` spelling.

    An empty-but-present variable wins over the fallback and over ``default`` —
    setting ``KLA_CORS_ALLOWED_ORIGIN=`` deliberately clears the value.
    """

    value = os.environ.get(name)
    if value is not None:
        return value

    legacy = legacy_name(name)
    if legacy is not None:
        value = os.environ.get(legacy)
        if value is not None:
            if legacy not in _legacy_warned:
                _legacy_warned.add(legacy)
                warnings.warn(
                    f"{legacy} is deprecated; rename it to {name}.",
                    DeprecationWarning,
                    stacklevel=2,
                )
            return value

    return default


def env_is_set(name: str) -> bool:
    """True when ``name`` (or its legacy spelling) is present, even if empty."""
    return env(name) is not None


def env_flag(name: str, default: bool = False) -> bool:
    value = env(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}
