"""Crawler rispettoso: robots.txt, sitemap, limiti di velocità, GET condizionali.

Non aggira login, CAPTCHA, paywall o blocchi: una risposta 401/403/429 interrompe la fonte.
"""
from __future__ import annotations

import time
import xml.etree.ElementTree as ET
from collections import deque
from dataclasses import dataclass, field
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser

import httpx

from ..audit import audit, log
from ..config import Settings
from ..db import Database, jload, now_iso
from .extract import extract_html, extract_pdf
from .store import KnowledgeStore

STOP_STATUSES = {401, 403, 429}
GONE_STATUSES = {404, 410}
MAX_BYTES = 15 * 1024 * 1024


@dataclass
class CrawlReport:
    job_id: int
    seen: int = 0
    new: int = 0
    changed: int = 0
    unchanged: int = 0
    gone: int = 0
    skipped: int = 0
    errors: list[str] = field(default_factory=list)
    stopped_reason: str | None = None


class Crawler:
    def __init__(self, db: Database, settings: Settings, client: httpx.Client | None = None,
                 sleep=time.sleep):
        self.db = db
        self.settings = settings
        self.store = KnowledgeStore(db)
        self.client = client or httpx.Client(timeout=30, follow_redirects=True,
                                             headers={"User-Agent": settings.crawler_user_agent})
        self.sleep = sleep
        self._robots: dict[str, RobotFileParser | None] = {}

    # ---------- robots / sitemap ----------
    def robots(self, url: str) -> RobotFileParser | None:
        """None = robots non leggibile per errore: per prudenza non si scansiona."""
        u = urlparse(url)
        origin = f"{u.scheme}://{u.netloc}"
        if origin not in self._robots:
            rp = RobotFileParser()
            try:
                r = self.client.get(f"{origin}/robots.txt")
                if r.status_code == 200:
                    rp.parse(r.text.splitlines())
                elif r.status_code in (404, 410):
                    rp.parse([])  # nessun robots: tutto consentito
                else:
                    rp = None
            except httpx.HTTPError:
                rp = None
            self._robots[origin] = rp
        return self._robots[origin]

    def allowed(self, url: str) -> bool:
        rp = self.robots(url)
        return bool(rp) and rp.can_fetch(self.settings.crawler_user_agent, url)

    def discover_sitemaps(self, base_url: str) -> list[str]:
        u = urlparse(base_url)
        origin = f"{u.scheme}://{u.netloc}"
        found = []
        try:
            r = self.client.get(f"{origin}/robots.txt")
            if r.status_code == 200:
                found = [l.split(":", 1)[1].strip() for l in r.text.splitlines() if l.lower().startswith("sitemap:")]
        except httpx.HTTPError:
            pass
        return found or [f"{origin}/sitemap.xml"]

    def sitemap_urls(self, sitemap_url: str, depth: int = 0) -> list[str]:
        if depth > 2:
            return []
        try:
            r = self.client.get(sitemap_url)
            if r.status_code != 200:
                return []
            root = ET.fromstring(r.content)
        except (httpx.HTTPError, ET.ParseError):
            return []
        ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
        if root.tag.endswith("sitemapindex"):
            out = []
            for loc in root.findall("sm:sitemap/sm:loc", ns):
                out += self.sitemap_urls(loc.text.strip(), depth + 1)
            return out
        return [loc.text.strip() for loc in root.findall("sm:url/sm:loc", ns) if loc.text]

    # ---------- crawl ----------
    def in_scope(self, url: str, base: str, prefixes: list[str]) -> bool:
        u, b = urlparse(url), urlparse(base)
        if u.scheme not in ("http", "https") or u.netloc != b.netloc:
            return False
        return not prefixes or any(u.path.startswith(p) for p in prefixes)

    def crawl_source(self, source_id: int, max_pages: int | None = None, seed_urls: list[str] | None = None) -> CrawlReport:
        src = self.db.one("SELECT * FROM sources WHERE id=?", (source_id,))
        if not src or not src["base_url"]:
            raise ValueError("Fonte inesistente o senza URL")
        max_pages = max_pages or self.settings.crawler_max_pages
        prefixes = jload(src["allowed_path_prefixes"], []) or []
        job_id = self.db.run("INSERT INTO crawl_jobs (source_id,started_at,status) VALUES (?,?,'running')", (source_id, now_iso()))
        rep = CrawlReport(job_id)
        try:
            queue: deque[str] = deque(seed_urls or [])
            if not seed_urls:
                for sm in self.discover_sitemaps(src["base_url"]):
                    queue.extend(u for u in self.sitemap_urls(sm) if self.in_scope(u, src["base_url"], prefixes))
                queue.appendleft(src["base_url"])
            seen: set[str] = set()
            follow_links = not seed_urls
            while queue and rep.seen < max_pages:
                url = queue.popleft()
                if url in seen:
                    continue
                seen.add(url)
                if not self.allowed(url):
                    rep.skipped += 1
                    self._result(job_id, url, "skipped_robots", None, "robots.txt non consente o non leggibile")
                    continue
                rep.seen += 1
                links = self._fetch_one(src, url, rep)
                if rep.stopped_reason:
                    break
                if follow_links:
                    queue.extend(l for l in links if l not in seen and self.in_scope(l, src["base_url"], prefixes))
                self.sleep(self.settings.crawler_delay_s)
            status = "failed" if rep.stopped_reason else "done"
            self.db.run("""UPDATE crawl_jobs SET finished_at=?, status=?, pages_seen=?, pages_changed=?, pages_gone=?, error=?
                           WHERE id=?""", (now_iso(), status, rep.seen, rep.new + rep.changed, rep.gone,
                                           rep.stopped_reason, job_id))
            self.db.run("UPDATE sources SET last_crawl_at=?, last_crawl_status=?, last_error=? WHERE id=?",
                        (now_iso(), status, rep.stopped_reason, source_id))
        except Exception as e:
            self.db.run("UPDATE crawl_jobs SET finished_at=?, status='failed', error=? WHERE id=?", (now_iso(), str(e), job_id))
            self.db.run("UPDATE sources SET last_crawl_at=?, last_crawl_status='failed', last_error=? WHERE id=?",
                        (now_iso(), str(e), source_id))
            raise
        audit(self.db, "job:crawl", "kb.crawl", "source", source_id, rep.__dict__)
        return rep

    def _result(self, job_id, url, outcome, status, detail=None):
        self.db.run("INSERT INTO crawl_results (crawl_job_id,url,outcome,http_status,detail,at) VALUES (?,?,?,?,?,?)",
                    (job_id, url, outcome, status, detail, now_iso()))

    def _fetch_one(self, src: dict, url: str, rep: CrawlReport) -> list[str]:
        prev = self.db.one("SELECT etag, last_modified FROM documents WHERE url=?", (url,))
        headers = {}
        if prev and prev["etag"]:
            headers["If-None-Match"] = prev["etag"]
        if prev and prev["last_modified"]:
            headers["If-Modified-Since"] = prev["last_modified"]
        try:
            r = self.client.get(url, headers=headers)
        except httpx.HTTPError as e:
            rep.errors.append(f"{url}: {e}")
            self._result(rep.job_id, url, "error", None, str(e))
            return []
        if r.status_code == 304:
            rep.unchanged += 1
            self.db.run("UPDATE documents SET last_checked_at=? WHERE url=?", (now_iso(), url))
            self._result(rep.job_id, url, "unchanged", 304)
            return []
        if r.status_code in STOP_STATUSES:
            rep.stopped_reason = f"HTTP {r.status_code} su {url}: accesso negato o limitato, scansione interrotta"
            self._result(rep.job_id, url, "error", r.status_code, rep.stopped_reason)
            log.warning("crawl stopped", extra={"data": {"url": url, "status": r.status_code}})
            return []
        if r.status_code in GONE_STATUSES:
            if self.store.mark_gone(url, r.status_code):
                rep.gone += 1
            self._result(rep.job_id, url, "gone", r.status_code)
            return []
        if r.status_code != 200:
            rep.errors.append(f"{url}: HTTP {r.status_code}")
            self._result(rep.job_id, url, "error", r.status_code)
            return []
        if len(r.content) > MAX_BYTES:
            self._result(rep.job_id, url, "error", 200, "documento troppo grande")
            return []
        ctype = r.headers.get("content-type", "").split(";")[0].strip().lower()
        final_url = str(r.url)
        try:
            if ctype == "application/pdf" or final_url.lower().endswith(".pdf"):
                ex, links, ctype = extract_pdf(r.content, final_url), [], "application/pdf"
            elif ctype in ("text/html", "application/xhtml+xml", ""):
                ex = extract_html(r.text, final_url)
                links = ex.links
            else:
                self._result(rep.job_id, url, "skipped", 200, f"tipo non supportato: {ctype}")
                return []
            doc_url = ex.canonical if ex.canonical and urlparse(ex.canonical).netloc == urlparse(url).netloc else url
            res = self.store.upsert(src["id"], doc_url, ex, ctype, region=src["region"], http_status=200,
                                    etag=r.headers.get("etag"), last_modified=r.headers.get("last-modified"))
        except ValueError as e:
            self._result(rep.job_id, url, "error", 200, str(e))
            return []
        counter = res.outcome if res.outcome in ("new", "changed") else "unchanged"
        setattr(rep, counter, getattr(rep, counter) + 1)
        self._result(rep.job_id, url, res.outcome, 200)
        return links


def import_file(db: Database, source_id: int, filename: str, data: bytes, url: str | None = None) -> dict:
    """Import manuale di un PDF o HTML (es. manuale scaricato dal Support Center)."""
    store = KnowledgeStore(db)
    ref = url or f"upload://{filename}"
    if filename.lower().endswith(".pdf") or data[:4] == b"%PDF":
        ex, ctype = extract_pdf(data, ref), "application/pdf"
    else:
        ex, ctype = extract_html(data.decode("utf-8", errors="replace"), ref), "text/html"
    src = db.one("SELECT region FROM sources WHERE id=?", (source_id,))
    if not src:
        raise ValueError("Fonte inesistente")
    res = store.upsert(source_id, ref, ex, ctype, region=src["region"])
    return {"document_id": res.document_id, "outcome": res.outcome, "version": res.version, "title": ex.title}
