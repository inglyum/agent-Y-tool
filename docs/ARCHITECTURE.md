# Architettura

```
                ┌──────────── Dashboard (ingly/web, vanilla JS, CSP stretta) ────────────┐
                │                                                                         │
                ▼                                                                         │
     FastAPI (ingly/api/app.py) ── sessioni, CSRF, ruoli/permessi, rate limit login ──────┘
                │
   ┌────────────┼──────────────────────────────────────────────────────────────┐
   │            │                                                              │
Knowledge     Social pipeline (ingly/social/pipeline.py)                     CRM (ingly/crm)
Engine         rileva → deduplica → lingua → prodotti/materiali → classifica   lead, eventi,
(ingly/        → fonti (RAG) → bozza → validazione → policy → registra        consensi, export,
knowledge)       │                    │                  │                      cancellazione
 crawler         │                    │                  │
 extract      Connettori            Response Engine   Automation Policy
 store        (ingly/social)        (ingly/response)  (ingly/automation)
 rag          Meta Graph, manuale    classify + engine  modalità, soglie,
 catalog                                │               kill switch, quote
                                        ▼
                               AI Core (ingly/ai/provider.py)
                               interfaccia AIProvider + MeteredAI (budget, uso, errori)
                │
        Job scheduler (ingly/jobs/scheduler.py) — coda SQLite, lease, backoff, dead-letter
                │
        SQLite + FTS5 (ingly/migrations/*.sql) — audit log, impostazioni, prompt versionati
```

## Principi

- **Separazione ragionamento / fonti / azioni.** Il modello produce solo JSON validato (bozza, fonti usate,
  confidenza). Recupero fonti, decisione e azioni esterne sono codice deterministico.
- **Le regole di rischio non dipendono dall'AI.** `classify_rules` gira sempre; l'AI può affinare solo
  i casi ambigui (`merge_ai`) e non annulla segnali espliciti o rischi.
- **Nessuna azione esterna senza policy.** La pubblicazione passa da `PolicyEngine.decide` (auto) o da
  approvazione umana, con kill switch, quote e chiave di idempotenza (`published_responses.idempotency_key`).
- **Contenuto esterno = dato.** Post e pagine sono racchiusi in `<contenuto_esterno>`/`<fonte>` con i tag
  di chiusura neutralizzati (`escape_external`); i segnali di prompt injection forzano la revisione.
- **Nessun dato inventato.** Catalogo e KB contengono solo ciò che arriva da fonti importate o inserite
  a mano con URL e data di verifica; "verified" richiede entrambe.

## Moduli

| Modulo | Responsabilità |
|---|---|
| `ingly/config.py` | Configurazione da variabili d'ambiente |
| `ingly/db.py` | Connessioni SQLite, transazioni IMMEDIATE, migrazioni |
| `ingly/security.py` | Password scrypt, sessioni, permessi, CSRF, cifratura token (Fernet), rate limit |
| `ingly/audit.py` | Audit log e log JSON con redazione di token, email, telefoni |
| `ingly/settings_store.py` | Impostazioni modificabili da dashboard, kill switch |
| `ingly/ai/provider.py` | Interfaccia provider, adattatore Anthropic, budget e misurazione |
| `ingly/knowledge/*` | Estrazione, archivio versionato, crawler, ricerca, catalogo |
| `ingly/response/*` | Classificazione, prompt versionato, generazione e validazione |
| `ingly/automation/policy.py` | Regole per categoria/canale, soglie, decisione |
| `ingly/social/*` | Interfaccia connettori, Meta Graph API, import manuale, pipeline |
| `ingly/crm/leads.py` | Lead, punteggio spiegabile, consensi, retention, cancellazione |
| `ingly/jobs/scheduler.py` | Coda di job persistente e pianificazioni |
| `ingly/evaluation.py` | Valutazione ripetibile con metriche deterministiche |
| `ingly/api/app.py` | API REST e dashboard |

## Flusso di un commento Facebook

1. Webhook firmato (`/webhooks/meta`) o polling pianificato → `social_items` (UNIQUE platform+external_id).
2. Job `process_item` → transizione atomica `new → processing` (un solo worker).
3. Classificazione, prodotti/materiali, lead (se pertinente).
4. `pre_decision`: OFF/MONITOR si fermano qui senza spendere AI.
5. Recupero fonti, bozza, validazione, eventuale invito INGLY (solo se l'URL è configurato e non ripetuto entro 30 giorni).
6. `decide`: `publish` solo in AUTO_SAFE con tutte le condizioni soddisfatte; altrimenti `review`/`draft`.
7. Pubblicazione con prenotazione idempotente; esito e audit registrati.
