// Test end-to-end nel browser (Chromium via playwright-core) sui file HTML finali.
// Uso: node scripts/e2e.mjs [--covers]   (--covers genera anche cover.png 4:3 e LISTING.md per Atomm)
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LISTINGS } from './listings.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SDK = 'https://static-res.makextool.com/scripts/js/generator-sdk/platform-sdk.js';
const MOCK_SDK = `window.__hooks={};window.__toasts=[];window.atomm={lifecycle:{on:function(e,f){window.__hooks[e]=f}},ui:{toast:function(m){window.__toasts.push(String(m))}}};`;
const covers = process.argv.includes('--covers');
// Chromium preinstallato (cloud) o indicato con CHROMIUM_PATH; altrimenti quello di playwright.
const executablePath = [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium'].find((p) => p && existsSync(p));

let failures = 0;
const ok = (cond, msg) => {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    failures++;
    console.log(`  ✗ ${msg}`);
  }
};

const browser = await chromium.launch({ executablePath });

function checkSvgText(s) {
  return /<svg[^>]*\swidth="[\d.]+mm"[^>]*\sheight="[\d.]+mm"[^>]*\sviewBox="0 0 [\d.]+ [\d.]+"/.test(s) && !/<script/i.test(s);
}

async function openPage(file, { sdk = 'absent', viewport = { width: 1440, height: 900 } } = {}) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(`console: ${m.text()}`);
  });
  await page.route(SDK, (route) => (sdk === 'mock' ? route.fulfill({ status: 200, contentType: 'application/javascript', body: MOCK_SDK }) : route.abort()));
  await page.goto(pathToFileURL(file).href);
  await page.waitForFunction(() => !document.querySelector('.status.processing'), null, { timeout: 15000 });
  return { ctx, page, problems };
}

async function exportViaButton(page, optionId) {
  if (optionId) await page.selectOption('.export-select', optionId);
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('.actionbar .btn.primary')]);
  const path = await dl.path();
  return { name: dl.suggestedFilename(), bytes: readFileSync(path) };
}

async function setField(page, gen, key, value) {
  const sel = `#p-${gen}-${key}`;
  const tag = await page.$eval(sel, (e) => e.tagName + ':' + (e.type || ''));
  if (tag.startsWith('SELECT')) await page.selectOption(sel, String(value));
  else if (tag.endsWith('checkbox')) await page.setChecked(sel, Boolean(value));
  else {
    await page.fill(sel, String(value));
    await page.$eval(sel, (e) => e.dispatchEvent(new Event('change', { bubbles: true })));
  }
  await page.waitForTimeout(250);
  await page.waitForFunction(() => !document.querySelector('.status.processing'));
}

/** Disegni dimostrativi sintetici creati nel browser (nessuna immagine di terzi). */
async function demoArt(page, kind) {
  const bytes = await page.evaluate(async (kind) => {
    const cv = document.createElement('canvas');
    const g = cv.getContext('2d');
    if (kind === 'photo') {
      // personaggio su sfondo sfumato opaco (come una foto): lo sfondo va rimosso in automatico
      cv.width = 700; cv.height = 700;
      const bg = g.createLinearGradient(0, 0, 0, 700);
      bg.addColorStop(0, '#b9d4f0'); bg.addColorStop(1, '#f2f6fa');
      g.fillStyle = bg; g.fillRect(0, 0, 700, 700);
      g.fillStyle = '#c2410c'; g.beginPath(); g.arc(350, 200, 110, 0, Math.PI * 2); g.fill();
      g.fillRect(250, 300, 200, 300); g.fillRect(150, 320, 60, 240); g.fillRect(150, 320, 120, 50); g.fillRect(150, 520, 120, 40);
      g.fillStyle = '#fff'; g.beginPath(); g.arc(315, 185, 18, 0, Math.PI * 2); g.arc(385, 185, 18, 0, Math.PI * 2); g.fill();
    } else if (kind === 'sticker') {
      cv.width = 800; cv.height = 600;
      g.translate(400, 300);
      g.fillStyle = '#facc15';
      g.beginPath();
      for (let i = 0; i < 24; i++) { const r = i % 2 ? 170 : 250, a = (i / 24) * Math.PI * 2; g.lineTo(r * Math.cos(a), r * Math.sin(a)); }
      g.closePath(); g.fill();
      g.fillStyle = '#111827'; g.beginPath(); g.arc(0, 0, 140, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ffffff'; g.font = 'bold 86px sans-serif'; g.textAlign = 'center'; g.fillText('INGLY', 0, 30);
    } else {
      cv.width = 900; cv.height = 600;
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, 900, 600);
      g.fillStyle = '#1d4f91'; g.beginPath(); g.moveTo(80, 520); g.lineTo(330, 120); g.lineTo(580, 520); g.closePath(); g.fill();
      g.fillStyle = '#facc15'; g.beginPath(); g.arc(650, 200, 110, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#b42318'; g.beginPath(); g.moveTo(420, 520); g.lineTo(600, 260); g.lineTo(820, 520); g.closePath(); g.fill();
      g.fillStyle = '#111827'; g.font = 'bold 110px sans-serif'; g.fillText('INGLY', 260, 590);
    }
    const b = await new Promise((r) => cv.toBlob(r, 'image/png'));
    return Array.from(new Uint8Array(await b.arrayBuffer()));
  }, kind);
  return Buffer.from(bytes);
}

const statText = (page) => page.$eval('.stats', (e) => e.textContent);

for (const l of LISTINGS) {
  const file = join(root, 'atomm-release', l.slug, `${l.slug}.html`);
  console.log(`\n▶ ${l.slug}`);
  const { ctx, page, problems } = await openPage(file, { sdk: 'mock' });
  const gen = l.generator;
  ok(await page.$eval('.chip-static', (e) => e.textContent) === 'Atomm: collegato', 'SDK Atomm rilevato e hook registrato');
  ok(await page.evaluate(() => typeof window.__hooks.export === 'function'), 'lifecycle.on("export") registrato');

  if (gen === 'image-prep') {
    // immagine di prova generata dal browser stesso (resta locale)
    const png = await page.screenshot({ clip: { x: 0, y: 0, width: 320, height: 200 } });
    await page.setInputFiles(`#p-${gen}-image`, { name: 'prova.png', mimeType: 'image/png', buffer: png });
    await page.waitForFunction(() => document.querySelector('.content canvas'), null, { timeout: 15000 });
    await page.waitForFunction(() => !document.querySelector('.status.processing'));
  }
  if (gen === 'print-cut' || gen === 'vectorize') {
    ok((await page.$$eval('.issue.error', (e) => e.map((x) => x.textContent).join('|'))).includes('Carica'), 'chiede di caricare un\'immagine');
    await page.setInputFiles(`#p-${gen}-image`, { name: 'demo.png', mimeType: 'image/png', buffer: await demoArt(page, gen === 'print-cut' ? 'sticker' : 'logo') });
    await page.waitForFunction(() => document.querySelector('.content svg path'), null, { timeout: 20000 });
    await page.waitForFunction(() => !document.querySelector('.status.processing'));
  }
  if (gen === 'cost-lab') {
    ok((await page.$$eval('.issue.error', (e) => e.map((x) => x.textContent).join('|'))).includes('dato mancante'), 'Cost Lab chiede i dati mancanti');
    await setField(page, gen, 'material', 'plywood-poplar');
    await page.click('details.mat >> nth=0');
    const mat = page.locator('details.mat').first();
    await mat.locator('label:has-text("Prezzo €") input').fill('12');
    await mat.locator('label:has-text("Prezzo €") input').dispatchEvent('change');
    await mat.locator('label:has-text("Larghezza lastra mm") input').fill('600');
    await mat.locator('label:has-text("Larghezza lastra mm") input').dispatchEvent('change');
    await mat.locator('label:has-text("Altezza lastra mm") input').fill('400');
    await mat.locator('label:has-text("Altezza lastra mm") input').dispatchEvent('change');
    for (const [k, v] of [['waste', 15], ['machineMin', 12], ['machineRate', 18], ['laborMin', 10], ['laborRate', 22], ['margin', 30]]) await setField(page, gen, k, v);
  }

  const errs = await page.$$eval('.issue.error', (e) => e.map((x) => x.textContent));
  ok(errs.length === 0, `nessun errore con i valori iniziali${errs.length ? ': ' + errs.join(' | ') : ''}`);
  ok(await page.$('.content svg, .content canvas, .content table') !== null, 'anteprima presente');

  // esportazione dal pulsante della UI
  const { name, bytes } = await exportViaButton(page);
  ok(bytes.length > 0, `export UI: ${name} (${bytes.length} byte)`);
  if (name.endsWith('.svg')) ok(checkSvgText(bytes.toString('utf8')), 'SVG in mm con viewBox');
  if (name.endsWith('.zip')) ok(bytes.readUInt32LE(0) === 0x04034b50, 'ZIP valido');
  if (name.endsWith('.png')) ok(bytes.subarray(1, 4).toString() === 'PNG' && bytes.includes(Buffer.from('pHYs')), 'PNG con DPI');

  // esportazione tramite l'hook Atomm: deve restituire un vero Blob con nome file
  const hook = await page.evaluate(async () => {
    const r = await window.__hooks.export('download');
    return { filename: r.filename, isBlob: r.blob instanceof Blob, size: r.blob.size, type: r.blob.type };
  });
  ok(hook.isBlob && hook.size > 0 && hook.filename.length > 0, `hook Atomm → ${hook.filename} (${hook.type}, ${hook.size} byte)`);

  if (gen === 'sign-tag') {
    const before = await statText(page);
    await setField(page, gen, 'width', 100);
    ok((await statText(page)).includes('100 × 30'), 'la larghezza aggiorna il risultato');
    await page.click('button:has-text("Annulla")');
    await page.waitForTimeout(300);
    ok((await statText(page)) === before, 'annulla ripristina lo stato precedente');
    await page.click('button:has-text("Ripristina")');
    await page.waitForTimeout(300);
    ok((await statText(page)).includes('100 × 30'), 'ripristina riapplica la modifica');
    await setField(page, gen, 'holeOffset', 1);
    ok(await page.$eval('.actionbar .btn.primary', (b) => b.disabled), 'export bloccato con foro fuori dal pezzo');
    const rejected = await page.evaluate(async () => {
      try { await window.__hooks.export(); return 'resolved'; } catch (e) { return String(e.message); }
    });
    ok(rejected !== 'resolved' && (await page.evaluate(() => window.__toasts.length)) > 0, 'hook Atomm rifiuta geometrie non valide e avvisa');
    ok(await page.$('.field.invalid') !== null, 'il campo errato è evidenziato');
    await page.click('button:has-text("Reset")');
    await page.waitForTimeout(300);
    ok((await page.$$('.issue.error')).length === 0 && (await statText(page)) === before, 'reset riporta ai valori iniziali');
    await page.click('button:has-text("Insegna")');
    await page.waitForTimeout(300);
    ok((await statText(page)).includes('400 × 150'), 'preset applicato');
    await page.click('button:has-text("Reset")');
    await page.waitForTimeout(300);
  }
  if (gen === 'print-cut') {
    ok(await page.$('.content svg image') !== null, 'anteprima con disegno e contorno di taglio');
    await page.setInputFiles(`#p-${gen}-image`, { name: 'foto.png', mimeType: 'image/png', buffer: await demoArt(page, 'photo') });
    await page.waitForTimeout(400);
    await page.waitForFunction(() => !document.querySelector('.status.processing'), null, { timeout: 20000 });
    ok(/rimosso \d+%/.test(await statText(page)), 'sfondo di una foto opaca rimosso in automatico');
    await page.click('.tab:has-text("Sfondo rimosso")');
    ok(await page.$('.content svg image') !== null, 'vista «Sfondo rimosso» con il soggetto scontornato');
    const co = await exportViaButton(page, 'cutout');
    ok(co.bytes.subarray(1, 4).toString() === 'PNG', `PNG scontornato (${co.bytes.length} byte)`);
    const png = await exportViaButton(page, 'print-png');
    ok(png.bytes.subarray(1, 4).toString() === 'PNG' && png.bytes.includes(Buffer.from('pHYs')), `PNG di stampa con DPI (${png.bytes.length} byte)`);
    const cut = await exportViaButton(page, 'cut');
    ok(checkSvgText(cut.bytes.toString('utf8')) && cut.bytes.toString('utf8').includes('data-operation="cut"'), 'SVG di taglio in mm');
    const zip = await exportViaButton(page, 'zip');
    ok(['stampa.png', 'stampa.svg', 'taglio.svg'].every((n) => zip.bytes.includes(Buffer.from(n))), 'ZIP con stampa PNG + SVG e taglio');
  }
  if (gen === 'vectorize') {
    await setField(page, gen, 'mode', 'color');
    ok((await statText(page)).includes('#'), 'modalità a colori con livelli');
    const z = await exportViaButton(page, 'zip');
    ok(z.bytes.readUInt32LE(0) === 0x04034b50, 'ZIP con un SVG per livello');
  }
  if (gen === 'box') {
    await setField(page, gen, 'divX', 1);
    await setField(page, gen, 'divY', 2);
    ok((await statText(page)).includes('nessuna collisione'), 'verifica 3D superata con divisori');
  }

  // zoom / adatta
  await page.click('button[title="Ingrandisci"]');
  const z1 = await page.$eval('.zoom-label', (e) => e.textContent);
  await page.click('button[title="Adatta alla tavola"]');
  const z2 = await page.$eval('.zoom-label', (e) => e.textContent);
  ok(z1 !== z2, `zoom e adattamento (${z1} → ${z2})`);

  // risoluzioni: niente scroll orizzontale della pagina
  for (const vp of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(vp);
    await page.waitForTimeout(150);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(over <= 0, `layout ${vp.width}×${vp.height} senza scroll orizzontale`);
  }
  ok(problems.length === 0, `nessun errore JavaScript in console${problems.length ? ': ' + problems.join(' | ') : ''}`);
  await ctx.close();

  // modalità autonoma: SDK non raggiungibile
  const solo = await openPage(file, { sdk: 'absent' });
  ok((await solo.page.$eval('.chip-static', (e) => e.textContent)) === 'Modalità autonoma', 'senza SDK l\'app funziona in modalità autonoma');
  ok(solo.problems.length === 0, 'nessun errore JavaScript senza SDK');
  await solo.ctx.close();

  if (covers) {
    const c = await openPage(file, { sdk: 'absent', viewport: { width: 1600, height: 1200 } });
    if (gen === 'image-prep') {
      // copertina con un'immagine dimostrativa sintetica (gradiente e forme), nessuna foto di terzi
      const demo = await c.page.evaluate(async () => {
        const cv = document.createElement('canvas');
        cv.width = 900; cv.height = 600;
        const g = cv.getContext('2d');
        const grd = g.createRadialGradient(450, 260, 30, 450, 300, 520);
        grd.addColorStop(0, '#fff'); grd.addColorStop(1, '#111');
        g.fillStyle = grd; g.fillRect(0, 0, 900, 600);
        g.fillStyle = '#facc15'; g.beginPath(); g.arc(450, 280, 150, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#111827'; g.font = 'bold 90px sans-serif'; g.textAlign = 'center'; g.fillText('INGLY', 450, 310);
        const b = await new Promise((r) => cv.toBlob(r, 'image/png'));
        return Array.from(new Uint8Array(await b.arrayBuffer()));
      });
      await c.page.setInputFiles(`#p-${gen}-image`, { name: 'demo.png', mimeType: 'image/png', buffer: Buffer.from(demo) });
      await c.page.waitForFunction(() => document.querySelector('.content canvas'));
    }
    if (gen === 'print-cut' || gen === 'vectorize') {
      await c.page.setInputFiles(`#p-${gen}-image`, { name: 'demo.png', mimeType: 'image/png', buffer: await demoArt(c.page, gen === 'print-cut' ? 'sticker' : 'logo') });
      await c.page.waitForFunction(() => document.querySelector('.content svg path'), null, { timeout: 20000 });
      if (gen === 'vectorize') {
        await setField(c.page, gen, 'mode', 'color');
        await setField(c.page, gen, 'colors', 5);
      }
    }
    if (gen === 'box') {
      await setField(c.page, gen, 'divX', 1);
      await setField(c.page, gen, 'divY', 2);
    }
    if (gen === 'cost-lab') {
      // valori dimostrativi digitati solo per la copertina (non vengono salvati nel pacchetto)
      await setField(c.page, gen, 'material', 'plywood-poplar');
      await c.page.click('details.mat >> nth=0');
      const mat = c.page.locator('details.mat').first();
      for (const [label, v] of [['Prezzo €', '12'], ['Larghezza lastra mm', '600'], ['Altezza lastra mm', '400']]) {
        await mat.locator(`label:has-text("${label}") input`).fill(v);
        await mat.locator(`label:has-text("${label}") input`).dispatchEvent('change');
      }
      for (const [k, v] of [['waste', 15], ['machineMin', 12], ['machineRate', 18], ['laborMin', 10], ['laborRate', 22], ['margin', 30]]) await setField(c.page, gen, k, v);
      await c.page.$eval('.panel.right', (e) => e.scrollTo(0, 0));
    }
    if (gen === 'box') await c.page.$eval('.panel.right', (e) => e.scrollTo(0, 0));
    if (gen === 'layer-light') await c.page.click('.tab >> nth=0');
    await c.page.waitForTimeout(400);
    const out = join(root, 'atomm-release', l.slug, 'screenshot-app.png');
    await c.page.screenshot({ path: out });
    console.log(`  → screenshot ${out.replace(root + '/', '')}`);
    await c.ctx.close();
  }
}

// suite completa: dashboard e navigazione
console.log('\n▶ suite (dist/index.html)');
{
  const { ctx, page, problems } = await openPage(join(root, 'dist/index.html'));
  ok((await page.$$('.card')).length === LISTINGS.length, 'dashboard con tutti i generatori');
  await page.click('.card >> nth=1');
  await page.waitForFunction(() => document.querySelector('.content svg'));
  ok((await page.$eval('.gen-title', (e) => e.textContent)).includes('Box'), 'apertura di un generatore dalla dashboard');
  await page.click('button:has-text("Tutti i generatori")');
  ok((await page.$$('.card')).length === LISTINGS.length, 'ritorno alla dashboard');
  ok(problems.length === 0, 'nessun errore JavaScript');
  await ctx.close();
}

await browser.close();

if (covers) {
  for (const l of LISTINGS) {
    const md = `# ${l.title} — scheda Atomm (copia e incolla)

App Atomm: **${l.slug}**

## Step 2 · Dettagli dell'annuncio

**Immagine di copertina:** \`cover.png\` (in questa cartella, formato 4:3)

**Titolo della carta:**
\`\`\`
${l.title}
\`\`\`

**Breve descrizione:**
\`\`\`
${l.short}
\`\`\`

**Descrizione dettagliata:**
\`\`\`
${l.detailed}
\`\`\`

**Mestiere da selezionare:** ${l.crafts.join(' · ')}

## Step 3 · Artefatto di codice

Carica il file \`${l.slug}.html\` (in questa cartella).

---

### English version (optional)

**Title:** ${l.titleEn}

**Short description:** ${l.shortEn}

**Detailed description:**
\`\`\`
${l.detailedEn}
\`\`\`
`;
    mkdirSync(join(root, 'atomm-release', l.slug), { recursive: true });
    writeFileSync(join(root, 'atomm-release', l.slug, 'LISTING.md'), md);
  }
}

console.log(failures ? `\n✗ ${failures} controlli falliti` : '\n✓ Tutti i controlli end-to-end superati');
process.exit(failures ? 1 : 0);
