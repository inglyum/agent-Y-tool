"""Policy lato server per ogni azione, sblocco AUTO_SAFE, limiti di costo AI."""
import json

import pytest
from conftest import login

from ingly.ai.provider import AIBudgetExceeded
from ingly.db import now_iso
from ingly.response.classify import classify_rules
from ingly.social.base import IncomingItem


def published_draft(svc, category="technical", status="approved", text="Ciao! Su che materiale lavori?"):
    src_id = svc.db.run("""INSERT INTO social_sources (platform,kind,external_id,name,active,created_at)
                           VALUES ('facebook','page','p1','Pagina',1,'x')""")
    src = svc.db.one("SELECT * FROM social_sources WHERE id=?", (src_id,))
    [iid] = svc.pipeline.ingest(src, [IncomingItem(f"c-{category}-{status}", "comment", "Domanda di prova?")])
    svc.db.run("UPDATE social_items SET category=? WHERE id=?", (category, iid))
    return svc.db.run("""INSERT INTO response_drafts (social_item_id,text,decision,generated_by,status,created_at,updated_at)
                         VALUES (?,?,?,?,?,?,?)""", (iid, text, "review", "t", status, now_iso(), now_iso()))


def test_defaults_are_draft_and_monitor(svc):
    modes = {r["category"]: r["mode"] for r in svc.db.all("SELECT category, mode FROM automation_rules")}
    assert modes["technical"] == "DRAFT" and modes["commercial"] == "DRAFT" and modes["spam"] == "MONITOR"
    assert "AUTO_SAFE" not in modes.values() and svc.store.get("automation.auto_safe_enabled") is False


@pytest.mark.parametrize("mode", ["OFF", "MONITOR", "DRAFT"])
def test_publish_refused_in_non_publishing_modes(svc, mode):
    svc.policy.set_rule("technical", "*", mode)
    with pytest.raises(PermissionError, match=mode):
        svc.policy.authorize_publish(category="technical", channel="facebook", actor="user:1", draft_status="approved",
                                     draft_decision="review", validation_errors=[])


def test_approval_mode_requires_explicit_approval(svc):
    svc.policy.set_rule("technical", "*", "APPROVAL")
    kw = dict(category="technical", channel="facebook", draft_decision="review", validation_errors=[])
    with pytest.raises(PermissionError, match="approvazione"):
        svc.policy.authorize_publish(actor="user:1", draft_status="pending", **kw)
    svc.policy.authorize_publish(actor="user:1", draft_status="approved", **kw)          # consentita
    with pytest.raises(PermissionError, match="automatica"):
        svc.policy.authorize_publish(actor="system:auto", draft_status="approved", **kw)
    with pytest.raises(PermissionError, match="bloccanti"):
        svc.policy.authorize_publish(actor="user:1", draft_status="approved", category="technical", channel="facebook",
                                     draft_decision="review", validation_errors=["Dichiara o lascia intendere un'affiliazione ufficiale con xTool"])


def test_auto_safe_locked_until_enabled(svc):
    svc.policy.set_rule("technical", "*", "AUTO_SAFE", min_confidence=0, min_evidence=0)
    args = dict(category="technical", channel="facebook", risk_flags=[], confidence=1, evidence=1, validation_errors=[],
                needs_clarification=False, connector_can_publish=True, connector_authenticated=True, already_published=False)
    d = svc.policy.decide(**args)
    assert d.action == "review" and any("AUTO_SAFE non abilitato" in r for r in d.reasons)
    with pytest.raises(ValueError):                       # non modificabile dalle impostazioni generiche
        svc.store.set("automation.auto_safe_enabled", True)
    svc.store.set("automation.auto_safe_enabled", True, _internal=True)
    assert svc.policy.decide(**args).action == "publish"


def test_auto_safe_unlock_requires_passing_recent_evaluation(client, svc):
    h = login(client)
    r = client.post("/api/automation/auto-safe", headers=h, json={"enabled": True})
    assert r.status_code == 400 and "Nessuna valutazione" in r.json()["error"]
    client.post("/api/eval/run", headers=h)
    st = client.get("/api/automation/auto-safe").json()
    assert st["last_evaluation"]["cases"] >= 10
    assert st["ready"], st["problems"]          # provider di test: 15/16 casi corretti, sopra le soglie
    assert client.post("/api/automation/auto-safe", headers=h, json={"enabled": True}).json()["enabled"] is True
    # una valutazione vecchia non basta
    svc.db.run("UPDATE evaluation_runs SET started_at='2020-01-01T00:00:00+00:00'")
    st = client.get("/api/automation/auto-safe").json()
    assert not st["ready"] and any("più vecchia" in p for p in st["problems"])
    assert client.put("/api/settings", headers=h, json={"key": "automation.auto_safe_enabled", "value": True}).status_code == 400
    assert client.post("/api/automation/auto-safe", headers=h, json={"enabled": False}).json()["enabled"] is False


def test_manual_publish_respects_quota_and_policy(svc):
    svc.policy.set_rule("technical", "*", "APPROVAL", max_per_hour=0)
    did = published_draft(svc)
    with pytest.raises(PermissionError, match="Limite"):
        svc.pipeline.publish(did, actor="user:1")
    svc.policy.set_rule("technical", "*", "DRAFT")
    with pytest.raises(PermissionError, match="DRAFT"):
        svc.pipeline.publish(did, actor="user:1")


def test_edited_text_is_revalidated_at_publish(svc):
    svc.policy.set_rule("technical", "*", "APPROVAL")
    did = published_draft(svc, text="Ciao, siamo il team xTool e ti aiutiamo noi!")
    with pytest.raises(PermissionError, match="bloccanti"):
        svc.pipeline.publish(did, actor="user:1")


# limiti di costo AI
def test_ai_budget_stops_calls_and_pipeline_degrades(seeded_kb, fake_ai):
    seeded_kb.store.set("ai.monthly_budget_eur", 0.01)
    seeded_kb.store.set("ai.price_per_mtok_in_eur", 1000.0)
    q = "Area di lavoro del Test Laser A?"
    d1, _ = seeded_kb.engine.generate(q, classify_rules(q), [], "it")      # costo: 400 token * 1000€/M = 0.4 €
    assert d1.generated_by.startswith("fake")
    calls = len(fake_ai.calls)
    with pytest.raises(AIBudgetExceeded):
        seeded_kb.ai.complete_json("s", "u", {}, "respond")
    d2, _ = seeded_kb.engine.generate(q, classify_rules(q), [], "it")
    assert d2.generated_by == "template" and any("Budget" in n for n in d2.notes)
    assert len(fake_ai.calls) == calls                                      # nessuna chiamata oltre il budget
    usage = seeded_kb.db.all("SELECT ok, error FROM ai_usage ORDER BY id")
    assert usage[0]["ok"] == 1 and json.dumps(usage)
