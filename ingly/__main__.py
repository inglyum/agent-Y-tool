"""CLI: python -m ingly <comando>"""
from __future__ import annotations

import argparse
import getpass
import json
import shutil
import sqlite3
import subprocess
import sys
from pathlib import Path

from .audit import configure_logging
from .config import get_settings
from .db import now_iso


def is_pg(url: str) -> bool:
    return url.startswith(("postgres://", "postgresql://"))


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="ingly", description="INGLY xTool Expert Agent")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("migrate", help="Applica le migrazioni e i dati di base")
    sub.add_parser("gen-key", help="Genera una chiave per INGLY_TOKEN_ENCRYPTION_KEY")
    cu = sub.add_parser("create-user", help="Crea un utente")
    cu.add_argument("email")
    cu.add_argument("--role", default="admin", choices=["admin", "editor", "sales", "viewer"])
    sv = sub.add_parser("serve", help="Avvia API e dashboard")
    sv.add_argument("--host", default="127.0.0.1")
    sv.add_argument("--port", type=int, default=8000)
    wk = sub.add_parser("worker", help="Avvia il worker dei job pianificati")
    wk.add_argument("--once", action="store_true", help="Esegue i job pronti ed esce")
    sub.add_parser("eval", help="Esegue la valutazione sui casi di evals/cases.yaml")
    cr = sub.add_parser("crawl", help="Scansiona una fonte (richiede crawl abilitato)")
    cr.add_argument("source_key")
    cr.add_argument("--max-pages", type=int, default=50)
    im = sub.add_parser("import", help="Importa un PDF/HTML nella knowledge base")
    im.add_argument("source_key")
    im.add_argument("file")
    im.add_argument("--url", help="URL ufficiale di origine del documento")
    sub.add_parser("import-yaml", help="Importa le schede YAML di knowledge/ nel catalogo")
    bk = sub.add_parser("backup", help="Backup consistente del database")
    bk.add_argument("dest", nargs="?")
    sub.add_parser("reembed", help="Ricalcola embedding e prodotti citati di tutti i chunk")
    rs = sub.add_parser("restore", help="Ripristina un backup (sovrascrive il database corrente)")
    rs.add_argument("src")
    a = p.parse_args(argv)
    configure_logging()
    settings = get_settings()

    if a.cmd == "gen-key":
        from .security import generate_encryption_key
        print(generate_encryption_key())
        return 0
    if a.cmd == "restore":
        src = Path(a.src)
        if not src.exists():
            print("Backup inesistente", file=sys.stderr)
            return 1
        if is_pg(settings.database_path):
            # il dump è in formato custom: pg_restore ricrea gli oggetti (--clean) nel database configurato
            subprocess.run(["pg_restore", "--clean", "--if-exists", "--no-owner", "-d", settings.database_path, str(src)], check=True)
        else:
            if Path(settings.database_path).exists():
                shutil.copy2(settings.database_path, settings.database_path + ".pre-restore")
            with sqlite3.connect(src) as s, sqlite3.connect(settings.database_path) as d:
                s.backup(d)
        print(f"Ripristinato da {src}")
        return 0

    from .service import build_services
    svc = build_services(settings)

    if a.cmd == "migrate":
        print("Database pronto:", settings.database_path)
    elif a.cmd == "create-user":
        from .security import create_user
        pw = getpass.getpass("Password (min 12 caratteri): ")
        create_user(svc.db, a.email, pw, a.role)
        print("Utente creato")
    elif a.cmd == "serve":
        import uvicorn
        from .api.app import create_app
        uvicorn.run(create_app(svc), host=a.host, port=a.port, proxy_headers=True)
    elif a.cmd == "worker":
        if a.once:
            svc.jobs.tick_schedules()
            print(json.dumps(svc.jobs.run_until_empty(), ensure_ascii=False, default=str, indent=1))
        else:
            svc.jobs.run_forever()
    elif a.cmd == "eval":
        from .evaluation import run_evaluation
        print(json.dumps(run_evaluation(svc)["summary"], indent=1))
    elif a.cmd == "crawl":
        src = svc.db.one("SELECT * FROM sources WHERE key=?", (a.source_key,))
        if not src or not src["crawl_enabled"]:
            print("Fonte inesistente o crawling non abilitato (abilitalo dalla dashboard)", file=sys.stderr)
            return 1
        print(svc.crawler().crawl_source(src["id"], a.max_pages).__dict__)
    elif a.cmd == "import":
        from .knowledge.crawler import import_file
        src = svc.db.one("SELECT id FROM sources WHERE key=?", (a.source_key,))
        if not src:
            print("Fonte inesistente", file=sys.stderr)
            return 1
        print(import_file(svc.db, src["id"], Path(a.file).name, Path(a.file).read_bytes(), a.url, store=svc.kb))
    elif a.cmd == "import-yaml":
        print(svc.catalog.import_yaml_cards())
    elif a.cmd == "backup":
        stamp = now_iso().replace(":", "")
        if svc.db.is_postgres:
            dest = Path(a.dest or f"ingly-{stamp}.dump")
            subprocess.run(["pg_dump", "-Fc", "-f", str(dest), settings.database_path], check=True)
        else:
            dest = Path(a.dest or f"{settings.database_path}.{stamp}.bak")
            with sqlite3.connect(settings.database_path) as s, sqlite3.connect(dest) as d:
                s.backup(d)
        print(f"Backup scritto in {dest}")
    elif a.cmd == "reembed":
        print({"chunks": svc.kb.reindex(), "embedder": svc.kb.embedder.name})
    return 0


if __name__ == "__main__":
    sys.exit(main())
