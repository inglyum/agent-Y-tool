"""Audit log e logging strutturato con redazione dei dati sensibili."""
from __future__ import annotations

import json
import logging
import re
import sqlite3
from typing import Any

from .db import Database, now_iso

_SECRET_KEYS = re.compile(r"(token|secret|password|api_key|apikey|authorization|cookie|access_token)", re.I)
_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_PHONE = re.compile(r"(?<!\d)(?:\+?\d[\d .-]{7,}\d)(?!\d)")
_BEARER = re.compile(r"(Bearer\s+)[A-Za-z0-9._\-]+", re.I)
_URL_TOKEN = re.compile(r"((?:access_token|token|key|secret)=)[^&\s]+", re.I)


def redact(value: Any) -> Any:
    """Rimuove segreti e dati di contatto prima di loggare o salvare nell'audit."""
    if isinstance(value, dict):
        return {k: ("[REDACTED]" if _SECRET_KEYS.search(str(k)) else redact(v)) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [redact(v) for v in value]
    if isinstance(value, str):
        s = _BEARER.sub(r"\1[REDACTED]", value)
        s = _URL_TOKEN.sub(r"\1[REDACTED]", s)
        s = _EMAIL.sub("[email]", s)
        s = _PHONE.sub("[telefono]", s)
        return s
    return value


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {"at": now_iso(), "level": record.levelname, "logger": record.name, "msg": redact(record.getMessage())}
        extra = getattr(record, "data", None)
        if extra:
            payload["data"] = redact(extra)
        if record.exc_info:
            payload["exc"] = redact(self.formatException(record.exc_info))
        return json.dumps(payload, ensure_ascii=False)


def configure_logging(level: int = logging.INFO) -> None:
    h = logging.StreamHandler()
    h.setFormatter(JsonFormatter())
    root = logging.getLogger("ingly")
    root.handlers[:] = [h]
    root.setLevel(level)
    root.propagate = False


log = logging.getLogger("ingly")


def audit(db: Database | sqlite3.Connection, actor: str, action: str, target_type: str | None = None,
          target_id: Any = None, detail: Any = None, user_id: int | None = None) -> None:
    row = (now_iso(), user_id, actor, action, target_type, None if target_id is None else str(target_id),
           json.dumps(redact(detail), ensure_ascii=False) if detail is not None else None)
    sql = "INSERT INTO audit_logs (at,user_id,actor,action,target_type,target_id,detail) VALUES (?,?,?,?,?,?,?)"
    if isinstance(db, sqlite3.Connection):
        db.execute(sql, row)
    else:
        db.run(sql, row)
