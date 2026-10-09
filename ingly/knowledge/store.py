"""Archivio documentale versionato + indici full-text e vettoriale (SQLite FTS5 / PostgreSQL tsvector + pgvector)."""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass

from ..audit import audit
from ..db import Conn, Database, jdump, jload, now_iso
from .embed import Embedder, HashingEmbedder, to_blob, to_pgvector
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


def page_of(heading: str | None) -> int | None:
    m = re.match(r"Pagina (\d+)$", heading or "")
    return int(m.group(1)) if m else None


class KnowledgeStore:
    def __init__(self, db: Database, embedder: Embedder | None = None):
        self.db = db
        self.embedder = embedder or HashingEmbedder()

    # ---------- indice ----------
    def _index_chunk(self, c: Conn, chunk_id: int, heading: str | None, title: str | None, text: str,
                     vector: list[float]) -> None:
        if self.db.is_postgres:
            c.execute("""UPDATE document_chunks SET embedding=CAST(? AS vector), embedding_model=?,
                         tsv=to_tsvector('simple', coalesce(?,'') || ' ' || coalesce(?,'') || ' ' || ?) WHERE id=?""",
                      (to_pgvector(vector), self.embedder.name, title, heading, text, chunk_id))
        else:
            c.execute("UPDATE document_chunks SET embedding=?, embedding_model=? WHERE id=?",
                      (to_blob(vector), self.embedder.name, chunk_id))
            c.execute("INSERT INTO document_chunks_fts (rowid,text,heading,title) VALUES (?,?,?,?)",
                      (chunk_id, text, heading or "", title or ""))

    def _deactivate_chunks(self, c: Conn, document_id: int) -> None:
        if not self.db.is_postgres:
            for r in c.execute("SELECT id FROM document_chunks WHERE document_id=? AND active=1", (document_id,)).fetchall():
                c.execute("DELETE FROM document_chunks_fts WHERE rowid=?", (r[0],))
        c.execute("UPDATE document_chunks SET active=0 WHERE document_id=?", (document_id,))

    # ---------- scrittura ----------
    def upsert(self, source_id: int, url: str, ex: Extracted, content_type: str, region: str | None = None,
               http_status: int | None = 200, etag: str | None = None, last_modified: str | None = None) -> UpsertResult:
        if not ex.text.strip():
            raise ValueError("Documento senza testo estraibile")
        h = content_hash(ex.text)
        lang = (ex.language or guess_language(ex.text) or "").split("-")[0] or None
        aliases = product_aliases(self.db)
        sections = ex.sections or [(None, ex.text)]
        chunks = chunk_sections(sections)
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
                version = c.execute("SELECT COALESCE(MAX(version),0) AS v FROM document_versions WHERE document_id=?",
                                    (did,)).fetchone()["v"] + 1
                outcome = "changed"
            vid = c.execute("""INSERT INTO document_versions (document_id,version,content_hash,title,text,metadata,fetched_at)
                               VALUES (?,?,?,?,?,?,?)""",
                            (did, version, h, ex.title, ex.text, jdump(ex.meta), now)).lastrowid
            self._deactivate_chunks(c, did)
            vectors = self.embedder.embed([f"{ex.title or ''}\n{hd or ''}\n{tx}" for hd, tx in chunks]) if chunks else []
            for i, ((heading, text), vec) in enumerate(zip(chunks, vectors)):
                prods = detect_products(f"{ex.title}\n{heading or ''}\n{text}", aliases)
                cid = c.execute("""INSERT INTO document_chunks (document_id,version_id,ordinal,heading,page,text,product_keys,region)
                                   VALUES (?,?,?,?,?,?,?,?)""",
                                (did, vid, i, heading, page_of(heading), text, jdump(prods), region)).lastrowid
                self._index_chunk(c, cid, heading, ex.title, text, vec)
            c.execute("""UPDATE documents SET title=?, content_type=?, language=?, status='active', removed_reason=NULL,
                         current_version_id=?, content_hash=?, last_checked_at=?, last_changed_at=?, http_status=?, etag=?,
                         last_modified=? WHERE id=?""",
                      (ex.title, content_type, lang, vid, h, now, now, http_status, etag, last_modified, did))
            c.execute("INSERT INTO knowledge_updates (document_id,kind,summary,detected_at) VALUES (?,?,?,?)",
                      (did, "new_document" if outcome == "new" else "changed",
                       f"{'Nuovo documento' if outcome == 'new' else 'Documento modificato'}: {ex.title or url}", now))
            audit(c, "system", f"kb.document.{outcome}", "document", did, {"url": url, "version": version})
        return UpsertResult(did, outcome, version)

    def mark_gone(self, url: str, http_status: int) -> bool:
        with self.db.tx() as c:
            doc = c.execute("SELECT id, title, status FROM documents WHERE url=?", (url,)).fetchone()
            if not doc or doc["status"] in ("gone", "removed"):
                return False
            self._deactivate_chunks(c, doc["id"])
            c.execute("UPDATE documents SET status='gone', http_status=?, last_checked_at=? WHERE id=?",
                      (http_status, now_iso(), doc["id"]))
            c.execute("INSERT INTO knowledge_updates (document_id,kind,summary,detected_at) VALUES (?,?,?,?)",
                      (doc["id"], "gone", f"Pagina non più disponibile ({http_status}): {doc['title'] or url}", now_iso()))
            audit(c, "system", "kb.document.gone", "document", doc["id"], {"url": url, "status": http_status})
        return True

    def remove(self, document_id: int, reason: str, user_id: int | None = None) -> bool:
        """Rimozione manuale: il documento esce da ricerche e risposte; versioni conservate per l'audit."""
        with self.db.tx() as c:
            doc = c.execute("SELECT id, url, status FROM documents WHERE id=?", (document_id,)).fetchone()
            if not doc or doc["status"] == "removed":
                return False
            self._deactivate_chunks(c, document_id)
            c.execute("UPDATE documents SET status='removed', removed_reason=?, last_checked_at=? WHERE id=?",
                      (reason, now_iso(), document_id))
            c.execute("INSERT INTO knowledge_updates (document_id,kind,summary,detected_at) VALUES (?,?,?,?)",
                      (document_id, "removed", f"Documento rimosso: {reason}", now_iso()))
            audit(c, f"user:{user_id}" if user_id else "system", "kb.document.remove", "document", document_id,
                  {"reason": reason}, user_id)
        return True

    def versions(self, document_id: int) -> list[dict]:
        return self.db.all("""SELECT id, version, content_hash, title, fetched_at, length(text) AS chars
                              FROM document_versions WHERE document_id=? ORDER BY version DESC""", (document_id,))

    def stale(self, days: int = 30) -> list[dict]:
        """Documenti attivi non ricontrollati da più di `days` giorni: da riverificare."""
        from datetime import timedelta
        cutoff = now_iso(-timedelta(days=days))
        return self.db.all("""SELECT d.id, d.url, d.title, d.last_checked_at, s.name AS source FROM documents d
                              JOIN sources s ON s.id=d.source_id WHERE d.status='active' AND d.last_checked_at < ?
                              ORDER BY d.last_checked_at""", (cutoff,))

    def reindex(self) -> int:
        """Ricalcola prodotti citati ed embedding dei chunk attivi (dopo nuovi alias o cambio di embedder)."""
        aliases = product_aliases(self.db)
        rows = self.db.all("""SELECT k.id, k.heading, k.text, d.title FROM document_chunks k
                              JOIN documents d ON d.id=k.document_id WHERE k.active=1""")
        for i in range(0, len(rows), 64):
            batch = rows[i:i + 64]
            vecs = self.embedder.embed([f"{r['title'] or ''}\n{r['heading'] or ''}\n{r['text']}" for r in batch])
            with self.db.tx() as c:
                for r, v in zip(batch, vecs):
                    prods = detect_products(f"{r['title'] or ''}\n{r['heading'] or ''}\n{r['text']}", aliases)
                    c.execute("UPDATE document_chunks SET product_keys=? WHERE id=?", (jdump(prods), r["id"]))
                    if self.db.is_postgres:
                        c.execute("UPDATE document_chunks SET embedding=CAST(? AS vector), embedding_model=? WHERE id=?",
                                  (to_pgvector(v), self.embedder.name, r["id"]))
                    else:
                        c.execute("UPDATE document_chunks SET embedding=?, embedding_model=? WHERE id=?",
                                  (to_blob(v), self.embedder.name, r["id"]))
        return len(rows)
