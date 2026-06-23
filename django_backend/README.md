# AEIS-K Django Backend

This is the only AEIS-K backend. It owns API routing, authentication, sessions, audit records, system settings, GIS services, data quality, weather integration, AI intelligence, report workflows, user management, field reports, and frontend delivery.

SQLite with WAL is the local default. Set `AEIS_DB_ENGINE=postgresql` plus the `AEIS_DB_*` variables for a PostgreSQL deployment. The request middleware emits structured JSON logs with request IDs and timing.

Run from the repository root:

```powershell
.\start.ps1
```

The API remains under `/api/...`; the health endpoint is `/health`.
