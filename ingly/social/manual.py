"""Import manuale: per fonti senza API consentita (es. gruppi Facebook).

L'operatore incolla o carica i testi che ha visto; il sistema li analizza e prepara bozze
che l'operatore pubblica a mano. Nessuna pubblicazione automatica è possibile.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json

from .base import Capabilities, IncomingItem, NotSupported


def stable_id(source_id: int, author: str | None, text: str) -> str:
    norm = " ".join(text.lower().split())
    return "manual:" + hashlib.sha256(f"{source_id}|{(author or '').lower()}|{norm}".encode()).hexdigest()[:32]


class ManualConnector:
    platform = "manual"

    def capabilities(self) -> Capabilities:
        return Capabilities(read_posts=True, read_comments=True, notes=[
            "Contenuti inseriti a mano dall'operatore", "Pubblicazione solo manuale: copia la risposta approvata"])

    def fetch_new(self, source: dict, since: str | None) -> list[IncomingItem]:
        return []

    def reply(self, item: dict, text: str) -> str:
        raise NotSupported("Fonte manuale: pubblica la risposta a mano e segna l'elemento come gestito")

    @staticmethod
    def parse(source_id: int, raw: str, fmt: str = "text") -> list[IncomingItem]:
        """fmt=text: un messaggio per blocco separato da riga vuota, opzionale 'Autore: testo' in prima riga.
        fmt=csv: colonne author,text[,permalink,created_at]. fmt=json: lista di oggetti con le stesse chiavi."""
        rows: list[dict] = []
        if fmt == "csv":
            rows = list(csv.DictReader(io.StringIO(raw)))
        elif fmt == "json":
            data = json.loads(raw)
            rows = data if isinstance(data, list) else [data]
        else:
            for block in [b.strip() for b in raw.replace("\r\n", "\n").split("\n\n") if b.strip()]:
                author, text = None, block
                first, _, rest = block.partition("\n")
                if ":" in first and len(first.split(":", 1)[0]) <= 40 and first.split(":", 1)[1].strip():
                    author, text = first.split(":", 1)[0].strip(), (first.split(":", 1)[1] + "\n" + rest).strip()
                rows.append({"author": author, "text": text})
        items = []
        for r in rows:
            text = (r.get("text") or "").strip()
            if not text:
                continue
            author = (r.get("author") or None)
            permalink = r.get("permalink") or None
            if permalink and not permalink.startswith("https://"):
                permalink = None
            items.append(IncomingItem(stable_id(source_id, author, text), "post", text[:5000], author_ref=author,
                                      author_name=author, permalink=permalink, created_at=r.get("created_at") or None))
        return items
