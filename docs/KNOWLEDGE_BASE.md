# Caricare e aggiornare la knowledge base

## Gerarchia delle fonti
Registrata in `knowledge/fonti.yaml` e nella tabella `sources` (priorità 1 = più autorevole):
xTool Europe Italia e catalogo → Support Center → manuali → Academy → Squad → community ufficiale → Host →
community maker → fonti indipendenti. Nel ranking le fonti ufficiali pesano di più; le community non
sostituiscono mai una specifica ufficiale e nel prompt sono marcate come "COMMUNITY/ESPERIENZA".

## Quattro modi di alimentarla

0. **Acquisizione di un URL** (Knowledge Base → Acquisisci un URL pubblico, o `POST /api/kb/ingest-url`):
   solo per pagine dei domini registrati come fonti, rispettando robots.txt, con protezione SSRF.

1. **Import di documenti** (consigliato per iniziare): dashboard → Knowledge Base → Importa documento,
   oppure `python -m ingly import xtool_support manuale.pdf --url https://support.xtool.com/...`.
   Indica sempre l'URL ufficiale di origine: diventa la citazione.
2. **Crawling**: Fonti e Crawler → abilita la fonte → *Scansiona ora* (eseguito dal worker).
   Il crawler legge robots.txt (se non è leggibile non scansiona), parte dalle sitemap, resta nei prefissi
   consentiti (`/it-it` per il sito italiano), attende `INGLY_CRAWLER_DELAY_S` tra le richieste, usa GET
   condizionali (ETag/Last-Modified) e si ferma su 401/403/429. Non aggira login, CAPTCHA o paywall.
3. **Catalogo strutturato**: Prodotti, Accessori, Materiali. Ogni specifica e compatibilità richiede
   l'URL della fonte; lo stato "verified" richiede anche la data di verifica. Le schede YAML esistenti in
   `knowledge/` si importano con `python -m ingly import-yaml` (i modelli vuoti vengono saltati).

## Cosa succede a ogni aggiornamento
- contenuto identico → solo `last_checked_at` aggiornato;
- contenuto cambiato → nuova riga in `document_versions`, chunk e indice rigenerati, notifica in "Novità rilevate";
- stesso contenuto a un altro URL → registrato come duplicato, senza duplicare l'indice;
- pagina 404/410 → documento `gone`, escluso dalle ricerche, notifica.

## Rimozione e fonti da riverificare
- **Rimuovi** un documento dalla dashboard (con motivo): esce subito da ricerche e risposte; le versioni restano per l'audit.
- **Fonti da riverificare**: documenti non ricontrollati da più di 30 giorni. Nelle citazioni compare
  "da riverificare" oltre i 90 giorni e la ricerca li penalizza.

## Ricerca ibrida ed embedding
Con l'embedder predefinito (`hashing`) la ricerca trova anche parole con refusi o varianti, ma non sinonimi.
Per una ricerca semantica imposta `INGLY_EMBEDDINGS_PROVIDER=voyage` e la chiave, poi `python -m ingly reembed`.

## Riconoscimento dei prodotti
Aggiungi alias ai prodotti (es. nome commerciale abbreviato) e reindicizza (`python -m ingly reembed`): i chunk vengono
etichettati con i prodotti citati e la ricerca privilegia quelli della domanda.

## Dati in conflitto
Se due fonti riportano valori diversi per la stessa specifica, compaiono in "Dati in conflitto".
Risolvi marcando come `superseded` la specifica superata.

## Stato attuale
La knowledge base è **vuota**: da questo ambiente di sviluppo i siti xtool.eu, xtool.com e
support.xtool.com non erano raggiungibili, quindi non è stato importato alcun dato reale e non è
stato inserito alcun dato di esempio nel database. Il primo popolamento va fatto dall'ambiente di produzione.
