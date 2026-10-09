"""Impostazioni di sistema modificabili da dashboard (persistite in system_settings)."""
from __future__ import annotations

from typing import Any

from .audit import audit
from .db import Database, jdump, jload, now_iso

DEFAULTS: dict[str, Any] = {
    "agent.enabled": True,
    "automation.kill_switch": False,          # True = nessuna azione esterna automatica
    "automation.auto_safe_enabled": False,    # si cambia solo con lo sblocco verificato (non da impostazioni)
    "automation.channel_kill": {"facebook": False, "instagram": False},
    "automation.global_max_per_hour": 10,
    "automation.global_max_per_day": 50,
    "ai.languages": ["it", "en"],
    "ai.monthly_budget_eur": 30.0,
    "ai.price_per_mtok_in_eur": 0.0,          # da compilare in base al listino del provider scelto
    "ai.price_per_mtok_out_eur": 0.0,
    "monitoring.default_interval_minutes": 30,
    "crm.retention_days": 365,
    "crm.auto_create_leads": True,
    "brand.name": "INGLY DESIGN",
    "brand.signature": "",                    # es. "— Ingly Design"
    "brand.disclosure": "Rispondo come INGLY DESIGN, realtà indipendente: non siamo xTool.",
    # URL di conversione: vuoti finché l'utente non li configura (mai inventati)
    "cta.contact_url": "",
    "cta.demo_url": "",
    "cta.course_url": "",
    "cta.quote_url": "",
    "escalation.categories": ["complaint", "sensitive", "misinformation"],
    # Domini che le risposte possono linkare
    "response.allowed_link_domains": ["xtool.eu", "xtool.com", "support.xtool.com"],
}


class SettingsStore:
    def __init__(self, db: Database):
        self.db = db

    def get(self, key: str) -> Any:
        r = self.db.one("SELECT value FROM system_settings WHERE key=?", (key,))
        return jload(r["value"]) if r else DEFAULTS.get(key)

    def all(self) -> dict[str, Any]:
        out = dict(DEFAULTS)
        for r in self.db.all("SELECT key, value FROM system_settings"):
            out[r["key"]] = jload(r["value"])
        return out

    PROTECTED = {"automation.auto_safe_enabled"}

    def set(self, key: str, value: Any, user_id: int | None = None, _internal: bool = False) -> None:
        if key in self.PROTECTED and not _internal:
            raise ValueError(f"{key} si modifica solo dalla procedura dedicata")
        if key not in DEFAULTS:
            raise KeyError(f"Impostazione sconosciuta: {key}")
        expected = type(DEFAULTS[key])
        if expected is float and isinstance(value, int):
            value = float(value)
        if not isinstance(value, expected) or (expected is int and isinstance(value, bool)):
            raise ValueError(f"{key}: atteso {expected.__name__}")
        if key.startswith("cta.") and value and not value.startswith("https://"):
            raise ValueError("Gli URL devono iniziare con https://")
        self.db.run("""INSERT INTO system_settings (key,value,updated_at,updated_by) VALUES (?,?,?,?)
                       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at,
                       updated_by=excluded.updated_by""", (key, jdump(value), now_iso(), user_id))
        audit(self.db, f"user:{user_id}" if user_id else "system", "settings.update", "setting", key,
              {"value": value}, user_id)

    def kill_switch_active(self, channel: str | None = None) -> bool:
        if self.get("automation.kill_switch") or not self.get("agent.enabled"):
            return True
        if channel:
            return bool((self.get("automation.channel_kill") or {}).get(channel, False))
        return False
