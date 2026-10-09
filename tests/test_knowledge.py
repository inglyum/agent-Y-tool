"""Knowledge engine: import, metadati, deduplica, versioni, crawler, RAG, compatibilità, conflitti."""
from conftest import FIXTURES, PUBLIC_GUARD, official_source_id, site_transport

from ingly.knowledge.catalog import Catalog
from ingly.knowledge.crawler import Crawler, import_file
from ingly.knowledge.extract import extract_html, extract_pdf
from ingly.knowledge.rag import Retriever


def make_pdf(text: str) -> bytes:
    """PDF minimo valido con una riga di testo (per testare l'import senza file esterni)."""
    stream = f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET".encode()
    objs = [b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
            b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
            b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    out, offsets = b"%PDF-1.4\n", []
    for i, o in enumerate(objs, 1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + o + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    out += b"".join(f"{o:010d} 00000 n \n".encode() for o in offsets)
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF".encode()
    return out


# 1. importazione di pagine e documenti
def test_import_html_and_pdf(svc):
    sid = official_source_id(svc)
    r = import_file(svc.db, sid, "a.html", (FIXTURES / "product_a.html").read_bytes(), "https://support.example.test/a", store=svc.kb)
    assert r["outcome"] == "new" and r["version"] == 1
    p = import_file(svc.db, sid, "manuale.pdf", make_pdf("Manuale di prova pulizia lente"), "https://support.example.test/m.pdf")
    assert p["outcome"] == "new"
    doc = svc.db.one("SELECT content_type FROM documents WHERE id=?", (p["document_id"],))
    assert doc["content_type"] == "application/pdf"
    assert svc.retriever.search("pulizia lente")[0].url == "https://support.example.test/m.pdf"


# 2. estrazione dei metadati
def test_extract_metadata_strips_boilerplate():
    ex = extract_html((FIXTURES / "product_a.html").read_text(), "https://support.example.test/a")
    assert ex.title == "Test Laser A — Specifiche"
    assert ex.language == "it"
    assert ex.canonical == "https://support.example.test/a"
    assert ex.meta["description"] == "Pagina di test"
    assert "tracking" not in ex.text and "Copyright" not in ex.text and "Menu Home" not in ex.text
    headings = [h for h, _ in ex.sections if h]
    assert "Specifiche tecniche" in headings and "Sicurezza" in headings


def test_extract_pdf_text():
    ex = extract_pdf(make_pdf("Area di lavoro 400 mm"), "https://x.test/a.pdf")
    assert "Area di lavoro 400 mm" in ex.text


# 3. deduplicazione e versionamento
def test_dedup_unchanged_changed_duplicate(svc):
    sid = official_source_id(svc)
    html = (FIXTURES / "product_a.html").read_bytes()
    first = import_file(svc.db, sid, "a.html", html, "https://support.example.test/a", store=svc.kb)
    again = import_file(svc.db, sid, "a.html", html, "https://support.example.test/a", store=svc.kb)
    assert again["outcome"] == "unchanged"
    dup = import_file(svc.db, sid, "copy.html", html, "https://support.example.test/copia")
    assert dup["outcome"] == "duplicate"
    n_chunks = svc.db.one("SELECT COUNT(*) n FROM document_chunks WHERE active=1")["n"]
    changed = import_file(svc.db, sid, "a.html", html.replace(b"20 W", b"22 W"), "https://support.example.test/a", store=svc.kb)
    assert changed["outcome"] == "changed" and changed["version"] == 2
    assert svc.db.one("SELECT COUNT(*) n FROM document_chunks WHERE active=1")["n"] == n_chunks
    assert len(svc.kb.versions(first["document_id"])) == 2
    assert svc.retriever.search("potenza laser 22")[0].text.count("22 W") == 1


def test_crawler_respects_robots_sitemap_and_detects_gone(svc, settings):
    base = "https://docs.example.test"
    pages = {
        f"{base}/robots.txt": (200, "text/plain", f"User-agent: *\nDisallow: /privato\nSitemap: {base}/sitemap.xml"),
        f"{base}/sitemap.xml": (200, "application/xml",
                                '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
                                f"<url><loc>{base}/it-it/a</loc></url><url><loc>{base}/privato/x</loc></url>"
                                f"<url><loc>{base}/it-it/b</loc></url></urlset>"),
        f"{base}/it-it": (200, "text/html", "<html><title>Home</title><body><p>Benvenuto nella documentazione di prova</p></body></html>"),
        f"{base}/it-it/a": (200, "text/html", (FIXTURES / "product_a.html").read_text()),
        f"{base}/it-it/b": (200, "text/html", (FIXTURES / "guide_b.html").read_text()),
    }
    seen: list = []
    sid = svc.db.run("""INSERT INTO sources (key,name,base_url,kind,priority,region,crawl_enabled,allowed_path_prefixes,created_at)
                        VALUES ('test','Test','https://docs.example.test/it-it','official',1,'it-IT',1,'["/it-it"]','2026-01-01')""")
    crawler = Crawler(svc.db, settings, transport=site_transport(pages, seen), sleep=lambda s: None, store=svc.kb, guard=PUBLIC_GUARD)
    rep = crawler.crawl_source(sid)
    assert f"{base}/privato/x" not in seen          # robots.txt rispettato
    assert rep.new >= 2 and rep.stopped_reason is None
    # la pagina b sparisce: deve essere marcata come non più disponibile
    del pages[f"{base}/it-it/b"]
    rep2 = Crawler(svc.db, settings, transport=site_transport(pages), sleep=lambda s: None, store=svc.kb,
                   guard=PUBLIC_GUARD).crawl_source(sid)
    assert rep2.gone == 1
    assert svc.db.one("SELECT status FROM documents WHERE url=?", (f"{base}/it-it/b",))["status"] == "gone"
    assert svc.db.one("SELECT COUNT(*) n FROM knowledge_updates WHERE kind='gone'")["n"] == 1


def test_crawler_stops_on_403(svc, settings):
    import httpx
    base = "https://blocked.example.test"
    pages = {f"{base}/robots.txt": (404, "text/plain", ""), f"{base}/": (403, "text/html", "denied")}
    sid = svc.db.run("""INSERT INTO sources (key,name,base_url,kind,priority,crawl_enabled,created_at)
                        VALUES ('blk','Blk','https://blocked.example.test/','official',1,1,'2026-01-01')""")
    rep = Crawler(svc.db, settings, transport=site_transport(pages), sleep=lambda s: None, store=svc.kb,
                  guard=PUBLIC_GUARD).crawl_source(sid)
    assert rep.stopped_reason and "403" in rep.stopped_reason
    assert svc.db.one("SELECT last_crawl_status FROM sources WHERE id=?", (sid,))["last_crawl_status"] == "failed"


# 4. ricerca di una specifica tecnica
def test_search_specification(seeded_kb):
    hits = seeded_kb.retriever.search("area di lavoro del Test Laser A", products=["test-laser-a"])
    assert hits and "400 x 400 mm" in hits[0].text
    assert "test-laser-a" in hits[0].products
    assert Retriever.evidence_score("area di lavoro", hits) > 0.5


def test_search_handles_fts_syntax_safely(seeded_kb):
    assert seeded_kb.retriever.search('area" OR NEAR(* -- ') is not None


# 6. compatibilità macchina-accessorio
def test_compatibility_requires_verified_source(svc):
    cat = Catalog(svc.db)
    cat.upsert_product({"key": "m1", "official_name": "Macchina 1"})
    cat.upsert_accessory({"key": "r1", "official_name": "Rotativo 1"})
    assert cat.compatibility("m1", "r1")["answer"] == "unknown"
    cat.set_compatibility("m1", "r1", "compatible", "https://support.example.test/r1", status="to_verify")
    assert cat.compatibility("m1", "r1")["answer"] == "unknown"       # non verificata = non dichiarabile
    cat.set_compatibility("m1", "r1", "compatible", "https://support.example.test/r1", "2026-10-01", status="verified")
    assert cat.compatibility("m1", "r1")["answer"] == "compatible"
    cat.set_compatibility("m1", "r1", "incompatible", "https://other.example.test/r1", "2026-10-02", status="verified")
    assert cat.compatibility("m1", "r1")["answer"] == "conflict"


def test_compatibility_needs_source():
    import pytest
    from ingly.db import Database
    db = Database(":memory:")
    db.migrate()
    cat = Catalog(db)
    cat.upsert_product({"key": "m1", "official_name": "M1"})
    cat.upsert_accessory({"key": "a1", "official_name": "A1"})
    with pytest.raises(ValueError):
        cat.set_compatibility("m1", "a1", "compatible", "")


# 7. gestione di informazioni mancanti
def test_missing_fields_and_verified_requires_source(svc):
    import pytest
    cat = Catalog(svc.db)
    cat.upsert_product({"key": "incompleto", "official_name": "Prodotto incompleto", "family": "F"})
    p = [x for x in cat.products() if x["key"] == "incompleto"][0]
    assert {"technology", "nominal_power", "work_area", "source_url", "verified_at"} <= set(p["missing_fields"])
    with pytest.raises(ValueError):
        cat.upsert_product({"key": "x", "official_name": "X", "status": "verified"})


# 8. conflitto tra fonti
def test_conflicting_specs_detected(svc):
    cat = Catalog(svc.db)
    cat.upsert_product({"key": "m2", "official_name": "Macchina 2"})
    cat.add_spec("m2", "potenza", "10", "W", "https://a.example.test/m2")
    cat.add_spec("m2", "potenza", "12", "W", "https://b.example.test/m2")
    cat.add_spec("m2", "peso", "5", "kg", "https://a.example.test/m2")
    conflicts = svc.retriever.conflicts(["m2"])
    assert len(conflicts) == 1 and conflicts[0]["spec"] == "potenza"


def test_yaml_cards_import_skips_empty_templates(svc):
    res = svc.catalog.import_yaml_cards()
    assert res["products"] == 0  # il repository contiene solo modelli vuoti: nessun dato inventato


def test_sources_seeded_from_registry(svc):
    keys = {r["key"] for r in svc.db.all("SELECT key FROM sources")}
    assert {"xtool_eu_it", "xtool_support", "xtool_com", "fb_xtool_official_it"} <= keys
    assert svc.db.one("SELECT crawl_enabled FROM sources WHERE key='fb_xtool_official_it'")["crawl_enabled"] == 0
