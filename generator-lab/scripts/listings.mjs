// Testi delle schede Atomm (step 2 "Dettagli dell'annuncio"). Usati dal build e dal file LISTING.md.
export const LISTINGS = [
  {
    generator: 'sign-tag',
    slug: 'label-generator',
    title: 'INGLY Sign & Tag',
    titleEn: 'INGLY Sign & Tag Maker',
    short: 'Targhette, portachiavi e insegne con fori validati e testo convertito in tracciati.',
    shortEn: 'Tags, keychains and signs with validated holes and text converted to vector paths.',
    crafts: ['Laser → Taglio', 'Laser → Incisione', 'Stampa → Stampa UV'],
    detailed: `Crea in pochi secondi targhette, portachiavi, targhe per porte e insegne pronte per il laser.

• Dimensioni in millimetri, angoli raccordati, smussati o vivi
• Due righe di testo con 4 font incorporati, adattamento automatico all'area sicura
• Testo convertito in tracciati vettoriali: il file non dipende dai font installati
• Fori di fissaggio (1, 2 o 4) con controllo del materiale minimo attorno al foro
• Cornice incisa opzionale, margini di sicurezza configurabili
• Esportazione SVG in mm: taglio (rosso), incisione (nero), marcatura (blu)
• Varianti separate solo-taglio e solo-incisione, oppure ZIP con tutto
• Se un foro esce dal pezzo o il testo sborda, l'esportazione viene bloccata e ti spiega cosa correggere

Modelli rapidi: portachiavi, targhetta, insegna, targa porta.`,
    detailedEn: `Design laser-ready tags, keychains, door plates and signs in seconds.
Millimetre sizing, rounded/chamfered corners, two text lines with 4 embedded fonts and auto-fit,
text converted to vector paths, mounting holes with material checks, optional engraved border.
Exports real SVG in mm with separate cut / engrave layers; invalid geometry blocks the export.`,
  },
  {
    generator: 'box',
    slug: 'box-generator',
    title: 'INGLY Box & Enclosure',
    titleEn: 'INGLY Finger-Joint Box',
    short: 'Scatole a incastro e organizer con scomparti, verificati in 3D prima del taglio.',
    shortEn: 'Finger-joint boxes and organizers with dividers, checked in 3D before cutting.',
    crafts: ['Laser → Taglio'],
    detailed: `Generatore parametrico di scatole e organizer da tagliare al laser.

• Misure interne o esterne, a scelta esplicita
• Spessore reale del materiale, gioco di montaggio e compensazione kerf
• Giunzione a dita (finger joint) o testa a testa
• Fondo, coperchio fisso a incastro o coperchio appoggiato con battuta
• Divisori a incastro a croce per creare scomparti
• Verifica 3D dell'assemblaggio: nessuna sovrapposizione fra pannelli e nessun pannello mancante
• Layout di taglio automatico sulla tua lastra, con distanza fra i pezzi
• Esportazione SVG in mm (ZIP con più lastre e pezzi singoli)

Se una combinazione non è realizzabile, l'esportazione si blocca invece di produrre un file sbagliato.`,
    detailedEn: `Parametric laser-cut box and organizer generator: inner or outer dimensions, real material thickness,
fit clearance and kerf, finger or butt joints, bottom and lid options, cross-halving dividers,
a 3D assembly check (no overlaps, no missing panels) and automatic sheet layout. Exports SVG in mm.`,
  },
  {
    generator: 'layer-light',
    slug: 'layer-light-generator',
    title: 'INGLY Layer & Light',
    titleEn: 'INGLY Layered Art & Lamp',
    short: 'Quadri multilivello, insegne e lampade a strati con fori di allineamento.',
    shortEn: 'Multi-layer shadow boxes, signs and lamps with alignment holes.',
    crafts: ['Laser → Taglio', 'Laser → 3D'],
    detailed: `Composizioni a strati per quadri, shadow box, insegne luminose e lampade.

• Da 2 a 12 livelli, sagoma rettangolare, arrotondata, circolare, esagonale o ad arco
• Motivi: paesaggio di colline (con variante casuale riproducibile), onde, tunnel concentrico
• Cornice piena di tenuta e spessore minimo del materiale controllato
• Fori di allineamento identici su tutti i livelli, con margine di registrazione
• Predisposizione luce: foro per il cavo sul fondo
• Anteprima della composizione e di ogni singolo livello
• Esportazione di un SVG per livello (ZIP), tutto vettoriale, nessuna immagine raster`,
    detailedEn: `Layered compositions for shadow boxes, signs and lamps: 2–12 layers, five outer shapes, hills / waves / tunnel
motifs, minimum material checks, identical alignment holes on every layer, cable hole for LEDs,
composition preview and one vector SVG per layer (ZIP).`,
  },
  {
    generator: 'nesting',
    slug: 'batch-nesting',
    title: 'INGLY Batch & Nesting',
    titleEn: 'INGLY Sheet Nesting',
    short: 'Disponi lotti di pezzi sulle lastre: utilizzo, sfrido e pezzi non collocabili.',
    shortEn: 'Nest batches of parts on sheets: utilisation, waste and unplaced parts.',
    crafts: ['Laser → Taglio', 'Laser → Incisione', 'Stampa → Stampa UV'],
    detailed: `Pianifica la produzione in serie sulle tue lastre.

• Elenco pezzi con nome, misure, quantità e rotazione ammessa
• Moltiplicatore di lotto, margini della lastra, distanza minima e kerf
• Algoritmo MaxRects (Best Short Side Fit) deterministico: stesso input, stesso risultato
• Verifica indipendente di sovrapposizioni e margini
• Pezzi collocati, superficie usata e residua, percentuale di utilizzo, pezzi non collocabili
• Esportazione SVG per lastra + report CSV con le coordinate

Lavora sui rettangoli d'ingombro dei pezzi.`,
    detailedEn: `Plan batch production on your sheets with a deterministic MaxRects nesting algorithm:
quantities, lot multiplier, margins, spacing, kerf and allowed rotation. Independent overlap/margin check,
utilisation statistics, unplaced parts, SVG per sheet and a CSV coordinate report. Works on bounding rectangles.`,
  },
  {
    generator: 'image-prep',
    slug: 'image-prep',
    title: 'INGLY Image Prep',
    titleEn: 'INGLY Photo Engraving Prep',
    short: 'Prepara foto e loghi per incisione: dithering, soglia e retino in mm e DPI.',
    shortEn: 'Prepare photos and logos for engraving: dithering, threshold and halftone in mm and DPI.',
    crafts: ['Laser → Incisione', 'Stampa → Stampa UV'],
    detailed: `Prepara le immagini per incisione laser e stampa, direttamente nel browser.

• L'immagine resta sul tuo dispositivo: nessun caricamento su server
• Dimensione finale in millimetri e risoluzione in DPI
• Luminosità, contrasto, gamma, negativo
• Scala di grigi, soglia, dithering Floyd–Steinberg, Atkinson, Bayer 4×4 e 8×8, retino a punti con lineatura e angolo
• Anteprima prima/dopo
• PNG con DPI scritti nel file: si apre già alla misura giusta

I filtri preparano l'immagine: velocità e potenza vanno sempre provate sul tuo materiale.`,
    detailedEn: `Prepare images for laser engraving and printing, locally in your browser: size in mm and DPI,
brightness / contrast / gamma / invert, grayscale, threshold, Floyd–Steinberg, Atkinson, Bayer and halftone,
before/after preview and PNG export with embedded DPI.`,
  },
  {
    generator: 'cost-lab',
    slug: 'material-cost-lab',
    title: 'INGLY Material & Cost Lab',
    titleEn: 'INGLY Laser Pricing Calculator',
    short: 'Catalogo materiali e preventivo trasparente: materiale, sfrido, tempi, margine, IVA.',
    shortEn: 'Material catalogue and transparent pricing: material, waste, time, margin, VAT.',
    crafts: ['Laser → Taglio', 'Laser → Incisione'],
    detailed: `Calcola il prezzo giusto dei tuoi lavori.

• Catalogo materiali modificabile: produttore, fonte, misure, prezzo, data, macchina e parametri verificati, note di sicurezza
• Voci separate: materiale, sfrido, tempo macchina, manodopera, consumabili, costi indiretti, commissioni, margine
• Prezzo netto e IVA inclusa, totale e al pezzo
• Nessun dato inventato: i valori mancanti vengono chiesti a te
• Esportazione CSV / JSON, backup del catalogo in JSON`,
    detailedEn: `Transparent pricing for laser jobs: an editable material catalogue with sources and safety notes, and a cost
breakdown (material, waste, machine time, labour, consumables, overhead, fees, margin, VAT). Nothing is
invented — missing data is requested from you. CSV/JSON export.`,
  },
  {
    generator: 'print-cut',
    slug: 'print-and-cut',
    title: 'INGLY Print & Cut',
    titleEn: 'INGLY Print & Cut Sticker Maker',
    short: 'Adesivi e sagomati: sfondo rimosso in automatico, contorno di taglio, abbondanza e crocini.',
    shortEn: 'Stickers and die-cut shapes: automatic cut contour, bleed and registration marks on a ready sheet.',
    crafts: ['Stampa → Taglio di coltello', 'Stampa → Stampa UV', 'Stampa → Stampa a inchiostro', 'Laser → Taglio'],
    detailed: `Trasforma un'immagine in adesivi, magneti e sagomati pronti da stampare e tagliare.

• Rimuove lo sfondo in automatico: resta solo il soggetto (personaggio, logo, disegno), anche su sfondi sfumati
• Opzioni per togliere lo sfondo chiuso nel soggetto e tenere solo il soggetto principale; esporta anche il PNG scontornato
• Contorno di taglio a distanza costante, con arrotondamento che elimina rientranze impossibili da tagliare
• Bordo del colore del materiale oppure colori estesi fino al taglio, con abbondanza configurabile
• Foglio con più copie disposte automaticamente (A4 o misura libera)
• Crocini di registrazione a 3 o 4 angoli, identici nel file di stampa e in quello di taglio
• File di STAMPA (PNG con DPI e SVG) e file di TAGLIO (SVG in mm) perfettamente allineati
• Lunghezza di taglio e numero di copie calcolati
• L'immagine resta sul tuo dispositivo`,
    detailedEn: `Turn an image into print-then-cut stickers, magnets and shapes: automatic background removal (keeps only the subject,
works on gradient backgrounds), constant-offset cut contour with smoothing, optional colour bleed, multi-copy sheet layout, 3- or
4-corner registration marks, aligned PRINT (PNG with DPI / SVG) and CUT (SVG in mm) files. Runs locally.`,
  },
  {
    generator: 'vectorize',
    slug: 'image-to-svg',
    title: 'INGLY Image → SVG',
    titleEn: 'INGLY Image to SVG Vectorizer',
    short: 'Vettorializza loghi, disegni e foto in SVG in millimetri, in bianco e nero o a livelli di colore.',
    shortEn: 'Vectorize logos, drawings and photos to millimetre SVG, black & white or colour layers.',
    crafts: ['Laser → Incisione', 'Laser → Taglio', 'Stampa → Stampa UV', 'Stampa → Taglio di coltello'],
    detailed: `Converte un'immagine raster in un SVG vettoriale pronto per laser, plotter e stampa.

• Bianco e nero con soglia regolabile e inversione
• A colori: da 2 a 12 livelli, impilati senza fessure fra un colore e l'altro (stile carta stratificata)
• Curve morbide con spigoli vivi dove servono (soglia angolo regolabile)
• Semplificazione dei nodi ed eliminazione delle macchioline
• Dimensione finale in millimetri
• Uscita a forme piene (stampa / incisione), contorni rossi per il taglio o riempimento nero
• ZIP con un SVG per livello per i lavori a strati
• Anteprima originale/vettoriale; l'immagine resta sul tuo dispositivo`,
    detailedEn: `Convert raster images into clean SVG for laser, plotter and print: black & white threshold or 2–12 stacked colour
layers without gaps, smooth curves with preserved corners, node simplification, speckle removal, millimetre sizing,
filled / cut / engrave output and one SVG per layer. Runs locally in your browser.`,
  },
];
