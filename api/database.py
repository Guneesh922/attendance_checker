"""
api/database.py
──────────────
Single point of truth for PostgreSQL connections.
All backend.py SQL calls route through get_conn().
DATABASE_URL is set as a Railway environment variable:
  postgresql://user:pass@host:5432/dbname
"""

import os
import psycopg2
import psycopg2.extras
from contextlib import contextmanager

DATABASE_URL = os.environ["DATABASE_URL"]


def get_conn() -> psycopg2.extensions.connection:
    """Return a new psycopg2 connection with RealDictCursor as default."""
    return psycopg2.connect(
        DATABASE_URL
    )


@contextmanager
def db():
    """
    Context manager for a single database transaction.
    Usage:
        with db() as (conn, cur):
            cur.execute(...)
    Commits on success, rolls back on any exception, always closes the connection.
    """
    conn = get_conn()
    try:
        cur = conn.cursor()
        yield conn, cur
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
