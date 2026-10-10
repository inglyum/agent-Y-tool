// Testi di vendita delle schede Atomm (italiano + inglese). Usati dal build, dagli e2e e dal kit.
const VECTOR_COMPAT = 'xTool Creative Space / xTool Studio · LightBurn · Glowforge · Cricut Design Space · Silhouette (DXF) · Inkscape · Illustrator';
const VECTOR_COMPAT_EN = 'xTool Creative Space / xTool Studio · LightBurn · Glowforge · Cricut Design Space · Silhouette (DXF) · Inkscape · Illustrator';

export const LISTINGS = [
  {
    generator: 'sign-tag',
    slug: 'label-generator',
    folder: '01-sign-and-tag',
    title: 'INGLY Sign & Tag',
    titleEn: 'INGLY Sign & Tag Maker',
    short: 'Targhette, portachiavi e insegne pronte per il laser: testo in tracciati, fori controllati, SVG/DXF in mm.',
    shortEn: 'Laser-ready tags, keychains and signs: text as vector paths, checked holes, SVG/DXF in mm.',
    crafts: ['Laser → Taglio', 'Laser → Incisione', 'Stampa → Stampa UV'],
    tags: ['targhetta', 'portachiavi', 'insegna', 'targa porta', 'nome', 'incisione', 'taglio laser', 'legno', 'acrilico', 'regalo personalizzato'],
    compat: VECTOR_COMPAT,
    detailed: `Crea in pochi secondi targhette, portachiavi, targhe per porte e insegne pronte da tagliare e incidere.

✦ COSA FA
• Misure in millimetri, angoli raccordati, smussati o vivi
• Due righe di testo con 4 font inclusi e adattamento automatico all'area utile
• Testo convertito in tracciati vettoriali: il file si apre uguale su ogni computer
• Fori di fissaggio (1, 2 o 4) con controllo del materiale attorno al foro
• Cornice incisa opzionale e margini di sicurezza
• File separati solo taglio / solo incisione, oppure tutto in uno
• Se un foro esce dal pezzo o il testo sborda, l'export si blocca e ti dice cosa correggere

✦ COMPATIBILE CON
${VECTOR_COMPAT}
Scegli il software nel menu «Software di destinazione»: il file viene adattato (colori LightBurn, guide rimosse, DXF per Silhouette).

✦ COME SI USA
1. Scegli un modello: portachiavi, targhetta, insegna, targa porta
2. Scrivi il testo e regola misure e fori
3. Esporta e lavora: rosso = taglio, nero = incisione, blu = marcatura

✦ PERFETTO PER
Regali personalizzati, uffici e studi professionali, B&B e hotel, negozi, eventi e bomboniere.`,
    detailedEn: `Create laser-ready tags, keychains, door plates and signs in seconds.

✦ FEATURES
• Millimetre sizing; rounded, chamfered or square corners
• Two text lines, 4 built-in fonts, automatic fit to the safe area
• Text converted to vector paths: the file looks the same on every computer
• Mounting holes (1, 2 or 4) with material checks around each hole
• Optional engraved border and safety margins
• Separate cut-only / engrave-only files or all-in-one
• Invalid geometry blocks the export and tells you what to fix

✦ WORKS WITH
${VECTOR_COMPAT_EN}

✦ HOW TO
1. Pick a template  2. Type your text and adjust size and holes  3. Export: red = cut, black = engrave, blue = score`,
  },
  {
    generator: 'box',
    slug: 'box-generator',
    folder: '02-box-and-enclosure',
    title: 'INGLY Box & Enclosure',
    titleEn: 'INGLY Finger-Joint Box Maker',
    short: 'Scatole a incastro e organizer con scomparti: verifica 3D dei pannelli e layout di taglio automatico.',
    shortEn: 'Finger-joint boxes and organizers with dividers: 3D panel check and automatic cutting layout.',
    crafts: ['Laser → Taglio', 'Laser → 3D'],
    tags: ['scatola', 'box', 'finger joint', 'incastro', 'organizer', 'portaoggetti', 'compensato', 'mdf', 'taglio laser', 'packaging'],
    compat: VECTOR_COMPAT,
    detailed: `Progetta scatole a incastro e organizer su misura, pronti da tagliare e montare.

✦ COSA FA
• Misure interne o esterne, a scelta
• Spessore reale del materiale, gioco di montaggio e compensazione del kerf
• Giunzione a dita (finger joint) o testa a testa
• Fondo, coperchio fisso a incastro o coperchio appoggiato con battuta
• Divisori a incastro a croce per creare scomparti
• Verifica 3D dell'assemblaggio: nessun pannello sovrapposto o mancante
• Layout di taglio automatico sulla tua lastra, con distanza fra i pezzi
• Se una combinazione non è realizzabile, l'export si blocca invece di produrre un file sbagliato

✦ COMPATIBILE CON
${VECTOR_COMPAT}

✦ COME SI USA
1. Inserisci misure e spessore misurato con il calibro
2. Scegli coperchio e scomparti
3. Esporta il layout e taglia: i pezzi si incastrano al primo colpo

✦ PERFETTO PER
Packaging per negozi, scatole regalo, organizer per cassetti, portautensili, gioielli e tè.`,
    detailedEn: `Design custom finger-joint boxes and organizers, ready to cut and assemble.

✦ FEATURES
• Inner or outer dimensions • real material thickness, fit clearance and kerf compensation
• Finger or butt joints • bottom, fixed lid or lift-off lid • cross-halving dividers
• 3D assembly check: no overlapping or missing panels • automatic sheet layout

✦ WORKS WITH
${VECTOR_COMPAT_EN}`,
  },
  {
    generator: 'layer-light',
    slug: 'layer-light-generator',
    folder: '03-layer-and-light',
    title: 'INGLY Layer & Light',
    titleEn: 'INGLY Layered Art & Lamp',
    short: 'Quadri multilivello, shadow box e lampade a strati con fori di allineamento: un file per livello.',
    shortEn: 'Multi-layer wall art, shadow boxes and lamps with alignment holes: one file per layer.',
    crafts: ['Laser → Taglio', 'Laser → 3D'],
    tags: ['multilivello', 'shadow box', 'quadro', 'lampada', 'paesaggio', 'layered', 'led', 'decorazione', 'taglio laser', 'legno'],
    compat: VECTOR_COMPAT,
    detailed: `Crea composizioni a strati con effetto profondità: quadri, shadow box, insegne luminose e lampade.

✦ COSA FA
• Da 2 a 12 livelli; sagoma rettangolare, arrotondata, circolare, esagonale o ad arco
• Motivi: paesaggio di colline (ogni variante è unica e riproducibile), onde, tunnel
• Cornice di tenuta e spessore minimo del materiale sempre controllati
• Fori di allineamento identici su tutti i livelli
• Predisposizione per LED: foro per il cavo sul fondo
• Anteprima della composizione e di ogni singolo livello
• Un file vettoriale per livello (ZIP), nessuna immagine raster

✦ COMPATIBILE CON
${VECTOR_COMPAT}

✦ COME SI USA
1. Scegli sagoma, misura e numero di livelli
2. Prova le varianti del motivo finché ti piace
3. Esporta lo ZIP, taglia i livelli e incollali con i distanziali

✦ PERFETTO PER
Arredo, regali, lampade da comodino, insegne retroilluminate, vetrine.`,
    detailedEn: `Layered wall art, shadow boxes, backlit signs and lamps: 2–12 layers, 5 outer shapes, hills / waves / tunnel motifs,
minimum material checks, identical alignment holes, LED cable hole, one vector file per layer.

✦ WORKS WITH
${VECTOR_COMPAT_EN}`,
  },
  {
    generator: 'nesting',
    slug: 'batch-nesting',
    folder: '04-batch-and-nesting',
    title: 'INGLY Batch & Nesting',
    titleEn: 'INGLY Sheet Nesting',
    short: 'Disponi lotti di pezzi sulle lastre e risparmia materiale: utilizzo, sfrido e report di produzione.',
    shortEn: 'Nest batches of parts on your sheets and save material: utilisation, waste and production report.',
    crafts: ['Laser → Taglio', 'Laser → Incisione', 'Stampa → Stampa UV'],
    tags: ['nesting', 'produzione', 'lotto', 'lastra', 'sfrido', 'ottimizzazione', 'serie', 'taglio laser', 'stampa uv', 'risparmio'],
    compat: VECTOR_COMPAT,
    detailed: `Pianifica la produzione in serie: quanti pezzi entrano nella lastra e quanto materiale risparmi.

✦ COSA FA
• Elenco pezzi con nome, misure, quantità e rotazione ammessa
• Numero di lotti, margini della lastra, distanza minima e kerf
• Disposizione automatica deterministica (algoritmo MaxRects): stesso input, stesso risultato
• Verifica indipendente di sovrapposizioni e margini
• Pezzi collocati, superficie usata e residua, percentuale di utilizzo, pezzi che non entrano
• Un file per lastra + report CSV con le coordinate di ogni pezzo

✦ COMPATIBILE CON
${VECTOR_COMPAT} · Excel / Google Sheets (report CSV)

✦ COME SI USA
1. Incolla l'elenco dei pezzi (nome; larghezza; altezza; quantità)
2. Imposta lastra, margini e kerf
3. Esporta le lastre e il report

✦ PERFETTO PER
Laboratori, produzione di gadget e bomboniere, ordini B2B, stampa UV su più pezzi.`,
    detailedEn: `Plan batch production: deterministic MaxRects nesting with lots, margins, spacing, kerf and rotation;
independent overlap check, utilisation stats, one file per sheet plus a CSV coordinate report.

✦ WORKS WITH
${VECTOR_COMPAT_EN} · Excel / Google Sheets`,
  },
  {
    generator: 'image-prep',
    slug: 'image-prep',
    folder: '05-image-prep',
    title: 'INGLY Image Prep',
    titleEn: 'INGLY Photo Engraving Prep',
    short: 'Prepara foto e loghi per l\'incisione laser: dithering, soglia e retino in mm e DPI, tutto in locale.',
    shortEn: 'Prepare photos and logos for laser engraving: dithering, threshold and halftone in mm and DPI, fully local.',
    crafts: ['Laser → Incisione', 'Stampa → Stampa UV'],
    tags: ['foto', 'incisione foto', 'dithering', 'ardesia', 'legno', 'ritratto', 'retino', 'dpi', 'laser', 'immagine'],
    compat: 'xTool Creative Space / xTool Studio · LightBurn · Glowforge · qualsiasi software di stampa (PNG con DPI)',
    detailed: `Trasforma una foto in un file pronto per l'incisione laser, direttamente nel browser.

✦ COSA FA
• L'immagine resta sul tuo dispositivo: nessun caricamento su server
• Misura finale in millimetri e risoluzione in DPI
• Luminosità, contrasto, gamma e negativo (per ardesia e materiali scuri)
• Scala di grigi, soglia, dithering Floyd–Steinberg, Atkinson, Bayer, retino a punti
• Anteprima prima/dopo
• PNG con i DPI scritti nel file: si apre già alla misura giusta

✦ COMPATIBILE CON
xTool Creative Space / xTool Studio · LightBurn · Glowforge · qualsiasi software di stampa

✦ COME SI USA
1. Trascina la foto
2. Scegli un modello (legno, ardesia, logo, retino) e regola il contrasto
3. Esporta il PNG e incidi in modalità immagine

Nota: velocità e potenza vanno sempre provate sul tuo materiale.`,
    detailedEn: `Turn a photo into a laser-engraving-ready image, locally in your browser: size in mm and DPI, brightness /
contrast / gamma / invert, grayscale, threshold, Floyd–Steinberg, Atkinson, Bayer, halftone, before/after preview,
PNG with embedded DPI.

✦ WORKS WITH
xTool Creative Space / xTool Studio · LightBurn · Glowforge · any print software`,
  },
  {
    generator: 'cost-lab',
    slug: 'material-cost-lab',
    folder: '06-material-and-cost-lab',
    title: 'INGLY Material & Cost Lab',
    titleEn: 'INGLY Laser Pricing Calculator',
    short: 'Calcola il prezzo giusto dei tuoi lavori laser: materiale, sfrido, tempo macchina, margine e IVA.',
    shortEn: 'Price your laser jobs right: material, waste, machine time, margin and VAT.',
    crafts: ['Laser → Taglio', 'Laser → Incisione', 'Stampa → Stampa UV'],
    tags: ['preventivo', 'prezzo', 'costi', 'margine', 'listino', 'materiali', 'business', 'laser', 'calcolatore', 'iva'],
    compat: 'Excel · Google Sheets · Numbers (CSV) · JSON',
    detailed: `Smetti di indovinare i prezzi: ogni costo del lavoro, separato e chiaro.

✦ COSA FA
• Catalogo materiali modificabile: produttore, fonte, misure, prezzo, data, note di sicurezza
• Voci separate: materiale, sfrido, tempo macchina, manodopera, consumabili, costi indiretti, commissioni, margine
• Prezzo netto e IVA inclusa, totale e al pezzo
• Nessun dato inventato: i valori mancanti vengono chiesti a te
• Avvisi di sicurezza sui materiali (es. PVC da non lavorare al laser)
• Export del preventivo in CSV / JSON e backup del catalogo

✦ COMPATIBILE CON
Excel · Google Sheets · Numbers (CSV)

✦ COME SI USA
1. Inserisci una volta i tuoi materiali e i prezzi d'acquisto
2. Indica pezzo, quantità, tempi e margine
3. Esporta il preventivo

✦ PERFETTO PER
Chi vende su Etsy, mercatini, negozi e clienti B2B e vuole margini sicuri.`,
    detailedEn: `Transparent pricing for laser jobs: editable material catalogue with sources and safety notes; material, waste,
machine time, labour, consumables, overhead, fees, margin and VAT as separate lines; per-piece and total prices.
Nothing is invented — missing data is requested from you. CSV/JSON export.`,
  },
  {
    generator: 'print-cut',
    slug: 'print-and-cut',
    folder: '07-print-and-cut',
    title: 'INGLY Print & Cut',
    titleEn: 'INGLY Print & Cut Sticker Maker',
    short: 'Adesivi e sagomati: sfondo rimosso in automatico, contorno di taglio, abbondanza e crocini su foglio pronto.',
    shortEn: 'Stickers and die-cut shapes: automatic background removal, cut contour, bleed and registration marks.',
    crafts: ['Stampa → Taglio di coltello', 'Stampa → Stampa UV', 'Stampa → Stampa a inchiostro', 'Laser → Taglio'],
    tags: ['adesivi', 'sticker', 'print and cut', 'stampa e taglia', 'sagomato', 'magneti', 'rimozione sfondo', 'cricut', 'contorno', 'etichette'],
    compat: `${VECTOR_COMPAT} · Cricut «Stampa e taglia» (PNG scontornato)`,
    detailed: `Da un'immagine a un foglio di adesivi pronto da stampare e tagliare, in un minuto.

✦ COSA FA
• Rimuove lo sfondo in automatico: resta solo il soggetto (personaggio, logo, disegno), anche su sfondi sfumati
• Opzioni per togliere lo sfondo chiuso nel soggetto e tenere solo il soggetto principale
• Contorno di taglio a distanza costante, arrotondato per un taglio pulito
• Bordo del colore del materiale oppure colori estesi fino al taglio, con abbondanza
• Foglio con più copie disposte automaticamente (A4 o misura libera)
• Crocini di registrazione a 3 o 4 angoli, identici nel file di stampa e in quello di taglio
• File di STAMPA (PNG con DPI e SVG) e di TAGLIO (SVG o DXF in mm) perfettamente allineati
• PNG scontornato con sfondo trasparente (ideale per Cricut «Stampa e taglia»)
• L'immagine resta sul tuo dispositivo

✦ COMPATIBILE CON
${VECTOR_COMPAT}

✦ COME SI USA
1. Trascina l'immagine: lo sfondo sparisce da solo
2. Regola distanza del taglio, copie e foglio
3. Stampa il file STAMPA al 100%, poi taglia con il file TAGLIO

✦ PERFETTO PER
Adesivi, etichette per prodotti, magneti, segnalibri, gadget e bomboniere.`,
    detailedEn: `From an image to a sheet of print-then-cut stickers in a minute: automatic background removal (even on gradient
backgrounds), constant-offset smoothed cut contour, optional colour bleed, multi-copy sheet, 3- or 4-corner registration
marks, aligned PRINT (PNG with DPI / SVG) and CUT (SVG / DXF in mm) files, transparent cut-out PNG for Cricut Print Then Cut.

✦ WORKS WITH
${VECTOR_COMPAT_EN}`,
  },
  {
    generator: 'vectorize',
    slug: 'image-to-svg',
    folder: '08-image-to-svg',
    title: 'INGLY Image → SVG',
    titleEn: 'INGLY Image to SVG Vectorizer',
    short: 'Vettorializza loghi, disegni e foto in SVG o DXF in millimetri, in bianco e nero o a livelli di colore.',
    shortEn: 'Vectorize logos, drawings and photos to millimetre SVG or DXF, black & white or colour layers.',
    crafts: ['Laser → Incisione', 'Laser → Taglio', 'Stampa → Stampa UV', 'Stampa → Taglio di coltello'],
    tags: ['vettorializzare', 'svg', 'dxf', 'tracciare', 'logo', 'png in svg', 'jpg in svg', 'carta stratificata', 'vettoriale', 'trace'],
    compat: VECTOR_COMPAT,
    detailed: `Converti un'immagine in un vettoriale pulito, pronto per laser, plotter e stampa.

✦ COSA FA
• Bianco e nero con soglia regolabile e inversione
• A colori: da 2 a 12 livelli impilati senza fessure (stile carta stratificata)
• Curve morbide con spigoli vivi dove servono
• Meno nodi e niente macchioline
• Misura finale in millimetri
• Uscita a forme piene (stampa/incisione), contorni rossi per il taglio o riempimento nero
• Un file per livello per i lavori a strati
• L'immagine resta sul tuo dispositivo

✦ COMPATIBILE CON
${VECTOR_COMPAT}

✦ COME SI USA
1. Trascina l'immagine
2. Scegli bianco e nero o colori e regola i dettagli
3. Esporta in SVG o DXF per il tuo software

✦ PERFETTO PER
Loghi di clienti, disegni a mano, timbri, stencil, lavori in carta o legno a strati.`,
    detailedEn: `Convert raster images to clean vectors for laser, plotter and print: black & white threshold or 2–12 stacked colour
layers without gaps, smooth curves with preserved corners, fewer nodes, speckle removal, millimetre sizing,
filled / cut / engrave output and one file per layer.

✦ WORKS WITH
${VECTOR_COMPAT_EN}`,
  },
];
