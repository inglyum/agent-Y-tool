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
        Job scheduler (ingly/jobs/scheduler.py) — coda nel database, lease, backoff, dead-letter
                │
        PostgreSQL + pgvector (produzione)  |  SQLite + FTS5 (sviluppo/test)
        ingly/migrations/{postgres,sqlite}/ — stesso schema, audit, impostazioni, prompt versionati
```

## Scelte di stack
Monolite modulare in **Python 3.11 + FastAPI**, dashboard in JavaScript senza build, worker separato,
**PostgreSQL con pgvector** in produzione. SQLite resta per sviluppo e test veloci: la stessa suite gira su
entrambi (`INGLY_TEST_DATABASE_URL`). Il backend non è stato riscritto in TypeScript: era già funzionante e
testato, e il prompt chiede di non sovrascrivere funzionalità valide. Il controllo dei tipi TypeScript sul
frontend (`tsc --checkJs`) segnala solo tipizzazioni DOM generiche, non difetti: non giustifica una fase di build.

## Ricerca
Ibrida: full-text (tsvector `simple` su PostgreSQL, FTS5 su SQLite) + vettoriale (pgvector, o calcolo in memoria
su SQLite), fuse con Reciprocal Rank Fusion e pesate per autorevolezza della fonte, freschezza, prodotto citato e
copertura dei termini nel singolo passaggio. Embedder predefinito offline (`hashing`, tollera refusi ma non è
semantico); `voyage` per embedding semantici. Le citazioni riportano URL, titolo, sezione, pagina, data di
acquisizione e un avviso se la fonte va riverificata.

## Principi

- **Separazione ragionamento / fonti / azioni.** Il modello produce solo JSON validato (bozza, fonti usate,
  confidenza). Recupero fonti, decisione e azioni esterne sono codice deterministico.
- **Le regole di rischio non dipendono dall'AI.** `classify_rules` gira sempre; l'AI può affinare solo
  i casi ambigui (`merge_ai`) e non annulla segnali espliciti o rischi.
- **Nessuna azione esterna senza policy.** Ogni pubblicazione, manuale o automatica, passa da
  `PolicyEngine.authorize_publish`: modalità della categoria (OFF/MONITOR/DRAFT rifiutano), approvazione
  esplicita in APPROVAL, AUTO_SAFE solo se sbloccato da una valutazione superata, rivalidazione del testo
  attuale, quote e kill switch; poi chiave di idempotenza (`published_responses.idempotency_key`).
  Modalità iniziale: DRAFT.
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
