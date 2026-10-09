"""Connettori Meta (Facebook Pages, Instagram professionale) via Graph API ufficiale.

Solo account e pagine che l'utente collega con OAuth. Nessuno scraping, nessun account personale.
I nomi esatti di permessi ed endpoint vanno ricontrollati sulla documentazione Meta al momento del
collegamento (docs/META_SETUP.md): Meta li modifica tra le versioni della Graph API.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import secrets
from urllib.parse import urlencode

import httpx

from ..audit import audit
from ..config import Settings
from ..db import Database, jdump, jload, now_iso, parse_iso, utcnow
from ..security import TokenVault
from .base import (Capabilities, ConnectorError, IncomingItem, NotSupported, PermissionMissing, RateLimited,
                   TokenExpired, TransientError)

# Permessi richiesti (verificare nomi correnti su developers.facebook.com prima dell'App Review)
FACEBOOK_SCOPES = ["pages_show_list", "pages_read_engagement", "pages_read_user_content", "pages_manage_engagement"]
INSTAGRAM_SCOPES = ["instagram_basic", "instagram_manage_comments"]
RATE_LIMIT_CODES = {4, 17, 32, 613, 80001, 80002, 80006}


class GraphClient:
    def __init__(self, settings: Settings, token: str | None = None, client: httpx.Client | None = None):
        self.base = f"https://graph.facebook.com/{settings.meta_graph_version}"
        self.token = token
        self.settings = settings
        self.http = client or httpx.Client(timeout=30)

    def _handle(self, r: httpx.Response) -> dict:
        try:
            data = r.json()
        except ValueError:
            data = {}
        if r.status_code < 400 and "error" not in data:
            return data
        err = data.get("error", {}) if isinstance(data, dict) else {}
        code, sub = err.get("code"), err.get("error_subcode")
        msg = err.get("message", f"HTTP {r.status_code}")
        if code == 190 or sub in (463, 467):
            raise TokenExpired(f"Token Meta scaduto o revocato: {msg}")
        if code in RATE_LIMIT_CODES or r.status_code == 429:
            retry = 900
            usage = r.headers.get("x-business-use-case-usage") or r.headers.get("x-app-usage")
            if usage:
                try:
                    vals = json.loads(usage)
                    if isinstance(vals, dict) and vals:
                        first = next(iter(vals.values()))
                        first = first[0] if isinstance(first, list) else first
                        retry = int(first.get("estimated_time_to_regain_access", 15)) * 60 or 900
                except (ValueError, StopIteration, AttributeError, TypeError):
                    pass
            raise RateLimited(f"Limite Meta raggiunto: {msg}", retry)
        if code in (10, 200, 3) or (isinstance(code, int) and 200 <= code < 300):
            raise PermissionMissing(f"Permesso Meta mancante: {msg}")
        if r.status_code >= 500 or err.get("is_transient"):
            raise TransientError(f"Errore temporaneo Meta: {msg}")
        raise ConnectorError(f"Errore Meta ({code}): {msg}")

    def get(self, path: str, **params) -> dict:
        if self.token:
            params["access_token"] = self.token
        try:
            return self._handle(self.http.get(f"{self.base}/{path.lstrip('/')}", params=params))
        except httpx.HTTPError as e:
            raise TransientError(f"Rete: {e}") from e

    def post(self, path: str, **data) -> dict:
        if self.token:
            data["access_token"] = self.token
        try:
            return self._handle(self.http.post(f"{self.base}/{path.lstrip('/')}", data=data))
        except httpx.HTTPError as e:
            raise TransientError(f"Rete: {e}") from e


# ---------- OAuth ----------
class MetaOAuth:
    def __init__(self, db: Database, settings: Settings, vault: TokenVault, client: httpx.Client | None = None):
        self.db, self.settings, self.vault = db, settings, vault
        self.http = client

    @property
    def configured(self) -> bool:
        s = self.settings
        return bool(s.meta_app_id and s.meta_app_secret and s.meta_redirect_uri and self.vault.available)

    def missing_config(self) -> list[str]:
        s = self.settings
        miss = [n for n, v in (("META_APP_ID", s.meta_app_id), ("META_APP_SECRET", s.meta_app_secret),
                               ("META_REDIRECT_URI", s.meta_redirect_uri)) if not v]
        if not self.vault.available:
            miss.append("INGLY_TOKEN_ENCRYPTION_KEY")
        return miss

    def login_url(self, include_instagram: bool = True) -> tuple[str, str]:
        if not self.configured:
            raise ConnectorError("Meta non configurato: " + ", ".join(self.missing_config()))
        state = secrets.token_urlsafe(24)
        self.db.run("""INSERT INTO system_settings (key,value,updated_at) VALUES (?,?,?)
                       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at""",
                    (f"oauth_state:{state}", jdump({"created": now_iso()}), now_iso()))
        scopes = FACEBOOK_SCOPES + (INSTAGRAM_SCOPES if include_instagram else [])
        q = urlencode({"client_id": self.settings.meta_app_id, "redirect_uri": self.settings.meta_redirect_uri,
                       "state": state, "scope": ",".join(scopes), "response_type": "code"})
        return f"https://www.facebook.com/{self.settings.meta_graph_version}/dialog/oauth?{q}", state

    def consume_state(self, state: str) -> bool:
        r = self.db.one("SELECT value FROM system_settings WHERE key=?", (f"oauth_state:{state}",))
        if not r:
            return False
        self.db.run("DELETE FROM system_settings WHERE key=?", (f"oauth_state:{state}",))
        created = parse_iso(jload(r["value"], {}).get("created"))
        return bool(created and (utcnow() - created).total_seconds() < 900)

    def handle_callback(self, code: str, state: str, user_id: int | None = None) -> list[dict]:
        if not self.consume_state(state):
            raise ConnectorError("Stato OAuth non valido o scaduto")
        g = GraphClient(self.settings, client=self.http)
        short = g.get("oauth/access_token", client_id=self.settings.meta_app_id, client_secret=self.settings.meta_app_secret,
                      redirect_uri=self.settings.meta_redirect_uri, code=code)
        long = g.get("oauth/access_token", grant_type="fb_exchange_token", client_id=self.settings.meta_app_id,
                     client_secret=self.settings.meta_app_secret, fb_exchange_token=short["access_token"])
        user_g = GraphClient(self.settings, long["access_token"], client=self.http)
        granted = [p["permission"] for p in user_g.get("me/permissions").get("data", []) if p.get("status") == "granted"]
        pages = user_g.get("me/accounts", fields="id,name,access_token,instagram_business_account{id,username}").get("data", [])
        connected = []
        for p in pages:
            # I page token derivati da un user token long-lived non hanno scadenza fissa, ma possono essere revocati.
            self._save_account("facebook", p["id"], p["name"], p["access_token"], granted, None)
            connected.append({"platform": "facebook", "id": p["id"], "name": p["name"]})
            ig = p.get("instagram_business_account")
            if ig:
                self._save_account("instagram", ig["id"], ig.get("username") or ig["id"], p["access_token"], granted, None)
                connected.append({"platform": "instagram", "id": ig["id"], "name": ig.get("username")})
        audit(self.db, f"user:{user_id}" if user_id else "system", "social.connect", "meta", None,
              {"accounts": connected, "scopes": granted}, user_id)
        return connected

    def _save_account(self, platform, ext_id, name, token, scopes, expires_at):
        self.db.run("""INSERT INTO social_accounts (platform,external_id,name,auth_type,token_encrypted,token_expires_at,scopes,
                       status,connected_at,last_error) VALUES (?,?,?,?,?,?,?,'connected',?,NULL)
                       ON CONFLICT(platform,external_id) DO UPDATE SET name=excluded.name, token_encrypted=excluded.token_encrypted,
                       token_expires_at=excluded.token_expires_at, scopes=excluded.scopes, status='connected',
                       connected_at=excluded.connected_at, last_error=NULL""",
                    (platform, ext_id, name, "oauth_page_token", self.vault.encrypt(token), expires_at, jdump(scopes), now_iso()))
        acc = self.db.one("SELECT id FROM social_accounts WHERE platform=? AND external_id=?", (platform, ext_id))
        kind = "page" if platform == "facebook" else "ig_business"
        self.db.run("""INSERT INTO social_sources (account_id,platform,kind,external_id,name,active,limits_note,created_at)
                       SELECT ?,?,?,?,?,0,?,? WHERE NOT EXISTS
                       (SELECT 1 FROM social_sources WHERE platform=? AND external_id=?)""",
                    (acc["id"], platform, kind, ext_id, name, "Limiti Graph API per app/pagina: vedi docs/META_SETUP.md",
                     now_iso(), platform, ext_id))

    def check_token(self, account_id: int) -> dict:
        """Verifica validità e permessi (debug_token). Aggiorna lo stato dell'account."""
        acc = self.db.one("SELECT * FROM social_accounts WHERE id=?", (account_id,))
        if not acc or not acc["token_encrypted"]:
            return {"status": "disconnected"}
        app_token = f"{self.settings.meta_app_id}|{self.settings.meta_app_secret}"
        g = GraphClient(self.settings, client=self.http)
        try:
            info = g.get("debug_token", input_token=self.vault.decrypt(acc["token_encrypted"]), access_token=app_token)["data"]
        except ConnectorError as e:
            self.db.run("UPDATE social_accounts SET status='error', last_error=? WHERE id=?", (str(e), account_id))
            return {"status": "error", "error": str(e)}
        valid = bool(info.get("is_valid"))
        exp = info.get("expires_at") or 0
        status = "connected" if valid else "expired"
        from datetime import datetime, timezone
        exp_iso = datetime.fromtimestamp(exp, timezone.utc).isoformat(timespec="seconds") if exp else None
        self.db.run("UPDATE social_accounts SET status=?, token_expires_at=?, scopes=?, last_error=? WHERE id=?",
                    (status, exp_iso, jdump(info.get("scopes", [])), None if valid else "Token non valido", account_id))
        return {"status": status, "expires_at": exp_iso, "scopes": info.get("scopes", [])}

    def disconnect(self, account_id: int, user_id: int | None = None) -> None:
        acc = self.db.one("SELECT * FROM social_accounts WHERE id=?", (account_id,))
        if not acc:
            return
        if acc["token_encrypted"] and acc["platform"] == "facebook":
            try:  # revoca lato Meta quando possibile; in ogni caso cancelliamo il token locale
                GraphClient(self.settings, self.vault.decrypt(acc["token_encrypted"]), self.http).http.delete(
                    f"https://graph.facebook.com/{self.settings.meta_graph_version}/{acc['external_id']}/subscribed_apps",
                    params={"access_token": self.vault.decrypt(acc["token_encrypted"])})
            except Exception:
                pass
        self.db.run("UPDATE social_accounts SET token_encrypted=NULL, status='disconnected', token_expires_at=NULL WHERE id=?",
                    (account_id,))
        self.db.run("UPDATE social_sources SET active=0 WHERE account_id=?", (account_id,))
        audit(self.db, f"user:{user_id}" if user_id else "system", "social.disconnect", "social_account", account_id, None, user_id)


# ---------- Connettori ----------
class _MetaBase:
    platform = "meta"

    def __init__(self, db: Database, settings: Settings, vault: TokenVault, client: httpx.Client | None = None):
        self.db, self.settings, self.vault, self.http = db, settings, vault, client

    def account(self, source: dict) -> dict:
        acc = self.db.one("SELECT * FROM social_accounts WHERE id=?", (source["account_id"],)) if source.get("account_id") else None
        if not acc or acc["status"] != "connected" or not acc["token_encrypted"]:
            raise TokenExpired("Account non collegato o token non valido")
        exp = parse_iso(acc["token_expires_at"])
        if exp and exp <= utcnow():
            self.db.run("UPDATE social_accounts SET status='expired' WHERE id=?", (acc["id"],))
            raise TokenExpired("Token scaduto: ricollegare l'account")
        return acc

    def graph(self, source: dict) -> GraphClient:
        acc = self.account(source)
        return GraphClient(self.settings, self.vault.decrypt(acc["token_encrypted"]), self.http)

    def authenticated(self, source: dict) -> bool:
        try:
            self.account(source)
            return True
        except TokenExpired:
            return False


class FacebookPageConnector(_MetaBase):
    platform = "facebook"

    def capabilities(self) -> Capabilities:
        return Capabilities(read_posts=True, read_comments=True, reply_comment=True, reply_post=True,
                            send_private_message=False, webhooks=True,
                            notes=["Solo Pagine gestite e collegate via OAuth",
                                   "Messaggi privati non inviati automaticamente (consenso e finestre di messaggistica)",
                                   "I gruppi Facebook non sono accessibili via API: usare l'import manuale"])

    def fetch_new(self, source: dict, since: str | None) -> list[IncomingItem]:
        g = self.graph(source)
        params = {"fields": "id,message,created_time,permalink_url,comments.limit(50){id,message,created_time,from,permalink_url}",
                  "limit": 25}
        if since:
            params["since"] = int(parse_iso(since).timestamp())
        data = g.get(f"{source['external_id']}/feed", **params)
        out: list[IncomingItem] = []
        for post in data.get("data", []):
            if post.get("message"):
                out.append(IncomingItem(post["id"], "post", post["message"], permalink=post.get("permalink_url"),
                                        created_at=post.get("created_time")))
            for c in (post.get("comments") or {}).get("data", []):
                frm = c.get("from") or {}
                if frm.get("id") == source["external_id"]:
                    continue  # commenti della Pagina stessa: evita loop
                if c.get("message"):
                    out.append(IncomingItem(c["id"], "comment", c["message"], parent_external_id=post["id"],
                                            author_ref=frm.get("id"), author_name=frm.get("name"),
                                            permalink=c.get("permalink_url"), created_at=c.get("created_time")))
        return out

    def reply(self, item: dict, text: str) -> str:
        source = self.db.one("SELECT * FROM social_sources WHERE id=?", (item["source_id"],))
        res = self.graph(source).post(f"{item['external_id']}/comments", message=text)
        return res["id"]


class InstagramConnector(_MetaBase):
    platform = "instagram"

    def capabilities(self) -> Capabilities:
        return Capabilities(read_posts=True, read_comments=True, reply_comment=True, reply_post=False,
                            send_private_message=False, webhooks=True,
                            notes=["Solo account Instagram professionali collegati a una Pagina",
                                   "Risposta ai commenti sui propri contenuti; nessun commento su contenuti di terzi",
                                   "Nessun DM automatico"])

    def fetch_new(self, source: dict, since: str | None) -> list[IncomingItem]:
        g = self.graph(source)
        data = g.get(f"{source['external_id']}/media",
                     fields="id,caption,timestamp,permalink,comments.limit(50){id,text,timestamp,username,from}", limit=25)
        since_dt = parse_iso(since) if since else None
        out: list[IncomingItem] = []
        for m in data.get("data", []):
            for c in (m.get("comments") or {}).get("data", []):
                ts = c.get("timestamp")
                if since_dt and ts and parse_iso(ts.replace("+0000", "+00:00")) <= since_dt:
                    continue
                frm = c.get("from") or {}
                if frm.get("id") == source["external_id"]:
                    continue
                out.append(IncomingItem(c["id"], "comment", c.get("text") or "", parent_external_id=m["id"],
                                        author_ref=frm.get("id") or c.get("username"), author_name=c.get("username"),
                                        permalink=m.get("permalink"), created_at=ts))
        return [i for i in out if i.text]

    def reply(self, item: dict, text: str) -> str:
        if item["kind"] != "comment":
            raise NotSupported("Su Instagram si risponde solo ai commenti")
        source = self.db.one("SELECT * FROM social_sources WHERE id=?", (item["source_id"],))
        return self.graph(source).post(f"{item['external_id']}/replies", message=text)["id"]


# ---------- Webhook ----------
def verify_webhook_subscription(settings: Settings, mode: str | None, token: str | None, challenge: str | None) -> str | None:
    if mode == "subscribe" and settings.meta_webhook_verify_token and token and \
            hmac.compare_digest(token, settings.meta_webhook_verify_token):
        return challenge
    return None


def verify_signature(settings: Settings, body: bytes, header: str | None) -> bool:
    if not settings.meta_app_secret or not header or not header.startswith("sha256="):
        return False
    expected = hmac.new(settings.meta_app_secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header.split("=", 1)[1])


def parse_webhook(payload: dict) -> list[tuple[str, str, IncomingItem]]:
    """Ritorna (platform, account_external_id, item) per i nuovi commenti notificati."""
    out = []
    obj = payload.get("object")
    for entry in payload.get("entry", []):
        acc_id = str(entry.get("id"))
        for ch in entry.get("changes", []):
            v = ch.get("value", {})
            if obj == "page" and ch.get("field") == "feed" and v.get("item") == "comment" and v.get("verb") == "add":
                frm = v.get("from") or {}
                if frm.get("id") == acc_id or not v.get("message"):
                    continue
                out.append(("facebook", acc_id, IncomingItem(v["comment_id"], "comment", v["message"],
                                                             parent_external_id=v.get("post_id"), author_ref=frm.get("id"),
                                                             author_name=frm.get("name"))))
            elif obj == "instagram" and ch.get("field") == "comments":
                frm = v.get("from") or {}
                if frm.get("id") == acc_id or not v.get("text"):
                    continue
                out.append(("instagram", acc_id, IncomingItem(v["id"], "comment", v["text"],
                                                              parent_external_id=(v.get("media") or {}).get("id"),
                                                              author_ref=frm.get("id"), author_name=frm.get("username"))))
    return out
