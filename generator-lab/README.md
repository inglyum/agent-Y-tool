# INGLY GENERATOR LAB PRO

Suite modulare di generatori parametrici INGLY DESIGN per laser, CNC e stampa. È un'app separata e
isolata dal resto del repository (backend Python in `../ingly`): non lo modifica e non dipende da esso.

**Per pubblicare su Atomm** leggi [atomm-release/GUIDA-ATOMM.md](atomm-release/GUIDA-ATOMM.md):
ogni app è già pronta da copiare e incollare (file HTML, copertina, testi della scheda).

## Generatori

| # | Generatore | Uscita | Stato |
|---|---|---|---|
| 01 | **Sign & Tag**: targhette, portachiavi, insegne | SVG (completo / solo taglio / solo incisione), ZIP | completo |
| 02 | **Box & Enclosure**: scatole a dita o testa a testa, coperchi, divisori | SVG layout di taglio, ZIP con i pezzi | completo |
| 03 | **Layer & Light**: composizioni multilivello e lampade | ZIP con un SVG per livello | completo |
| 04 | **Batch & Nesting**: pezzi su lastra (MaxRects) | ZIP con SVG per lastra + report CSV | completo (rettangoli d'ingombro) |
| 05 | **Image Prep**: grigi, soglia, dithering, retino | PNG con DPI nel file | completo |
| 06 | **Material & Cost Lab**: catalogo materiali e preventivi | CSV / JSON | completo |

## Comandi

```bash
npm install
npm test            # 49 test unitari, geometrici e di esportazione (node:test)
npm run typecheck   # TypeScript strict
npm run build       # dist/index.html (suite) + atomm-release/<slug>/<slug>.html
npm run e2e         # test nel browser (Chromium) sui file finali
npm run release     # tutto quanto sopra + copertine 4:3 e LISTING.md
npm run serve -- label-generator   # anteprima su http://127.0.0.1:5173 per il Debug locale Atomm
```

Ogni file HTML è autonomo (JS, CSS e font incorporati): si apre anche con doppio clic, senza server.
L'unica risorsa esterna è l'SDK Atomm; se non è raggiungibile l'app passa in **modalità autonoma**.

## Architettura

```
src/
  core/
    types.ts        contratti: ParamDef, GeneratorDef, View, ExportOption
    params.ts       generator-core: normalizzazione/validazione, annulla/ripristina
    geometry.ts     geometry-engine: primitive in mm, distanze, intersezioni, PRNG deterministico
    rectilinear.ts  contorni esatti di regioni rettilinee (dita, cave)
    nesting.ts      MaxRects Best Short Side Fit + verifica indipendente
    svg.ts          svg-engine: documenti in mm, livelli per lavorazione, escape XML, validatore
    export.ts       export-engine: nomi file, ZIP (store), CRC32, PNG con pHYs, CSV sicuro
    fonts.ts        testo → tracciati (opentype.js + font OFL incorporati)
    atomm.ts        adapter Atomm opzionale
  generators/       un modulo per generatore + registry.ts (generator-registry)
  ui/               app-shell e ui-components (canvas zoom/pan, griglia mm, pannelli, azioni)
  entries/main.ts   punto d'ingresso; il build sceglie suite o singolo generatore
scripts/            build, generazione font, e2e, server locale, testi delle schede Atomm
tests/              test unitari e di regressione
```

Ogni generatore è una funzione pura `run(parametri) → { viste, problemi, statistiche, esportazioni }`.
La UI non contiene geometria: per aggiungere un generatore crea `src/generators/<nome>.ts`, registralo in
`registry.ts` e aggiungi la scheda in `scripts/listings.mjs`; il build crea il pacchetto Atomm.

### Convenzioni dei file esportati
- `width`/`height` in **mm**, `viewBox` con 1 unità = 1 mm (verificato a ogni esportazione).
- Rosso `#FF0000` = taglio (traccia 0,1 mm), nero pieno = incisione, blu = marcatura,
  azzurro = guida da non lavorare (nomi dei pezzi, contorni di riferimento).
- I testi sono **tracciati vettoriali** per impostazione predefinita. L'opzione "testo modificabile" scrive
  un `<text>` e avverte che il risultato dipende dal font installato; non è ammessa per il taglio.
- Nessun file viene esportato se ci sono errori: i pulsanti si disattivano e l'hook Atomm rifiuta con un messaggio.

### Controlli geometrici
- **Sign & Tag**: materiale minimo attorno ai fori, fori sovrapposti, raggio massimo, testo nell'area sicura
  (misurato sui contorni reali dei glifi) e lontano dai fori, glifi mancanti nel font.
- **Box**: lati troppo corti per le dita, gioco/kerf eccessivi, pannelli divisi, **verifica 3D**: ogni cella
  del guscio appartiene a un solo pannello (0 = pannello mancante, 2 = collisione), pezzi fuori lastra.
- **Layer & Light**: cornice minima, ponti fra finestre sotto lo spessore minimo, fori di registrazione
  lontani da bordi e finestre su tutti i livelli.
- **Nesting**: verifica indipendente di margini, distanze e sovrapposizioni; pezzi non collocabili con motivo.

### Dati e privacy
- Le immagini di Image Prep restano nel browser: nessun invio a servizi esterni.
- I parametri si salvano nel `localStorage` del browser. **Salva progetto** scarica un JSON
  (`format: ingly-project`) che **Apri progetto** ricarica; l'import accetta solo chiavi e tipi noti.
- Il catalogo materiali ha **Esporta / Importa catalogo JSON** per backup e trasferimento.
- Nessun prezzo, tempo o parametro macchina è precompilato: i modelli di materiale contengono solo
  nome e note di sicurezza note; ogni dato porta lo stato "inserito manualmente" o "verificato con fonte".

### Adapter Atomm
`src/core/atomm.ts` verifica che `window.atomm.lifecycle.on` esista, registra `'export'` e restituisce
`{ filename, blob }` con un vero `Blob` (fonte: https://dev.atomm.com/docs/atomm). La documentazione
non era raggiungibile dall'ambiente di sviluppo: l'adapter usa solo l'API documentata, `ui.toast` è
facoltativo, e il comportamento è stato provato con un SDK simulato nei test e2e. **Da verificare
nell'anteprima reale della console Atomm prima dell'invio.**

## Limiti noti / prossimi passi
- Nesting su rettangoli d'ingombro (non su sagome reali).
- Box: nessuna anteprima 3D renderizzata (la verifica 3D è numerica); niente cerniere o coperchi scorrevoli.
- Image Prep: elaborazione nel thread principale; immagini molto grandi possono richiedere qualche secondo.
- Font: 4 famiglie latine (Montserrat, Oswald, Playfair Display, Great Vibes — SIL OFL 1.1).
