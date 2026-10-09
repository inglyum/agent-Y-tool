"""Motore di regole per le automazioni: modalità per categoria/canale, soglie, kill switch, limiti."""
from __future__ import annotations

from dataclasses import dataclass, field

from ..audit import audit
from ..db import Database, now_iso
from ..security import rate_limit_count
from ..settings_store import SettingsStore

MODES = ("OFF", "MONITOR", "DRAFT", "APPROVAL", "AUTO_SAFE")
POLICY_CATEGORIES = ["technical", "compatibility", "price", "commercial", "demo_course", "problem", "complaint",
                     "misinformation", "sensitive", "spam", "other"]
# Default prudenti: nessuna pubblicazione automatica finché l'utente non la abilita.
DEFAULT_MODES = {c: "APPROVAL" for c in POLICY_CATEGORIES}
DEFAULT_MODES.update({"spam": "MONITOR", "other": "MONITOR"})
# Categorie per cui AUTO_SAFE non è mai ammesso, qualunque sia la configurazione.
NEVER_AUTO = {"complaint", "sensitive", "misinformation", "spam", "price"}


@dataclass
class Decision:
    action: str                      # ignore | monitor | draft | review | publish
    mode: str
    reasons: list[str] = field(default_factory=list)
    include_cta: bool = False


def seed_rules(db: Database) -> None:
    for cat, mode in DEFAULT_MODES.items():
        db.run("""INSERT OR IGNORE INTO automation_rules (category,channel,mode,include_cta,updated_at)
                  VALUES (?,?,?,?,?)""", (cat, "*", mode, 1 if cat in ("commercial", "demo_course") else 0, now_iso()))


class PolicyEngine:
    def __init__(self, db: Database, settings: SettingsStore):
        self.db = db
        self.settings = settings

    def rule(self, category: str, channel: str) -> dict:
        r = (self.db.one("SELECT * FROM automation_rules WHERE category=? AND channel=?", (category, channel))
             or self.db.one("SELECT * FROM automation_rules WHERE category=? AND channel='*'", (category,)))
        return r or {"category": category, "channel": "*", "mode": "APPROVAL", "min_confidence": 0.85,
                     "min_evidence": 0.6, "max_per_hour": 5, "max_per_day": 30, "include_cta": 0}

    def set_rule(self, category: str, channel: str, mode: str, user_id: int | None = None, **thresholds) -> None:
        if mode not in MODES:
            raise ValueError(f"Modalità non valida: {mode}")
        if category not in POLICY_CATEGORIES:
            raise ValueError(f"Categoria non valida: {category}")
        if mode == "AUTO_SAFE" and category in NEVER_AUTO:
            raise ValueError(f"La categoria '{category}' richiede sempre revisione umana")
        for k in ("min_confidence", "min_evidence"):
            if k in thresholds and not 0 <= float(thresholds[k]) <= 1:
                raise ValueError(f"{k} deve essere tra 0 e 1")
        cur = self.rule(category, channel)
        vals = {k: thresholds.get(k, cur.get(k)) for k in ("min_confidence", "min_evidence", "max_per_hour", "max_per_day", "include_cta")}
        self.db.run("""INSERT INTO automation_rules (category,channel,mode,min_confidence,min_evidence,max_per_hour,max_per_day,include_cta,updated_at)
                       VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(category,channel) DO UPDATE SET mode=excluded.mode,
                       min_confidence=excluded.min_confidence, min_evidence=excluded.min_evidence, max_per_hour=excluded.max_per_hour,
                       max_per_day=excluded.max_per_day, include_cta=excluded.include_cta, updated_at=excluded.updated_at""",
                    (category, channel, mode, vals["min_confidence"], vals["min_evidence"], vals["max_per_hour"],
                     vals["max_per_day"], int(bool(vals["include_cta"])), now_iso()))
        audit(self.db, f"user:{user_id}" if user_id else "system", "automation.rule.update", "rule", f"{category}/{channel}",
              {"mode": mode, **vals}, user_id)

    def pre_decision(self, category: str, channel: str) -> Decision:
        """Decide se generare una bozza (prima di chiamare l'AI, per non sprecare budget)."""
        r = self.rule(category, channel)
        mode = r["mode"]
        if mode == "OFF":
            return Decision("ignore", mode, ["Regola OFF per la categoria"])
        if mode == "MONITOR":
            return Decision("monitor", mode, ["Solo monitoraggio per la categoria"])
        return Decision("draft", mode, include_cta=bool(r["include_cta"]))

    def decide(self, *, category: str, channel: str, risk_flags: list[str], confidence: float, evidence: float,
               validation_errors: list[str], needs_clarification: bool, connector_can_publish: bool,
               connector_authenticated: bool, already_published: bool) -> Decision:
        r = self.rule(category, channel)
        mode = r["mode"]
        base = self.pre_decision(category, channel)
        if base.action != "draft":
            return base
        if mode == "DRAFT":
            return Decision("draft", mode, ["Modalità DRAFT: solo bozza"], bool(r["include_cta"]))
        reasons: list[str] = []
        if mode == "APPROVAL":
            reasons.append("Modalità APPROVAL: serve approvazione umana")
        if category in NEVER_AUTO:
            reasons.append(f"Categoria '{category}' sempre in revisione")
        if category in (self.settings.get("escalation.categories") or []):
            reasons.append("Categoria soggetta a escalation")
        if self.settings.kill_switch_active():
            reasons.append("Kill switch globale attivo")
        if self.settings.kill_switch_active(channel):
            reasons.append(f"Kill switch attivo per {channel}")
        if not connector_authenticated:
            reasons.append("Connettore non autenticato")
        if not connector_can_publish:
            reasons.append("Il canale non consente la pubblicazione via API")
        if already_published:
            reasons.append("Risposta già pubblicata per questo elemento")
        if risk_flags:
            reasons.append("Segnali di rischio: " + ", ".join(risk_flags))
        if validation_errors:
            reasons.append("Validazione non superata: " + "; ".join(validation_errors))
        if needs_clarification:
            reasons.append("La risposta chiede chiarimenti: meglio revisione")
        if confidence < float(r["min_confidence"]):
            reasons.append(f"Confidenza {confidence:.2f} sotto soglia {r['min_confidence']}")
        if evidence < float(r["min_evidence"]):
            reasons.append(f"Copertura fonti {evidence:.2f} sotto soglia {r['min_evidence']}")
        if self.publish_quota_exceeded(channel, r):
            reasons.append("Limite di pubblicazioni raggiunto")
        if reasons:
            return Decision("review", mode, reasons, bool(r["include_cta"]))
        return Decision("publish", mode, ["Tutte le condizioni AUTO_SAFE soddisfatte"], bool(r["include_cta"]))

    def publish_quota_exceeded(self, channel: str, rule: dict | None = None) -> bool:
        rule = rule or {"max_per_hour": 10 ** 9, "max_per_day": 10 ** 9}
        h = rate_limit_count(self.db, f"publish:{channel}:h", 3600)
        d = rate_limit_count(self.db, f"publish:{channel}:d", 86400)
        gh = rate_limit_count(self.db, "publish:*:h", 3600)
        gd = rate_limit_count(self.db, "publish:*:d", 86400)
        return (h >= int(rule["max_per_hour"]) or d >= int(rule["max_per_day"])
                or gh >= int(self.settings.get("automation.global_max_per_hour"))
                or gd >= int(self.settings.get("automation.global_max_per_day")))
