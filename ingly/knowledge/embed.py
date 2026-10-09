"""Embedding per la ricerca ibrida.

- `hashing` (predefinito, offline): vettori da parole e trigrammi di caratteri. Tollera refusi, plurali e
  varianti ("incisione"/"incidere") ma NON è semantico: non sa che "taglio" e "cut" sono la stessa cosa.
- `voyage`: embedding semantici via API (richiede INGLY_EMBEDDINGS_API_KEY).

Cambiando embedder bisogna rigenerare i vettori: `python -m ingly reembed`.
"""
from __future__ import annotations

import hashlib
import math
import re
import struct
from typing import Protocol

import httpx


class Embedder(Protocol):
    name: str
    dim: int

    def embed(self, texts: list[str], kind: str = "document") -> list[list[float]]: ...


def _normalize(v: list[float]) -> list[float]:
    n = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / n for x in v]


class HashingEmbedder:
    name = "hashing-v1"

    def __init__(self, dim: int = 384):
        self.dim = dim

    def _features(self, text: str) -> list[str]:
        words = re.findall(r"[\wàèéìòù]+", text.lower())
        feats = [f"w:{w}" for w in words if len(w) > 2]
        for w in words:
            p = f"#{w}#"
            feats += [f"g:{p[i:i + 3]}" for i in range(len(p) - 2)]
        return feats

    def embed(self, texts: list[str], kind: str = "document") -> list[list[float]]:
        out = []
        for t in texts:
            v = [0.0] * self.dim
            for f in self._features(t):
                h = int.from_bytes(hashlib.blake2b(f.encode(), digest_size=8).digest(), "little")
                v[h % self.dim] += (1.0 if (h >> 63) & 1 else -1.0) * (2.0 if f.startswith("w:") else 1.0)
            out.append(_normalize(v))
        return out


class VoyageEmbedder:
    """Adattatore HTTP per Voyage AI (non verificato dal vivo in questo ambiente)."""

    def __init__(self, api_key: str, model: str = "voyage-3.5", dim: int = 1024, client: httpx.Client | None = None):
        self.api_key, self.model, self.dim = api_key, model, dim
        self.name = f"voyage:{model}"
        self.http = client or httpx.Client(timeout=30)

    def embed(self, texts: list[str], kind: str = "document") -> list[list[float]]:
        out: list[list[float]] = []
        for i in range(0, len(texts), 64):
            r = self.http.post("https://api.voyageai.com/v1/embeddings",
                               headers={"Authorization": f"Bearer {self.api_key}"},
                               json={"input": texts[i:i + 64], "model": self.model, "input_type": kind,
                                     "output_dimension": self.dim})
            r.raise_for_status()
            out += [d["embedding"] for d in sorted(r.json()["data"], key=lambda d: d["index"])]
        return out


def build_embedder(settings) -> Embedder:
    kind = getattr(settings, "embeddings_provider", "hashing")
    if kind == "voyage":
        if not settings.embeddings_api_key:
            raise ValueError("INGLY_EMBEDDINGS_API_KEY mancante per l'embedder voyage")
        return VoyageEmbedder(settings.embeddings_api_key, settings.embeddings_model or "voyage-3.5")
    if kind in ("hashing", "", None):
        return HashingEmbedder()
    raise ValueError(f"Embedder non supportato: {kind}")


def to_blob(v: list[float]) -> bytes:
    return struct.pack(f"<{len(v)}f", *v)


def from_blob(b: bytes) -> list[float]:
    return list(struct.unpack(f"<{len(b) // 4}f", b))


def to_pgvector(v: list[float]) -> str:
    return "[" + ",".join(f"{x:.6f}" for x in v) + "]"
