"""Migrazioni e integrità del database; protezione di tutte le rotte."""
import pytest

from ingly.db import Database


def test_migrations_idempotent_and_complete(svc):
    assert svc.db.migrate() == []                                   # già applicate: nessuna ripetizione
    tables = {"users", "roles", "permissions", "workspaces", "products", "product_specs", "accessories",
              "compatibility_rules", "materials", "sources", "documents", "document_chunks", "social_connections",
              "social_items", "conversations", "response_drafts", "published_responses", "leads", "consents",
              "automation_rules", "audit_events", "ai_usage"}
    if svc.db.is_postgres:
        found = {r["table_name"] for r in svc.db.all("SELECT table_name FROM information_schema.tables WHERE table_schema='public'")}
        assert svc.db.one("SELECT extname FROM pg_extension WHERE extname='vector'")
    else:
        found = {r["name"] for r in svc.db.all("SELECT name FROM sqlite_master WHERE type='table'")}
    assert tables <= found


def test_constraints_enforced(svc):
    errors = (Exception,)
    with pytest.raises(errors):     # stato non ammesso
        svc.db.run("INSERT INTO products (key,official_name,status,updated_at) VALUES ('x','X','inventato','t')")
    with pytest.raises(errors):     # chiave esterna inesistente
        svc.db.run("INSERT INTO product_specs (product_id,name,value,source_url) VALUES (999999,'p','1','https://a')")
    src = svc.db.one("SELECT id FROM social_sources WHERE platform='manual'")["id"]
    iid = svc.db.run("""INSERT INTO social_items (source_id,platform,external_id,kind,text,collected_at)
                        VALUES (?,'manual','e1','post','testo','t')""", (src,))
    did = svc.db.run("""INSERT INTO response_drafts (social_item_id,text,decision,generated_by,status,created_at,updated_at)
                        VALUES (?,'r','review','t','pending','t','t')""", (iid,))
    ins = """INSERT INTO published_responses (draft_id,social_item_id,idempotency_key,platform,status,created_at)
             VALUES (?,?,'k','manual','reserved','t')"""
    svc.db.run(ins, (did, iid))
    with pytest.raises(errors):     # unicità della chiave di idempotenza
        svc.db.run(ins, (did, iid))
    with pytest.raises(errors):     # stesso ID piattaforma: deduplica garantita dal database
        svc.db.run("""INSERT INTO social_items (source_id,platform,external_id,kind,text,collected_at)
                      VALUES (?,'manual','e1','post','altro','t')""", (src,))


def test_cascade_delete_removes_personal_data(svc):
    lid = svc.db.run("""INSERT INTO leads (category,stage,created_at,updated_at) VALUES ('machine','NEW','t','t')""")
    svc.db.run("INSERT INTO consents (lead_id,purpose,granted,legal_basis,at) VALUES (?,'contact',1,'consent','t')", (lid,))
    svc.db.run("DELETE FROM leads WHERE id=?", (lid,))
    assert svc.db.one("SELECT COUNT(*) AS n FROM consents WHERE lead_id=?", (lid,))["n"] == 0


PUBLIC = {"/api/auth/login", "/api/health", "/api/openapi.json", "/webhooks/meta"}


def test_every_api_route_requires_authentication(client):
    app = client.app
    checked = 0
    for r in app.routes:
        if not hasattr(r, "methods") or not r.path.startswith("/api") or r.path in PUBLIC:
            continue
        path = r.path.replace("{", "").replace("}", "")
        path = "/".join("1" if seg.endswith(("id", "key")) else seg for seg in path.split("/"))
        for m in r.methods - {"HEAD"}:
            resp = client.request(m, path, json={})
            assert resp.status_code == 401, (m, r.path, resp.status_code)
            checked += 1
    assert checked > 60
