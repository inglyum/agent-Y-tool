"""CRM: lead, eventi, punteggio spiegabile, consensi, retention e cancellazione."""
from __future__ import annotations

from datetime import timedelta

from ..audit import audit
from ..db import Database, jdump, jload, now_iso
from ..response.classify import Classification

STAGES = ["NEW", "QUALIFIED", "CONTACT_REQUESTED", "CONTACTED", "DEMO_BOOKED", "QUOTE_REQUESTED", "WON", "LOST"]
ALLOWED_TRANSITIONS = {
    "NEW": {"QUALIFIED", "CONTACT_REQUESTED", "CONTACTED", "LOST"},
    "QUALIFIED": {"CONTACT_REQUESTED", "CONTACTED", "DEMO_BOOKED", "QUOTE_REQUESTED", "LOST"},
    "CONTACT_REQUESTED": {"CONTACTED", "LOST"},
    "CONTACTED": {"DEMO_BOOKED", "QUOTE_REQUESTED", "WON", "LOST"},
    "DEMO_BOOKED": {"QUOTE_REQUESTED", "WON", "LOST", "CONTACTED"},
    "QUOTE_REQUESTED": {"WON", "LOST", "CONTACTED"},
    "WON": set(),
    "LOST": {"NEW", "QUALIFIED"},
}
LEAD_CATEGORIES = ["curious", "machine", "accessory", "materials", "support", "course", "demo", "quote", "b2b"]

# Pesi configurabili in un solo punto; ogni punto assegnato è spiegato nel lead.
SCORE_WEIGHTS = {
    "intent_quote": 35, "intent_purchase": 30, "intent_demo": 25, "intent_course": 20, "intent_research": 15,
    "intent_support": 5, "b2b_signal": 20, "budget_mentioned": 10, "product_mentioned": 10, "material_mentioned": 5,
    "question_asked": 5,
}


def score_lead(cls: Classification, products: list[str], materials: list[str]) -> tuple[int, list[dict]]:
    """Solo segnali osservabili nel messaggio; nessuna caratteristica personale."""
    expl = []
    key = f"intent_{cls.intent}"
    if key in SCORE_WEIGHTS:
        expl.append({"signal": key, "points": SCORE_WEIGHTS[key]})
    if cls.signals.get("b2b"):
        expl.append({"signal": "b2b_signal", "points": SCORE_WEIGHTS["b2b_signal"]})
    if cls.signals.get("budget"):
        expl.append({"signal": "budget_mentioned", "points": SCORE_WEIGHTS["budget_mentioned"]})
    if products:
        expl.append({"signal": "product_mentioned", "points": SCORE_WEIGHTS["product_mentioned"]})
    if materials:
        expl.append({"signal": "material_mentioned", "points": SCORE_WEIGHTS["material_mentioned"]})
    if cls.is_question:
        expl.append({"signal": "question_asked", "points": SCORE_WEIGHTS["question_asked"]})
    return min(100, sum(e["points"] for e in expl)), expl


class CRM:
    def __init__(self, db: Database, retention_days: int = 365):
        self.db = db
        self.retention_days = retention_days

    def create_from_item(self, item: dict, cls: Classification, products: list[str], materials: list[str]) -> int | None:
        if not cls.lead_category:
            return None
        score, expl = score_lead(cls, products, materials)
        now = now_iso()
        with self.db.tx() as c:
            existing = c.execute("SELECT id FROM leads WHERE source_item_id=?", (item["id"],)).fetchone()
            if existing:
                return existing[0]
            lid = c.execute("""INSERT INTO leads (display_name,platform,platform_user_ref,source_item_id,category,desired_machine,
                               materials,score,score_explanation,stage,retention_until,created_at,updated_at)
                               VALUES (?,?,?,?,?,?,?,?,?,'NEW',?,?,?)""",
                            (item.get("author_name"), item["platform"], item.get("author_ref"), item["id"], cls.lead_category,
                             ", ".join(products) or None, jdump(materials), score, jdump(expl),
                             now_iso(timedelta(days=self.retention_days)), now, now)).lastrowid
            c.execute("INSERT INTO lead_events (lead_id,kind,detail,at) VALUES (?,?,?,?)",
                      (lid, "created", f"Da {item['platform']}: {cls.category}/{cls.intent}", now))
            c.execute("INSERT INTO conversations (social_item_id,lead_id,channel,summary,created_at) VALUES (?,?,?,?,?)",
                      (item["id"], lid, item["platform"], item["text"][:280], now))
            audit(c, "system", "crm.lead.create", "lead", lid, {"category": cls.lead_category, "score": score})
        return lid

    def list(self, stage: str | None = None, category: str | None = None, q: str | None = None) -> list[dict]:
        sql = """SELECT l.*, s.text AS source_text, s.permalink FROM leads l LEFT JOIN social_items s ON s.id=l.source_item_id
                 WHERE 1=1"""
        p: list = []
        if stage:
            sql += " AND l.stage=?"
            p.append(stage)
        if category:
            sql += " AND l.category=?"
            p.append(category)
        if q:
            sql += " AND (l.display_name LIKE ? OR l.notes LIKE ? OR s.text LIKE ?)"
            p += [f"%{q}%"] * 3
        rows = self.db.all(sql + " ORDER BY l.score DESC, l.created_at DESC LIMIT 500", tuple(p))
        for r in rows:
            r["score_explanation"] = jload(r["score_explanation"], [])
            r["materials"] = jload(r["materials"], [])
        return rows

    def get(self, lead_id: int) -> dict | None:
        l = self.db.one("SELECT * FROM leads WHERE id=?", (lead_id,))
        if not l:
            return None
        l["score_explanation"] = jload(l["score_explanation"], [])
        l["materials"] = jload(l["materials"], [])
        l["events"] = self.db.all("SELECT * FROM lead_events WHERE lead_id=? ORDER BY at DESC", (lead_id,))
        l["consents"] = self.db.all("SELECT * FROM consent_records WHERE lead_id=? ORDER BY at DESC", (lead_id,))
        return l

    def move(self, lead_id: int, stage: str, user_id: int | None = None, note: str | None = None) -> None:
        l = self.db.one("SELECT stage FROM leads WHERE id=?", (lead_id,))
        if not l:
            raise ValueError("Lead inesistente")
        if stage not in STAGES:
            raise ValueError(f"Stato non valido: {stage}")
        if stage != l["stage"] and stage not in ALLOWED_TRANSITIONS[l["stage"]]:
            raise ValueError(f"Passaggio non consentito: {l['stage']} → {stage}")
        with self.db.tx() as c:
            c.execute("UPDATE leads SET stage=?, updated_at=? WHERE id=?", (stage, now_iso(), lead_id))
            c.execute("INSERT INTO lead_events (lead_id,kind,detail,user_id,at) VALUES (?,?,?,?,?)",
                      (lead_id, "stage_change", f"{l['stage']} → {stage}" + (f": {note}" if note else ""), user_id, now_iso()))
            audit(c, f"user:{user_id}" if user_id else "system", "crm.lead.stage", "lead", lead_id,
                  {"from": l["stage"], "to": stage}, user_id)

    def update(self, lead_id: int, fields: dict, user_id: int | None = None) -> None:
        allowed = {"display_name", "category", "owned_machine", "desired_machine", "applications", "notes"}
        vals = {k: v for k, v in fields.items() if k in allowed}
        if "category" in vals and vals["category"] not in LEAD_CATEGORIES:
            raise ValueError("Categoria lead non valida")
        if not vals:
            return
        sets = ", ".join(f"{k}=?" for k in vals)
        self.db.run(f"UPDATE leads SET {sets}, updated_at=? WHERE id=?", (*vals.values(), now_iso(), lead_id))
        audit(self.db, f"user:{user_id}" if user_id else "system", "crm.lead.update", "lead", lead_id, list(vals), user_id)

    def add_event(self, lead_id: int, kind: str, detail: str, due_at: str | None = None, user_id: int | None = None) -> int:
        if kind not in ("note", "demo_request", "course_request", "quote_request", "follow_up"):
            raise ValueError("Tipo evento non valido")
        return self.db.run("INSERT INTO lead_events (lead_id,kind,detail,due_at,user_id,at) VALUES (?,?,?,?,?,?)",
                           (lead_id, kind, detail, due_at, user_id, now_iso()))

    def record_consent(self, lead_id: int, purpose: str, granted: bool, legal_basis: str, channel: str | None,
                       evidence: str | None, email: str | None = None, phone: str | None = None,
                       user_id: int | None = None) -> None:
        if legal_basis not in ("consent", "contract", "legitimate_interest"):
            raise ValueError("Base giuridica non valida")
        if (email or phone) and not (granted and purpose == "contact"):
            raise ValueError("Recapiti salvabili solo con consenso al contatto")
        with self.db.tx() as c:
            c.execute("INSERT INTO consent_records (lead_id,purpose,granted,channel,legal_basis,evidence,at) VALUES (?,?,?,?,?,?,?)",
                      (lead_id, purpose, int(granted), channel, legal_basis, evidence, now_iso()))
            if purpose == "contact":
                if granted:
                    c.execute("UPDATE leads SET contact_email=COALESCE(?,contact_email), contact_phone=COALESCE(?,contact_phone), "
                              "updated_at=? WHERE id=?", (email, phone, now_iso(), lead_id))
                else:  # revoca: i recapiti vengono rimossi
                    c.execute("UPDATE leads SET contact_email=NULL, contact_phone=NULL, updated_at=? WHERE id=?", (now_iso(), lead_id))
            audit(c, f"user:{user_id}" if user_id else "system", "crm.consent", "lead", lead_id,
                  {"purpose": purpose, "granted": granted, "basis": legal_basis}, user_id)

    def can_contact(self, lead_id: int, purpose: str = "contact") -> bool:
        r = self.db.one("SELECT granted FROM consent_records WHERE lead_id=? AND purpose=? ORDER BY id DESC LIMIT 1",
                        (lead_id, purpose))
        return bool(r and r["granted"])

    def export(self, lead_id: int) -> dict:
        """Diritto di accesso: tutti i dati personali conservati per il lead."""
        l = self.get(lead_id)
        if not l:
            raise ValueError("Lead inesistente")
        if l.get("source_item_id"):
            l["source_item"] = self.db.one("SELECT platform,text,permalink,collected_at FROM social_items WHERE id=?",
                                           (l["source_item_id"],))
        return l

    def delete(self, lead_id: int, user_id: int | None = None, reason: str = "richiesta interessato") -> bool:
        """Cancellazione definitiva del lead e anonimizzazione dell'elemento social collegato."""
        l = self.db.one("SELECT id, source_item_id FROM leads WHERE id=?", (lead_id,))
        if not l:
            return False
        with self.db.tx() as c:
            if l["source_item_id"]:
                c.execute("UPDATE social_items SET author_ref=NULL, author_name=NULL WHERE id=?", (l["source_item_id"],))
            c.execute("DELETE FROM leads WHERE id=?", (lead_id,))  # eventi, consensi e conversazioni in cascata
            audit(c, f"user:{user_id}" if user_id else "system", "crm.lead.delete", "lead", lead_id, {"reason": reason}, user_id)
        return True

    def purge_expired(self) -> int:
        expired = self.db.all("SELECT id FROM leads WHERE retention_until IS NOT NULL AND retention_until < ? AND stage != 'WON'",
                              (now_iso(),))
        for r in expired:
            self.delete(r["id"], reason="retention scaduta")
        return len(expired)
