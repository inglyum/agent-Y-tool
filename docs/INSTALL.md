# Installazione

Requisiti: Python 3.11+. Produzione: PostgreSQL 14+ con estensione **pgvector** (vedi docs/DEPLOYMENT.md).
Sviluppo: basta SQLite (incluso in Python), senza installare altro.

```bash
git clone <repo> && cd agent-Y-tool
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # compila almeno INGLY_TOKEN_ENCRYPTION_KEY e l'amministratore
python -m ingly gen-key         # incolla il risultato in INGLY_TOKEN_ENCRYPTION_KEY
set -a; . ./.env; set +a
python -m ingly migrate         # crea il database, i ruoli, le fonti ufficiali, le regole prudenti
python -m ingly serve           # dashboard su http://127.0.0.1:8000
python -m ingly worker          # in un secondo terminale: crawling, polling, retention, controlli token
```

In alternativa all'amministratore da `.env`: `python -m ingly create-user tua@email.it --role admin`.

## Primo avvio consigliato

1. **Impostazioni**: brand, dichiarazione di trasparenza, URL di contatto/demo/corsi/preventivi (se esistono),
   budget AI, retention.
2. **AI Agent → Prova una domanda**: verifica classificazione e bozza senza pubblicare nulla.
3. **xTool Knowledge Base**: importa i primi manuali ufficiali (PDF scaricati dal Support Center) oppure
   abilita il crawling in **Fonti e Crawler** dopo aver verificato le condizioni d'uso del sito.
4. **Social Listening → Import manuale**: incolla domande dal gruppo Facebook e lavora dalla **Coda Risposte**.
5. **Facebook / Instagram**: collega la Pagina INGLY quando la app Meta è pronta (docs/META_SETUP.md).
6. **Automazioni**: tutto parte in **DRAFT** (solo bozze). Passa a APPROVAL le categorie che vuoi pubblicare
   via API dopo approvazione. AUTO_SAFE resta bloccato finché una valutazione recente, con il provider AI attivo,
   non supera le soglie (**AI Tests** → poi **Automazioni → Sblocca AUTO_SAFE**).

## Comandi

| Comando | Cosa fa |
|---|---|
| `python -m ingly migrate` | migrazioni e dati di base |
| `python -m ingly serve [--host --port]` | API e dashboard |
| `python -m ingly worker [--once]` | esegue i job pianificati |
| `python -m ingly import <fonte> <file> [--url]` | importa PDF/HTML nella KB (es. fonte `xtool_support`) |
| `python -m ingly crawl <fonte> [--max-pages]` | scansiona una fonte con crawling abilitato |
| `python -m ingly import-yaml` | importa le schede YAML in `knowledge/` |
| `python -m ingly eval` | valutazione sui casi di `evals/cases.yaml` |
| `python -m ingly backup [dest]` / `restore <src>` | backup consistente / ripristino |
| `python -m ingly reembed` | ricalcola embedding e prodotti citati |
| `python -m pytest -q` | test automatici (SQLite) |
| `INGLY_TEST_DATABASE_URL=postgresql://… python -m pytest -q` | stessi test su PostgreSQL (crea e cancella un database per test) |
| `python scripts/gen_api_docs.py` | rigenera docs/API.md |
