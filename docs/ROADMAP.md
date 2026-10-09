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
- Ricerca **semantica** provata dal vivo: oggi ibrida con embedder offline non semantico; adattatore Voyage da verificare.
- **Workspace multipli**: la tabella esiste e gli utenti sono legati al workspace INGLY, ma i dati non sono ancora separati per workspace.
- Indice ANN (HNSW) su pgvector quando i chunk superano qualche decina di migliaia (oggi ricerca esatta).
- **Interfaccia multilingua** della dashboard (oggi italiano; le risposte supportano italiano e inglese).
- **Adattatori CRM esterni** (HubSpot, Pipedrive…): oggi CRM integrato con export per lead.
- **Calendario demo** integrato: oggi URL di prenotazione configurabile e attività con scadenza.
- **Notifiche** (email/Telegram) per lead caldi e bozze ad alta priorità.
- **Retention automatica dei documenti KB** oltre alle versioni (oggi conservate tutte).
