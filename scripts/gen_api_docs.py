"""Genera docs/API.md dalle rotte reali dell'applicazione: python scripts/gen_api_docs.py"""
import inspect
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from ingly.api.app import create_app  # noqa: E402
from ingly.config import Settings  # noqa: E402
from ingly.security import generate_encryption_key  # noqa: E402
from ingly.service import build_services  # noqa: E402

s = Settings()
s.database_path, s.token_encryption_key = ":memory:", generate_encryption_key()
app = create_app(build_services(s))
PERM = re.compile(r'need\("([\w.]+)"\)')
rows = []
for r in app.routes:
    if not hasattr(r, "methods") or r.path.startswith("/static") or r.path == "/":
        continue
    src = inspect.getsource(r.endpoint)
    perms = PERM.findall(src)
    auth = (f"`{perms[0]}`" if perms else "sessione" if "Depends(current)" in src
            else "firma HMAC Meta / verify token" if "webhooks" in r.path else "pubblica")
    doc = (r.endpoint.__doc__ or "").strip().split("\n")[0]
    for m in sorted(r.methods - {"HEAD"}):
        rows.append((r.path, m, auth, doc))
rows.sort()
out = ["# API", "", "Generato da `scripts/gen_api_docs.py`. Schema OpenAPI completo: `/api/openapi.json`.", "",
       "- Autenticazione: cookie di sessione da `POST /api/auth/login` (HttpOnly, SameSite=Lax, Secure in produzione).",
       "- Ogni richiesta che modifica dati richiede l'header `X-CSRF-Token` (restituito da login e da `GET /api/me`).",
       "- Permessi verificati lato server su ogni rotta (colonna Permesso); ruoli in `ingly/security.py`.",
       "- Errori: JSON `{\"error\": \"messaggio\"}` — 400 input/azione non valida, 401 accesso richiesto, 403 permesso o CSRF,",
       "  404 non trovato, 413 file troppo grande, 423 bloccato da policy/kill switch, 429 troppi tentativi, 502 errore piattaforma esterna.",
       "", "| Metodo | Percorso | Permesso | Note |", "|---|---|---|---|"]
out += [f"| {m} | `{p}` | {a} | {d} |" for p, m, a, d in rows]
(ROOT / "docs" / "API.md").write_text("\n".join(out) + "\n")
print(f"{len(rows)} rotte documentate")
