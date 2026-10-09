# Installazione

Requisiti: Python 3.11+, SQLite con FTS5 (incluso in Python standard).

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
6. **Automazioni**: tutto parte in APPROVAL. Passa una categoria ad AUTO_SAFE solo dopo aver controllato
   la qualità delle bozze e le metriche di **Test e Valutazione AI**.

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
| `python -m pytest -q` | test automatici |
