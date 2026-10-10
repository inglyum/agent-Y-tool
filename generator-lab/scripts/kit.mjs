// Kit di pubblicazione: INGLY-Generator-Lab-Kit.zip con una cartella per app, pronta per Atomm e per la vendita.
// Uso: node scripts/kit.mjs   (dopo build, e2e --covers e covers)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipStore } from '../src/core/export.ts';
import { LISTINGS } from './listings.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const enc = new TextEncoder();
const entries = [];
const K = 'INGLY-Generator-Lab-Kit';
// righe Windows-friendly per i .txt (Blocco note)
const txt = (s) => enc.encode(s.replace(/\r?\n/g, '\r\n') + '\r\n');
const add = (name, data) => entries.push({ name: `${K}/${name}`, data });
const file = (p) => {
  if (!existsSync(p)) throw new Error(`manca ${p}: esegui prima npm run release`);
  return new Uint8Array(readFileSync(p));
};

function scheda(l) {
  return `# ${l.title} — scheda Atomm (copia e incolla)

App Atomm: **${l.slug}**

## Dettagli dell'annuncio
**Immagine di copertina:** \`2-IMMAGINI/cover.png\` (4:3) — immagine aggiuntiva facoltativa: \`2-IMMAGINI/screenshot-app.png\`

**Titolo della carta**
\`\`\`
${l.title}
\`\`\`

**Breve descrizione**
\`\`\`
${l.short}
\`\`\`

**Descrizione dettagliata**
\`\`\`
${l.detailed}
\`\`\`

**Mestiere da selezionare:** ${l.crafts.join(' · ')}

**Parole chiave:** ${l.tags.join(', ')}

## Artefatto di codice
Carica \`1-CODICE-da-caricare/${l.slug}.html\`.

## Compatibilità
${l.compat}

---

### English
**Title:** ${l.titleEn}

**Short description:** ${l.shortEn}

**Detailed description:**
\`\`\`
${l.detailedEn}
\`\`\`
`;
}

const table = LISTINGS.map((l) => `  ${l.folder.padEnd(26)} → app Atomm: ${l.slug}`).join('\n');

const leggimi = `INGLY GENERATOR LAB PRO — KIT DI PUBBLICAZIONE
================================================

Questo kit contiene 8 generatori pronti da pubblicare su Atomm (dev.atomm.com) e da vendere.
Ogni cartella è un'app completa:

${table}

In ogni cartella:
  1-CODICE-da-caricare/   → il file .html da caricare in «Artefatto di codice»
  2-IMMAGINI/             → cover.png (copertina 4:3) e screenshot-app.png (immagine extra)
  3-TESTI-copia-incolla/  → un file .txt per ogni campo della scheda
  SCHEDA.md               → tutti i testi in un unico file (italiano + inglese)

PROCEDURA SU ATOMM (uguale per ogni app)
---------------------------------------
1. Crea l'app con il nome indicato nella tabella (es. label-generator).
2. Debug locale → SALTA: l'SDK della piattaforma è già incluso nel file .html.
3. Dettagli dell'annuncio:
   - Immagine di copertina   → 2-IMMAGINI/cover.png
   - Titolo della carta      → 3-TESTI-copia-incolla/01-titolo.txt
   - Breve descrizione       → 3-TESTI-copia-incolla/02-breve-descrizione.txt
   - Descrizione dettagliata → 3-TESTI-copia-incolla/03-descrizione-dettagliata.txt
   - Mestiere                → spunta le voci in 04-mestieri-da-selezionare.txt
   - (facoltativo) immagine aggiuntiva → 2-IMMAGINI/screenshot-app.png
   - Clicca «Salva».
4. Artefatto di codice → trascina il file della cartella 1-CODICE-da-caricare.
5. Invia per la revisione → spunta la Dichiarazione di autorizzazione commerciale → «Invia per la revisione».

Prima di inviare prova il pulsante Esporta nell'anteprima: deve scaricare un file.

ALTRO
-----
suite-completa/INGLY-Generator-Lab.html → tutti gli 8 generatori in un unico file, da usare anche senza Atomm
                                            (doppio clic, funziona offline nel browser).
COMPATIBILITA-SOFTWARE.txt              → come aprire i file in xTool, LightBurn, Cricut, Glowforge, Silhouette, Inkscape.
`;

const compat = `COMPATIBILITÀ CON I SOFTWARE
============================

Nei generatori, accanto al pulsante «Esporta», c'è il menu SOFTWARE DI DESTINAZIONE.
Sceglilo prima di esportare: il file viene adattato automaticamente.

Universale (SVG)
  Per xTool, LightBurn, Glowforge, Inkscape, Illustrator. Livelli con nome (Taglio, Incisione, Marcatura),
  misure in millimetri. Rosso = taglio · Nero pieno = incisione · Blu = marcatura · Azzurro = guida (non lavorare).

xTool Creative Space / xTool Studio
  SVG in mm senza linee guida. Importa con «Importa» o trascinando il file: le misure sono già corrette.
  Contorni = taglio o marcatura (scegli il processo per colore), forme piene = incisione.

LightBurn
  I colori corrispondono alla tavolozza di LightBurn: 00 nero = incisione, 01 blu = marcatura, 02 rosso = taglio.
  Importa con File → Importa: ogni operazione finisce già sul suo livello. Guide rimosse.

Glowforge
  Un colore per operazione, guide rimosse: nell'app Glowforge assegna Cut / Engrave / Score per colore.

Cricut Design Space
  SVG senza guide con forme chiuse. Carica con «Carica → Carica immagine». Controlla la misura al primo import.
  Per «Stampa e taglia» usa nel Print & Cut l'export «PNG del soggetto scontornato»: Cricut crea il contorno e i suoi crocini.

DXF (Silhouette, CAD, Cricut)
  DXF R12 in millimetri con un livello per operazione (TAGLIO, INCISIONE, MARCATURA). Le curve sono convertite
  in segmenti con precisione 0,05 mm. Silhouette Studio edizione base apre solo DXF: usa questo profilo.

File di stampa (Print & Cut, Image Prep)
  PNG con i DPI scritti nel file: stampa sempre in scala 100% («dimensione reale»), mai «adatta alla pagina».
`;

add('00-LEGGIMI.txt', txt(leggimi));
add('COMPATIBILITA-SOFTWARE.txt', txt(compat));
add('suite-completa/INGLY-Generator-Lab.html', file(join(root, 'dist/index.html')));
for (const l of LISTINGS) {
  const dir = join(root, 'atomm-release', l.slug);
  writeFileSync(join(dir, 'LISTING.md'), scheda(l));
  const f = l.folder;
  add(`${f}/1-CODICE-da-caricare/${l.slug}.html`, file(join(dir, `${l.slug}.html`)));
  add(`${f}/2-IMMAGINI/cover.png`, file(join(dir, 'cover.png')));
  if (existsSync(join(dir, 'screenshot-app.png'))) add(`${f}/2-IMMAGINI/screenshot-app.png`, file(join(dir, 'screenshot-app.png')));
  add(`${f}/3-TESTI-copia-incolla/01-titolo.txt`, txt(l.title));
  add(`${f}/3-TESTI-copia-incolla/02-breve-descrizione.txt`, txt(l.short));
  add(`${f}/3-TESTI-copia-incolla/03-descrizione-dettagliata.txt`, txt(l.detailed));
  add(`${f}/3-TESTI-copia-incolla/04-mestieri-da-selezionare.txt`, txt(l.crafts.join('\n')));
  add(`${f}/3-TESTI-copia-incolla/05-parole-chiave.txt`, txt(l.tags.join(', ')));
  add(`${f}/3-TESTI-copia-incolla/06-english.txt`, txt(`TITLE\n${l.titleEn}\n\nSHORT DESCRIPTION\n${l.shortEn}\n\nDETAILED DESCRIPTION\n${l.detailedEn}`));
  add(`${f}/SCHEDA.md`, enc.encode(scheda(l)));
}
const out = join(root, `${K}.zip`);
writeFileSync(out, zipStore(entries));
console.log(`${K}.zip: ${entries.length} file, ${(readFileSync(out).length / 1024 / 1024).toFixed(1)} MB`);
