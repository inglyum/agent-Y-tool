"""Pipeline social, policy, pubblicazione, Meta (token, rate limit, webhook), idempotenza, kill switch."""
import hashlib
import hmac
import json

import httpx
import pytest
from conftest import graph_transport

from ingly.service import build_services
from ingly.social.base import IncomingItem, NotSupported, RateLimited, TokenExpired
from ingly.social.manual import ManualConnector
from ingly.social.meta import GraphClient, parse_webhook, verify_signature, verify_webhook_subscription


def manual_source(svc):
    return svc.db.one("SELECT * FROM social_sources WHERE platform='manual'")


def connect_facebook(svc, page_id="111", token="page-token"):
    acc = svc.db.run("""INSERT INTO social_connections (platform,external_id,name,auth_type,token_encrypted,status,connected_at)
                        VALUES ('facebook',?,?,'oauth_page_token',?,'connected','2026-10-01')""",
                     (page_id, "Pagina INGLY", svc.vault.encrypt(token)))
    sid = svc.db.run("""INSERT INTO social_sources (connection_id,platform,kind,external_id,name,active,created_at)
                        VALUES (?,'facebook','page',?,'Pagina INGLY',1,'2026-10-01')""", (acc, page_id))
    return acc, svc.db.one("SELECT * FROM social_sources WHERE id=?", (sid,))


def svc_with_graph(settings, fake_ai, routes, log=None):
    return build_services(settings, ai_provider=fake_ai, http_client=httpx.Client(transport=graph_transport(routes, log)))


def test_manual_import_dedup_and_processing(seeded_kb):
    src = manual_source(seeded_kb)
    raw = "Mario: Qual è l'area di lavoro del Test Laser A?\n\nGiulia: Vorrei comprare un laser, preventivo?"
    items = ManualConnector.parse(src["id"], raw)
    assert [i.author_name for i in items] == ["Mario", "Giulia"]
    ids = seeded_kb.pipeline.ingest(src, items)
    assert len(ids) == 2
    assert seeded_kb.pipeline.ingest(src, ManualConnector.parse(src["id"], raw)) == []   # deduplica
    res = [seeded_kb.pipeline.process(i) for i in ids]
    assert all(r["action"] == "review" for r in res)          # default APPROVAL
    assert all(r["lead_id"] for r in res)
    # 12. senza connettore autorizzato non si pubblica
    reasons = " ".join(res[0]["reasons"])
    assert "non consente la pubblicazione" in reasons or "non autenticato" in reasons


# 15. idempotenza dell'elaborazione
def test_process_is_idempotent(seeded_kb):
    src = manual_source(seeded_kb)
    [iid] = seeded_kb.pipeline.ingest(src, ManualConnector.parse(src["id"], "Area di lavoro del Test Laser A?"))
    seeded_kb.pipeline.process(iid)
    again = seeded_kb.pipeline.process(iid)
    assert again["skipped"] is True
    assert seeded_kb.db.one("SELECT COUNT(*) n FROM response_drafts WHERE social_item_id=?", (iid,))["n"] == 1


# 12. blocco della pubblicazione senza autorizzazione
def test_manual_channel_cannot_publish(seeded_kb):
    src = manual_source(seeded_kb)
    [iid] = seeded_kb.pipeline.ingest(src, ManualConnector.parse(src["id"], "Area di lavoro del Test Laser A?"))
    r = seeded_kb.pipeline.process(iid)
    seeded_kb.pipeline.approve(r["draft_id"], user_id=None)
    with pytest.raises(NotSupported):
        seeded_kb.pipeline.publish(r["draft_id"], actor="user:1")
    with pytest.raises(PermissionError):   # la policy non ha autorizzato l'auto-pubblicazione
        seeded_kb.pipeline.publish(r["draft_id"], actor="system:auto")


def test_auto_safe_publishes_once_with_idempotency(settings, fake_ai):
    log = []
    routes = {("POST", "c1/comments"): (200, {"id": "reply-1"}),
              ("GET", "111/feed"): (200, {"data": [{"id": "p1", "message": "Post pagina", "comments": {"data": [
                  {"id": "c1", "message": "Qual è l'area di lavoro del Test Laser A?", "from": {"id": "u9", "name": "Luca"}}]}}]})}
    svc = svc_with_graph(settings, fake_ai, routes, log)
    from ingly.knowledge.crawler import import_file
    from conftest import FIXTURES, official_source_id
    svc.catalog.upsert_product({"key": "test-laser-a", "official_name": "Test Laser A"})
    import_file(svc.db, official_source_id(svc), "a.html", (FIXTURES / "product_a.html").read_bytes(), "https://support.example.test/a")
    svc.policy.set_rule("technical", "*", "AUTO_SAFE", min_confidence=0.8, min_evidence=0.3)
    _, src = connect_facebook(svc)
    out = svc.pipeline.poll_source(src["id"])
    assert out["new"] == 2   # post + commento
    comment_id = svc.db.one("SELECT id FROM social_items WHERE external_id='c1'")["id"]
    res = svc.pipeline.process(comment_id)
    assert res["action"] == "publish" and res["publish"]["status"] == "published"
    draft_id = res["draft_id"]
    # retry/riavvio: la stessa risposta non viene ripubblicata
    again = svc.pipeline.publish(draft_id, actor="user:1")
    assert again["status"] == "already_published"
    assert sum(1 for m, p, *_ in log if m == "POST" and p == "c1/comments") == 1
    # la pagina non risponde a sé stessa né due volte allo stesso commento
    assert svc.pipeline.poll_source(src["id"])["new"] == 0
    # 16. audit
    actions = {r["action"] for r in svc.db.all("SELECT action FROM audit_events")}
    assert {"pipeline.decision", "publish.ok", "automation.rule.update"} <= actions


def test_never_auto_categories_and_quota(svc):
    with pytest.raises(ValueError):
        svc.policy.set_rule("complaint", "*", "AUTO_SAFE")
    svc.policy.set_rule("technical", "facebook", "AUTO_SAFE", max_per_hour=0)
    d = svc.policy.decide(category="technical", channel="facebook", risk_flags=[], confidence=0.99, evidence=0.99,
                          validation_errors=[], needs_clarification=False, connector_can_publish=True,
                          connector_authenticated=True, already_published=False)
    assert d.action == "review" and any("Limite" in r for r in d.reasons)


# 20. kill switch globale
def test_kill_switch_blocks_everything(settings, fake_ai):
    routes = {("POST", "c1/comments"): (200, {"id": "r"})}
    svc = svc_with_graph(settings, fake_ai, routes)
    svc.policy.set_rule("technical", "*", "AUTO_SAFE", min_confidence=0, min_evidence=0)
    svc.store.set("automation.kill_switch", True)
    d = svc.policy.decide(category="technical", channel="facebook", risk_flags=[], confidence=1, evidence=1, validation_errors=[],
                          needs_clarification=False, connector_can_publish=True, connector_authenticated=True, already_published=False)
    assert d.action == "review" and any("Kill switch" in r for r in d.reasons)
    _, src = connect_facebook(svc)
    [iid] = svc.pipeline.ingest(src, [IncomingItem("c1", "comment", "Domanda?")])
    did = svc.db.run("""INSERT INTO response_drafts (social_item_id,text,decision,generated_by,status,created_at,updated_at)
                        VALUES (?,?,?,?,?,?,?)""", (iid, "Risposta", "review", "t", "approved", "x", "x"))
    with pytest.raises(PermissionError):
        svc.pipeline.publish(did, actor="user:1")
    svc.store.set("automation.kill_switch", False)
    svc.store.set("automation.channel_kill", {"facebook": True, "instagram": False})
    with pytest.raises(PermissionError):
        svc.pipeline.publish(did, actor="user:1")


# 13. gestione di token scaduti
def test_expired_token_marks_account(settings, fake_ai):
    routes = {("GET", "111/feed"): (400, {"error": {"message": "Session has expired", "code": 190, "error_subcode": 463}})}
    svc = svc_with_graph(settings, fake_ai, routes)
    acc, src = connect_facebook(svc)
    with pytest.raises(TokenExpired):
        svc.pipeline.poll_source(src["id"])
    assert svc.db.one("SELECT status FROM social_connections WHERE id=?", (acc,))["status"] == "expired"
    assert "scaduto" in svc.db.one("SELECT last_error FROM social_sources WHERE id=?", (src["id"],))["last_error"]
    # il job non viene ritentato all'infinito: va in dead-letter subito
    svc.jobs.enqueue("poll_social_source", {"source_id": src["id"]})
    assert svc.jobs.run_one()["status"] == "dead"
    # e un connettore non autenticato non pubblica
    assert not svc.connectors["facebook"].authenticated(src)


# 14. rate limit Meta → retry pianificato
def test_meta_rate_limit_retries_later(settings, fake_ai):
    routes = {("GET", "111/feed"): (400, {"error": {"message": "Too many calls", "code": 4}})}
    svc = svc_with_graph(settings, fake_ai, routes)
    _, src = connect_facebook(svc)
    with pytest.raises(RateLimited):
        svc.pipeline.poll_source(src["id"])
    svc.jobs.enqueue("poll_social_source", {"source_id": src["id"]})
    r = svc.jobs.run_one()
    assert r["status"] == "queued"
    job = svc.db.one("SELECT run_after, attempts FROM jobs WHERE id=?", (r["id"],))
    assert job["attempts"] == 1 and job["run_after"] > svc.db.one("SELECT updated_at FROM jobs WHERE id=?", (r["id"],))["updated_at"]


def test_graph_error_mapping():
    from ingly.config import Settings
    def g(status, body):
        return GraphClient(Settings(), "t", httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(status, json=body))))
    with pytest.raises(TokenExpired):
        g(400, {"error": {"code": 190}}).get("x")
    with pytest.raises(RateLimited):
        g(429, {}).get("x")
    from ingly.social.base import PermissionMissing, TransientError
    with pytest.raises(PermissionMissing):
        g(403, {"error": {"code": 200, "message": "perm"}}).get("x")
    with pytest.raises(TransientError):
        g(500, {"error": {"code": 2, "is_transient": True}}).get("x")


def test_webhook_verification_and_parsing(settings):
    assert verify_webhook_subscription(settings, "subscribe", "verify-me", "abc") == "abc"
    assert verify_webhook_subscription(settings, "subscribe", "wrong", "abc") is None
    body = json.dumps({"object": "page", "entry": [{"id": "111", "changes": [{"field": "feed", "value": {
        "item": "comment", "verb": "add", "comment_id": "c5", "post_id": "p1", "message": "Ciao, info?",
        "from": {"id": "u1", "name": "Ada"}}}, {"field": "feed", "value": {"item": "comment", "verb": "add",
        "comment_id": "c6", "message": "risposta della pagina", "from": {"id": "111"}}}]}]}).encode()
    sig = "sha256=" + hmac.new(b"app-secret", body, hashlib.sha256).hexdigest()
    assert verify_signature(settings, body, sig)
    assert not verify_signature(settings, body, "sha256=00")
    parsed = parse_webhook(json.loads(body))
    assert len(parsed) == 1 and parsed[0][2].external_id == "c5"   # il commento della pagina stessa è escluso


def test_oauth_flow_stores_encrypted_tokens(settings, fake_ai):
    routes = {
        ("GET", "oauth/access_token"): (200, {"access_token": "user-token"}),
        ("GET", "me/permissions"): (200, {"data": [{"permission": "pages_manage_engagement", "status": "granted"}]}),
        ("GET", "me/accounts"): (200, {"data": [{"id": "111", "name": "Pagina", "access_token": "page-secret-token",
                                                 "instagram_business_account": {"id": "222", "username": "ingly"}}]}),
    }
    svc = svc_with_graph(settings, fake_ai, routes)
    url, state = svc.oauth.login_url()
    assert "client_id=123" in url and "pages_manage_engagement" in url
    connected = svc.oauth.handle_callback("code", state)
    assert {c["platform"] for c in connected} == {"facebook", "instagram"}
    acc = svc.db.one("SELECT token_encrypted FROM social_connections WHERE platform='facebook'")
    assert "page-secret-token" not in acc["token_encrypted"]
    assert svc.vault.decrypt(acc["token_encrypted"]) == "page-secret-token"
    from ingly.social.base import ConnectorError
    with pytest.raises(ConnectorError):        # lo stesso state non può essere riusato
        svc.oauth.handle_callback("code", state)
    assert svc.db.one("SELECT active FROM social_sources WHERE external_id='111'")["active"] == 0   # attivazione esplicita
    log_dump = json.dumps(svc.db.all("SELECT detail FROM audit_events"))
    assert "page-secret-token" not in log_dump and "user-token" not in log_dump


def test_meta_not_configured_is_reported(settings, fake_ai):
    settings.meta_app_id = None
    svc = build_services(settings, ai_provider=fake_ai)
    assert not svc.oauth.configured and "META_APP_ID" in svc.oauth.missing_config()
    from ingly.social.base import ConnectorError
    with pytest.raises(ConnectorError):
        svc.oauth.login_url()
