# Limitazioni delle API e delle piattaforme

Queste limitazioni sono scelte di progetto o vincoli esterni: il sistema le mostra in dashboard come
"non disponibile" e ripiega sulla revisione manuale.

| Limitazione | Effetto nel sistema |
|---|---|
| **Gruppi Facebook**: Meta ha dismesso la Groups API (annuncio gennaio 2024) | Il gruppo xTool Official Italia si gestisce con l'**import manuale**; le risposte si pubblicano a mano |
| Pagine e profili di terzi non sono leggibili né commentabili da una app esterna | Solo Pagine/account INGLY collegati via OAuth |
| Permessi `pages_*` e `instagram_*` richiedono App Review e Business Verification per l'uso reale | In sviluppo funzionano solo per gli utenti con ruolo nella app |
| Messaggi privati: finestre di messaggistica e consenso | Nessun DM automatico implementato |
| Instagram: risposta solo ai commenti sui propri contenuti | `reply_post` non disponibile su Instagram |
| Rate limit Graph API (per app, utente, Pagina) | `RetryLater` con attesa dagli header di utilizzo; quote di pubblicazione proprie |
| Token revocabili in qualsiasi momento | Controllo periodico `debug_token`, stato `expired`, nessun retry inutile |
| Siti xTool: condizioni d'uso, robots.txt, protezioni anti-bot | Crawling disattivato di default; stop su 401/403/429; nessuna elusione |
| Contenuti dinamici (prezzi, disponibilità, promo) | Mai riportati se non presenti testualmente in una fonte ufficiale; invito a verificare sul sito |
| Embedding semantici (Voyage) | Adattatore scritto ma non provato dal vivo: l'API non era raggiungibile da questo ambiente |
| Ambiente di sviluppo di questa sessione | xtool.eu, xtool.com, support.xtool.com e graph.facebook.com non raggiungibili: KB vuota e connettori testati solo con risposte simulate |

I nomi di permessi, campi ed endpoint Meta in `ingly/social/meta.py` vanno ricontrollati sulla
documentazione ufficiale alla versione Graph API in uso (`META_GRAPH_VERSION`).
