"""Pipeline: rileva → deduplica → lingua/argomento → classifica → recupera fonti → bozza → valuta → decide → registra."""
from __future__ import annotations

import re
from datetime import timedelta

from ..audit import audit, log
from ..automation.policy import PolicyEngine
from ..crm.leads import CRM
from ..db import Database, jdump, jload, now_iso
from ..knowledge.catalog import Catalog
from ..knowledge.extract import guess_language
from ..knowledge.store import detect_products, product_aliases
from ..response.classify import classify_rules, merge_ai
from ..response.engine import ResponseEngine
from ..security import rate_limit_hit
from ..settings_store import SettingsStore
from .base import ConnectorError, IncomingItem, NotSupported, RateLimited, TokenExpired

RESERVATION_STALE_MIN = 10


class Pipeline:
    def __init__(self, db: Database, engine: ResponseEngine, policy: PolicyEngine, settings: SettingsStore,
                 connectors: dict, crm: CRM):
        self.db, self.engine, self.policy, self.settings = db, engine, policy, settings
        self.connectors = connectors   # platform -> connector
        self.crm = crm

    # ---------- 1-2: rilevazione e deduplica ----------
    def ingest(self, source: dict, items: list[IncomingItem]) -> list[int]:
        new_ids = []
        for it in items:
            if not it.text.strip():
                continue
            rid = self.db.run("""INSERT OR IGNORE INTO social_items (source_id,platform,external_id,parent_external_id,kind,
                                 author_ref,author_name,text,permalink,created_at_platform,collected_at,status)
                                 VALUES (?,?,?,?,?,?,?,?,?,?,?,'new')""",
                              (source["id"], source["platform"], it.external_id, it.parent_external_id, it.kind, it.author_ref,
                               it.author_name, it.text, it.permalink, it.created_at, now_iso()))
            if rid:  # 0 = già presente (stesso ID piattaforma): deduplicato
                new_ids.append(rid)
        return new_ids

    def poll_source(self, source_id: int) -> dict:
        source = self.db.one("SELECT * FROM social_sources WHERE id=?", (source_id,))
        if not source or not source["active"]:
            return {"skipped": "fonte inattiva"}
        conn = self.connectors.get(source["platform"])
        try:
            items = conn.fetch_new(source, source["last_success_at"])
        except TokenExpired as e:
            self._source_error(source, str(e))
            if source.get("connection_id"):
                self.db.run("UPDATE social_connections SET status='expired', last_error=? WHERE id=?", (str(e), source["connection_id"]))
            raise
        except ConnectorError as e:
            self._source_error(source, str(e))
            raise
        ids = self.ingest(source, items)
        self.db.run("UPDATE social_sources SET last_success_at=?, last_error=NULL WHERE id=?", (now_iso(), source_id))
        return {"fetched": len(items), "new": len(ids), "item_ids": ids}

    def _source_error(self, source: dict, msg: str) -> None:
        self.db.run("UPDATE social_sources SET last_error=?, last_error_at=? WHERE id=?", (msg, now_iso(), source["id"]))
        log.warning("source error", extra={"data": {"source": source["id"], "error": msg}})

    # ---------- 3-10: elaborazione ----------
    def process(self, item_id: int) -> dict:
        # transizione atomica: un solo worker elabora l'elemento (idempotenza su retry/riavvii)
        claimed = self.db.run("UPDATE social_items SET status='processing' WHERE id=? AND status IN ('new','error')", (item_id,))
        if not claimed:
            r = self.db.one("SELECT status FROM social_items WHERE id=?", (item_id,))
            return {"skipped": True, "status": r["status"] if r else None}
        try:
            return self._process(item_id)
        except Exception as e:
            self.db.run("UPDATE social_items SET status='error', decision_reason=? WHERE id=?", (str(e)[:500], item_id))
            raise

    def _process(self, item_id: int) -> dict:
        item = self.db.one("SELECT * FROM social_items WHERE id=?", (item_id,))
        text = item["text"]
        lang = guess_language(text) or "it"
        products = detect_products(text, product_aliases(self.db))
        materials = [k for k, names in Catalog(self.db).material_aliases().items()
                     if any(re.search(rf"(?<!\w){re.escape(n)}(?!\w)", text.lower()) for n in names)]
        cls = classify_rules(text)
        ai_cls = self.engine.ai_classify(text) if cls.category not in ("spam",) else None
        cls = merge_ai(cls, ai_cls)
        if ai_cls and ai_cls.get("language") in ("it", "en"):
            lang = ai_cls["language"]
        self.db.run("""UPDATE social_items SET language=?, products=?, materials=?, category=?, intent=?, priority=?, risk_flags=?
                       WHERE id=?""", (lang, jdump(products), jdump(materials), cls.category, cls.intent, cls.priority,
                                       jdump(cls.risk_flags), item_id))
        lead_id = None
        if self.settings.get("crm.auto_create_leads") and cls.lead_category and "prompt_injection" not in cls.risk_flags:
            lead_id = self.crm.create_from_item(item, cls, products, materials)

        pre = self.policy.pre_decision(cls.category, item["platform"])
        if pre.action in ("ignore", "monitor"):
            status = "ignored" if pre.action == "ignore" else "handled"
            self._finish(item_id, status, pre.reasons)
            return {"item_id": item_id, "action": pre.action, "category": cls.category, "lead_id": lead_id}

        draft, hits = self.engine.generate(text, cls, products, lang)
        cta = None
        conn = self.connectors.get(item["platform"])
        caps = conn.capabilities() if conn else None
        can_publish = bool(caps and (caps.reply_comment if item["kind"] == "comment" else caps.reply_post))
        source = self.db.one("SELECT * FROM social_sources WHERE id=?", (item["source_id"],))
        authenticated = bool(conn and hasattr(conn, "authenticated") and conn.authenticated(source))
        if pre.include_cta and cls.intent in ("purchase", "quote", "demo", "course", "research") \
                and not draft.validation_errors and not self._cta_recent(item):
            cta = self.engine.add_cta(draft, cls)
        decision = self.policy.decide(category=cls.category, channel=item["platform"], risk_flags=cls.risk_flags,
                                      confidence=draft.confidence, evidence=draft.evidence,
                                      validation_errors=draft.validation_errors, needs_clarification=draft.needs_clarification,
                                      connector_can_publish=can_publish, connector_authenticated=authenticated,
                                      already_published=self._already_published(item_id))
        with self.db.tx() as c:
            c.execute("UPDATE response_drafts SET status='superseded', updated_at=? WHERE social_item_id=? AND status='pending'",
                      (now_iso(), item_id))
            draft_id = c.execute("""INSERT INTO response_drafts (social_item_id,text,language,citations,confidence,evidence_score,
                                    risk_flags,validation_errors,decision,decision_reason,generated_by,status,created_at,updated_at)
                                    VALUES (?,?,?,?,?,?,?,?,?,?,?,'pending',?,?)""",
                                 (item_id, draft.text, draft.language, jdump(draft.citations), draft.confidence, draft.evidence,
                                  jdump(cls.risk_flags), jdump(draft.validation_errors), decision.action,
                                  jdump(decision.reasons + draft.notes), draft.generated_by, now_iso(), now_iso())).lastrowid
            audit(c, "system", "pipeline.decision", "social_item", item_id,
                  {"draft": draft_id, "decision": decision.action, "reasons": decision.reasons, "cta": bool(cta)})
        if decision.action == "publish":
            res = self.publish(draft_id, actor="system:auto")
            return {"item_id": item_id, "action": "publish", "draft_id": draft_id, "publish": res, "lead_id": lead_id}
        self._finish(item_id, "in_review" if decision.action == "review" else "drafted", decision.reasons)
        return {"item_id": item_id, "action": decision.action, "draft_id": draft_id, "category": cls.category,
                "reasons": decision.reasons, "lead_id": lead_id}

    def _finish(self, item_id: int, status: str, reasons: list[str]) -> None:
        self.db.run("UPDATE social_items SET status=?, decision_reason=?, processed_at=? WHERE id=?",
                    (status, "; ".join(reasons), now_iso(), item_id))

    def _already_published(self, item_id: int) -> bool:
        return bool(self.db.one("SELECT 1 AS x FROM published_responses WHERE social_item_id=? AND status IN ('published','reserved')",
                                (item_id,)))

    def _cta_recent(self, item: dict) -> bool:
        """Non ripetere l'invito alla stessa persona entro 30 giorni."""
        if not item.get("author_ref"):
            return False
        since = now_iso(-timedelta(days=30))
        r = self.db.one("""SELECT 1 AS x FROM response_drafts d JOIN social_items s ON s.id=d.social_item_id
                           WHERE s.author_ref=? AND s.platform=? AND d.status='published' AND d.created_at>=?
                           AND (d.text LIKE '%contattare%' OR d.text LIKE '%reach %')""",
                        (item["author_ref"], item["platform"], since))
        return bool(r)

    # ---------- pubblicazione idempotente ----------
    def publish(self, draft_id: int, actor: str = "system", user_id: int | None = None) -> dict:
        d = self.db.one("SELECT * FROM response_drafts WHERE id=?", (draft_id,))
        if not d:
            raise ValueError("Bozza inesistente")
        item = self.db.one("SELECT * FROM social_items WHERE id=?", (d["social_item_id"],))
        platform = item["platform"]
        key = f"{platform}:{item['external_id']}:reply"
        done = self.db.one("SELECT external_response_id FROM published_responses WHERE idempotency_key=? AND status='published'", (key,))
        if done:  # retry o doppio clic: nessuna seconda pubblicazione
            return {"status": "already_published", "external_id": done["external_response_id"]}
        if self.settings.kill_switch_active() or self.settings.kill_switch_active(platform):
            raise PermissionError("Kill switch attivo: pubblicazione bloccata")
        if actor.startswith("user:") and d["status"] not in ("approved", "pending"):
            raise ValueError(f"Bozza in stato {d['status']}: non pubblicabile")
        if actor == "system:auto" and d["decision"] != "publish":
            raise PermissionError("Pubblicazione automatica non autorizzata dalla policy")
        conn = self.connectors.get(platform)
        if conn is None:
            raise NotSupported("Nessun connettore per la piattaforma")
        caps = conn.capabilities()
        if not (caps.reply_comment if item["kind"] == "comment" else caps.reply_post):
            raise NotSupported("Il canale non consente la pubblicazione via API: pubblica a mano e segna come gestito")
        with self.db.tx() as c:
            existing = c.execute("SELECT * FROM published_responses WHERE idempotency_key=?", (key,)).fetchone()
            if existing and existing["status"] == "published":
                return {"status": "already_published", "external_id": existing["external_response_id"]}
            if existing and existing["status"] == "reserved":
                created = existing["created_at"]
                if created > now_iso(-timedelta(minutes=RESERVATION_STALE_MIN)):
                    return {"status": "in_progress"}
                # prenotazione orfana (crash): non sappiamo se Meta ha ricevuto la risposta → revisione manuale
                c.execute("UPDATE published_responses SET status='failed', error=? WHERE id=?",
                          ("Prenotazione orfana: verificare manualmente sulla piattaforma prima di ripubblicare", existing["id"]))
                return {"status": "needs_manual_check"}
            if existing and existing["status"] == "failed":
                c.execute("UPDATE published_responses SET status='reserved', draft_id=?, error=NULL, created_at=? WHERE id=?",
                          (draft_id, now_iso(), existing["id"]))
                pub_id = existing["id"]
            else:
                pub_id = c.execute("""INSERT INTO published_responses (draft_id,social_item_id,idempotency_key,platform,status,created_at)
                                      VALUES (?,?,?,?,'reserved',?)""", (draft_id, item["id"], key, platform, now_iso())).lastrowid
        # contatori di pubblicazione letti dalla PolicyEngine per i limiti orari/giornalieri
        for bucket, window in ((f"publish:{platform}:h", 3600), (f"publish:{platform}:d", 86400),
                               ("publish:*:h", 3600), ("publish:*:d", 86400)):
            rate_limit_hit(self.db, bucket, 10 ** 9, window)
        try:
            ext_id = conn.reply(item, d["text"])
        except RateLimited as e:
            self.db.run("UPDATE published_responses SET status='failed', error=? WHERE id=?", (str(e), pub_id))
            raise
        except ConnectorError as e:
            self.db.run("UPDATE published_responses SET status='failed', error=? WHERE id=?", (str(e), pub_id))
            self.db.run("UPDATE response_drafts SET status='failed', updated_at=? WHERE id=?", (now_iso(), draft_id))
            audit(self.db, actor, "publish.failed", "draft", draft_id, {"error": str(e)}, user_id)
            raise
        with self.db.tx() as c:
            c.execute("UPDATE published_responses SET status='published', external_response_id=?, published_at=? WHERE id=?",
                      (ext_id, now_iso(), pub_id))
            c.execute("UPDATE response_drafts SET status='published', approved_by=COALESCE(approved_by,?), updated_at=? WHERE id=?",
                      (user_id, now_iso(), draft_id))
            c.execute("UPDATE social_items SET status='published', processed_at=? WHERE id=?", (now_iso(), item["id"]))
            audit(c, actor, "publish.ok", "draft", draft_id, {"platform": platform, "external_id": ext_id}, user_id)
        return {"status": "published", "external_id": ext_id}

    # ---------- azioni di revisione ----------
    def edit_draft(self, draft_id: int, text: str, user_id: int) -> list[str]:
        from ..response.engine import validate_reply
        d = self.db.one("SELECT * FROM response_drafts WHERE id=?", (draft_id,))
        if not d or d["status"] not in ("pending", "approved"):
            raise ValueError("Bozza non modificabile")
        cites = jload(d["citations"], [])
        hits_like = [type("H", (), {"title": c.get("title", ""), "heading": "", "text": self._chunk_text(c.get("chunk_id")),
                                    "url": c.get("url")})() for c in cites]
        cta_urls = [self.settings.get(k) for k in ("cta.contact_url", "cta.demo_url", "cta.course_url", "cta.quote_url")
                    if self.settings.get(k)]
        errors = validate_reply(text, hits_like, self.settings, cta_urls)
        self.db.run("UPDATE response_drafts SET text=?, validation_errors=?, edited_by=?, status='pending', updated_at=? WHERE id=?",
                    (text, jdump(errors), user_id, now_iso(), draft_id))
        audit(self.db, f"user:{user_id}", "draft.edit", "draft", draft_id, {"errors": errors}, user_id)
        return errors

    def _chunk_text(self, chunk_id) -> str:
        r = self.db.one("SELECT text FROM document_chunks WHERE id=?", (chunk_id,)) if chunk_id else None
        return r["text"] if r else ""

    def approve(self, draft_id: int, user_id: int) -> None:
        d = self.db.one("SELECT * FROM response_drafts WHERE id=?", (draft_id,))
        if not d or d["status"] != "pending":
            raise ValueError("Bozza non approvabile")
        if jload(d["validation_errors"], []) and any("affiliazione" in e or "sicurezza" in e for e in jload(d["validation_errors"], [])):
            raise ValueError("Correggi gli errori bloccanti (affiliazione/sicurezza) prima di approvare")
        self.db.run("UPDATE response_drafts SET status='approved', approved_by=?, updated_at=? WHERE id=?", (user_id, now_iso(), draft_id))
        self.db.run("UPDATE social_items SET status='approved' WHERE id=?", (d["social_item_id"],))
        audit(self.db, f"user:{user_id}", "draft.approve", "draft", draft_id, None, user_id)

    def reject(self, draft_id: int, user_id: int, reason: str = "") -> None:
        d = self.db.one("SELECT * FROM response_drafts WHERE id=?", (draft_id,))
        if not d or d["status"] not in ("pending", "approved"):
            raise ValueError("Bozza non rifiutabile")
        self.db.run("UPDATE response_drafts SET status='rejected', updated_at=? WHERE id=?", (now_iso(), draft_id))
        self.db.run("UPDATE social_items SET status='rejected', decision_reason=? WHERE id=?", (reason, d["social_item_id"]))
        audit(self.db, f"user:{user_id}", "draft.reject", "draft", draft_id, {"reason": reason}, user_id)

    def mark_handled(self, item_id: int, user_id: int, note: str = "") -> None:
        self.db.run("UPDATE social_items SET status='handled', decision_reason=?, processed_at=? WHERE id=?", (note, now_iso(), item_id))
        self.db.run("UPDATE response_drafts SET status='superseded', updated_at=? WHERE social_item_id=? AND status IN ('pending','approved')",
                    (now_iso(), item_id))
        audit(self.db, f"user:{user_id}", "item.handled", "social_item", item_id, {"note": note}, user_id)

    def purge_old_items(self, days: int) -> int:
        cutoff = now_iso(-timedelta(days=days))
        return self.db.run("""UPDATE social_items SET author_ref=NULL, author_name=NULL, text='[rimosso per retention]'
                              WHERE collected_at < ? AND text != '[rimosso per retention]'
                              AND id NOT IN (SELECT source_item_id FROM leads WHERE source_item_id IS NOT NULL)""", (cutoff,))
