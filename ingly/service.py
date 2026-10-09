"""Composizione dei servizi, bootstrap e handler dei job."""
from __future__ import annotations

from dataclasses import dataclass

import httpx

from .ai.provider import MeteredAI, build_provider
from .automation.policy import PolicyEngine, seed_rules
from .config import Settings, get_settings
from .crm.leads import CRM
from .db import Database, now_iso
from .jobs.scheduler import JobQueue, RetryLater
from .knowledge.catalog import Catalog, seed_sources
from .knowledge.crawler import Crawler
from .knowledge.embed import build_embedder
from .knowledge.netguard import NetGuard
from .knowledge.rag import Retriever
from .knowledge.store import KnowledgeStore
from .response.engine import ResponseEngine, seed_prompts
from .security import TokenVault, create_user, seed_roles
from .settings_store import SettingsStore
from .social.base import RateLimited, TokenExpired, TransientError
from .social.manual import ManualConnector
from .social.meta import FacebookPageConnector, InstagramConnector, MetaOAuth
from .social.pipeline import Pipeline


@dataclass
class Services:
    settings: Settings
    db: Database
    store: SettingsStore
    vault: TokenVault
    ai: MeteredAI
    catalog: Catalog
    kb: KnowledgeStore
    retriever: Retriever
    engine: ResponseEngine
    policy: PolicyEngine
    crm: CRM
    connectors: dict
    pipeline: Pipeline
    oauth: MetaOAuth
    jobs: JobQueue
    http: httpx.Client | None = None
    crawler_transport: httpx.BaseTransport | None = None
    guard: NetGuard | None = None

    def crawler(self) -> Crawler:
        return Crawler(self.db, self.settings, transport=self.crawler_transport, store=self.kb, guard=self.guard)


def build_services(settings: Settings | None = None, ai_provider=None, http_client: httpx.Client | None = None,
                   bootstrap: bool = True, crawler_transport: httpx.BaseTransport | None = None,
                   guard: NetGuard | None = None) -> Services:
    settings = settings or get_settings()
    db = Database(settings.database_path)
    if bootstrap:
        db.migrate()
    store = SettingsStore(db)
    vault = TokenVault(settings.token_encryption_key)
    ai = MeteredAI(ai_provider or build_provider(settings), db, store)
    connectors = {
        "facebook": FacebookPageConnector(db, settings, vault, http_client),
        "instagram": InstagramConnector(db, settings, vault, http_client),
        "manual": ManualConnector(),
    }
    embedder = build_embedder(settings)
    kb = KnowledgeStore(db, embedder)
    retriever = Retriever(db, embedder)
    engine = ResponseEngine(db, ai, store, retriever)
    policy = PolicyEngine(db, store)
    crm = CRM(db, int(store.get("crm.retention_days")))
    svc = Services(settings, db, store, vault, ai, Catalog(db), kb, retriever, engine, policy, crm,
                   connectors, Pipeline(db, engine, policy, store, connectors, crm), MetaOAuth(db, settings, vault, http_client),
                   JobQueue(db), http_client, crawler_transport, guard or NetGuard())
    if bootstrap:
        bootstrap_data(svc)
    register_handlers(svc)
    return svc


def bootstrap_data(svc: Services) -> None:
    # workspace predefinito (id 1): INGLY DESIGN
    svc.db.run("INSERT OR IGNORE INTO workspaces (slug,name,created_at) VALUES ('ingly-design','INGLY DESIGN',?)", (now_iso(),))
    seed_roles(svc.db)
    seed_sources(svc.db)
    seed_rules(svc.db)
    seed_prompts(svc.db)
    from .evaluation import seed_cases
    seed_cases(svc.db)
    # Fonte manuale per i gruppi Facebook (nessuna API disponibile)
    svc.db.run("""INSERT INTO social_sources (platform,kind,name,url,active,limits_note,created_at)
                  SELECT 'manual','fb_group_manual','Gruppo Facebook xTool Official Italia (import manuale)',
                         'https://www.facebook.com/groups/xtoolofficialit',1,
                         'Nessuna API Meta per leggere gruppi: i contenuti vanno inseriti a mano', ?
                  WHERE NOT EXISTS (SELECT 1 FROM social_sources WHERE kind='fb_group_manual')""", (now_iso(),))
    s = svc.settings
    if s.bootstrap_admin_email and s.bootstrap_admin_password and \
            not svc.db.one("SELECT 1 AS x FROM users WHERE email=lower(?)", (s.bootstrap_admin_email,)):
        create_user(svc.db, s.bootstrap_admin_email, s.bootstrap_admin_password, "admin")
    svc.jobs.set_schedule("check_tokens", 360)
    svc.jobs.set_schedule("retention_purge", 1440)
    svc.jobs.set_schedule("sync_schedules", 15)


def register_handlers(svc: Services) -> None:
    q = svc.jobs

    def crawl_source(p: dict) -> dict:
        src = svc.db.one("SELECT * FROM sources WHERE id=?", (p["source_id"],))
        if not src or not src["crawl_enabled"]:
            return {"skipped": "crawl disattivato"}
        rep = svc.crawler().crawl_source(src["id"], p.get("max_pages"))
        return {"new": rep.new, "changed": rep.changed, "gone": rep.gone, "stopped": rep.stopped_reason}

    def poll_social_source(p: dict) -> dict:
        try:
            res = svc.pipeline.poll_source(p["source_id"])
        except RateLimited as e:
            raise RetryLater(str(e), e.retry_after_s)
        except TransientError as e:
            raise RetryLater(str(e), 120)
        except TokenExpired as e:
            e.retryable = False
            raise
        for iid in res.get("item_ids", []):
            q.enqueue("process_item", {"item_id": iid}, dedupe_key=f"process:{iid}")
        return res

    def process_item(p: dict) -> dict:
        try:
            return svc.pipeline.process(p["item_id"])
        except RateLimited as e:
            raise RetryLater(str(e), e.retry_after_s)

    def check_tokens(_p: dict) -> dict:
        if not svc.oauth.configured:
            return {"skipped": "Meta non configurato"}
        out = {}
        for a in svc.db.all("SELECT id FROM social_connections WHERE token_encrypted IS NOT NULL"):
            out[a["id"]] = svc.oauth.check_token(a["id"])["status"]
        return out

    def retention_purge(_p: dict) -> dict:
        days = int(svc.store.get("crm.retention_days"))
        return {"leads_deleted": svc.crm.purge_expired(), "items_anonymized": svc.pipeline.purge_old_items(days)}

    def sync_schedules(_p: dict) -> dict:
        n = 0
        for s in svc.db.all("SELECT id, crawl_enabled, crawl_interval_hours FROM sources"):
            q.set_schedule(f"crawl_source@{s['id']}", s["crawl_interval_hours"] * 60, {"source_id": s["id"]},
                           enabled=bool(s["crawl_enabled"]))
            n += 1
        for s in svc.db.all("SELECT id, active, poll_interval_minutes, platform FROM social_sources WHERE platform != 'manual'"):
            q.set_schedule(f"poll_social_source@{s['id']}", s["poll_interval_minutes"], {"source_id": s["id"]},
                           enabled=bool(s["active"]))
            n += 1
        return {"schedules": n}

    for name, fn in [("crawl_source", crawl_source), ("poll_social_source", poll_social_source),
                     ("process_item", process_item), ("check_tokens", check_tokens),
                     ("retention_purge", retention_purge), ("sync_schedules", sync_schedules)]:
        q.register(name, fn)
