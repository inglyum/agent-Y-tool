# Stato dell'implementazione

Aggiornato: 2026-10-09

## Fasi

| Fase | Stato | Note |
|---|---|---|
| A — Audit del repository | ✔ | Repository con sole istruzioni (`AGENT.md`), registro fonti, schemi YAML vuoti, validatore e pagina Radar Clienti. Nessun segreto. Tutto conservato. |
| B — Architettura e piano | ✔ | `docs/ARCHITECTURE.md` |
| C — Database e backend | ✔ | SQLite + migrazioni, FastAPI, CLI |
| D — Knowledge ingestion e RAG | ✔ codice · ✖ dati | Funziona con import e crawling; KB reale vuota (siti xTool non raggiungibili da qui) |
| E — Dashboard | ✔ | 20 sezioni, chiaro/scuro, mobile, provata nel browser |
| F — Social connectors | ✔ codice · ⏳ credenziali | Meta Graph testata con risposte simulate; serve app Meta + App Review |
| G — Response Engine | ✔ | Funziona senza AI (regole + bozze prudenti); con provider Anthropic serve la chiave |
| H — CRM e lead | ✔ | |
| I — Automazioni e sicurezza | ✔ | Default prudente: tutto in APPROVAL |
| J — Test, documentazione, deployment | ✔ | 47 test, valutazione, Docker, guide |

## Funziona davvero, oggi
- Login, ruoli (admin/editor/sales/viewer), CSRF, blocco tentativi, audit con redazione.
- Import manuale di messaggi (es. dal gruppo Facebook) → classificazione → bozza → coda di revisione → lead.
- Import PDF/HTML nella KB con versioni, deduplica, ricerca e citazioni.
- Crawler (robots.txt, sitemap, GET condizionali, stop su blocchi) — provato su siti simulati.
- Catalogo con stato di verifica, campi mancanti, compatibilità prudente, conflitti tra fonti.
- Policy di automazione, kill switch, quote, pubblicazione idempotente.
- Scheduler con retry, dead-letter, pianificazioni; backup/ripristino.

## Richiede credenziali o approvazioni esterne
- **Meta**: app, `META_APP_ID`/`META_APP_SECRET`/`META_REDIRECT_URI`/`META_WEBHOOK_VERIFY_TOKEN`, App Review.
  Fino ad allora Facebook e Instagram mostrano "non configurato": nessun collegamento è simulato.
- **Provider AI**: `INGLY_AI_PROVIDER=anthropic` + chiave. Senza, le bozze sono domande di chiarimento prudenti.
- **Dati xTool reali**: da importare dall'ambiente di produzione.

## Simulato (solo nei test)
Provider AI finto, siti web finti, Graph API finta, pagine HTML di una macchina fittizia. Nulla di questo è nel database applicativo.

## Prossimo passo preciso
1. Deploy (docs/DEPLOYMENT.md) con HTTPS e worker attivo.
2. Importare 5-10 manuali ufficiali dal Support Center e abilitare il crawling di `xtool_support` con `--max-pages 50`;
   controllare "Novità rilevate" e la qualità della ricerca.
3. Configurare il provider AI ed eseguire **Test e Valutazione AI**; aggiungere casi reali a `evals/cases.yaml`.
4. Creare l'app Meta, collegare la Pagina INGLY, lavorare 2-4 settimane in APPROVAL prima di valutare AUTO_SAFE
   per la sola categoria `technical`.
