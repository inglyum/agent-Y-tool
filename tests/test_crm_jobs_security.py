"""CRM, cancellazione dati, scheduler, sicurezza (permessi, CSRF, redazione), API."""
import pytest
from conftest import login

from ingly.audit import redact
from ingly.crm.leads import score_lead
from ingly.jobs.scheduler import JobQueue, RetryLater
from ingly.response.classify import classify_rules
from ingly.social.manual import ManualConnector


def make_lead(svc, text="Siamo un'azienda, ci serve un preventivo per un laser"):
    src = svc.db.one("SELECT * FROM social_sources WHERE platform='manual'")
    [iid] = svc.pipeline.ingest(src, ManualConnector.parse(src["id"], f"Anna B.: {text}"))
    return svc.pipeline.process(iid)["lead_id"], iid


def test_lead_scoring_is_explainable():
    cls = classify_rules("Siamo un'azienda, ci serve un preventivo, budget 3000 euro")
    score, expl = score_lead(cls, ["m1"], ["legno"])
    signals = {e["signal"] for e in expl}
    assert {"intent_quote", "b2b_signal", "budget_mentioned", "product_mentioned", "material_mentioned"} <= signals
    assert score == sum(e["points"] for e in expl)


def test_pipeline_transitions_and_consent(svc):
    lid, _ = make_lead(svc)
    lead = svc.crm.get(lid)
    assert lead["category"] == "b2b" and lead["stage"] == "NEW" and lead["contact_email"] is None
    with pytest.raises(ValueError):
        svc.crm.move(lid, "WON")                       # salto non consentito
    svc.crm.move(lid, "QUALIFIED")
    with pytest.raises(ValueError):                    # niente recapiti senza consenso
        svc.crm.record_consent(lid, "contact", False, "consent", "fb", None, email="a@b.it")
    svc.crm.record_consent(lid, "contact", True, "consent", "messenger", "messaggio del 9/10", email="anna@example.test")
    assert svc.crm.can_contact(lid) and svc.crm.get(lid)["contact_email"] == "anna@example.test"
    svc.crm.record_consent(lid, "contact", False, "consent", "messenger", "revoca")
    assert not svc.crm.can_contact(lid) and svc.crm.get(lid)["contact_email"] is None


# 18. cancellazione dei dati
def test_lead_deletion_and_retention(svc):
    lid, iid = make_lead(svc)
    exported = svc.crm.export(lid)
    assert exported["source_item"]["text"]
    assert svc.crm.delete(lid, reason="richiesta")
    assert svc.crm.get(lid) is None
    item = svc.db.one("SELECT author_ref, author_name FROM social_items WHERE id=?", (iid,))
    assert item["author_ref"] is None and item["author_name"] is None
    assert svc.db.one("SELECT COUNT(*) n FROM lead_events WHERE lead_id=?", (lid,))["n"] == 0
    lid2, _ = make_lead(svc, "Vorrei comprare un laser per il legno, quale?")
    svc.db.run("UPDATE leads SET retention_until='2000-01-01T00:00:00+00:00' WHERE id=?", (lid2,))
    assert svc.crm.purge_expired() == 1


# 14. retry con backoff e dead-letter
def test_job_retry_backoff_and_dead_letter(svc):
    q = JobQueue(svc.db, worker_id="w1")
    calls = {"n": 0}

    def flaky(p):
        calls["n"] += 1
        raise RuntimeError("boom")
    q.register("flaky", flaky)
    jid = q.enqueue("flaky", {}, max_attempts=2)
    r1 = q.run_one()
    assert r1["status"] == "retry" and r1["retry_in_s"] == 30
    svc.db.run("UPDATE jobs SET run_after='2000-01-01T00:00:00+00:00' WHERE id=?", (jid,))
    assert q.run_one()["status"] == "dead"
    assert q.requeue_dead(jid)


def test_job_dedupe_lock_and_lease_recovery(svc):
    q1, q2 = JobQueue(svc.db, "w1"), JobQueue(svc.db, "w2")
    assert q1.enqueue("noop", {}, dedupe_key="k") is not None
    assert q1.enqueue("noop", {}, dedupe_key="k") is None          # duplicato in coda
    job = q1.claim()
    assert job and q2.claim() is None                               # lock: un solo worker
    svc.db.run("UPDATE jobs SET lease_until='2000-01-01T00:00:00+00:00' WHERE id=?", (job["id"],))
    assert q2.claim()["id"] == job["id"]                            # lease scaduto: ripreso da un altro worker


def test_job_retry_later_and_timeout(svc):
    q = JobQueue(svc.db, "w1", timeout_s=1)
    q.register("rl", lambda p: (_ for _ in ()).throw(RetryLater("limite", 600)))
    import time
    q.register("slow", lambda p: time.sleep(3))
    q.enqueue("rl")
    assert q.run_one()["status"] == "queued"
    q.enqueue("slow")
    t0 = time.monotonic()
    r = q.run_one()
    assert "Timeout" in r["error"] and time.monotonic() - t0 < 2.5


def test_schedules_enqueue_once_per_interval(svc):
    svc.jobs.set_schedule("retention_purge", 60)
    first = svc.jobs.tick_schedules()
    assert "retention_purge" in first
    assert "retention_purge" not in svc.jobs.tick_schedules()


# sicurezza: redazione dei log
def test_redaction():
    r = redact({"access_token": "abc", "note": "scrivi a mario@example.com o +39 333 1234567", "url": "https://x?access_token=zzz",
                "h": "Bearer sk-123"})
    assert r["access_token"] == "[REDACTED]" and "mario@" not in r["note"] and "333" not in r["note"]
    assert "zzz" not in r["url"] and "sk-123" not in r["h"]


# 19. controllo dei permessi + CSRF
def test_api_permissions_and_csrf(client, svc):
    assert client.get("/api/overview").status_code == 401
    h = login(client, "viewer@example.test")
    assert client.get("/api/overview").status_code == 200
    assert client.put("/api/automation/rules", json={"category": "technical", "mode": "OFF"}, headers=h).status_code == 403
    assert client.get("/api/audit").status_code == 403
    client.post("/api/auth/logout", headers=h)
    h = login(client)
    assert client.put("/api/automation/rules", json={"category": "technical", "mode": "OFF"}).status_code == 403   # niente CSRF
    assert client.put("/api/automation/rules", json={"category": "technical", "mode": "OFF"}, headers=h).status_code == 200
    r = client.put("/api/automation/rules", json={"category": "complaint", "mode": "AUTO_SAFE"}, headers=h)
    assert r.status_code == 400
    resp = client.get("/")
    assert "default-src 'self'" in resp.headers["content-security-policy"]


def test_login_lockout_and_rate_limit(client):
    for _ in range(5):
        client.post("/api/auth/login", json={"email": "admin@example.test", "password": "sbagliata-123456"})
    r = client.post("/api/auth/login", json={"email": "admin@example.test", "password": "password-lunga-123"})
    assert r.status_code == 401        # account bloccato temporaneamente
    for _ in range(5):
        client.post("/api/auth/login", json={"email": "x@example.test", "password": "y" * 12})
    assert client.post("/api/auth/login", json={"email": "x@example.test", "password": "y" * 12}).status_code == 429


def test_api_end_to_end_manual_flow(client, svc):
    h = login(client)
    src = svc.db.one("SELECT id FROM social_sources WHERE platform='manual'")["id"]
    r = client.post("/api/social/manual-import", headers=h, json={"source_id": src, "content": "Luca: Vorrei comprare un laser per l'ardesia, quale?"})
    assert r.status_code == 200 and r.json()["new"] == 1
    drafts = client.get("/api/drafts").json()
    assert len(drafts) == 1 and drafts[0]["can_publish_via_api"] is False
    did = drafts[0]["id"]
    assert client.put(f"/api/drafts/{did}", headers=h, json={"text": "Ciao Luca! Su che spessore lavori?"}).json()["validation_errors"] == []
    assert client.post(f"/api/drafts/{did}/approve", headers=h).status_code == 200
    assert client.post(f"/api/drafts/{did}/publish", headers=h).status_code == 400   # canale manuale
    leads = client.get("/api/leads").json()
    assert leads and leads[0]["category"] == "machine"
    ov = client.get("/api/overview").json()
    assert ov["crm_30d"]["leads"] == 1 and ov["social_30d"]["approved"] == 1
    t = client.post("/api/agent/test", headers=h, json={"text": "Quanto costa?"}).json()
    assert t["classification"]["category"] == "price" and t["decision_if_connected"]["action"] == "review"
    assert client.post("/api/eval/run", headers=h).json()["summary"]["cases"] >= 10
    # impostazioni: URL non https rifiutato, nessun link inventato
    assert client.put("/api/settings", headers=h, json={"key": "cta.demo_url", "value": "http://x"}).status_code == 400
    assert client.get("/api/settings").json()["settings"]["cta.demo_url"] == ""


def test_webhook_endpoint_rejects_unsigned(client):
    assert client.post("/webhooks/meta", content=b"{}").status_code == 403
    assert client.get("/webhooks/meta", params={"hub.mode": "subscribe", "hub.verify_token": "verify-me",
                                                "hub.challenge": "42"}).text == "42"
