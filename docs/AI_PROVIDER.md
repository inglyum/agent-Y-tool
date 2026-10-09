# Configurare il provider AI

Il sistema funziona anche **senza AI**: classifica con regole e propone risposte prudenti (domande di
chiarimento, rimandi alle fonti ufficiali) che vanno sempre approvate. Con un provider configurato le
bozze diventano risposte basate sulle fonti della knowledge base, con citazioni.

## Anthropic (adattatore incluso)

```bash
INGLY_AI_PROVIDER=anthropic
INGLY_AI_MODEL=claude-opus-5-5
INGLY_AI_API_KEY=...        # oppure lascia vuoto e usa ANTHROPIC_API_KEY / `ant auth login`
```

Dettagli dell'adattatore (`ingly/ai/provider.py`):
- output strutturato con schema JSON (`output_config.format`), quindi niente parsing fragile;
- `effort: medium`;
- fallback lato server in caso di rifiuto del modello (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`);
- gestione di `stop_reason` `refusal` e `max_tokens`;
- errori mappati: rate limit, credenziali, richiesta non valida, errori 5xx, rete → `AIUnavailable`
  (la pipeline ripiega su regole + bozza prudente, mai su pubblicazione).

Retry e timeout: `INGLY_AI_MAX_RETRIES` e `INGLY_AI_TIMEOUT_S` sono passati all'SDK.

## Budget e costi

In **Impostazioni** imposta:
- `Budget AI mensile (€)`: superato il budget le chiamate si fermano (`AIBudgetExceeded`) e l'agente
  continua con regole e revisione umana;
- `Prezzo input/output per milione di token (€)`: usati per stimare il costo in **Costi e Utilizzo AI**.
  Compilali con il listino in vigore del tuo provider (li lasciamo a 0 per non inventare prezzi).

## Aggiungere un altro provider

Implementa una classe con `name`, `model` e `complete_json(system, user, schema, purpose, max_tokens) -> AIResult`
e registrala in `build_provider`. Il resto del sistema non cambia.

## Prompt di sistema

Il prompt della risposta è versionato in database (seed da `ingly/response/prompts/responder_v1.md`).
Da **AI Agent** puoi creare una nuova versione e attivarla; ogni cambio è registrato nell'audit log.
Prima di attivarla, esegui **Test e Valutazione AI** e confronta le metriche con l'esecuzione precedente.
