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
# Modalità iniziale DRAFT: solo bozze. Spam e post senza domanda vengono solo classificati.
DEFAULT_MODES = {c: "DRAFT" for c in POLICY_CATEGORIES}
DEFAULT_MODES.update({"spam": "MONITOR", "other": "MONITOR"})
# Errori di validazione che bloccano qualsiasi pubblicazione, anche approvata da una persona.
BLOCKING_ERRORS = ("affiliazione", "sicurezza", "istruzioni interne", "Link non consentito")
# Requisiti per sbloccare AUTO_SAFE
AUTO_SAFE_REQUIREMENTS = {"max_age_days": 7, "decision_accuracy": 0.9, "category_accuracy": 0.85,
                          "unsupported_rate": 0.05, "forbidden_term_violations": 0, "min_cases": 10}
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
        if mode == "AUTO_SAFE" and not self.settings.get("automation.auto_safe_enabled"):
            reasons.append("AUTO_SAFE non abilitato: serve una valutazione superata (Automazioni → Sblocca AUTO_SAFE)")
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

    # ---------- autorizzazione lato server di ogni pubblicazione ----------
    def authorize_publish(self, *, category: str | None, channel: str, actor: str, draft_status: str,
                          draft_decision: str, validation_errors: list[str]) -> None:
        """Solleva PermissionError se la pubblicazione non è consentita. Chiamata per OGNI pubblicazione."""
        if self.settings.kill_switch_active() or self.settings.kill_switch_active(channel):
            raise PermissionError("Kill switch attivo: pubblicazione bloccata")
        mode = self.rule(category or "other", channel)["mode"]
        if mode in ("OFF", "MONITOR"):
            raise PermissionError(f"Modalità {mode} per '{category}': nessuna azione esterna consentita")
        if mode == "DRAFT":
            raise PermissionError(f"Modalità DRAFT per '{category}': la bozza va pubblicata a mano sulla piattaforma")
        blocking = [e for e in validation_errors if any(b in e for b in BLOCKING_ERRORS)]
        if blocking:
            raise PermissionError("Errori bloccanti: " + "; ".join(blocking))
        if actor == "system:auto":
            if mode != "AUTO_SAFE" or not self.settings.get("automation.auto_safe_enabled") or draft_decision != "publish":
                raise PermissionError("Pubblicazione automatica non autorizzata dalla policy")
        elif actor.startswith("user:"):
            if draft_status != "approved":
                raise PermissionError("Serve l'approvazione esplicita della bozza prima di pubblicare")
        else:
            raise PermissionError("Attore non riconosciuto")
        if self.publish_quota_exceeded(channel, self.rule(category or "other", channel)):
            raise PermissionError("Limite di pubblicazioni raggiunto per il canale")

    def auto_safe_readiness(self, db_last_run: dict | None, ai_label: str, ai_available: bool) -> tuple[bool, list[str]]:
        """Verifica i requisiti per sbloccare AUTO_SAFE: provider AI attivo e valutazione recente superata."""
        from ..db import jload, parse_iso, utcnow
        req = AUTO_SAFE_REQUIREMENTS
        problems = []
        if not ai_available:
            problems.append("Nessun provider AI attivo")
        if not db_last_run:
            return False, problems + ["Nessuna valutazione eseguita"]
        summ = jload(db_last_run["summary"], {})
        started = parse_iso(db_last_run["started_at"])
        if not started or (utcnow() - started).days > req["max_age_days"]:
            problems.append(f"Ultima valutazione più vecchia di {req['max_age_days']} giorni")
        if db_last_run["provider"] != ai_label:
            problems.append("L'ultima valutazione è stata eseguita con un provider/modello diverso da quello attivo")
        if summ.get("cases", 0) < req["min_cases"]:
            problems.append(f"Servono almeno {req['min_cases']} casi di valutazione")
        if summ.get("decision_accuracy", 0) < req["decision_accuracy"]:
            problems.append(f"Accuratezza decisioni {summ.get('decision_accuracy')} < {req['decision_accuracy']}")
        if summ.get("category_accuracy", 0) < req["category_accuracy"]:
            problems.append(f"Accuratezza categorie {summ.get('category_accuracy')} < {req['category_accuracy']}")
        if summ.get("unsupported_rate", 1) > req["unsupported_rate"]:
            problems.append(f"Risposte non supportate {summ.get('unsupported_rate')} > {req['unsupported_rate']}")
        if summ.get("forbidden_term_violations", 1) > req["forbidden_term_violations"]:
            problems.append("Termini vietati presenti nelle risposte di prova")
        return not problems, problems
