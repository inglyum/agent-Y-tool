"""Accesso al database: PostgreSQL (produzione, con pgvector) o SQLite (sviluppo e test).

Il codice applicativo scrive SQL portabile con segnaposto `?`; per PostgreSQL questo modulo traduce
segnaposto, `INSERT OR IGNORE` e recupera l'id inserito con `RETURNING id`.
"""
from __future__ import annotations

import json
import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator

MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"
# Tabelle senza colonna id: niente RETURNING id
NO_ID_TABLES = {"role_permissions", "sessions", "system_settings", "rate_limits", "job_schedules", "schema_migrations"}
_INSERT_TABLE = re.compile(r"^\s*INSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+(\w+)", re.I)


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
    return None if v is None else json.dumps(v, ensure_ascii=False, default=str)


def jload(s: str | None, default: Any = None) -> Any:
    if s in (None, ""):
        return default
    try:
        return json.loads(s)
    except (TypeError, ValueError):
        return default


def to_pg(sql: str) -> tuple[str, bool]:
    """Traduce SQL portabile in SQL PostgreSQL. Ritorna (sql, aggiunto_returning_id)."""
    s = sql.replace("%", "%%").replace("?", "%s")
    ignore = re.match(r"^\s*INSERT\s+OR\s+IGNORE\s+INTO", s, re.I) is not None
    if ignore:
        s = re.sub(r"INSERT\s+OR\s+IGNORE\s+INTO", "INSERT INTO", s, count=1, flags=re.I).rstrip().rstrip(";")
        s += " ON CONFLICT DO NOTHING"
    m = _INSERT_TABLE.match(sql)
    returning = bool(m and m.group(1).lower() not in NO_ID_TABLES and not re.search(r"\bRETURNING\b", s, re.I))
    if returning:
        s = s.rstrip().rstrip(";") + " RETURNING id"
    return s, returning


class Row(dict):
    """Riga accessibile per nome o per indice (come sqlite3.Row)."""
    __slots__ = ("_vals",)

    def __init__(self, cols, vals):
        super().__init__(zip(cols, vals))
        self._vals = vals

    def __getitem__(self, k):
        return self._vals[k] if isinstance(k, int) else super().__getitem__(k)


class Cursor:
    def __init__(self, rows: list | None, lastrowid: int, rowcount: int):
        self._rows = rows or []
        self.lastrowid = lastrowid
        self.rowcount = rowcount

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def fetchall(self):
        return list(self._rows)


class Conn:
    """Connessione con la stessa interfaccia per i due database."""

    def __init__(self, raw, dialect: str):
        self.raw = raw
        self.dialect = dialect

    def execute(self, sql: str, params: tuple | list | dict = ()) -> Cursor:
        if self.dialect == "sqlite":
            cur = self.raw.execute(sql, params)
            rows = cur.fetchall() if cur.description else None
            return Cursor(rows, cur.lastrowid or 0, cur.rowcount)
        pg_sql, returning = to_pg(sql)
        cur = self.raw.execute(pg_sql, params)
        rows = None
        if cur.description:
            cols = [d.name for d in cur.description]
            rows = [Row(cols, r) for r in cur.fetchall()]
        lastrowid = 0
        if returning:
            lastrowid = rows[0]["id"] if rows else 0
            rows = None
        return Cursor(rows, lastrowid, cur.rowcount)

    def executescript(self, script: str) -> None:
        if self.dialect == "sqlite":
            self.raw.executescript(script)
        else:
            self.raw.execute(script)


class Database:
    def __init__(self, url: str):
        self.url = url
        self.dialect = "postgres" if url.startswith(("postgres://", "postgresql://")) else "sqlite"
        self._uri = False
        self.path = url
        if self.dialect == "sqlite":
            if url == ":memory:":
                # URI condiviso: più connessioni vedono gli stessi dati in memoria
                self.path = f"file:ingly_mem_{id(self)}?mode=memory&cache=shared"
                self._uri = True
                self._keepalive = self._open_sqlite()
            else:
                Path(url).parent.mkdir(parents=True, exist_ok=True)

    @property
    def is_postgres(self) -> bool:
        return self.dialect == "postgres"

    def _open_sqlite(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, uri=self._uri, timeout=30, check_same_thread=False, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA busy_timeout = 30000")
        if not self._uri:
            conn.execute("PRAGMA journal_mode = WAL")
        return conn

    def _open(self) -> Conn:
        if self.dialect == "sqlite":
            return Conn(self._open_sqlite(), "sqlite")
        import psycopg
        return Conn(psycopg.connect(self.url, autocommit=True), "postgres")

    @contextmanager
    def connect(self) -> Iterator[Conn]:
        c = self._open()
        try:
            yield c
        finally:
            c.raw.close()

    @contextmanager
    def tx(self) -> Iterator[Conn]:
        """Transazione: IMMEDIATE su SQLite (lock in scrittura subito), standard su PostgreSQL."""
        with self.connect() as c:
            c.raw.execute("BEGIN IMMEDIATE" if self.dialect == "sqlite" else "BEGIN")
            try:
                yield c
                c.raw.execute("COMMIT")
            except BaseException:
                c.raw.execute("ROLLBACK")
                raise

    def migrate(self) -> list[str]:
        applied: list[str] = []
        folder = MIGRATIONS_DIR / self.dialect
        with self.connect() as c:
            c.raw.execute("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)")
            done = {r[0] for r in c.execute("SELECT name FROM schema_migrations").fetchall()}
            for f in sorted(folder.glob("*.sql")):
                if f.name in done:
                    continue
                if self.dialect == "sqlite":
                    c.raw.executescript("BEGIN;" + f.read_text() +
                                        f"\nINSERT INTO schema_migrations VALUES ('{f.name}', '{now_iso()}');COMMIT;")
                else:
                    with c.raw.transaction():
                        c.raw.execute(f.read_text())
                        c.raw.execute("INSERT INTO schema_migrations VALUES (%s, %s)", (f.name, now_iso()))
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
        """INSERT → id della riga inserita (0 se ignorata); altri comandi → righe modificate."""
        with self.connect() as c:
            cur = c.execute(sql, params)
            return cur.lastrowid if cur.lastrowid else cur.rowcount
