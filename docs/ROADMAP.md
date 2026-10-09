# Roadmap

## Pronto (in questo repository)
Backend, database e migrazioni, knowledge engine (import, crawler, versioni, RAG full-text), response engine
con validazione, policy di automazione, connettori Meta (codice), import manuale, CRM, scheduler, dashboard
(20 sezioni), sicurezza, test e valutazione.

## Prossimi passi, in ordine
1. **Popolare la knowledge base reale** dall'ambiente di produzione: import dei manuali ufficiali e crawling
   di support.xtool.com e xtool.eu/it-it dopo verifica delle condizioni d'uso.
2. **Catalogo verificato**: schede prodotto/accessorio/materiale con URL e data di verifica.
3. **App Meta + App Review** e primo collegamento reale della Pagina INGLY; prova end-to-end in modalità APPROVAL.
4. **Provider AI in produzione** e confronto delle metriche di valutazione prima/dopo.
5. **Casi di valutazione reali**: sostituire/integrare `evals/cases.yaml` con domande vere (anonimizzate)
   e risposte di riferimento scritte da INGLY; aggiungere un giudizio umano periodico sul tono.

## Funzionalità non ancora disponibili
- Ricerca **vettoriale/semantica** (oggi BM25 full-text con sinonimi via alias): interfaccia `Retriever`
  pronta per affiancare embeddings.
- **Interfaccia multilingua** della dashboard (oggi italiano; le risposte supportano italiano e inglese).
- **Adattatori CRM esterni** (HubSpot, Pipedrive…): oggi CRM integrato con export per lead.
- **Calendario demo** integrato: oggi URL di prenotazione configurabile e attività con scadenza.
- **PostgreSQL** per più worker/istanze.
- **Notifiche** (email/Telegram) per lead caldi e bozze ad alta priorità.
- **Retention automatica dei documenti KB** oltre alle versioni (oggi conservate tutte).
