// Genera src/fonts/font-data.gen.ts con i font OFL (WOFF, subset latin) codificati in base64.
// I font vengono incorporati nell'HTML finale: il testo può così essere convertito in tracciati
// senza dipendere dai font installati sul computer dell'utente.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fonts = [
  { id: 'montserrat', label: 'Montserrat Bold (sans)', file: '@fontsource/montserrat/files/montserrat-latin-700-normal.woff' },
  { id: 'oswald', label: 'Oswald SemiBold (condensato)', file: '@fontsource/oswald/files/oswald-latin-600-normal.woff' },
  { id: 'playfair', label: 'Playfair Display Bold (serif)', file: '@fontsource/playfair-display/files/playfair-display-latin-700-normal.woff' },
  { id: 'greatvibes', label: 'Great Vibes (corsivo)', file: '@fontsource/great-vibes/files/great-vibes-latin-400-normal.woff' },
];
let out = '// File generato da scripts/gen-fonts.mjs — non modificare a mano.\n';
out += '// Font con licenza SIL Open Font License 1.1 (pacchetti @fontsource).\n';
out += 'export const FONT_DATA: { id: string; label: string; base64: string }[] = [\n';
for (const f of fonts) {
  const b64 = readFileSync(join(root, 'node_modules', f.file)).toString('base64');
  out += `  { id: ${JSON.stringify(f.id)}, label: ${JSON.stringify(f.label)}, base64: ${JSON.stringify(b64)} },\n`;
}
out += '];\n';
writeFileSync(join(root, 'src/fonts/font-data.gen.ts'), out);
console.log(`font-data.gen.ts: ${fonts.length} font, ${(out.length / 1024).toFixed(0)} KB`);
