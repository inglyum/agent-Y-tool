"""Recupero ibrido delle fonti: full-text + vettoriale fusi con Reciprocal Rank Fusion,
pesati per autorevolezza della fonte, freschezza e prodotto. Rilevamento dei conflitti tra specifiche."""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field

from ..db import Database, jload, parse_iso, utcnow
from .embed import Embedder, HashingEmbedder, from_blob, to_pgvector

STOPWORDS = {
    # it
    "il", "lo", "la", "i", "gli", "le", "un", "uno", "una", "di", "a", "da", "in", "con", "su", "per", "tra", "fra",
    "e", "o", "ma", "che", "chi", "cosa", "come", "quale", "quali", "quanto", "mi", "ti", "si", "ci", "vi", "è", "sono",
    "del", "della", "dei", "delle", "al", "alla", "nel", "nella", "non", "più", "anche", "ho", "hai", "ha", "posso",
    "può", "ciao", "salve", "grazie", "qualcuno", "consigli", "consigliate", "vorrei", "questo", "questa",
    # en
    "the", "a", "an", "of", "to", "in", "on", "for", "with", "and", "or", "is", "are", "can", "i", "you", "it",
    "what", "which", "how", "my", "me", "do", "does", "hi", "hello", "thanks",
}
RRF_K = 60
STALE_DAYS = 90


@dataclass
class Hit:
    chunk_id: int
    document_id: int
    url: str
    title: str
    heading: str | None
    page: int | None
    text: str
    source_key: str
    source_kind: str
    source_priority: int
    last_checked_at: str | None
    acquired_at: str | None
    score: float
    products: list[str] = field(default_factory=list)
    stale: bool = False

    def citation(self) -> dict:
        return {"chunk_id": self.chunk_id, "url": self.url, "title": self.title, "section": self.heading, "page": self.page,
                "source": self.source_key, "official": self.source_kind.startswith("official"),
                "priority": self.source_priority, "acquired_at": self.acquired_at, "checked_at": self.last_checked_at,
                "stale": self.stale}


def query_terms(text: str) -> list[str]:
    words = re.findall(r"[\wàèéìòù]+", text.lower())
    terms = [w for w in words if w not in STOPWORDS and (len(w) > 2 or any(ch.isdigit() for ch in w))]
    return list(dict.fromkeys(terms))[:16]


def fts_query(terms: list[str]) -> str:
    # ogni termine tra virgolette (niente sintassi FTS dall'esterno) + prefisso per varianti
    return " OR ".join(f'"{t}"*' if len(t) > 3 else f'"{t}"' for t in terms)


def ts_query(terms: list[str]) -> str:
    safe = [re.sub(r"[^\wàèéìòù]", "", t) for t in terms]
    return " | ".join(f"{t}:*" if len(t) > 3 else t for t in safe if t)


BASE_COLS = """k.id AS chunk_id, k.document_id, k.heading, k.page, k.text, k.product_keys, k.region,
               d.url, d.title, d.last_checked_at, v.fetched_at AS acquired_at,
               s.key AS source_key, s.kind AS source_kind, s.priority"""
BASE_JOIN = """JOIN documents d ON d.id = k.document_id AND d.status = 'active'
               JOIN document_versions v ON v.id = k.version_id
               JOIN sources s ON s.id = d.source_id"""


class Retriever:
    def __init__(self, db: Database, embedder: Embedder | None = None):
        self.db = db
        self.embedder = embedder or HashingEmbedder()

    # ---------- canali di ricerca ----------
    def _lexical(self, terms: list[str]) -> list[dict]:
        if self.db.is_postgres:
            return self.db.all(f"""SELECT {BASE_COLS}, ts_rank_cd(k.tsv, to_tsquery('simple', ?)) AS lex
                                   FROM document_chunks k {BASE_JOIN}
                                   WHERE k.active = 1 AND k.tsv @@ to_tsquery('simple', ?)
                                   ORDER BY lex DESC LIMIT 60""", (ts_query(terms), ts_query(terms)))
        return self.db.all(f"""SELECT {BASE_COLS}, -bm25(document_chunks_fts, 1.0, 2.0, 1.5) AS lex
                               FROM document_chunks_fts JOIN document_chunks k ON k.id = document_chunks_fts.rowid AND k.active = 1
                               {BASE_JOIN}
                               WHERE document_chunks_fts MATCH ? ORDER BY lex DESC LIMIT 60""", (fts_query(terms),))

    def _vector(self, text: str) -> list[dict]:
        qv = self.embedder.embed([text], kind="query")[0]
        if self.db.is_postgres:
            return self.db.all(f"""SELECT {BASE_COLS}, 1 - (k.embedding <=> CAST(? AS vector)) AS sim
                                   FROM document_chunks k {BASE_JOIN}
                                   WHERE k.active = 1 AND k.embedding_model = ?
                                   ORDER BY k.embedding <=> CAST(? AS vector) LIMIT 60""",
                               (to_pgvector(qv), self.embedder.name, to_pgvector(qv)))
        rows = self.db.all(f"""SELECT {BASE_COLS}, k.embedding FROM document_chunks k {BASE_JOIN}
                               WHERE k.active = 1 AND k.embedding_model = ?""", (self.embedder.name,))
        if not rows:
            return []
        import numpy as np
        mat = np.array([from_blob(r.pop("embedding")) for r in rows], dtype=np.float32)
        sims = mat @ np.array(qv, dtype=np.float32)
        for r, s in zip(rows, sims):
            r["sim"] = float(s)
        return sorted(rows, key=lambda r: r["sim"], reverse=True)[:60]

    # ---------- ricerca ibrida ----------
    def search(self, text: str, products: list[str] | None = None, region: str | None = None,
               max_age_days: int | None = None, limit: int = 6, min_similarity: float = 0.25) -> list[Hit]:
        terms = query_terms(text)
        if not terms:
            return []
        lexical = self._lexical(terms)
        # il canale vettoriale entra solo sopra una soglia di similarità, per non portare rumore
        vector = [r for r in self._vector(" ".join(terms)) if r["sim"] >= min_similarity]
        fused: dict[int, dict] = {}
        for channel in (lexical, vector):
            for rank, r in enumerate(channel):
                e = fused.setdefault(r["chunk_id"], {**r, "rrf": 0.0})
                e["rrf"] += 1.0 / (RRF_K + rank + 1)
        hits: list[Hit] = []
        now = utcnow()
        for r in fused.values():
            prods = jload(r["product_keys"], []) or []
            if region and r["region"] and r["region"] not in (region, "global"):
                continue
            checked = parse_iso(r["last_checked_at"])
            age_days = (now - checked).days if checked else 9999
            if max_age_days is not None and age_days > max_age_days:
                continue
            prio = 1.0 + (10 - min(r["priority"], 9)) / 10     # priorità 1 → 1.9, 9 → 1.1
            fresh = 1.0 if age_days <= 30 else (0.9 if age_days <= STALE_DAYS else 0.75)
            prod_boost = 1.5 if products and set(prods) & set(products) else 1.0
            prod_penalty = 0.6 if products and prods and not set(prods) & set(products) else 1.0
            # copertura dei termini nel testo del singolo chunk (il titolo è comune a tutti i chunk del documento)
            body = f"{r['heading'] or ''} {r['text']}".lower()
            coverage = sum(1 for t in terms if t[:5] in body) / len(terms)
            hits.append(Hit(r["chunk_id"], r["document_id"], r["url"], r["title"] or r["url"], r["heading"], r["page"],
                            r["text"], r["source_key"], r["source_kind"], r["priority"], r["last_checked_at"],
                            r["acquired_at"], r["rrf"] * prio * fresh * prod_boost * prod_penalty * (0.5 + coverage), prods,
                            stale=age_days > STALE_DAYS))
        hits.sort(key=lambda h: h.score, reverse=True)
        out, per_doc = [], {}
        for h in hits:  # al massimo 2 chunk per documento per diversificare le fonti
            if per_doc.get(h.document_id, 0) >= 2:
                continue
            per_doc[h.document_id] = per_doc.get(h.document_id, 0) + 1
            out.append(h)
            if len(out) >= limit:
                break
        return out

    @staticmethod
    def evidence_score(query: str, hits: list[Hit]) -> float:
        """0..1: quanto le fonti recuperate coprono i termini della domanda, pesato per autorevolezza.
        È una misura di copertura, non una prova di correttezza."""
        terms = query_terms(query)
        if not terms or not hits:
            return 0.0
        covered = set()
        official = False
        for h in hits:
            body = f"{h.title} {h.heading or ''} {h.text}".lower()
            covered |= {t for t in terms if t[:5] in body}
            official = official or h.source_kind.startswith("official")
        coverage = len(covered) / len(terms)
        return round(min(1.0, coverage * (1.0 if official else 0.6) * (1 - math.exp(-len(hits) / 2)) * 1.15), 3)

    def conflicts(self, product_keys: list[str] | None = None) -> list[dict]:
        """Specifiche con lo stesso nome ma valori diversi tra fonti non superate."""
        agg = (lambda e: f"string_agg(DISTINCT {e}, '|')") if self.db.is_postgres else (lambda e: f"GROUP_CONCAT(DISTINCT {e})")
        sep = "|" if self.db.is_postgres else ","
        sql = f"""SELECT p.key AS product, ps.name, {agg("ps.value || COALESCE(' ' || ps.unit, '')")} AS values_,
                        {agg("ps.source_url")} AS sources, COUNT(DISTINCT ps.value) AS n
                 FROM product_specs ps JOIN products p ON p.id = ps.product_id
                 WHERE ps.status IN ('verified','to_verify')"""
        params: list = []
        if product_keys:
            sql += f" AND p.key IN ({','.join('?' * len(product_keys))})"
            params += product_keys
        sql += " GROUP BY p.key, ps.name HAVING COUNT(DISTINCT ps.value) > 1"
        return [{"product": r["product"], "spec": r["name"], "values": r["values_"].split(sep),
                 "sources": r["sources"].split(sep)} for r in self.db.all(sql, tuple(params))]
