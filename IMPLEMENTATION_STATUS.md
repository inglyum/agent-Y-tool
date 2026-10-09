# Stato dell'implementazione

Aggiornato: 2026-10-09 · 88 test verdi su SQLite e su PostgreSQL 16 + pgvector.

## Audit di partenza (seconda iterazione)
Il repository conteneva già l'applicazione Python/FastAPI (backend, dashboard, 47 test). Mancavano rispetto al
nuovo prompt: PostgreSQL + pgvector, ricerca ibrida, acquisizione URL con protezione SSRF, modalità iniziale DRAFT
con AUTO_SAFE bloccato, autorizzazione lato server di ogni pubblicazione, System Prompt v1.0, tabelle
`workspaces`/`consents`/`audit_events`/`ai_usage`, guida sicurezza/privacy, documentazione API.
Decisione: **mantenere Python** (funzionante e testato) invece di riscrivere in TypeScript; aggiungere PostgreSQL
mantenendo SQLite per sviluppo e test.

## ✅ Completo e verificato
| Area | Note |
|---|---|
| Autenticazione e permessi | sessioni, CSRF, ruoli, blocco tentativi; tutte le rotte /api protette (test) |
| Database | migrazioni versionate per PostgreSQL (pgvector, tsvector) e SQLite; vincoli, indici, cascade |
| Knowledge base | import PDF/HTML, acquisizione URL di fonti registrate, crawler (robots, sitemap, GET condizionali), versioni, checksum, deduplica, rimozione, fonti obsolete, conflitti |
| Ricerca e citazioni | ibrida full-text + vettoriale; citazioni con URL, titolo, sezione, pagina, data di acquisizione |
| Risposte | System Prompt v1.0 versionato, fonti obbligatorie, ipotesi segnalate, validatore (prezzi, dati tecnici, link, affiliazione, sicurezza, istruzioni interne, duplicati) |
| Policy | OFF/MONITOR/DRAFT/APPROVAL/AUTO_SAFE; DRAFT iniziale; AUTO_SAFE bloccato fino a valutazione superata; ogni pubblicazione riautorizzata lato server; kill switch; quote; idempotenza |
| CRM | pipeline NEW→WON/LOST, opportunità solo da interesse concreto, consensi, export, cancellazione, retention |
| Job | coda nel database, lease, backoff, dead-letter, pianificazioni, SKIP LOCKED su PostgreSQL |
| Sicurezza | SSRF guard, CSP, redazione log, token cifrati, backup/ripristino (pg_dump/pg_restore) |
| Dashboard | 20 sezioni, chiaro/scuro, mobile, stati reali di connessione e cosa manca |
| Test e documentazione | 88 test su due database, valutazione deterministica, guide in docs/ |

## 🟡 Parziale
| Area | Cosa manca |
|---|---|
| Ricerca semantica | embedder predefinito offline non semantico; adattatore Voyage scritto ma non provato dal vivo |
| Workspace | tabella e legame utenti presenti; i dati non sono ancora separati per workspace (un solo workspace: INGLY DESIGN) |
| Valutazione | 16 casi scritti a mano; servono casi reali con risposte di riferimento |
| TypeScript | non adottato: backend Python esistente mantenuto; frontend JS senza build (controllo tsc solo informativo) |

## ⛔ Bloccato da elementi esterni
| Blocco | Cosa serve |
|---|---|
| Dati xTool reali | i siti xtool.eu, xtool.com, support.xtool.com non erano raggiungibili da questo ambiente: KB e catalogo vuoti |
| Facebook / Instagram | app Meta, credenziali in `.env`, App Review; fino ad allora "non configurato" (nessun collegamento simulato) |
| Gruppi Facebook di terzi | nessuna API Meta: solo import manuale e pubblicazione a mano |
| Provider AI | `INGLY_AI_PROVIDER=anthropic` e chiave; senza, bozze prudenti di chiarimento |
| Deploy | un server con HTTPS (docker-compose pronto) |

## Prossimo passo preciso
1. Deploy con `docker compose up -d` (PostgreSQL incluso) dietro HTTPS; creare l'amministratore.
2. Importare i primi manuali ufficiali e acquisire le pagine chiave di support.xtool.com con "Acquisisci un URL".
3. Configurare il provider AI, eseguire **AI Tests** e aggiungere casi reali a `evals/cases.yaml`.
4. Lavorare in DRAFT dalla Coda Risposte; creare l'app Meta e passare in APPROVAL le categorie mature.
