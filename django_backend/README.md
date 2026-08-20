# Kenya Live Atlas Django Backend

This is the only Kenya Live Atlas backend. It owns API routing, authentication, sessions, audit records, system settings, GIS services, data quality, weather integration, AI intelligence, report workflows, user management, field reports, and frontend delivery.

SQLite with WAL is the local default. The control script stores the local SQLite database at `%LOCALAPPDATA%\AEIS-K\aeis-live.sqlite3` unless `KLA_DB_PATH` is set. Set `KLA_DB_ENGINE=postgresql` plus the `KLA_DB_*` variables for a PostgreSQL deployment. The request middleware emits structured JSON logs with request IDs and timing.

## Environment variables

Configuration is read under the `KLA_` prefix. The pre-rename `AEIS_` spelling of
every variable still resolves as a fallback, so existing `.env` files and
deployment configs keep working — each legacy name that is used raises a
`DeprecationWarning` once at startup naming its replacement. Run with
`python -W error::DeprecationWarning manage.py check` to fail loudly on any that
remain, and drop the fallback in `aeis_django/env.py` once every deployment has
migrated.

Run from the repository root:

```powershell
.\start.ps1
```

The API remains under `/api/...`; the health endpoint is `/health`.
