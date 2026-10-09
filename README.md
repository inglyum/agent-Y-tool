# INGLY xTool Expert Agent

Assistente tecnico e commerciale di **INGLY DESIGN** sull'ecosistema xTool: conosce i prodotti a partire
dalle fonti ufficiali, monitora i canali autorizzati, prepara risposte basate su fonti, pubblica solo dove
è consentito e trasforma le conversazioni pertinenti in contatti, senza spam.

L'agente parla come INGLY DESIGN, realtà indipendente: non si presenta mai come xTool.

## Avvio rapido

**Produzione (PostgreSQL + pgvector):** `cp .env.example .env`, compila, poi `docker compose up -d --build`
(dettagli in docs/DEPLOYMENT.md).

**Sviluppo locale (SQLite, nessuna installazione extra):**
```bash
pip install -r requirements.txt
cp .env.example .env && python -m ingly gen-key   # metti la chiave in INGLY_TOKEN_ENCRYPTION_KEY
set -a; . ./.env; set +a
python -m ingly migrate && python -m ingly serve  # http://127.0.0.1:8000
python -m ingly worker                            # in un altro terminale
python -m pytest -q                               # 88 test (anche su PostgreSQL con INGLY_TEST_DATABASE_URL)
```

Il prompt di sistema attivo è **INGLY xTool Expert Agent — System Prompt v1.0**
(`ingly/response/prompts/responder_v2.md`). Tutte le categorie partono in **DRAFT**: nessuna pubblicazione
finché non lo decidi tu.

## Documentazione
| Documento | Contenuto |
|---|---|
| [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) | cosa funziona, cosa richiede credenziali, prossimo passo |
| [docs/INSTALL.md](docs/INSTALL.md) | installazione, primo avvio, comandi |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | moduli, flussi, principi di sicurezza |
| [docs/AI_PROVIDER.md](docs/AI_PROVIDER.md) | configurazione del provider AI, budget, prompt versionato |
| [docs/META_SETUP.md](docs/META_SETUP.md) | collegare Facebook e Instagram |
| [docs/KNOWLEDGE_BASE.md](docs/KNOWLEDGE_BASE.md) | caricare e aggiornare la knowledge base |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Docker con PostgreSQL, HTTPS, backup, checklist produzione |
| [docs/API.md](docs/API.md) | tutte le rotte con il permesso richiesto |
| [docs/SECURITY_PRIVACY.md](docs/SECURITY_PRIVACY.md) | sicurezza, segreti, GDPR, backup, audit |
| [docs/API_LIMITATIONS.md](docs/API_LIMITATIONS.md) | cosa le piattaforme non consentono |
| [docs/ROADMAP.md](docs/ROADMAP.md) | prossimi passi e funzionalità non ancora disponibili |
| [docs/TEST_REPORT.md](docs/TEST_REPORT.md) | risultati dei test e della valutazione |

## Struttura
- `ingly/` — applicazione (API, knowledge engine, social, risposte, automazioni, CRM, job, dashboard in `ingly/web`)
- `ingly/migrations/postgres` e `ingly/migrations/sqlite` — schema del database
- `tests/` — test automatici; `evals/` — casi di valutazione
- `AGENT.md` — regole operative dell'agente (fonti, gerarchia, "non inventare", flusso utente → post-vendita)
- `knowledge/` — registro delle fonti ufficiali e schede YAML (modelli; importabili con `python -m ingly import-yaml`)
- `generator-lab/` — **INGLY Generator Lab PRO**: generatori parametrici per laser/CNC/stampa e pacchetti pronti per Atomm (vedi [generator-lab/README.md](generator-lab/README.md))
- `app/radar-clienti.html` — Radar Clienti: analisi rapida di screenshot di messaggi (pubblicato su https://claude.ai/artifact/NBqETpLaA2gyTs3fDjHfTn)
- `scripts/valida_kb.py` — controllo delle schede YAML (fonte e data di verifica)
