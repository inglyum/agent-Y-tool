"""Estrazione e normalizzazione di testo da HTML e PDF."""
from __future__ import annotations

import io
import re
import unicodedata
from dataclasses import dataclass, field
from html.parser import HTMLParser
from urllib.parse import urljoin, urldefrag

SKIP_TAGS = {"script", "style", "noscript", "svg", "nav", "footer", "header", "form", "iframe", "template", "button"}
BLOCK_TAGS = {"p", "div", "section", "article", "li", "ul", "ol", "table", "tr", "td", "th", "br", "main",
              "h1", "h2", "h3", "h4", "h5", "h6", "dd", "dt", "blockquote", "pre"}
HEADINGS = {"h1", "h2", "h3", "h4"}


@dataclass
class Extracted:
    title: str
    text: str
    language: str | None
    links: list[str] = field(default_factory=list)
    canonical: str | None = None
    sections: list[tuple[str | None, str]] = field(default_factory=list)  # (heading, testo)
    meta: dict = field(default_factory=dict)


class _Parser(HTMLParser):
    def __init__(self, base_url: str):
        super().__init__(convert_charrefs=True)
        self.base = base_url
        self.skip = 0
        self.title = ""
        self.in_title = False
        self.lang: str | None = None
        self.canonical: str | None = None
        self.links: list[str] = []
        self.meta: dict = {}
        self.sections: list[tuple[str | None, list[str]]] = [(None, [])]
        self.heading_buf: list[str] | None = None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "html" and a.get("lang"):
            self.lang = a["lang"]
        if tag in SKIP_TAGS:
            self.skip += 1
            return
        if tag == "title":
            self.in_title = True
        elif tag == "link" and (a.get("rel") or "").lower() == "canonical" and a.get("href"):
            self.canonical = urljoin(self.base, a["href"])
        elif tag == "meta" and a.get("name") in ("description",) and a.get("content"):
            self.meta["description"] = a["content"]
        elif tag == "meta" and a.get("property") == "og:type" and a.get("content"):
            self.meta["og_type"] = a["content"]
        elif tag == "a" and a.get("href") and not self.skip:
            self.links.append(urldefrag(urljoin(self.base, a["href"]))[0])
        if self.skip:
            return
        if tag in HEADINGS:
            self.heading_buf = []
        elif tag in BLOCK_TAGS:
            self.sections[-1][1].append("\n")

    def handle_endtag(self, tag):
        if tag in SKIP_TAGS:
            self.skip = max(0, self.skip - 1)
            return
        if tag == "title":
            self.in_title = False
        if self.skip:
            return
        if tag in HEADINGS and self.heading_buf is not None:
            h = normalize_ws(" ".join(self.heading_buf))
            self.heading_buf = None
            if h:
                self.sections.append((h, []))
        elif tag in BLOCK_TAGS:
            self.sections[-1][1].append("\n")

    def handle_data(self, data):
        if self.in_title:
            self.title += data
            return
        if self.skip:
            return
        if self.heading_buf is not None:
            self.heading_buf.append(data)
        else:
            self.sections[-1][1].append(data)


def normalize_ws(s: str) -> str:
    s = unicodedata.normalize("NFC", s)
    s = re.sub(r"[ \t ]+", " ", s)
    s = re.sub(r" *\n *", "\n", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


def extract_html(html: str, url: str) -> Extracted:
    p = _Parser(url)
    p.feed(html)
    p.close()
    sections = []
    for heading, parts in p.sections:
        body = normalize_ws("".join(parts))
        if body or heading:
            sections.append((heading, body))
    text = "\n\n".join((f"{h}\n{b}" if h else b) for h, b in sections).strip()
    links = list(dict.fromkeys(l for l in p.links if l.startswith(("http://", "https://"))))
    return Extracted(title=normalize_ws(p.title), text=text, language=(p.lang or None), links=links,
                     canonical=p.canonical, sections=sections, meta=p.meta)


def extract_pdf(data: bytes, url: str) -> Extracted:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    pages = [normalize_ws(pg.extract_text() or "") for pg in reader.pages]
    title = ""
    try:
        title = (reader.metadata.title or "") if reader.metadata else ""
    except Exception:  # metadati corrotti: non bloccano l'import
        title = ""
    sections = [(f"Pagina {i + 1}", t) for i, t in enumerate(pages) if t]
    return Extracted(title=title or url.rsplit("/", 1)[-1], text="\n\n".join(t for _, t in sections),
                     language=None, sections=sections, meta={"pages": len(pages)})


def guess_language(text: str) -> str | None:
    """Euristica leggera it/en (sufficiente per instradare; non è un rilevatore completo)."""
    t = f" {text.lower()} "
    it = sum(t.count(f" {w} ") for w in ("il", "la", "che", "di", "per", "non", "una", "sono", "con", "come", "ciao", "vorrei", "macchina"))
    en = sum(t.count(f" {w} ") for w in ("the", "and", "is", "for", "with", "what", "how", "can", "you", "machine", "which"))
    if it == en == 0:
        return None
    return "it" if it >= en else "en"


def chunk_sections(sections: list[tuple[str | None, str]], max_chars: int = 1200) -> list[tuple[str | None, str]]:
    """Raggruppa paragrafi per sezione in chunk di dimensione limitata."""
    chunks: list[tuple[str | None, str]] = []
    for heading, body in sections:
        paras = [p for p in body.split("\n") if p.strip()]
        buf = ""
        for para in paras:
            while len(para) > max_chars:  # paragrafo enorme: spezza su confine di frase
                cut = para.rfind(". ", 0, max_chars)
                cut = cut + 1 if cut > max_chars // 2 else max_chars
                if buf:
                    chunks.append((heading, buf.strip()))
                    buf = ""
                chunks.append((heading, para[:cut].strip()))
                para = para[cut:].strip()
            if len(buf) + len(para) + 1 > max_chars and buf:
                chunks.append((heading, buf.strip()))
                buf = ""
            buf += para + "\n"
        if buf.strip():
            chunks.append((heading, buf.strip()))
        elif heading and not paras:
            continue
    return chunks
