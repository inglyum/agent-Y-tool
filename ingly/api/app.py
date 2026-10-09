"""API HTTP + dashboard statica."""
from __future__ import annotations

from datetime import timedelta
from pathlib import Path
from typing import Any, Literal

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, Request, Response, UploadFile
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from ..audit import audit
from ..automation.policy import MODES, POLICY_CATEGORIES
from ..crm.leads import LEAD_CATEGORIES, STAGES
from ..db import jdump, jload, now_iso
from ..knowledge.crawler import import_file
from ..security import ROLES, check_csrf, create_user, login, logout, rate_limit_hit, session_user
from ..service import Services, build_services
from ..social.base import ConnectorError, NotSupported
from ..social.manual import ManualConnector
from ..social.meta import parse_webhook, verify_signature, verify_webhook_subscription

WEB_DIR = Path(__file__).resolve().parent.parent / "web"
COOKIE = "ingly_session"
MAX_UPLOAD = 20 * 1024 * 1024


# ---------- modelli input ----------
class LoginIn(BaseModel):
    email: str = Field(max_length=200)
    password: str = Field(max_length=200)


class SettingIn(BaseModel):
    key: str
    value: Any


class PromptIn(BaseModel):
    name: str = Field(default="responder", pattern=r"^[a-z_]{2,40}$")
    text: str = Field(min_length=50, max_length=20000)


class ProductIn(BaseModel):
    key: str | None = Field(default=None, pattern=r"^[a-z0-9-]{2,80}$")
    official_name: str = Field(max_length=200)
    brand: str | None = "xTool"
    family: str | None = None
    model: str | None = None
    revision: str | None = None
    category: str | None = None
    market: str | None = None
    technology: str | None = None
    source_type: str | None = None
    nominal_power: str | None = None
    work_area: str | None = None
    supported_materials: list[str] | None = None
    declared_limitations: list[str] | None = None
    software: list[str] | None = None
    firmware_notes: str | None = None
    manual_urls: list[str] | None = None
    aliases: list[str] | None = None
    status: Literal["verified", "to_verify", "superseded", "retired"] = "to_verify"
    source_url: str | None = None
    verified_at: str | None = None


class SpecIn(BaseModel):
    name: str
    value: str
    unit: str | None = None
    source_url: str
    verified_at: str | None = None
    status: Literal["verified", "to_verify", "superseded", "retired"] = "to_verify"


class AccessoryIn(BaseModel):
    key: str | None = Field(default=None, pattern=r"^[a-z0-9-]{2,80}$")
    official_name: str
    category: str | None = None
    function: str | None = None
    aliases: list[str] | None = None
    status: Literal["verified", "to_verify", "superseded", "retired"] = "to_verify"
    source_url: str | None = None
    verified_at: str | None = None


class CompatIn(BaseModel):
    product_key: str
    accessory_key: str
    relation: Literal["compatible", "incompatible", "required", "recommended"]
    source_url: str
    verified_at: str | None = None
    conditions: str | None = None
    status: Literal["verified", "to_verify", "superseded", "retired"] = "to_verify"


class MaterialIn(BaseModel):
    key: str | None = Field(default=None, pattern=r"^[a-z0-9-]{2,80}$")
    name: str
    aliases: list[str] | None = None
    precautions: list[str] | None = None
    avoid: bool = False
    avoid_reason: str | None = None
    status: Literal["verified", "to_verify", "superseded", "retired"] = "to_verify"
    source_url: str | None = None
    verified_at: str | None = None


class UrlIn(BaseModel):
    url: str = Field(min_length=10, max_length=2000)


class RemoveIn(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


class SourcePatch(BaseModel):
    crawl_enabled: bool | None = None
    crawl_interval_hours: int | None = Field(default=None, ge=1, le=24 * 30)
    allowed_path_prefixes: list[str] | None = None


class SocialSourcePatch(BaseModel):
    active: bool | None = None
    poll_interval_minutes: int | None = Field(default=None, ge=5, le=24 * 60)


class ManualImportIn(BaseModel):
    source_id: int
    content: str = Field(min_length=1, max_length=200_000)
    format: Literal["text", "csv", "json"] = "text"
    process_now: bool = True


class DraftEdit(BaseModel):
    text: str = Field(min_length=1, max_length=3000)


class RejectIn(BaseModel):
    reason: str = ""


class LeadPatch(BaseModel):
    display_name: str | None = None
    category: str | None = None
    owned_machine: str | None = None
    desired_machine: str | None = None
    applications: str | None = None
    notes: str | None = None


class StageIn(BaseModel):
    stage: str
    note: str | None = None


class EventIn(BaseModel):
    kind: Literal["note", "demo_request", "course_request", "quote_request", "follow_up"]
    detail: str = Field(max_length=2000)
    due_at: str | None = None


class ConsentIn(BaseModel):
    purpose: Literal["contact", "marketing", "demo"]
    granted: bool
    legal_basis: Literal["consent", "contract", "legitimate_interest"]
    channel: str | None = None
    evidence: str | None = Field(default=None, max_length=1000)
    email: str | None = None
    phone: str | None = None


class RuleIn(BaseModel):
    category: str
    channel: str = "*"
    mode: str
    min_confidence: float | None = None
    min_evidence: float | None = None
    max_per_hour: int | None = Field(default=None, ge=0, le=1000)
    max_per_day: int | None = Field(default=None, ge=0, le=10000)
    include_cta: bool | None = None


class AutoSafeIn(BaseModel):
    enabled: bool


class KillIn(BaseModel):
    active: bool
    channel: str | None = None


class UserIn(BaseModel):
    email: str
    password: str = Field(min_length=12, max_length=200)
    role: str


class UserPatch(BaseModel):
    role: str | None = None
    active: bool | None = None


def create_app(svc: Services | None = None) -> FastAPI:
    svc = svc or build_services()
    app = FastAPI(title="INGLY xTool Expert Agent", docs_url=None, redoc_url=None, openapi_url="/api/openapi.json")
    app.state.svc = svc
    db = svc.db

    # ---------- middleware sicurezza ----------
    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        resp = await call_next(request)
        resp.headers["Content-Security-Policy"] = ("default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
                                                   "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["X-Frame-Options"] = "DENY"
        resp.headers["Referrer-Policy"] = "no-referrer"
        resp.headers["Cache-Control"] = "no-store" if request.url.path.startswith("/api") else "no-cache"
        return resp

    def current(request: Request) -> dict:
        user = session_user(db, request.cookies.get(COOKIE))
        if not user:
            raise HTTPException(401, "Accesso richiesto")
        if request.method not in ("GET", "HEAD") and not check_csrf(user, request.headers.get("x-csrf-token")):
            raise HTTPException(403, "Token CSRF mancante o non valido")
        return user

    def need(perm: str):
        def dep(user: dict = Depends(current)) -> dict:
            if perm not in user["permissions"]:
                raise HTTPException(403, f"Permesso richiesto: {perm}")
            return user
        return dep

    def bad(e: Exception):
        raise HTTPException(400, str(e))

    # ---------- auth ----------
    @app.post("/api/auth/login")
    def do_login(body: LoginIn, request: Request, response: Response):
        ip = request.client.host if request.client else "?"
        if rate_limit_hit(db, f"login:{ip}", 10, 900):
            raise HTTPException(429, "Troppi tentativi: riprova tra 15 minuti")
        res = login(db, body.email, body.password)
        if not res:
            audit(db, "anonymous", "auth.login_failed", "user", None, {"email": body.email, "ip": ip})
            raise HTTPException(401, "Credenziali non valide")
        token, csrf = res
        response.set_cookie(COOKIE, token, httponly=True, samesite="lax", secure=svc.settings.cookie_secure,
                            max_age=12 * 3600, path="/")
        u = session_user(db, token)
        audit(db, f"user:{u['id']}", "auth.login", "user", u["id"], None, u["id"])
        return {"csrf": csrf, "email": u["email"], "role": u["role"], "permissions": sorted(u["permissions"])}

    @app.post("/api/auth/logout")
    def do_logout(request: Request, response: Response, user: dict = Depends(current)):
        logout(db, request.cookies.get(COOKIE, ""))
        response.delete_cookie(COOKIE, path="/")
        return {"ok": True}

    @app.get("/api/me")
    def me(user: dict = Depends(current)):
        return {"email": user["email"], "role": user["role"], "csrf": user["csrf_token"], "permissions": sorted(user["permissions"])}

    @app.get("/api/health")
    def health():
        db.one("SELECT 1 AS ok")
        return {"ok": True, "time": now_iso()}

    # ---------- overview / analytics ----------
    @app.get("/api/overview")
    def overview(user: dict = Depends(need("dashboard.view"))):
        since = now_iso(-timedelta(days=30))
        c = lambda sql, p=(): db.one(sql, p)["n"]  # noqa: E731
        accounts = db.all("SELECT platform, name, status, last_error, token_expires_at FROM social_connections")
        sources = db.all("SELECT name, platform, active, last_success_at, last_error FROM social_sources")
        return {
            "agent_enabled": svc.store.get("agent.enabled"),
            "kill_switch": svc.store.get("automation.kill_switch"),
            "channel_kill": svc.store.get("automation.channel_kill"),
            "ai": {"provider": svc.ai.label, "available": svc.ai.available, "month_cost_eur": round(svc.ai.month_cost(), 4),
                   "budget_eur": svc.store.get("ai.monthly_budget_eur")},
            "connections": {"accounts": accounts, "social_sources": sources, "meta_configured": svc.oauth.configured,
                            "meta_missing": svc.oauth.missing_config()},
            "kb": {"documents": c("SELECT COUNT(*) n FROM documents WHERE status='active'"),
                   "chunks": c("SELECT COUNT(*) n FROM document_chunks WHERE active=1"),
                   "products": c("SELECT COUNT(*) n FROM products"),
                   "products_verified": c("SELECT COUNT(*) n FROM products WHERE status='verified'"),
                   "sources_crawled_30d": c("SELECT COUNT(*) n FROM sources WHERE last_crawl_at>=?", (since,)),
                   "updates_unread": c("SELECT COUNT(*) n FROM knowledge_updates WHERE acknowledged=0")},
            "social_30d": {"analyzed": c("SELECT COUNT(*) n FROM social_items WHERE collected_at>=? AND status!='new'", (since,)),
                           "in_review": c("SELECT COUNT(*) n FROM response_drafts WHERE status='pending'"),
                           "approved": c("SELECT COUNT(*) n FROM response_drafts WHERE status='approved'"),
                           "published": c("SELECT COUNT(*) n FROM published_responses WHERE status='published' AND published_at>=?", (since,))},
            "crm_30d": {"leads": c("SELECT COUNT(*) n FROM leads WHERE created_at>=?", (since,)),
                        "demo_requests": c("SELECT COUNT(*) n FROM leads WHERE category='demo' AND created_at>=?", (since,)),
                        "won": c("SELECT COUNT(*) n FROM leads WHERE stage='WON'")},
            "errors": db.all("""SELECT 'job' AS kind, name AS what, last_error AS error, updated_at AS at FROM jobs WHERE status='dead'
                                UNION ALL SELECT 'fonte', name, last_error, last_crawl_at FROM sources WHERE last_error IS NOT NULL
                                UNION ALL SELECT 'social', name, last_error, last_error_at FROM social_sources WHERE last_error IS NOT NULL
                                ORDER BY at DESC LIMIT 10"""),
            "recent": db.all("SELECT at, actor, action, target_type, target_id FROM audit_events ORDER BY id DESC LIMIT 12"),
        }

    @app.get("/api/analytics")
    def analytics(days: int = Query(30, ge=1, le=365), user: dict = Depends(need("dashboard.view"))):
        since = now_iso(-timedelta(days=days))
        return {
            "items_by_day": db.all("""SELECT substr(collected_at,1,10) AS day, COUNT(*) AS n FROM social_items
                                      WHERE collected_at>=? GROUP BY day ORDER BY day""", (since,)),
            "items_by_category": db.all("""SELECT COALESCE(category,'non classificato') AS category, COUNT(*) AS n FROM social_items
                                           WHERE collected_at>=? GROUP BY category ORDER BY n DESC""", (since,)),
            "items_by_platform": db.all("SELECT platform, COUNT(*) AS n FROM social_items WHERE collected_at>=? GROUP BY platform", (since,)),
            "drafts_by_status": db.all("SELECT status, COUNT(*) AS n FROM response_drafts WHERE created_at>=? GROUP BY status", (since,)),
            "leads_by_stage": db.all("SELECT stage, COUNT(*) AS n FROM leads GROUP BY stage"),
            "leads_by_category": db.all("SELECT category, COUNT(*) AS n FROM leads WHERE created_at>=? GROUP BY category", (since,)),
        }

    # ---------- impostazioni e prompt ----------
    @app.get("/api/settings")
    def get_settings_(user: dict = Depends(need("dashboard.view"))):
        return {"settings": svc.store.all(),
                "ai": {"provider": svc.settings.ai_provider, "model": svc.ai.provider.model, "available": svc.ai.available,
                       "timeout_s": svc.settings.ai_timeout_s, "max_retries": svc.settings.ai_max_retries},
                "env": {"meta_missing": svc.oauth.missing_config(), "token_vault": svc.vault.available,
                        "environment": svc.settings.environment}}

    @app.put("/api/settings")
    def put_setting(body: SettingIn, user: dict = Depends(need("settings.edit"))):
        try:
            svc.store.set(body.key, body.value, user["id"])
        except (KeyError, ValueError) as e:
            bad(e)
        return {"ok": True}

    @app.get("/api/prompts")
    def prompts(user: dict = Depends(need("settings.edit"))):
        return db.all("SELECT id,name,version,active,created_at,text FROM prompt_versions ORDER BY name, version DESC")

    @app.post("/api/prompts")
    def new_prompt(body: PromptIn, user: dict = Depends(need("settings.edit"))):
        v = (db.one("SELECT COALESCE(MAX(version),0) AS v FROM prompt_versions WHERE name=?", (body.name,))["v"]) + 1
        pid = db.run("INSERT INTO prompt_versions (name,version,text,active,created_at,created_by) VALUES (?,?,?,0,?,?)",
                     (body.name, v, body.text, now_iso(), user["id"]))
        audit(db, f"user:{user['id']}", "prompt.create", "prompt", pid, {"name": body.name, "version": v}, user["id"])
        return {"id": pid, "version": v}

    @app.post("/api/prompts/{pid}/activate")
    def activate_prompt(pid: int, user: dict = Depends(need("settings.edit"))):
        p = db.one("SELECT name FROM prompt_versions WHERE id=?", (pid,))
        if not p:
            raise HTTPException(404)
        with db.tx() as c:
            c.execute("UPDATE prompt_versions SET active=0 WHERE name=?", (p["name"],))
            c.execute("UPDATE prompt_versions SET active=1 WHERE id=?", (pid,))
        audit(db, f"user:{user['id']}", "prompt.activate", "prompt", pid, None, user["id"])
        return {"ok": True}

    # ---------- knowledge base ----------
    @app.get("/api/kb/search")
    def kb_search(q: str = Query(min_length=2, max_length=300), product: str | None = None,
                  user: dict = Depends(need("dashboard.view"))):
        hits = svc.retriever.search(q, products=[product] if product else None, limit=10)
        return {"evidence": svc.retriever.evidence_score(q, hits),
                "hits": [{**h.citation(), "text": h.text[:600], "score": round(h.score, 4),
                          "products": h.products, "kind": h.source_kind} for h in hits]}

    @app.get("/api/kb/documents")
    def kb_documents(status: str | None = None, source_id: int | None = None, user: dict = Depends(need("dashboard.view"))):
        sql = """SELECT d.id,d.url,d.title,d.status,d.language,d.region,d.content_type,d.last_checked_at,d.last_changed_at,
                 s.name AS source, (SELECT MAX(version) FROM document_versions v WHERE v.document_id=d.id) AS versions
                 FROM documents d JOIN sources s ON s.id=d.source_id WHERE 1=1"""
        p: list = []
        if status:
            sql += " AND d.status=?"
            p.append(status)
        if source_id:
            sql += " AND d.source_id=?"
            p.append(source_id)
        return db.all(sql + " ORDER BY d.last_changed_at DESC LIMIT 500", tuple(p))

    @app.get("/api/kb/documents/{doc_id}")
    def kb_document(doc_id: int, user: dict = Depends(need("dashboard.view"))):
        d = db.one("SELECT * FROM documents WHERE id=?", (doc_id,))
        if not d:
            raise HTTPException(404)
        d["versions"] = svc.kb.versions(doc_id)
        cur = db.one("SELECT text FROM document_versions WHERE id=?", (d["current_version_id"],)) if d["current_version_id"] else None
        d["text"] = cur["text"][:20000] if cur else ""
        return d

    @app.post("/api/kb/import")
    async def kb_import(source_id: int = Form(...), url: str | None = Form(None), file: UploadFile = File(...),
                        user: dict = Depends(need("kb.crawl"))):
        data = await file.read(MAX_UPLOAD + 1)
        if len(data) > MAX_UPLOAD:
            raise HTTPException(413, "File troppo grande (max 20 MB)")
        if url and not url.startswith("https://"):
            raise HTTPException(400, "L'URL di origine deve essere https://")
        try:
            res = import_file(db, source_id, file.filename or "documento", data, url, store=svc.kb)
        except ValueError as e:
            bad(e)
        audit(db, f"user:{user['id']}", "kb.import", "document", res["document_id"], {"file": file.filename}, user["id"])
        return res

    @app.post("/api/kb/ingest-url")
    def kb_ingest_url(body: UrlIn, user: dict = Depends(need("kb.crawl"))):
        from ..knowledge.netguard import BlockedURL
        try:
            res = svc.crawler().fetch_url(body.url.strip())
        except BlockedURL as e:
            raise HTTPException(400, f"URL non acquisibile: {e}")
        audit(db, f"user:{user['id']}", "kb.ingest_url", "document", res.get("document_id"), {"url": body.url, **res}, user["id"])
        return res

    @app.delete("/api/kb/documents/{doc_id}")
    def kb_remove(doc_id: int, body: RemoveIn, user: dict = Depends(need("kb.edit"))):
        if not svc.kb.remove(doc_id, body.reason, user["id"]):
            raise HTTPException(404, "Documento inesistente o già rimosso")
        return {"ok": True}

    @app.get("/api/kb/stale")
    def kb_stale(days: int = Query(30, ge=1, le=3650), user: dict = Depends(need("dashboard.view"))):
        return svc.kb.stale(days)

    @app.get("/api/kb/updates")
    def kb_updates(user: dict = Depends(need("dashboard.view"))):
        return db.all("""SELECT u.*, d.url FROM knowledge_updates u LEFT JOIN documents d ON d.id=u.document_id
                         ORDER BY u.id DESC LIMIT 200""")

    @app.post("/api/kb/updates/{uid}/ack")
    def kb_ack(uid: int, user: dict = Depends(need("kb.edit"))):
        db.run("UPDATE knowledge_updates SET acknowledged=1 WHERE id=?", (uid,))
        return {"ok": True}

    @app.get("/api/kb/conflicts")
    def kb_conflicts(user: dict = Depends(need("dashboard.view"))):
        return svc.retriever.conflicts()

    @app.post("/api/kb/reindex")
    def kb_reindex(user: dict = Depends(need("kb.edit"))):
        return {"chunks": svc.kb.reindex()}

    @app.get("/api/kb/export")
    def kb_export(user: dict = Depends(need("kb.edit"))):
        """Esporta catalogo strutturato e metadati (non il testo integrale delle pagine di terzi)."""
        return {"exported_at": now_iso(), "products": svc.catalog.products(), "accessories": svc.catalog.accessories(),
                "materials": svc.catalog.materials(),
                "documents": db.all("SELECT url,title,status,last_checked_at,last_changed_at FROM documents")}

    # ---------- catalogo ----------
    @app.get("/api/products")
    def products(q: str | None = None, category: str | None = None, user: dict = Depends(need("dashboard.view"))):
        return svc.catalog.products(q, category)

    @app.get("/api/products/{key}")
    def product(key: str, user: dict = Depends(need("dashboard.view"))):
        p = svc.catalog.product(key)
        if not p:
            raise HTTPException(404)
        return p

    @app.post("/api/products")
    def upsert_product(body: ProductIn, user: dict = Depends(need("kb.edit"))):
        try:
            return {"id": svc.catalog.upsert_product(body.model_dump(exclude_none=True), user["id"])}
        except ValueError as e:
            bad(e)

    @app.post("/api/products/{key}/specs")
    def add_spec(key: str, body: SpecIn, user: dict = Depends(need("kb.edit"))):
        try:
            return {"id": svc.catalog.add_spec(key, body.name, body.value, body.unit, body.source_url, body.verified_at, body.status)}
        except ValueError as e:
            bad(e)

    @app.get("/api/accessories")
    def accessories(user: dict = Depends(need("dashboard.view"))):
        return svc.catalog.accessories()

    @app.post("/api/accessories")
    def upsert_accessory(body: AccessoryIn, user: dict = Depends(need("kb.edit"))):
        try:
            return {"id": svc.catalog.upsert_accessory(body.model_dump(exclude_none=True))}
        except ValueError as e:
            bad(e)

    @app.post("/api/compatibility")
    def set_compat(body: CompatIn, user: dict = Depends(need("kb.edit"))):
        try:
            svc.catalog.set_compatibility(body.product_key, body.accessory_key, body.relation, body.source_url,
                                          body.verified_at, body.conditions, body.status)
        except ValueError as e:
            bad(e)
        return {"ok": True}

    @app.get("/api/compatibility")
    def get_compat(product: str, accessory: str, user: dict = Depends(need("dashboard.view"))):
        return svc.catalog.compatibility(product, accessory)

    @app.get("/api/materials")
    def materials(user: dict = Depends(need("dashboard.view"))):
        return svc.catalog.materials()

    @app.post("/api/materials")
    def upsert_material(body: MaterialIn, user: dict = Depends(need("kb.edit"))):
        try:
            return {"id": svc.catalog.upsert_material(body.model_dump(exclude_none=True))}
        except ValueError as e:
            bad(e)

    @app.post("/api/catalog/import-yaml")
    def import_yaml(user: dict = Depends(need("kb.edit"))):
        return svc.catalog.import_yaml_cards()

    # ---------- fonti e crawler ----------
    @app.get("/api/sources")
    def sources(user: dict = Depends(need("dashboard.view"))):
        rows = db.all("""SELECT s.*, (SELECT COUNT(*) FROM documents d WHERE d.source_id=s.id AND d.status='active') AS documents
                         FROM sources s ORDER BY priority, name""")
        for r in rows:
            r["allowed_path_prefixes"] = jload(r["allowed_path_prefixes"], [])
        return rows

    @app.patch("/api/sources/{sid}")
    def patch_source(sid: int, body: SourcePatch, user: dict = Depends(need("kb.crawl"))):
        src = db.one("SELECT * FROM sources WHERE id=?", (sid,))
        if not src:
            raise HTTPException(404)
        if body.crawl_enabled and (not src["base_url"] or src["kind"] in ("official_community", "community")):
            raise HTTPException(400, "Questa fonte non è scansionabile automaticamente")
        if body.crawl_enabled is not None:
            db.run("UPDATE sources SET crawl_enabled=? WHERE id=?", (int(body.crawl_enabled), sid))
        if body.crawl_interval_hours is not None:
            db.run("UPDATE sources SET crawl_interval_hours=? WHERE id=?", (body.crawl_interval_hours, sid))
        if body.allowed_path_prefixes is not None:
            if any(not p.startswith("/") for p in body.allowed_path_prefixes):
                raise HTTPException(400, "I prefissi devono iniziare con /")
            db.run("UPDATE sources SET allowed_path_prefixes=? WHERE id=?", (jdump(body.allowed_path_prefixes), sid))
        audit(db, f"user:{user['id']}", "source.update", "source", sid, body.model_dump(exclude_none=True), user["id"])
        svc.jobs.enqueue("sync_schedules", dedupe_key="sync_schedules")
        return {"ok": True}

    @app.post("/api/sources/{sid}/crawl")
    def crawl_now(sid: int, max_pages: int = Query(50, ge=1, le=2000), user: dict = Depends(need("kb.crawl"))):
        src = db.one("SELECT crawl_enabled FROM sources WHERE id=?", (sid,))
        if not src:
            raise HTTPException(404)
        if not src["crawl_enabled"]:
            raise HTTPException(400, "Abilita prima il crawling per questa fonte (dopo aver verificato le condizioni d'uso del sito)")
        jid = svc.jobs.enqueue("crawl_source", {"source_id": sid, "max_pages": max_pages}, dedupe_key=f"crawl:{sid}")
        return {"job_id": jid, "queued": jid is not None}

    @app.get("/api/crawl/jobs")
    def crawl_jobs(user: dict = Depends(need("dashboard.view"))):
        return db.all("""SELECT c.*, s.name AS source FROM crawl_jobs c JOIN sources s ON s.id=c.source_id
                         ORDER BY c.id DESC LIMIT 100""")

    @app.get("/api/crawl/jobs/{jid}/results")
    def crawl_results(jid: int, user: dict = Depends(need("dashboard.view"))):
        return db.all("SELECT * FROM crawl_results WHERE crawl_job_id=? ORDER BY id LIMIT 2000", (jid,))

    # ---------- social ----------
    @app.get("/api/social/sources")
    def social_sources(user: dict = Depends(need("social.view"))):
        rows = db.all("""SELECT ss.*, sa.status AS account_status, sa.scopes, sa.token_expires_at FROM social_sources ss
                         LEFT JOIN social_connections sa ON sa.id=ss.connection_id ORDER BY ss.platform, ss.name""")
        for r in rows:
            conn = svc.connectors.get(r["platform"])
            r["capabilities"] = conn.capabilities().__dict__ if conn else {}
            r["scopes"] = jload(r["scopes"], [])
        return rows

    @app.patch("/api/social/sources/{sid}")
    def patch_social_source(sid: int, body: SocialSourcePatch, user: dict = Depends(need("social.connect"))):
        s = db.one("SELECT * FROM social_sources WHERE id=?", (sid,))
        if not s:
            raise HTTPException(404)
        if body.active and s["platform"] != "manual":
            acc = db.one("SELECT status FROM social_connections WHERE id=?", (s["connection_id"],)) if s["connection_id"] else None
            if not acc or acc["status"] != "connected":
                raise HTTPException(400, "Collega prima l'account (OAuth)")
        if body.active is not None:
            db.run("UPDATE social_sources SET active=? WHERE id=?", (int(body.active), sid))
        if body.poll_interval_minutes is not None:
            db.run("UPDATE social_sources SET poll_interval_minutes=? WHERE id=?", (body.poll_interval_minutes, sid))
        audit(db, f"user:{user['id']}", "social.source.update", "social_source", sid, body.model_dump(exclude_none=True), user["id"])
        svc.jobs.enqueue("sync_schedules", dedupe_key="sync_schedules")
        return {"ok": True}

    @app.post("/api/social/sources/{sid}/poll")
    def poll_now(sid: int, user: dict = Depends(need("social.connect"))):
        jid = svc.jobs.enqueue("poll_social_source", {"source_id": sid}, dedupe_key=f"poll:{sid}")
        return {"job_id": jid, "queued": jid is not None}

    @app.get("/api/social/accounts")
    def social_connections(user: dict = Depends(need("social.view"))):
        rows = db.all("SELECT id,platform,external_id,name,auth_type,token_expires_at,scopes,status,last_error,connected_at FROM social_connections")
        for r in rows:
            r["scopes"] = jload(r["scopes"], [])
        return rows

    @app.get("/api/social/meta/status")
    def meta_status(user: dict = Depends(need("social.view"))):
        from ..social.meta import FACEBOOK_SCOPES, INSTAGRAM_SCOPES
        return {"configured": svc.oauth.configured, "missing": svc.oauth.missing_config(),
                "requested_scopes": FACEBOOK_SCOPES + INSTAGRAM_SCOPES,
                "webhook_verify_token_set": bool(svc.settings.meta_webhook_verify_token),
                "capabilities": {p: svc.connectors[p].capabilities().__dict__ for p in ("facebook", "instagram", "manual")}}

    @app.get("/api/social/meta/login")
    def meta_login(user: dict = Depends(need("social.connect"))):
        try:
            url, _state = svc.oauth.login_url()
        except ConnectorError as e:
            raise HTTPException(400, str(e))
        return {"url": url}

    @app.get("/api/social/meta/callback")
    def meta_callback(code: str | None = None, state: str | None = None, error: str | None = None,
                      user: dict = Depends(need("social.connect"))):
        if error or not code or not state:
            return RedirectResponse("/#facebook?oauth=denied")
        try:
            svc.oauth.handle_callback(code, state, user["id"])
        except ConnectorError as e:
            audit(db, f"user:{user['id']}", "social.connect_failed", "meta", None, {"error": str(e)}, user["id"])
            return RedirectResponse("/#facebook?oauth=error")
        return RedirectResponse("/#facebook?oauth=ok")

    @app.post("/api/social/accounts/{aid}/check")
    def check_account(aid: int, user: dict = Depends(need("social.connect"))):
        if not svc.oauth.configured:
            raise HTTPException(400, "Meta non configurato")
        return svc.oauth.check_token(aid)

    @app.post("/api/social/accounts/{aid}/disconnect")
    def disconnect_account(aid: int, user: dict = Depends(need("social.connect"))):
        svc.oauth.disconnect(aid, user["id"])
        return {"ok": True}

    @app.post("/api/social/manual-import")
    def manual_import(body: ManualImportIn, user: dict = Depends(need("drafts.edit"))):
        src = db.one("SELECT * FROM social_sources WHERE id=? AND platform='manual'", (body.source_id,))
        if not src:
            raise HTTPException(400, "Fonte manuale inesistente")
        try:
            items = ManualConnector.parse(src["id"], body.content, body.format)
        except (ValueError, KeyError) as e:
            raise HTTPException(400, f"Formato non valido: {e}")
        ids = svc.pipeline.ingest(src, items)
        audit(db, f"user:{user['id']}", "social.manual_import", "social_source", src["id"], {"items": len(items), "new": len(ids)}, user["id"])
        results = []
        if body.process_now:
            for iid in ids:
                try:
                    results.append(svc.pipeline.process(iid))
                except Exception as e:  # noqa: BLE001 — l'errore resta sull'elemento
                    results.append({"item_id": iid, "error": str(e)})
        else:
            for iid in ids:
                svc.jobs.enqueue("process_item", {"item_id": iid}, dedupe_key=f"process:{iid}")
        return {"received": len(items), "new": len(ids), "duplicates": len(items) - len(ids), "results": results}

    @app.get("/api/social/items")
    def social_items(status: str | None = None, category: str | None = None, platform: str | None = None,
                     limit: int = Query(200, le=1000), user: dict = Depends(need("social.view"))):
        sql = """SELECT i.*, ss.name AS source_name,
                 (SELECT d.id FROM response_drafts d WHERE d.social_item_id=i.id ORDER BY d.id DESC LIMIT 1) AS draft_id,
                 (SELECT d.text FROM response_drafts d WHERE d.social_item_id=i.id ORDER BY d.id DESC LIMIT 1) AS draft_text,
                 (SELECT d.citations FROM response_drafts d WHERE d.social_item_id=i.id ORDER BY d.id DESC LIMIT 1) AS citations,
                 (SELECT d.decision FROM response_drafts d WHERE d.social_item_id=i.id ORDER BY d.id DESC LIMIT 1) AS decision
                 FROM social_items i JOIN social_sources ss ON ss.id=i.source_id WHERE 1=1"""
        p: list = []
        for col, val in (("i.status", status), ("i.category", category), ("i.platform", platform)):
            if val:
                sql += f" AND {col}=?"
                p.append(val)
        rows = db.all(sql + " ORDER BY i.collected_at DESC LIMIT ?", (*p, limit))
        for r in rows:
            for f in ("products", "materials", "risk_flags", "citations"):
                r[f] = jload(r[f], [])
        return rows

    @app.post("/api/social/items/{iid}/process")
    def reprocess(iid: int, user: dict = Depends(need("drafts.edit"))):
        db.run("UPDATE social_items SET status='new' WHERE id=? AND status IN ('error','rejected','handled','ignored','drafted','in_review')",
               (iid,))
        try:
            return svc.pipeline.process(iid)
        except Exception as e:  # noqa: BLE001
            raise HTTPException(500, f"Elaborazione fallita: {e}")

    @app.post("/api/social/items/{iid}/lead")
    def item_to_lead(iid: int, user: dict = Depends(need("leads.edit"))):
        from ..response.classify import classify_rules
        item = db.one("SELECT * FROM social_items WHERE id=?", (iid,))
        if not item:
            raise HTTPException(404)
        cls = classify_rules(item["text"])
        lid = svc.crm.create_from_item(item, cls, jload(item["products"], []) or [], jload(item["materials"], []) or [],
                                       manual=True, user_id=user["id"])
        return {"lead_id": lid}

    @app.post("/api/social/items/{iid}/handled")
    def handled(iid: int, body: RejectIn, user: dict = Depends(need("drafts.edit"))):
        svc.pipeline.mark_handled(iid, user["id"], body.reason)
        return {"ok": True}

    # ---------- webhook Meta (pubblico, firmato) ----------
    @app.get("/webhooks/meta")
    def meta_verify(request: Request):
        q = request.query_params
        ch = verify_webhook_subscription(svc.settings, q.get("hub.mode"), q.get("hub.verify_token"), q.get("hub.challenge"))
        if ch is None:
            raise HTTPException(403, "Verifica webhook fallita")
        return PlainTextResponse(ch)

    @app.post("/webhooks/meta")
    async def meta_webhook(request: Request):
        body = await request.body()
        if len(body) > 1_000_000 or not verify_signature(svc.settings, body, request.headers.get("x-hub-signature-256")):
            raise HTTPException(403, "Firma non valida")
        import json as _json
        try:
            payload = _json.loads(body)
        except ValueError:
            raise HTTPException(400, "JSON non valido")
        n = 0
        for platform, acc_ext, item in parse_webhook(payload):
            src = db.one("SELECT * FROM social_sources WHERE platform=? AND external_id=? AND active=1", (platform, acc_ext))
            if not src:
                continue
            for iid in svc.pipeline.ingest(src, [item]):
                svc.jobs.enqueue("process_item", {"item_id": iid}, dedupe_key=f"process:{iid}")
                n += 1
        return {"queued": n}

    # ---------- coda risposte ----------
    @app.get("/api/drafts")
    def drafts(status: str = "pending", user: dict = Depends(need("social.view"))):
        rows = db.all("""SELECT d.*, i.text AS item_text, i.platform, i.permalink, i.author_name, i.category, i.intent, i.priority,
                         i.kind, i.source_id FROM response_drafts d JOIN social_items i ON i.id=d.social_item_id
                         WHERE d.status=? ORDER BY CASE i.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, d.id DESC
                         LIMIT 300""", (status,))
        for r in rows:
            for f in ("citations", "risk_flags", "validation_errors", "decision_reason"):
                r[f] = jload(r[f], [])
            conn = svc.connectors.get(r["platform"])
            caps = conn.capabilities() if conn else None
            r["can_publish_via_api"] = bool(caps and (caps.reply_comment if r["kind"] == "comment" else caps.reply_post))
        return rows

    @app.put("/api/drafts/{did}")
    def edit_draft(did: int, body: DraftEdit, user: dict = Depends(need("drafts.edit"))):
        try:
            return {"validation_errors": svc.pipeline.edit_draft(did, body.text, user["id"])}
        except ValueError as e:
            bad(e)

    @app.post("/api/drafts/{did}/approve")
    def approve(did: int, user: dict = Depends(need("drafts.approve"))):
        try:
            svc.pipeline.approve(did, user["id"])
        except ValueError as e:
            bad(e)
        return {"ok": True}

    @app.post("/api/drafts/{did}/reject")
    def reject(did: int, body: RejectIn, user: dict = Depends(need("drafts.approve"))):
        try:
            svc.pipeline.reject(did, user["id"], body.reason)
        except ValueError as e:
            bad(e)
        return {"ok": True}

    @app.post("/api/drafts/{did}/publish")
    def publish(did: int, user: dict = Depends(need("drafts.publish"))):
        d = db.one("SELECT status FROM response_drafts WHERE id=?", (did,))
        if not d:
            raise HTTPException(404)
        if d["status"] != "approved":
            raise HTTPException(400, "Approva la bozza prima di pubblicarla")
        try:
            return svc.pipeline.publish(did, actor=f"user:{user['id']}", user_id=user["id"])
        except PermissionError as e:
            raise HTTPException(423, str(e))
        except NotSupported as e:
            raise HTTPException(400, f"{e}")
        except ConnectorError as e:
            raise HTTPException(502, f"Pubblicazione non riuscita: {e}")

    # ---------- CRM ----------
    @app.get("/api/leads")
    def leads(stage: str | None = None, category: str | None = None, q: str | None = None,
              user: dict = Depends(need("leads.view"))):
        return svc.crm.list(stage, category, q)

    @app.get("/api/leads/meta")
    def leads_meta(user: dict = Depends(need("leads.view"))):
        from ..crm.leads import ALLOWED_TRANSITIONS, SCORE_WEIGHTS
        return {"stages": STAGES, "categories": LEAD_CATEGORIES, "transitions": {k: sorted(v) for k, v in ALLOWED_TRANSITIONS.items()},
                "score_weights": SCORE_WEIGHTS}

    @app.get("/api/leads/requests")
    def lead_requests(user: dict = Depends(need("leads.view"))):
        return {"leads": db.all("""SELECT id, display_name, platform, category, stage, score, created_at FROM leads
                                   WHERE category IN ('demo','course','quote') ORDER BY created_at DESC LIMIT 300"""),
                "events": db.all("""SELECT e.*, l.display_name FROM lead_events e JOIN leads l ON l.id=e.lead_id
                                    WHERE e.kind IN ('demo_request','course_request','quote_request','follow_up')
                                    ORDER BY COALESCE(e.due_at, e.at) LIMIT 300""")}

    @app.get("/api/leads/{lid}")
    def lead(lid: int, user: dict = Depends(need("leads.view"))):
        l = svc.crm.get(lid)
        if not l:
            raise HTTPException(404)
        return l

    @app.patch("/api/leads/{lid}")
    def patch_lead(lid: int, body: LeadPatch, user: dict = Depends(need("leads.edit"))):
        try:
            svc.crm.update(lid, body.model_dump(exclude_none=True), user["id"])
        except ValueError as e:
            bad(e)
        return {"ok": True}

    @app.post("/api/leads/{lid}/stage")
    def lead_stage(lid: int, body: StageIn, user: dict = Depends(need("leads.edit"))):
        try:
            svc.crm.move(lid, body.stage, user["id"], body.note)
        except ValueError as e:
            bad(e)
        return {"ok": True}

    @app.post("/api/leads/{lid}/events")
    def lead_event(lid: int, body: EventIn, user: dict = Depends(need("leads.edit"))):
        try:
            return {"id": svc.crm.add_event(lid, body.kind, body.detail, body.due_at, user["id"])}
        except ValueError as e:
            bad(e)

    @app.post("/api/leads/{lid}/consent")
    def lead_consent(lid: int, body: ConsentIn, user: dict = Depends(need("leads.edit"))):
        try:
            svc.crm.record_consent(lid, body.purpose, body.granted, body.legal_basis, body.channel, body.evidence,
                                   body.email, body.phone, user["id"])
        except ValueError as e:
            bad(e)
        return {"ok": True}

    @app.get("/api/leads/{lid}/export")
    def lead_export(lid: int, user: dict = Depends(need("leads.delete"))):
        try:
            data = svc.crm.export(lid)
        except ValueError:
            raise HTTPException(404)
        audit(db, f"user:{user['id']}", "crm.lead.export", "lead", lid, None, user["id"])
        return data

    @app.delete("/api/leads/{lid}")
    def lead_delete(lid: int, user: dict = Depends(need("leads.delete"))):
        if not svc.crm.delete(lid, user["id"]):
            raise HTTPException(404)
        return {"ok": True}

    # ---------- automazioni ----------
    @app.get("/api/automation/rules")
    def rules(user: dict = Depends(need("dashboard.view"))):
        from ..automation.policy import NEVER_AUTO
        return {"rules": db.all("SELECT * FROM automation_rules ORDER BY category, channel"), "modes": MODES,
                "categories": POLICY_CATEGORIES, "never_auto": sorted(NEVER_AUTO),
                "kill_switch": svc.store.get("automation.kill_switch"), "channel_kill": svc.store.get("automation.channel_kill")}

    @app.put("/api/automation/rules")
    def put_rule(body: RuleIn, user: dict = Depends(need("automation.edit"))):
        try:
            svc.policy.set_rule(body.category, body.channel, body.mode, user["id"],
                                **body.model_dump(exclude_none=True, exclude={"category", "channel", "mode"}))
        except ValueError as e:
            bad(e)
        return {"ok": True}

    def _auto_safe_status() -> dict:
        last = db.one("SELECT * FROM evaluation_runs ORDER BY id DESC LIMIT 1")
        ok, problems = svc.policy.auto_safe_readiness(last, svc.ai.label, svc.ai.available)
        from ..automation.policy import AUTO_SAFE_REQUIREMENTS
        return {"enabled": bool(svc.store.get("automation.auto_safe_enabled")), "ready": ok, "problems": problems,
                "requirements": AUTO_SAFE_REQUIREMENTS, "last_evaluation": jload(last["summary"], {}) if last else None}

    @app.get("/api/automation/auto-safe")
    def auto_safe_status(user: dict = Depends(need("dashboard.view"))):
        return _auto_safe_status()

    @app.post("/api/automation/auto-safe")
    def auto_safe_set(body: AutoSafeIn, user: dict = Depends(need("automation.edit"))):
        st = _auto_safe_status()
        if body.enabled and not st["ready"]:
            raise HTTPException(400, "AUTO_SAFE non sbloccabile: " + "; ".join(st["problems"]))
        svc.store.set("automation.auto_safe_enabled", body.enabled, user["id"], _internal=True)
        audit(db, f"user:{user['id']}", "automation.auto_safe", None, None, {"enabled": body.enabled}, user["id"])
        return _auto_safe_status()

    @app.post("/api/automation/kill")
    def kill(body: KillIn, user: dict = Depends(need("automation.edit"))):
        if body.channel:
            ck = dict(svc.store.get("automation.channel_kill") or {})
            ck[body.channel] = body.active
            svc.store.set("automation.channel_kill", ck, user["id"])
        else:
            svc.store.set("automation.kill_switch", body.active, user["id"])
        return {"ok": True}

    # ---------- prova dell'agente (nessuna scrittura su social, nessun lead) ----------
    @app.post("/api/agent/test")
    def agent_test(body: DraftEdit, user: dict = Depends(need("drafts.edit"))):
        from ..knowledge.extract import guess_language
        from ..knowledge.store import detect_products, product_aliases
        from ..response.classify import classify_rules, merge_ai
        text = body.text
        cls = merge_ai(classify_rules(text), svc.engine.ai_classify(text))
        products = detect_products(text, product_aliases(db))
        pre = svc.policy.pre_decision(cls.category, "facebook")
        out = {"classification": cls.as_dict(), "products": products, "pre_decision": pre.__dict__}
        if pre.action == "draft":
            draft, hits = svc.engine.generate(text, cls, products, guess_language(text))
            d = svc.policy.decide(category=cls.category, channel="facebook", risk_flags=cls.risk_flags,
                                  confidence=draft.confidence, evidence=draft.evidence, validation_errors=draft.validation_errors,
                                  needs_clarification=draft.needs_clarification, connector_can_publish=True,
                                  connector_authenticated=True, already_published=False)
            out["draft"] = draft.__dict__
            out["decision_if_connected"] = d.__dict__
            out["sources"] = [h.citation() for h in hits]
        return out

    # ---------- valutazione ----------
    @app.get("/api/eval/cases")
    def eval_cases(user: dict = Depends(need("dashboard.view"))):
        return db.all("SELECT * FROM evaluation_cases ORDER BY key")

    @app.post("/api/eval/run")
    def eval_run(user: dict = Depends(need("eval.run"))):
        from ..evaluation import run_evaluation
        return run_evaluation(svc)

    @app.get("/api/eval/runs")
    def eval_runs(user: dict = Depends(need("dashboard.view"))):
        rows = db.all("SELECT id, started_at, provider, summary FROM evaluation_runs ORDER BY id DESC LIMIT 50")
        for r in rows:
            r["summary"] = jload(r["summary"], {})
        return rows

    # ---------- utenti ----------
    @app.get("/api/users")
    def users(user: dict = Depends(need("users.manage"))):
        return {"users": db.all("""SELECT u.id,u.email,r.name AS role,u.active,u.created_at,u.last_login_at
                                   FROM users u JOIN roles r ON r.id=u.role_id ORDER BY u.email"""),
                "roles": {k: v for k, v in ROLES.items()}}

    @app.post("/api/users")
    def add_user(body: UserIn, user: dict = Depends(need("users.manage"))):
        try:
            uid = create_user(db, body.email, body.password, body.role)
        except ValueError as e:
            bad(e)
        except Exception:
            raise HTTPException(400, "Utente già esistente")
        audit(db, f"user:{user['id']}", "users.create", "user", uid, {"email": body.email, "role": body.role}, user["id"])
        return {"id": uid}

    @app.patch("/api/users/{uid}")
    def patch_user(uid: int, body: UserPatch, user: dict = Depends(need("users.manage"))):
        if uid == user["id"] and (body.active is False or (body.role and body.role != "admin")):
            raise HTTPException(400, "Non puoi disattivare o declassare te stesso")
        if body.role:
            r = db.one("SELECT id FROM roles WHERE name=?", (body.role,))
            if not r:
                raise HTTPException(400, "Ruolo sconosciuto")
            db.run("UPDATE users SET role_id=? WHERE id=?", (r["id"], uid))
        if body.active is not None:
            db.run("UPDATE users SET active=? WHERE id=?", (int(body.active), uid))
            if not body.active:
                db.run("DELETE FROM sessions WHERE user_id=?", (uid,))
        audit(db, f"user:{user['id']}", "users.update", "user", uid, body.model_dump(exclude_none=True), user["id"])
        return {"ok": True}

    # ---------- audit, uso AI, job ----------
    @app.get("/api/audit")
    def audit_log(action: str | None = None, limit: int = Query(200, le=2000), user: dict = Depends(need("audit.view"))):
        if action:
            return db.all("SELECT * FROM audit_events WHERE action LIKE ? ORDER BY id DESC LIMIT ?", (f"{action}%", limit))
        return db.all("SELECT * FROM audit_events ORDER BY id DESC LIMIT ?", (limit,))

    @app.get("/api/usage")
    def usage(user: dict = Depends(need("dashboard.view"))):
        return {"month_cost_eur": round(svc.ai.month_cost(), 4), "budget_eur": svc.store.get("ai.monthly_budget_eur"),
                "by_day": db.all("""SELECT substr(at,1,10) AS day, COUNT(*) AS calls, SUM(input_tokens) AS tokens_in,
                                    SUM(output_tokens) AS tokens_out, ROUND(CAST(SUM(cost_eur) AS NUMERIC),4) AS cost_eur, SUM(1-ok) AS errors
                                    FROM ai_usage GROUP BY day ORDER BY day DESC LIMIT 60"""),
                "by_purpose": db.all("""SELECT purpose, COUNT(*) AS calls, ROUND(AVG(latency_ms)) AS avg_ms, SUM(1-ok) AS errors
                                        FROM ai_usage GROUP BY purpose"""),
                "recent_errors": db.all("SELECT at, purpose, error FROM ai_usage WHERE ok=0 ORDER BY id DESC LIMIT 20")}

    @app.get("/api/jobs")
    def jobs(user: dict = Depends(need("dashboard.view"))):
        return {"stats": svc.jobs.stats(), "schedules": db.all("SELECT * FROM job_schedules ORDER BY name"),
                "recent": db.all("SELECT id,name,status,attempts,run_after,last_error,duration_ms,updated_at FROM jobs ORDER BY id DESC LIMIT 100")}

    @app.post("/api/jobs/{jid}/requeue")
    def requeue(jid: int, user: dict = Depends(need("automation.edit"))):
        return {"ok": svc.jobs.requeue_dead(jid)}

    # ---------- dashboard statica ----------
    @app.get("/")
    def index():
        return FileResponse(WEB_DIR / "index.html")

    app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")

    @app.exception_handler(HTTPException)
    async def http_err(request: Request, exc: HTTPException):
        return JSONResponse({"error": exc.detail}, status_code=exc.status_code)

    return app
