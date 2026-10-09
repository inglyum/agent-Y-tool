// Build: crea file HTML singoli e autonomi (JS + CSS + font incorporati).
//  - dist/index.html                    → suite completa con dashboard (uso autonomo / online)
//  - atomm-release/<slug>/<slug>.html   → un generatore per pacchetto, pronto da caricare su Atomm
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SDK = 'https://static-res.makextool.com/scripts/js/generator-sdk/platform-sdk.js';
const css = readFileSync(join(root, 'src/ui/styles.css'), 'utf8');
const { LISTINGS } = await import('./listings.mjs');

async function bundle(generator) {
  const r = await build({
    entryPoints: [join(root, 'src/entries/main.ts')],
    bundle: true, minify: true, format: 'iife', target: ['es2020'], write: false, legalComments: 'none',
    define: { __GENERATOR__: JSON.stringify(generator) },
  });
  return r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
}

function page({ title, description, js, withSdk }) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#FACC15"/><text x="16" y="21" font-size="13" font-family="Arial" font-weight="700" text-anchor="middle" fill="#111827">IG</text></svg>')}">
${withSdk ? `<!-- SDK della piattaforma Atomm: se non è raggiungibile l'app funziona comunque in modalità autonoma -->\n<script src="${SDK}"></script>\n` : ''}<style>${css}</style>
</head>
<body>
<div id="app"><noscript>Questo generatore richiede JavaScript.</noscript></div>
<script>${js}</script>
</body>
</html>
`;
}

mkdirSync(join(root, 'dist'), { recursive: true });
const suiteJs = await bundle('');
writeFileSync(join(root, 'dist/index.html'), page({ title: 'INGLY Generator Lab PRO', description: 'Suite di generatori parametrici INGLY DESIGN per laser, CNC e stampa.', js: suiteJs, withSdk: false }));
console.log(`dist/index.html  ${(suiteJs.length / 1024).toFixed(0)} KB`);

for (const l of LISTINGS) {
  const js = await bundle(l.generator);
  const dir = join(root, 'atomm-release', l.slug);
  mkdirSync(dir, { recursive: true });
  const html = page({ title: l.title, description: l.short, js, withSdk: true });
  writeFileSync(join(dir, `${l.slug}.html`), html);
  console.log(`atomm-release/${l.slug}/${l.slug}.html  ${(html.length / 1024).toFixed(0)} KB`);
}
