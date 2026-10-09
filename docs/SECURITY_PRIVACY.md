# Sicurezza e privacy

## Accesso
- Password con **scrypt** (sale casuale, minimo 12 caratteri); blocco di 15 minuti dopo 5 tentativi falliti;
  limite di 10 tentativi di login per IP ogni 15 minuti.
- Sessioni lato server (solo l'hash del token nel database), cookie `HttpOnly`, `SameSite=Lax`, `Secure` con
  `INGLY_COOKIE_SECURE=true`; durata 12 ore. Disattivare un utente chiude subito le sue sessioni.
- **CSRF**: ogni richiesta che modifica dati richiede l'header `X-CSRF-Token` legato alla sessione.
- **Ruoli e permessi** verificati lato server su ogni rotta (`admin`, `editor`, `sales`, `viewer`); un test
  verifica che tutte le rotte `/api` rifiutino richieste anonime.

## Protezioni applicative
- **SQL injection**: solo query parametrizzate; la ricerca full-text quota ogni termine.
- **XSS**: la dashboard inserisce dati solo tramite escape; Content-Security-Policy `default-src 'self'`
  senza script inline; `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`.
- **SSRF**: crawler e acquisizione URL passano da `NetGuard` su ogni richiesta e redirect: solo http/https,
  porte 80/443, niente credenziali nell'URL, solo indirizzi pubblici (bloccati localhost, reti private,
  link-local e metadata cloud). L'acquisizione è consentita solo per i domini delle fonti registrate.
  Limite noto: il DNS rebinding non è escluso al 100% → in produzione aggiungere un egress firewall.
- **Validazione input**: modelli Pydantic con limiti di lunghezza; upload massimo 20 MB; webhook massimo 1 MB.
- **Prompt injection**: contenuti esterni racchiusi e neutralizzati (`escape_external`), segnali di injection
  forzano la revisione, il modello non ha strumenti né accesso a segreti, il validatore blocca risposte che
  rivelano istruzioni interne, link non consentiti, affiliazioni false o consigli contrari alla sicurezza.
- **Azioni esterne**: ogni pubblicazione è riautorizzata lato server (modalità della categoria, approvazione
  esplicita, validazione del testo attuale, quote, kill switch) con chiave di idempotenza.

## Segreti
- Solo variabili d'ambiente (`.env` escluso da Git; `.env.example` senza valori).
- Token OAuth Meta cifrati a riposo con Fernet (`INGLY_TOKEN_ENCRYPTION_KEY`); mai nei log né nell'audit.
- Log JSON con redazione automatica di token, header Authorization, parametri `access_token`, email e telefoni.
- Token scaduti/revocati: stato `expired`, nessun retry inutile, fonte disattivata finché non si ricollega.

## Dati personali (GDPR)
- **Minimizzazione**: dai social si salvano testo, nome visibile e ID pseudonimo della piattaforma; nessuna email
  o telefono salvati senza consenso esplicito al contatto (il database lo impone a livello applicativo).
- **Nessun contatto marketing automatico**: un'opportunità nasce solo da interesse concreto espresso nel messaggio
  (acquisto, preventivo, demo, corso) e non ha recapiti; la partecipazione a una discussione non è consenso.
- **Consensi** registrati con finalità, base giuridica, canale, prova e data; la revoca cancella i recapiti.
- **Accesso**: export completo dei dati di un lead (`GET /api/leads/{id}/export`).
- **Cancellazione**: definitiva, con eventi, consensi e conversazioni in cascata e anonimizzazione del post collegato.
- **Conservazione**: `crm.retention_days` (predefinito 365); il job `retention_purge` cancella i lead scaduti
  (non quelli `WON`) e anonimizza i contenuti social più vecchi non legati a lead.
- Prima del go-live: informativa privacy sul sito INGLY che descriva questo trattamento e la base giuridica
  (legittimo interesse per rispondere a domande pubbliche; consenso per il ricontatto).

## Backup e ripristino
- PostgreSQL: `python -m ingly backup` usa `pg_dump -Fc`; `python -m ingly restore file.dump` usa `pg_restore --clean`.
- SQLite: backup online consistente con l'API di backup di SQLite.
- Pianifica un backup giornaliero fuori dal server e **prova il ripristino** almeno una volta al mese.

## Audit
Ogni azione rilevante (login, modifiche a impostazioni, regole, prompt, catalogo, fonti, bozze, pubblicazioni,
lead, consensi, cancellazioni, collegamenti social) finisce in `audit_events` con attore e dettaglio redatto.
