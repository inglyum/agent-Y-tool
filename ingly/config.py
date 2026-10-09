"""Configurazione da variabili d'ambiente. Nessun segreto ha un valore di default."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _env(name: str, default: str | None = None) -> str | None:
    v = os.environ.get(name)
    return v if v not in (None, "") else default


def _env_int(name: str, default: int) -> int:
    v = _env(name)
    return int(v) if v is not None else default


def _env_float(name: str, default: float) -> float:
    v = _env(name)
    return float(v) if v is not None else default


@dataclass
class Settings:
    database_path: str = field(default_factory=lambda: _env("INGLY_DATABASE_PATH", str(ROOT / "data" / "ingly.db")))
    secret_key: str | None = field(default_factory=lambda: _env("INGLY_SECRET_KEY"))
    # Chiave Fernet (base64 urlsafe, 32 byte) per cifrare i token OAuth a riposo.
    token_encryption_key: str | None = field(default_factory=lambda: _env("INGLY_TOKEN_ENCRYPTION_KEY"))
    environment: str = field(default_factory=lambda: _env("INGLY_ENV", "development"))
    cookie_secure: bool = field(default_factory=lambda: _env("INGLY_COOKIE_SECURE", "false").lower() == "true")

    ai_provider: str = field(default_factory=lambda: _env("INGLY_AI_PROVIDER", "none"))  # none | anthropic | openai_compatible
    ai_model: str | None = field(default_factory=lambda: _env("INGLY_AI_MODEL"))
    ai_api_key: str | None = field(default_factory=lambda: _env("INGLY_AI_API_KEY"))
    ai_base_url: str | None = field(default_factory=lambda: _env("INGLY_AI_BASE_URL"))
    ai_timeout_s: float = field(default_factory=lambda: _env_float("INGLY_AI_TIMEOUT_S", 60.0))
    ai_max_retries: int = field(default_factory=lambda: _env_int("INGLY_AI_MAX_RETRIES", 3))

    meta_app_id: str | None = field(default_factory=lambda: _env("META_APP_ID"))
    meta_app_secret: str | None = field(default_factory=lambda: _env("META_APP_SECRET"))
    meta_webhook_verify_token: str | None = field(default_factory=lambda: _env("META_WEBHOOK_VERIFY_TOKEN"))
    meta_redirect_uri: str | None = field(default_factory=lambda: _env("META_REDIRECT_URI"))
    meta_graph_version: str = field(default_factory=lambda: _env("META_GRAPH_VERSION", "v21.0"))

    crawler_user_agent: str = field(default_factory=lambda: _env("INGLY_CRAWLER_USER_AGENT", "INGLYKnowledgeBot/1.0 (+contatto: configurare INGLY_CRAWLER_CONTACT)"))
    crawler_delay_s: float = field(default_factory=lambda: _env_float("INGLY_CRAWLER_DELAY_S", 2.0))
    crawler_max_pages: int = field(default_factory=lambda: _env_int("INGLY_CRAWLER_MAX_PAGES", 200))

    bootstrap_admin_email: str | None = field(default_factory=lambda: _env("INGLY_ADMIN_EMAIL"))
    bootstrap_admin_password: str | None = field(default_factory=lambda: _env("INGLY_ADMIN_PASSWORD"))

    def is_production(self) -> bool:
        return self.environment == "production"


def get_settings() -> Settings:
    return Settings()
