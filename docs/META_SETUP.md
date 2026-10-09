# Collegare Facebook e Instagram (Meta)

> Stato in questo repository: i connettori sono implementati e testati contro risposte simulate della
> Graph API. **Nessun account reale è stato collegato**: servono una app Meta e le credenziali di INGLY DESIGN.
> Meta modifica spesso nomi dei permessi, versioni e requisiti di App Review: verifica ogni punto sulla
> documentazione ufficiale (developers.facebook.com) al momento della configurazione.

## Cosa si può fare (e cosa no)

| Canale | Lettura | Risposta | Note |
|---|---|---|---|
| Pagina Facebook gestita da INGLY | post e commenti | risposta ai commenti | via OAuth con page token |
| Instagram professionale collegato alla Pagina | commenti sui propri contenuti | risposta ai commenti | nessun commento su contenuti di terzi |
| Gruppi Facebook (es. xTool Official Italia) | **no** | **no** | Meta ha dismesso la Groups API (annuncio gennaio 2024): usa l'import manuale |
| Pagine di terzi (es. pagina xTool) | no | no | servirebbero permessi che una app esterna non ottiene |
| Messaggi privati | non attivati | non attivati | nessun DM automatico; contatto solo su richiesta e con consenso |

## Passi

1. **Crea una app** su developers.facebook.com (tipo Business) con un account amministratore della Pagina INGLY.
2. Aggiungi i prodotti *Facebook Login for Business* e *Webhooks* (e *Instagram* se usi Instagram).
3. In *Facebook Login* → *Valid OAuth Redirect URIs* inserisci `https://TUO-DOMINIO/api/social/meta/callback`.
4. Compila `.env`: `META_APP_ID`, `META_APP_SECRET`, `META_REDIRECT_URI`, `META_WEBHOOK_VERIFY_TOKEN`
   (stringa casuale), `INGLY_TOKEN_ENCRYPTION_KEY` (`python -m ingly gen-key`), `META_GRAPH_VERSION`.
5. Permessi richiesti dal sistema (in `ingly/social/meta.py`):
   `pages_show_list`, `pages_read_engagement`, `pages_read_user_content`, `pages_manage_engagement`,
   `instagram_basic`, `instagram_manage_comments`. In modalità sviluppo funzionano solo per gli utenti
   con ruolo nella app; per l'uso reale serve **App Review** con Business Verification.
6. Dalla dashboard: **Facebook → Collega con Meta**. Al ritorno le Pagine e gli account Instagram
   compaiono in **Account collegati** e come **fonti** (disattivate: attivale una per una).
7. **Webhook**: in *Webhooks* sottoscrivi l'oggetto *Page* (campo `feed`) e *Instagram* (campo `comments`)
   con URL `https://TUO-DOMINIO/webhooks/meta` e il verify token scelto. Ogni POST è verificato con la firma
   `X-Hub-Signature-256` (HMAC con l'app secret); senza firma valida la richiesta è rifiutata.
   Senza webhook il sistema usa il polling alla frequenza impostata sulla fonte.

## Token, scadenze, disconnessione

- I token sono salvati **cifrati** (Fernet) e mai scritti nei log o nell'audit.
- Il job `check_tokens` (ogni 6 ore) chiama `debug_token` e aggiorna stato, scadenza e permessi.
- Errore 190 → account `expired`, fonte in errore, job in dead-letter (nessun retry inutile): ricollega l'account.
- **Scollega** cancella il token locale e disattiva le fonti; revoca anche l'iscrizione della app alla Pagina quando possibile.

## Limiti di frequenza

Gli errori di rate limit Meta (codici 4, 17, 32, 613 o HTTP 429) diventano `RetryLater`: il job viene
ripianificato usando, se presente, `estimated_time_to_regain_access` dagli header di utilizzo.
Le pubblicazioni hanno inoltre limiti propri per ora/giorno, per canale e globali (dashboard → Automazioni).

## Policy

- L'agente si presenta come INGLY DESIGN, realtà indipendente: il validatore blocca frasi che lasciano
  intendere un'affiliazione con xTool.
- Niente messaggi privati automatici, niente follow-up non richiesti, niente risposte ripetute alla stessa persona
  con inviti commerciali entro 30 giorni.
