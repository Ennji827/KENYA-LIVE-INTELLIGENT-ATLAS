from __future__ import annotations

from django.db.backends.signals import connection_created


def tune_sqlite_connection(sender, connection, **kwargs):
    if connection.vendor != "sqlite":
        return

    with connection.cursor() as cursor:
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA busy_timeout=20000")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA cache_size=-20000")
        cursor.execute("PRAGMA temp_store=MEMORY")
        try:
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA mmap_size=134217728")
        except Exception:
            # In-memory test databases cannot enable every file-backed SQLite optimization.
            pass


connection_created.connect(tune_sqlite_connection, dispatch_uid="aeis_sqlite_tuning")
