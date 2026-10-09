"""Autenticazione, sessioni, ruoli/permessi, CSRF, cifratura token, rate limit."""
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from datetime import timedelta

from cryptography.fernet import Fernet, InvalidToken

from .db import Database, now_iso, parse_iso, utcnow

PERMISSIONS = {
    "dashboard.view": "Vedere la dashboard",
    "kb.edit": "Modificare knowledge base e catalogo",
    "kb.crawl": "Avviare crawling e import",
    "social.view": "Vedere elementi social",
    "social.connect": "Collegare e scollegare account social",
    "drafts.edit": "Modificare bozze",
    "drafts.approve": "Approvare/rifiutare bozze",
    "drafts.publish": "Pubblicare risposte",
    "leads.view": "Vedere lead",
    "leads.edit": "Modificare lead",
    "leads.delete": "Cancellare dati personali",
    "automation.edit": "Modificare automazioni e kill switch",
    "settings.edit": "Modificare impostazioni",
    "users.manage": "Gestire utenti e ruoli",
    "audit.view": "Vedere audit log",
    "eval.run": "Eseguire valutazioni AI",
}
ROLES = {
    "admin": list(PERMISSIONS),
    "editor": ["dashboard.view", "kb.edit", "kb.crawl", "social.view", "drafts.edit", "drafts.approve",
               "drafts.publish", "leads.view", "leads.edit", "eval.run"],
    "sales": ["dashboard.view", "social.view", "drafts.edit", "leads.view", "leads.edit"],
    "viewer": ["dashboard.view", "social.view", "leads.view"],
}
SESSION_HOURS = 12
MAX_FAILED_LOGINS = 5
LOCK_MINUTES = 15


def seed_roles(db: Database) -> None:
    with db.tx() as c:
        for code, desc in PERMISSIONS.items():
            c.execute("INSERT OR IGNORE INTO permissions (code, description) VALUES (?,?)", (code, desc))
        for role, perms in ROLES.items():
            c.execute("INSERT OR IGNORE INTO roles (name) VALUES (?)", (role,))
            rid = c.execute("SELECT id FROM roles WHERE name=?", (role,)).fetchone()[0]
            for p in perms:
                pid = c.execute("SELECT id FROM permissions WHERE code=?", (p,)).fetchone()[0]
                c.execute("INSERT OR IGNORE INTO role_permissions VALUES (?,?)", (rid, pid))


# ---------- password ----------
def hash_password(password: str) -> str:
    if len(password) < 12:
        raise ValueError("La password deve avere almeno 12 caratteri")
    salt = secrets.token_bytes(16)
    n = 2 ** 14
    dk = hashlib.scrypt(password.encode(), salt=salt, n=n, r=8, p=1, dklen=32)
    return f"scrypt${n}${base64.b64encode(salt).decode()}${base64.b64encode(dk).decode()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, n, salt, dk = stored.split("$")
        if algo != "scrypt":
            return False
        calc = hashlib.scrypt(password.encode(), salt=base64.b64decode(salt), n=int(n), r=8, p=1, dklen=32)
        return hmac.compare_digest(calc, base64.b64decode(dk))
    except (ValueError, TypeError):
        return False


def create_user(db: Database, email: str, password: str, role: str) -> int:
    r = db.one("SELECT id FROM roles WHERE name=?", (role,))
    if not r:
        raise ValueError(f"Ruolo sconosciuto: {role}")
    return db.run("INSERT INTO users (email,password_hash,role_id,created_at) VALUES (?,?,?,?)",
                  (email.strip().lower(), hash_password(password), r["id"], now_iso()))


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def login(db: Database, email: str, password: str) -> tuple[str, str] | None:
    """Ritorna (session_token, csrf_token) o None. Blocca dopo troppi tentativi."""
    u = db.one("SELECT * FROM users WHERE email=? COLLATE NOCASE", (email.strip(),))
    if not u or not u["active"]:
        hashlib.scrypt(b"x", salt=b"y" * 16, n=2 ** 14, r=8, p=1)  # tempo costante approssimato
        return None
    locked = parse_iso(u["locked_until"])
    if locked and locked > utcnow():
        return None
    if not verify_password(password, u["password_hash"]):
        fails = u["failed_logins"] + 1
        lock = now_iso(timedelta(minutes=LOCK_MINUTES)) if fails >= MAX_FAILED_LOGINS else None
        db.run("UPDATE users SET failed_logins=?, locked_until=? WHERE id=?", (0 if lock else fails, lock, u["id"]))
        return None
    token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(24)
    with db.tx() as c:
        c.execute("UPDATE users SET failed_logins=0, locked_until=NULL, last_login_at=? WHERE id=?", (now_iso(), u["id"]))
        c.execute("INSERT INTO sessions VALUES (?,?,?,?,?)",
                  (_token_hash(token), u["id"], csrf, now_iso(), now_iso(timedelta(hours=SESSION_HOURS))))
    return token, csrf


def session_user(db: Database, token: str | None) -> dict | None:
    if not token:
        return None
    s = db.one("""SELECT s.csrf_token, s.expires_at, u.id, u.email, u.active, r.name AS role
                  FROM sessions s JOIN users u ON u.id=s.user_id JOIN roles r ON r.id=u.role_id
                  WHERE s.token_hash=?""", (_token_hash(token),))
    if not s or not s["active"] or parse_iso(s["expires_at"]) < utcnow():
        return None
    s["permissions"] = user_permissions(db, s["id"])
    return s


def logout(db: Database, token: str) -> None:
    db.run("DELETE FROM sessions WHERE token_hash=?", (_token_hash(token),))


def user_permissions(db: Database, user_id: int) -> set[str]:
    rows = db.all("""SELECT p.code FROM users u JOIN role_permissions rp ON rp.role_id=u.role_id
                     JOIN permissions p ON p.id=rp.permission_id WHERE u.id=?""", (user_id,))
    return {r["code"] for r in rows}


def check_csrf(session: dict, header_value: str | None) -> bool:
    return bool(header_value) and hmac.compare_digest(session["csrf_token"], header_value)


# ---------- cifratura token OAuth ----------
class TokenVault:
    def __init__(self, key: str | None):
        self._f = Fernet(key.encode()) if key else None

    @property
    def available(self) -> bool:
        return self._f is not None

    def encrypt(self, plaintext: str) -> str:
        if not self._f:
            raise RuntimeError("INGLY_TOKEN_ENCRYPTION_KEY non configurata: impossibile salvare token")
        return self._f.encrypt(plaintext.encode()).decode()

    def decrypt(self, ciphertext: str) -> str:
        if not self._f:
            raise RuntimeError("INGLY_TOKEN_ENCRYPTION_KEY non configurata")
        try:
            return self._f.decrypt(ciphertext.encode()).decode()
        except InvalidToken as e:
            raise RuntimeError("Token cifrato non valido o chiave cambiata") from e


def generate_encryption_key() -> str:
    return Fernet.generate_key().decode()


# ---------- rate limit a finestra fissa (persistente) ----------
def rate_limit_hit(db: Database, bucket: str, limit: int, window_seconds: int) -> bool:
    """Registra un evento; ritorna True se il limite è SUPERATO (azione da bloccare)."""
    now = utcnow()
    start = int(now.timestamp()) // window_seconds * window_seconds
    ws = str(start)
    with db.tx() as c:
        row = c.execute("SELECT count FROM rate_limits WHERE bucket=? AND window_start=?", (bucket, ws)).fetchone()
        count = (row[0] if row else 0)
        if count >= limit:
            return True
        c.execute("INSERT INTO rate_limits VALUES (?,?,1) ON CONFLICT(bucket,window_start) DO UPDATE SET count=count+1",
                  (bucket, ws))
        c.execute("DELETE FROM rate_limits WHERE bucket=? AND CAST(window_start AS INTEGER) < ?", (bucket, start - 7 * 86400))
    return False


def rate_limit_count(db: Database, bucket: str, window_seconds: int) -> int:
    start = int(utcnow().timestamp()) // window_seconds * window_seconds
    r = db.one("SELECT count FROM rate_limits WHERE bucket=? AND window_start=?", (bucket, str(start)))
    return r["count"] if r else 0
