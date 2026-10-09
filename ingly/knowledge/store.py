"""Archivio documentale versionato + indice full-text."""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass

from ..audit import audit
from ..db import Database, jdump, jload, now_iso
from .extract import Extracted, chunk_sections, guess_language


@dataclass
class UpsertResult:
    document_id: int
    outcome: str  # new | changed | unchanged | duplicate
    version: int | None


def content_hash(text: str) -> str:
    norm = re.sub(r"\s+", " ", text).strip().lower()
    return hashlib.sha256(norm.encode()).hexdigest()


def product_aliases(db: Database) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for p in db.all("SELECT key, official_name, model, aliases FROM products WHERE status != 'retired'"):
        names = [p["official_name"], p["model"], *(jload(p["aliases"], []) or [])]
        out[p["key"]] = sorted({n.lower() for n in names if n and len(n) >= 2}, key=len, reverse=True)
    return out


def detect_products(text: str, aliases: dict[str, list[str]]) -> list[str]:
    t = text.lower()
    found = []
    for key, names in aliases.items():
        if any(re.search(rf"(?<![a-z0-9]){re.escape(n)}(?![a-z0-9])", t) for n in names):
            found.append(key)
    return found


class KnowledgeStore:
    def __init__(self, db: Database):
        self.db = db

    def upsert(self, source_id: int, url: str, ex: Extracted, content_type: str, region: str | None = None,
               http_status: int | None = 200, etag: str | None = None, last_modified: str | None = None) -> UpsertResult:
        if not ex.text.strip():
            raise ValueError("Documento senza testo estraibile")
        h = content_hash(ex.text)
        lang = (ex.language or guess_language(ex.text) or "").split("-")[0] or None
        aliases = product_aliases(self.db)
        with self.db.tx() as c:
            doc = c.execute("SELECT * FROM documents WHERE url=?", (url,)).fetchone()
            now = now_iso()
            if doc and doc["content_hash"] == h and doc["status"] == "active":
                c.execute("UPDATE documents SET last_checked_at=?, http_status=?, etag=?, last_modified=? WHERE id=?",
                          (now, http_status, etag, last_modified, doc["id"]))
                return UpsertResult(doc["id"], "unchanged", None)
            if not doc:
                dup = c.execute("SELECT id, url FROM documents WHERE content_hash=? AND status='active'", (h,)).fetchone()
                if dup:  # stesso contenuto a un altro URL: registriamo l'URL senza duplicare i chunk
                    did = c.execute("""INSERT INTO documents (source_id,url,title,content_type,language,region,status,content_hash,
                                       first_seen_at,last_checked_at,http_status) VALUES (?,?,?,?,?,?,'active',?,?,?,?)""",
                                    (source_id, url, ex.title, content_type, lang, region, h, now, now, http_status)).lastrowid
                    return UpsertResult(did, "duplicate", None)
                did = c.execute("""INSERT INTO documents (source_id,url,title,content_type,language,region,status,
                                   first_seen_at,last_checked_at,http_status,etag,last_modified)
                                   VALUES (?,?,?,?,?,?,'active',?,?,?,?,?)""",
                                (source_id, url, ex.title, content_type, lang, region, now, now, http_status, etag,
                                 last_modified)).lastrowid
                version, outcome = 1, "new"
            else:
                did = doc["id"]
                version = (c.execute("SELECT COALESCE(MAX(version),0) FROM document_versions WHERE document_id=?",
                                     (did,)).fetchone()[0]) + 1
                outcome = "changed"
            vid = c.execute("""INSERT INTO document_versions (document_id,version,content_hash,title,text,metadata,fetched_at)
                               VALUES (?,?,?,?,?,?,?)""",
                            (did, version, h, ex.title, ex.text, jdump(ex.meta), now)).lastrowid
            # disattiva i chunk precedenti e rimuovili dall'indice
            for r in c.execute("SELECT id FROM knowledge_chunks WHERE document_id=? AND active=1", (did,)).fetchall():
                c.execute("DELETE FROM knowledge_fts WHERE rowid=?", (r[0],))
            c.execute("UPDATE knowledge_chunks SET active=0 WHERE document_id=?", (did,))
            sections = ex.sections or [(None, ex.text)]
            for i, (heading, text) in enumerate(chunk_sections(sections)):
                prods = detect_products(f"{ex.title}\n{heading or ''}\n{text}", aliases)
                cid = c.execute("""INSERT INTO knowledge_chunks (document_id,version_id,ordinal,heading,text,product_keys,region)
                                   VALUES (?,?,?,?,?,?,?)""",
                                (did, vid, i, heading, text, jdump(prods), region)).lastrowid
                c.execute("INSERT INTO knowledge_fts (rowid,text,heading,title) VALUES (?,?,?,?)",
                          (cid, text, heading or "", ex.title or ""))
            c.execute("""UPDATE documents SET title=?, content_type=?, language=?, status='active', current_version_id=?,
                         content_hash=?, last_checked_at=?, last_changed_at=?, http_status=?, etag=?, last_modified=?
                         WHERE id=?""",
                      (ex.title, content_type, lang, vid, h, now, now, http_status, etag, last_modified, did))
            c.execute("INSERT INTO knowledge_updates (document_id,kind,summary,detected_at) VALUES (?,?,?,?)",
                      (did, "new_document" if outcome == "new" else "changed",
                       f"{'Nuovo documento' if outcome == 'new' else 'Documento modificato'}: {ex.title or url}", now))
            audit(c, "system", f"kb.document.{outcome}", "document", did, {"url": url, "version": version})
        return UpsertResult(did, outcome, version)

    def mark_gone(self, url: str, http_status: int) -> bool:
        with self.db.tx() as c:
            doc = c.execute("SELECT id, title, status FROM documents WHERE url=?", (url,)).fetchone()
            if not doc or doc["status"] == "gone":
                return False
            for r in c.execute("SELECT id FROM knowledge_chunks WHERE document_id=? AND active=1", (doc["id"],)).fetchall():
                c.execute("DELETE FROM knowledge_fts WHERE rowid=?", (r[0],))
            c.execute("UPDATE knowledge_chunks SET active=0 WHERE document_id=?", (doc["id"],))
            c.execute("UPDATE documents SET status='gone', http_status=?, last_checked_at=? WHERE id=?",
                      (http_status, now_iso(), doc["id"]))
            c.execute("INSERT INTO knowledge_updates (document_id,kind,summary,detected_at) VALUES (?,?,?,?)",
                      (doc["id"], "gone", f"Pagina non più disponibile ({http_status}): {doc['title'] or url}", now_iso()))
            audit(c, "system", "kb.document.gone", "document", doc["id"], {"url": url, "status": http_status})
        return True

    def versions(self, document_id: int) -> list[dict]:
        return self.db.all("""SELECT id, version, content_hash, title, fetched_at, length(text) AS chars
                              FROM document_versions WHERE document_id=? ORDER BY version DESC""", (document_id,))

    def reindex_products(self) -> int:
        """Ricalcola i prodotti citati nei chunk (dopo aver aggiunto alias al catalogo)."""
        aliases = product_aliases(self.db)
        n = 0
        with self.db.tx() as c:
            rows = c.execute("""SELECT k.id, k.heading, k.text, d.title FROM knowledge_chunks k
                                JOIN documents d ON d.id=k.document_id WHERE k.active=1""").fetchall()
            for r in rows:
                prods = detect_products(f"{r['title'] or ''}\n{r['heading'] or ''}\n{r['text']}", aliases)
                c.execute("UPDATE knowledge_chunks SET product_keys=? WHERE id=?", (jdump(prods), r["id"]))
                n += 1
        return n
