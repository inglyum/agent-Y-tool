"""Interfaccia provider AI + adattatore Anthropic.

Il resto del sistema dipende solo da `AIProvider`: per aggiungere un altro provider
basta implementare `complete_json` e registrarlo in `build_provider`.
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Any, Protocol

from ..audit import log
from ..config import Settings
from ..db import Database, now_iso, utcnow


class AIUnavailable(RuntimeError):
    """Nessun provider configurato o provider non raggiungibile."""


class AIBudgetExceeded(RuntimeError):
    pass


class AIOutputInvalid(RuntimeError):
    pass


@dataclass
class AIResult:
    data: dict
    model: str
    input_tokens: int
    output_tokens: int
    latency_ms: int


class AIProvider(Protocol):
    name: str
    model: str | None

    def complete_json(self, system: str, user: str, schema: dict, purpose: str,
                      max_tokens: int = 4000) -> AIResult: ...


class NullProvider:
    """Usato quando nessun provider è configurato: il sistema degrada a regole + revisione umana."""
    name = "none"
    model = None

    def complete_json(self, system: str, user: str, schema: dict, purpose: str, max_tokens: int = 4000) -> AIResult:
        raise AIUnavailable("Nessun provider AI configurato (INGLY_AI_PROVIDER=none)")


class AnthropicProvider:
    name = "anthropic"

    def __init__(self, api_key: str | None, model: str | None, timeout_s: float, max_retries: int):
        import anthropic  # import locale: dipendenza opzionale

        self._anthropic = anthropic
        # Senza api_key l'SDK risolve le credenziali dall'ambiente (ANTHROPIC_API_KEY, profilo `ant`).
        kwargs: dict[str, Any] = {"timeout": timeout_s, "max_retries": max_retries}
        if api_key:
            kwargs["api_key"] = api_key
        self.client = anthropic.Anthropic(**kwargs)
        self.model = model or "claude-opus-5-5"

    def complete_json(self, system: str, user: str, schema: dict, purpose: str, max_tokens: int = 4000) -> AIResult:
        a = self._anthropic
        t0 = time.monotonic()
        try:
            resp = self.client.beta.messages.create(
                model=self.model,
                max_tokens=max_tokens,
                system=system,
                messages=[{"role": "user", "content": user}],
                output_config={"effort": "medium", "format": {"type": "json_schema", "schema": schema}},
                # Se il modello rifiuta, l'API riprova con un modello di fallback scelto dal server.
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
            )
        except a.RateLimitError as e:
            raise AIUnavailable(f"Rate limit del provider: {e.message}") from e
        except (a.AuthenticationError, a.PermissionDeniedError) as e:
            raise AIUnavailable("Credenziali AI non valide o senza permessi") from e
        except a.BadRequestError as e:
            raise AIUnavailable(f"Richiesta rifiutata dal provider: {e.message}") from e
        except a.APIStatusError as e:
            raise AIUnavailable(f"Errore provider ({e.status_code})") from e
        except a.APIConnectionError as e:
            raise AIUnavailable("Provider AI non raggiungibile") from e
        latency = int((time.monotonic() - t0) * 1000)
        if resp.stop_reason == "refusal":
            raise AIOutputInvalid("Il modello ha rifiutato la richiesta")
        if resp.stop_reason == "max_tokens":
            raise AIOutputInvalid("Risposta troncata (max_tokens)")
        text = "".join(b.text for b in resp.content if b.type == "text")
        try:
            data = json.loads(text)
        except ValueError as e:
            raise AIOutputInvalid("Il modello non ha restituito JSON valido") from e
        return AIResult(data=data, model=resp.model, input_tokens=resp.usage.input_tokens,
                        output_tokens=resp.usage.output_tokens, latency_ms=latency)


def build_provider(settings: Settings) -> AIProvider:
    if settings.ai_provider == "anthropic":
        return AnthropicProvider(settings.ai_api_key, settings.ai_model, settings.ai_timeout_s, settings.ai_max_retries)
    if settings.ai_provider in ("none", "", None):
        return NullProvider()
    raise ValueError(f"Provider AI non supportato: {settings.ai_provider}")


class MeteredAI:
    """Avvolge un provider: controlla il budget, registra uso/costi/errori in ai_usage."""

    def __init__(self, provider: AIProvider, db: Database, settings_store):
        self.provider = provider
        self.db = db
        self.settings = settings_store

    @property
    def available(self) -> bool:
        return not isinstance(self.provider, NullProvider)

    @property
    def label(self) -> str:
        return f"{self.provider.name}:{self.provider.model}" if self.provider.model else self.provider.name

    def month_cost(self) -> float:
        start = utcnow().replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat(timespec="seconds")
        r = self.db.one("SELECT COALESCE(SUM(cost_eur),0) AS c FROM ai_usage WHERE at >= ?", (start,))
        return float(r["c"])

    def complete_json(self, system: str, user: str, schema: dict, purpose: str, max_tokens: int = 4000) -> AIResult:
        budget = float(self.settings.get("ai.monthly_budget_eur"))
        if budget > 0 and self.month_cost() >= budget:
            raise AIBudgetExceeded(f"Budget AI mensile ({budget} EUR) raggiunto")
        try:
            res = self.provider.complete_json(system, user, schema, purpose, max_tokens)
        except Exception as e:
            self.db.run("""INSERT INTO ai_usage (at,provider,model,purpose,ok,error) VALUES (?,?,?,?,0,?)""",
                        (now_iso(), self.provider.name, self.provider.model, purpose, str(e)[:500]))
            log.warning("ai call failed", extra={"data": {"purpose": purpose, "error": str(e)}})
            raise
        pin = float(self.settings.get("ai.price_per_mtok_in_eur"))
        pout = float(self.settings.get("ai.price_per_mtok_out_eur"))
        cost = res.input_tokens / 1e6 * pin + res.output_tokens / 1e6 * pout
        self.db.run("""INSERT INTO ai_usage (at,provider,model,purpose,input_tokens,output_tokens,cost_eur,latency_ms,ok)
                       VALUES (?,?,?,?,?,?,?,?,1)""",
                    (now_iso(), self.provider.name, res.model, purpose, res.input_tokens, res.output_tokens, cost, res.latency_ms))
        return res
