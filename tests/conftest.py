"""Fixture di test: DB in memoria, provider AI finto (deterministico), trasporti HTTP simulati.

Il provider finto e i siti simulati esistono SOLO nei test: non vengono mai usati in produzione
e non popolano la knowledge base reale.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ingly.ai.provider import AIResult  # noqa: E402
from ingly.config import Settings  # noqa: E402
from ingly.security import create_user, generate_encryption_key  # noqa: E402
from ingly.service import build_services  # noqa: E402

FIXTURES = Path(__file__).parent / "fixtures"


class FakeProvider:
    """Risponde in modo deterministico: usa la prima fonte disponibile e ne cita l'id."""
    name = "fake"
    model = "fake-1"

    def __init__(self):
        self.calls = []
        self.next_answer: dict | None = None

    def complete_json(self, system, user, schema, purpose, max_tokens=4000):
        self.calls.append({"purpose": purpose, "system": system, "user": user})
        if purpose == "classify":
            return AIResult({"category": "technical", "intent": "support", "language": "it", "materials": [],
                             "problem_summary": ""}, self.model, 50, 20, 5)
        if self.next_answer:
            ans, self.next_answer = self.next_answer, None
            return AIResult(ans, self.model, 100, 50, 5)
        has_source = '<fonte id="S1"' in user
        lang = "en" if re.search(r"\b(which|what|how|the)\b", user.split("<contenuto_esterno>")[1].lower()) else "it"
        if has_source:
            src = re.search(r'<fonte id="S1"[^>]*>\n(.*?)\n', user).group(1)
            text = (f"Secondo la documentazione ufficiale ({src}) la risposta è nelle specifiche indicate."
                    if lang == "it" else f"According to the official documentation ({src}) the answer is in the listed specs.")
            return AIResult({"answer": text, "used_sources": ["S1"], "confidence": 0.92, "needs_clarification": False,
                             "unsupported_claims": [], "language": lang}, self.model, 400, 80, 5)
        return AIResult({"answer": "Mi servono più dettagli: che materiale e che macchina usi?" if lang == "it"
                         else "Could you share the material and machine?", "used_sources": [], "confidence": 0.4,
                         "needs_clarification": True, "unsupported_claims": [], "language": lang}, self.model, 200, 30, 5)


def site_transport(pages: dict[str, tuple[int, str, str]], log: list | None = None):
    """pages: url -> (status, content_type, body)."""
    def handler(req: httpx.Request) -> httpx.Response:
        url = str(req.url).split("?")[0]
        if log is not None:
            log.append(url)
        if url in pages:
            status, ctype, body = pages[url]
            return httpx.Response(status, headers={"content-type": ctype}, content=body.encode() if isinstance(body, str) else body)
        return httpx.Response(404, text="not found")
    return httpx.MockTransport(handler)


@pytest.fixture
def settings(tmp_path):
    s = Settings()
    s.database_path = ":memory:"
    s.token_encryption_key = generate_encryption_key()
    s.ai_provider = "none"
    s.crawler_delay_s = 0
    s.meta_app_id, s.meta_app_secret = "123", "app-secret"
    s.meta_redirect_uri = "https://example.test/api/social/meta/callback"
    s.meta_webhook_verify_token = "verify-me"
    s.bootstrap_admin_email = None
    return s


@pytest.fixture
def fake_ai():
    return FakeProvider()


@pytest.fixture
def svc(settings, fake_ai):
    return build_services(settings, ai_provider=fake_ai)


@pytest.fixture
def svc_noai(settings):
    return build_services(settings)


def official_source_id(svc, key="xtool_support"):
    return svc.db.one("SELECT id FROM sources WHERE key=?", (key,))["id"]


@pytest.fixture
def seeded_kb(svc):
    """Carica nella KB due pagine di test (fixture HTML, non dati reali xTool)."""
    from ingly.knowledge.crawler import import_file
    sid = official_source_id(svc)
    svc.catalog.upsert_product({"key": "test-laser-a", "official_name": "Test Laser A", "aliases": ["laser a"],
                                "status": "to_verify"})
    import_file(svc.db, sid, "a.html", (FIXTURES / "product_a.html").read_bytes(), "https://support.example.test/a")
    import_file(svc.db, sid, "b.html", (FIXTURES / "guide_b.html").read_bytes(), "https://support.example.test/b")
    return svc


@pytest.fixture
def client(svc):
    from fastapi.testclient import TestClient
    from ingly.api.app import create_app
    create_user(svc.db, "admin@example.test", "password-lunga-123", "admin")
    create_user(svc.db, "viewer@example.test", "password-lunga-123", "viewer")
    return TestClient(create_app(svc))


def login(client, email="admin@example.test"):
    r = client.post("/api/auth/login", json={"email": email, "password": "password-lunga-123"})
    assert r.status_code == 200, r.text
    return {"X-CSRF-Token": r.json()["csrf"]}


def graph_transport(routes: dict, log: list | None = None):
    """routes: (METHOD, path-suffix) -> (status, json)."""
    def handler(req: httpx.Request) -> httpx.Response:
        path = req.url.path.split("/v21.0/", 1)[-1]
        if log is not None:
            log.append((req.method, path, dict(req.url.params), req.content.decode()))
        for (m, p), (status, body) in routes.items():
            if m == req.method and path == p:
                return httpx.Response(status, json=body)
        return httpx.Response(404, json={"error": {"message": "unknown", "code": 803}})
    return httpx.MockTransport(handler)


def jdumps(o):
    return json.dumps(o)
