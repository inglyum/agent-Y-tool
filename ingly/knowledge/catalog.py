"""Catalogo prodotti/accessori/materiali/compatibilità con stato di verifica e campi mancanti."""
from __future__ import annotations

import re
from pathlib import Path

import yaml

from ..audit import audit
from ..config import ROOT
from ..db import Database, jdump, jload, now_iso

STATUSES = ("verified", "to_verify", "superseded", "retired")
PRODUCT_REQUIRED = ["official_name", "family", "category", "technology", "nominal_power", "work_area",
                    "supported_materials", "software", "source_url", "verified_at"]
PRODUCT_FIELDS = ["brand", "official_name", "family", "model", "revision", "category", "market", "technology",
                  "source_type", "nominal_power", "work_area", "supported_materials", "declared_limitations",
                  "software", "firmware_notes", "manual_urls", "aliases", "status", "source_url", "verified_at"]
JSON_FIELDS = {"supported_materials", "declared_limitations", "software", "manual_urls", "aliases", "precautions"}


def slugify(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def _require_source(data: dict, what: str) -> None:
    if data.get("status") == "verified" and not (data.get("source_url") and data.get("verified_at")):
        raise ValueError(f"{what}: lo stato 'verificato' richiede source_url e verified_at")
    if data.get("status") and data["status"] not in STATUSES:
        raise ValueError(f"Stato non valido: {data['status']}")


class Catalog:
    def __init__(self, db: Database):
        self.db = db

    # ---------- prodotti ----------
    def upsert_product(self, data: dict, user_id: int | None = None) -> int:
        if not data.get("official_name"):
            raise ValueError("official_name obbligatorio")
        _require_source(data, "Prodotto")
        key = data.get("key") or slugify(data["official_name"])
        vals = {f: (jdump(data[f]) if f in JSON_FIELDS else data[f]) for f in PRODUCT_FIELDS if f in data}
        vals["updated_at"] = now_iso()
        existing = self.db.one("SELECT id FROM products WHERE key=?", (key,))
        if existing:
            sets = ", ".join(f"{k}=?" for k in vals)
            self.db.run(f"UPDATE products SET {sets} WHERE id=?", (*vals.values(), existing["id"]))
            pid = existing["id"]
        else:
            cols = ["key", *vals]
            pid = self.db.run(f"INSERT INTO products ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})",
                              (key, *vals.values()))
        audit(self.db, f"user:{user_id}" if user_id else "system", "catalog.product.upsert", "product", key, data, user_id)
        return pid

    def add_spec(self, product_key: str, name: str, value: str, unit: str | None, source_url: str,
                 verified_at: str | None = None, status: str = "to_verify", document_id: int | None = None) -> int:
        if not source_url:
            raise ValueError("Ogni specifica richiede la fonte")
        p = self.db.one("SELECT id FROM products WHERE key=?", (product_key,))
        if not p:
            raise ValueError(f"Prodotto sconosciuto: {product_key}")
        return self.db.run("""INSERT INTO product_specs (product_id,name,value,unit,source_url,document_id,verified_at,status)
                              VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(product_id,name,source_url)
                              DO UPDATE SET value=excluded.value, unit=excluded.unit, verified_at=excluded.verified_at,
                              status=excluded.status""",
                           (p["id"], name, value, unit, source_url, document_id, verified_at, status))

    def products(self, q: str | None = None, category: str | None = None) -> list[dict]:
        sql, params = "SELECT * FROM products WHERE 1=1", []
        if q:
            sql += " AND (official_name LIKE ? OR family LIKE ? OR model LIKE ? OR aliases LIKE ?)"
            params += [f"%{q}%"] * 4
        if category:
            sql += " AND category=?"
            params.append(category)
        rows = self.db.all(sql + " ORDER BY family, official_name", tuple(params))
        for r in rows:
            for f in JSON_FIELDS & r.keys():
                r[f] = jload(r[f], [])
            r["missing_fields"] = self.missing_fields(r)
        return rows

    def product(self, key: str) -> dict | None:
        rows = [r for r in self.products() if r["key"] == key]
        if not rows:
            return None
        p = rows[0]
        p["specs"] = self.db.all("SELECT name,value,unit,source_url,verified_at,status FROM product_specs WHERE product_id=?",
                                 (p["id"],))
        p["compatibility"] = self.db.all("""SELECT a.key AS accessory, a.official_name, c.relation, c.conditions, c.source_url,
                                            c.verified_at, c.status FROM compatibility_rules c
                                            JOIN accessories a ON a.id=c.accessory_id WHERE c.product_id=?""", (p["id"],))
        return p

    @staticmethod
    def missing_fields(p: dict) -> list[str]:
        return [f for f in PRODUCT_REQUIRED if p.get(f) in (None, "", [], "[]")]

    # ---------- accessori e compatibilità ----------
    def upsert_accessory(self, data: dict) -> int:
        if not data.get("official_name"):
            raise ValueError("official_name obbligatorio")
        _require_source(data, "Accessorio")
        key = data.get("key") or slugify(data["official_name"])
        self.db.run("""INSERT INTO accessories (key,official_name,category,function,aliases,status,source_url,verified_at,updated_at)
                       VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET official_name=excluded.official_name,
                       category=excluded.category, function=excluded.function, aliases=excluded.aliases,
                       status=excluded.status, source_url=excluded.source_url, verified_at=excluded.verified_at,
                       updated_at=excluded.updated_at""",
                    (key, data["official_name"], data.get("category"), data.get("function"), jdump(data.get("aliases")),
                     data.get("status", "to_verify"), data.get("source_url"), data.get("verified_at"), now_iso()))
        return self.db.one("SELECT id FROM accessories WHERE key=?", (key,))["id"]

    def set_compatibility(self, product_key: str, accessory_key: str, relation: str, source_url: str,
                          verified_at: str | None = None, conditions: str | None = None, status: str = "to_verify") -> None:
        if not source_url:
            raise ValueError("Una compatibilità richiede sempre la fonte")
        p = self.db.one("SELECT id FROM products WHERE key=?", (product_key,))
        a = self.db.one("SELECT id FROM accessories WHERE key=?", (accessory_key,))
        if not p or not a:
            raise ValueError("Prodotto o accessorio sconosciuto")
        self.db.run("""INSERT INTO compatibility_rules (product_id,accessory_id,relation,conditions,source_url,verified_at,status)
                       VALUES (?,?,?,?,?,?,?) ON CONFLICT(product_id,accessory_id,relation,source_url)
                       DO UPDATE SET conditions=excluded.conditions, verified_at=excluded.verified_at, status=excluded.status""",
                    (p["id"], a["id"], relation, conditions, source_url, verified_at, status))

    def compatibility(self, product_key: str, accessory_key: str) -> dict:
        """Risposta prudente: 'unknown' se non c'è una regola verificata."""
        rows = self.db.all("""SELECT c.relation, c.status, c.source_url, c.verified_at, c.conditions FROM compatibility_rules c
                              JOIN products p ON p.id=c.product_id JOIN accessories a ON a.id=c.accessory_id
                              WHERE p.key=? AND a.key=? AND c.status != 'superseded'""", (product_key, accessory_key))
        verified = [r for r in rows if r["status"] == "verified"]
        if not verified:
            return {"answer": "unknown", "reason": "Nessuna compatibilità verificata su fonte ufficiale", "rules": rows}
        relations = {r["relation"] for r in verified}
        if "incompatible" in relations and relations & {"compatible", "required", "recommended"}:
            return {"answer": "conflict", "reason": "Fonti verificate in contrasto", "rules": verified}
        return {"answer": "incompatible" if "incompatible" in relations else "compatible", "rules": verified}

    def accessories(self) -> list[dict]:
        rows = self.db.all("SELECT * FROM accessories ORDER BY official_name")
        for r in rows:
            r["aliases"] = jload(r["aliases"], [])
            r["compatible_with"] = self.db.all("""SELECT p.key, p.official_name, c.relation, c.status, c.source_url
                                                  FROM compatibility_rules c JOIN products p ON p.id=c.product_id
                                                  WHERE c.accessory_id=?""", (r["id"],))
        return rows

    # ---------- materiali ----------
    def upsert_material(self, data: dict) -> int:
        if not data.get("name"):
            raise ValueError("name obbligatorio")
        _require_source(data, "Materiale")
        key = data.get("key") or slugify(data["name"])
        self.db.run("""INSERT INTO materials (key,name,aliases,precautions,avoid,avoid_reason,source_url,verified_at,status,updated_at)
                       VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET name=excluded.name, aliases=excluded.aliases,
                       precautions=excluded.precautions, avoid=excluded.avoid, avoid_reason=excluded.avoid_reason,
                       source_url=excluded.source_url, verified_at=excluded.verified_at, status=excluded.status,
                       updated_at=excluded.updated_at""",
                    (key, data["name"], jdump(data.get("aliases")), jdump(data.get("precautions")), int(bool(data.get("avoid"))),
                     data.get("avoid_reason"), data.get("source_url"), data.get("verified_at"), data.get("status", "to_verify"),
                     now_iso()))
        return self.db.one("SELECT id FROM materials WHERE key=?", (key,))["id"]

    def materials(self) -> list[dict]:
        rows = self.db.all("SELECT * FROM materials ORDER BY name")
        for r in rows:
            r["aliases"] = jload(r["aliases"], [])
            r["precautions"] = jload(r["precautions"], [])
        return rows

    def material_aliases(self) -> dict[str, list[str]]:
        return {m["key"]: [m["name"].lower(), *[a.lower() for a in m["aliases"]]] for m in self.materials()}

    # ---------- import dalle schede YAML esistenti (knowledge/) ----------
    def import_yaml_cards(self, base: Path | None = None) -> dict:
        base = base or ROOT / "knowledge"
        counts = {"products": 0, "accessories": 0, "materials": 0, "skipped_empty": 0}
        for f in sorted((base / "macchine").glob("*.yaml")):
            d = yaml.safe_load(f.read_text()) or {}
            if not d.get("nome"):
                counts["skipped_empty"] += 1
                continue
            comm = d.get("commerciale") or {}
            self.upsert_product({
                "key": d.get("slug"), "official_name": d["nome"], "family": d.get("famiglia"),
                "technology": d.get("tecnologia"), "nominal_power": d.get("potenza"), "work_area": d.get("area_lavoro"),
                "supported_materials": d.get("materiali") or [], "software": d.get("software") or [],
                "declared_limitations": d.get("limiti") or [], "source_url": d.get("url_scheda"),
                "verified_at": str(d["data_verifica"]) if d.get("data_verifica") else None,
                "status": "verified" if d.get("url_scheda") and d.get("data_verifica") else "to_verify",
                "market": "EU-IT" if comm else None,
            })
            counts["products"] += 1
        for f in sorted((base / "accessori").glob("*.yaml")):
            d = yaml.safe_load(f.read_text()) or {}
            if not d.get("nome"):
                counts["skipped_empty"] += 1
                continue
            self.upsert_accessory({"key": d.get("slug"), "official_name": d["nome"], "category": d.get("categoria"),
                                   "function": d.get("funzione"), "source_url": d.get("url_scheda"),
                                   "verified_at": str(d["data_verifica"]) if d.get("data_verifica") else None})
            counts["accessories"] += 1
        for f in sorted((base / "materiali").glob("*.yaml")):
            d = yaml.safe_load(f.read_text()) or {}
            if not d.get("nome"):
                counts["skipped_empty"] += 1
                continue
            self.upsert_material({"key": d.get("slug"), "name": d["nome"], "precautions": d.get("precauzioni") or [],
                                  "avoid": bool(d.get("da_evitare")), "avoid_reason": d.get("da_evitare")})
            counts["materials"] += 1
        return counts


def seed_sources(db: Database) -> int:
    """Registra le fonti da knowledge/fonti.yaml (solo URL reali indicati dall'utente)."""
    data = yaml.safe_load((ROOT / "knowledge" / "fonti.yaml").read_text())
    kind_map = {"ufficiale": "official", "community": "community", "esperienza": "host", "indipendente": "independent"}
    n = 0
    extra = [{"id": "xtool_com", "nome": "xTool (sito globale)", "url": "https://www.xtool.com/", "tipo": "ufficiale",
              "priorita": 1, "region": "global"}]
    for f in data["fonti"] + extra:
        kind = kind_map.get(f.get("tipo"), "independent")
        if f["id"] == "xtool_support":
            kind = "official_support"
        elif f["id"] == "xtool_academy":
            kind = "official_training"
        elif f["id"] == "fb_xtool_official_it":
            kind = "official_community"
        region = f.get("region") or ("it-IT" if "it-it" in (f.get("url") or "") else "global")
        prefixes = None
        if f.get("url") and "/it-it" in f["url"]:
            prefixes = jdump(["/it-it"])
        # Il gruppo Facebook non è scansionabile: crawl sempre disattivato
        crawlable = 0
        n += db.run("""INSERT OR IGNORE INTO sources (key,name,base_url,kind,priority,region,crawl_enabled,allowed_path_prefixes,created_at)
                       VALUES (?,?,?,?,?,?,?,?,?)""",
                    (f["id"], f["nome"], f.get("url"), kind, f["priorita"], region, crawlable, prefixes, now_iso())) and 1
    return n
