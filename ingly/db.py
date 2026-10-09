"""Accesso SQLite con migrazioni versionate."""
from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator

MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def now_iso(delta: timedelta | None = None) -> str:
    t = utcnow() + (delta or timedelta())
    return t.isoformat(timespec="seconds")


def parse_iso(s: str | None) -> datetime | None:
    if not s:
        return None
    d = datetime.fromisoformat(s)
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def jdump(v: Any) -> str | None:
    return None if v is None else json.dumps(v, ensure_ascii=False)


def jload(s: str | None, default: Any = None) -> Any:
    if s in (None, ""):
        return default
    try:
        return json.loads(s)
    except (TypeError, ValueError):
        return default


class Database:
    def __init__(self, path: str):
        self.path = path
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        # Per ":memory:" usiamo un URI condiviso così più connessioni vedono gli stessi dati.
        self._uri = path == ":memory:"
        if self._uri:
            self.path = f"file:ingly_mem_{id(self)}?mode=memory&cache=shared"
            self._keepalive = self._open()

    def _open(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, uri=self._uri, timeout=30, check_same_thread=False,
                               isolation_level=None)  # autocommit; transazioni esplicite
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA busy_timeout = 30000")
        if not self._uri:
            conn.execute("PRAGMA journal_mode = WAL")
        return conn

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        conn = self._open()
        try:
            yield conn
        finally:
            conn.close()

    @contextmanager
    def tx(self) -> Iterator[sqlite3.Connection]:
        """Transazione IMMEDIATE: blocca in scrittura subito, evita race tra worker."""
        with self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                yield conn
                conn.execute("COMMIT")
            except BaseException:
                conn.execute("ROLLBACK")
                raise

    def migrate(self) -> list[str]:
        applied: list[str] = []
        with self.connect() as conn:
            conn.execute("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)")
            done = {r[0] for r in conn.execute("SELECT name FROM schema_migrations")}
            for f in sorted(MIGRATIONS_DIR.glob("*.sql")):
                if f.name in done:
                    continue
                conn.executescript("BEGIN;" + f.read_text() +
                                   f"\nINSERT INTO schema_migrations VALUES ('{f.name}', '{now_iso()}');COMMIT;")
                applied.append(f.name)
        return applied

    # Helper di comodo
    def one(self, sql: str, params: tuple | dict = ()) -> dict | None:
        with self.connect() as c:
            r = c.execute(sql, params).fetchone()
            return dict(r) if r else None

    def all(self, sql: str, params: tuple | dict = ()) -> list[dict]:
        with self.connect() as c:
            return [dict(r) for r in c.execute(sql, params).fetchall()]

    def run(self, sql: str, params: tuple | dict = ()) -> int:
        with self.connect() as c:
            cur = c.execute(sql, params)
            return cur.lastrowid if cur.lastrowid else cur.rowcount
