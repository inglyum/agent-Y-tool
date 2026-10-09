"""Acquisizione URL, protezione SSRF, rimozione documenti, fonti obsolete, ricerca ibrida, citazioni."""
import httpx
import pytest
from conftest import FIXTURES, PUBLIC_GUARD, login, official_source_id, site_transport

from ingly.knowledge.crawler import Crawler, import_file
from ingly.knowledge.netguard import BlockedURL, NetGuard
from test_knowledge import make_pdf


@pytest.mark.parametrize("url", [
    "http://127.0.0.1/admin", "http://localhost/", "http://169.254.169.254/latest/meta-data/", "http://10.0.0.5/",
    "http://[::1]/", "file:///etc/passwd", "ftp://support.example.test/x", "https://support.example.test:8443/",
    "https://user:pw@support.example.test/", "http://intranet.local/",
])
def test_netguard_blocks_non_public_targets(url):
    with pytest.raises(BlockedURL):
        PUBLIC_GUARD.check(url)


def test_netguard_allows_public():
    PUBLIC_GUARD.check("https://support.example.test/a")
    NetGuard(resolver=lambda h, p: ["2606:4700::1111"]).check("https://example.org/")


def test_redirect_to_private_address_is_blocked(svc, settings):
    def handler(req):
        if req.url.host == "support.example.test" and req.url.path == "/robots.txt":
            return httpx.Response(404)
        if req.url.host == "support.example.test":
            return httpx.Response(302, headers={"location": "http://internal.local/secret"})
        return httpx.Response(200, text="<html><title>Segreto</title><body><p>dati interni riservati</p></body></html>")
    crawler = Crawler(svc.db, settings, transport=httpx.MockTransport(handler), store=svc.kb, guard=PUBLIC_GUARD)
    svc.db.run("UPDATE sources SET base_url='https://support.example.test/' WHERE key='xtool_support'")
    res = crawler.fetch_url("https://support.example.test/pagina")
    assert res["outcome"] == "blocked" and res["document_id"] is None
    assert svc.db.one("SELECT COUNT(*) AS n FROM documents")["n"] == 0


def test_fetch_url_only_for_registered_sources(svc, settings):
    pages = {"https://support.example.test/robots.txt": (200, "text/plain", "User-agent: *\nDisallow: /privato"),
             "https://support.example.test/guida": (200, "text/html", (FIXTURES / "guide_b.html").read_text()),
             "https://support.example.test/privato/x": (200, "text/html", "<p>no</p>")}
    svc.db.run("UPDATE sources SET base_url='https://support.example.test/' WHERE key='xtool_support'")
    crawler = Crawler(svc.db, settings, transport=site_transport(pages), store=svc.kb, guard=PUBLIC_GUARD)
    res = crawler.fetch_url("https://support.example.test/guida")
    assert res["outcome"] == "new" and res["source"] == "xtool_support" and res["document_id"]
    with pytest.raises(BlockedURL):
        crawler.fetch_url("https://altro-sito.example.test/pagina")          # dominio non registrato
    with pytest.raises(BlockedURL):
        crawler.fetch_url("https://support.example.test/privato/x")         # vietato da robots.txt
    community = svc.db.one("SELECT base_url FROM sources WHERE key='fb_xtool_official_it'")["base_url"]
    with pytest.raises(BlockedURL):
        Crawler(svc.db, settings, transport=site_transport({}), store=svc.kb,
                guard=NetGuard(resolver=lambda h, p: ["93.184.216.34"])).fetch_url(community)


def test_document_removal_excludes_from_search(seeded_kb):
    hits = seeded_kb.retriever.search("rotativo bicchieri")
    doc_id = hits[0].document_id
    assert seeded_kb.kb.remove(doc_id, "pagina sostituita da nuova guida")
    assert not any(h.document_id == doc_id for h in seeded_kb.retriever.search("rotativo bicchieri"))
    assert seeded_kb.db.one("SELECT status, removed_reason FROM documents WHERE id=?", (doc_id,))["status"] == "removed"
    assert not seeded_kb.kb.remove(doc_id, "di nuovo")


def test_stale_documents_reported(seeded_kb):
    seeded_kb.db.run("UPDATE documents SET last_checked_at='2020-01-01T00:00:00+00:00' WHERE url LIKE '%/b'")
    stale = seeded_kb.kb.stale(30)
    assert [d["url"] for d in stale] == ["https://support.example.test/b"]
    hit = [h for h in seeded_kb.retriever.search("rotativo bicchieri") if h.url.endswith("/b")][0]
    assert hit.stale and hit.citation()["stale"]


def test_hybrid_search_tolerates_typos(seeded_kb):
    hits = seeded_kb.retriever.search("rotatvo biccheri")      # refusi: il canale full-text non trova nulla
    assert hits and hits[0].url.endswith("/b")


def test_citation_contains_section_page_and_dates(svc):
    sid = official_source_id(svc)
    import_file(svc.db, sid, "m.pdf", make_pdf("Pulizia della lente di messa a fuoco"), "https://support.example.test/m.pdf", store=svc.kb)
    c = svc.retriever.search("pulizia lente")[0].citation()
    assert c["page"] == 1 and c["section"] == "Pagina 1" and c["acquired_at"] and c["official"] is True
    assert c["url"] == "https://support.example.test/m.pdf"


def test_api_ingest_and_remove(client, svc):
    h = login(client)
    r = client.post("/api/kb/ingest-url", headers=h, json={"url": "http://127.0.0.1:8000/api/me"})
    assert r.status_code == 400 and "non acquisibile" in r.json()["error"]
    sid = official_source_id(svc)
    doc = import_file(svc.db, sid, "a.html", (FIXTURES / "product_a.html").read_bytes(), "https://support.example.test/a", store=svc.kb)
    r = client.request("DELETE", f"/api/kb/documents/{doc['document_id']}", headers=h, json={"reason": "obsoleto"})
    assert r.status_code == 200
    assert client.get("/api/kb/search", params={"q": "area di lavoro"}).json()["hits"] == []
