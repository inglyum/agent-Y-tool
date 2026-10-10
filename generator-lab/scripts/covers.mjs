// Copertine professionali 4:3 (1600×1200) per le schede Atomm: atomm-release/<slug>/cover.png
// Uso: node scripts/covers.mjs   (dopo npm run build; richiede Chromium come gli e2e)
import { build } from 'esbuild';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { LISTINGS } from './listings.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const font = (w) => readFileSync(join(root, `node_modules/@fontsource/montserrat/files/montserrat-latin-${w}-normal.woff`)).toString('base64');
const js = (await build({ entryPoints: [join(root, 'scripts/cover/entry.ts')], bundle: true, format: 'iife', write: false, target: ['es2020'] })).outputFiles[0].text;

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:Montserrat;font-weight:500;src:url(data:font/woff;base64,${font(500)}) format('woff')}
@font-face{font-family:Montserrat;font-weight:800;src:url(data:font/woff;base64,${font(800)}) format('woff')}
*{box-sizing:border-box;margin:0}
html,body{width:1600px;height:1200px;overflow:hidden}
body{font-family:Montserrat,sans-serif;color:#fff;position:relative;
  background:
    radial-gradient(900px 700px at 78% 42%, rgba(250,204,21,.16), transparent 70%),
    linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px) 0 0/40px 40px,
    linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px) 0 0/40px 40px,
    linear-gradient(160deg,#141b26 0%,#0b0f16 100%)}
.brand{position:absolute;left:80px;top:72px;display:flex;align-items:center;gap:16px;font-weight:800;font-size:26px;letter-spacing:.06em}
.brand .logo{width:54px;height:54px;border-radius:13px;background:#facc15;color:#111827;display:grid;place-items:center;font-size:22px}
.brand small{display:block;font-weight:500;font-size:16px;letter-spacing:.18em;color:#9ca3af}
.text{position:absolute;left:80px;top:300px;width:600px}
#code{font-weight:800;font-size:30px;color:#facc15;letter-spacing:.12em}
h1{font-weight:800;font-size:124px;line-height:.98;letter-spacing:-.03em;margin-top:18px}
#t2{color:#facc15}
#tagline{font-weight:500;font-size:36px;line-height:1.3;color:#d1d5db;margin-top:34px}
#chips{display:flex;flex-wrap:wrap;gap:14px;margin-top:40px}
#chips span{font-weight:500;font-size:23px;padding:11px 22px;border-radius:999px;border:2px solid rgba(250,204,21,.6);color:#fef3c7;background:rgba(250,204,21,.08)}
#visual{position:absolute;left:690px;top:110px;width:850px;height:980px;display:flex;align-items:center;justify-content:center}
#visual svg{max-width:100%;max-height:100%;overflow:visible}
.foot{position:absolute;left:80px;bottom:64px;font-weight:500;font-size:20px;color:#6b7280;letter-spacing:.04em}
.foot b{color:#facc15}
</style></head><body>
<div class="brand"><div class="logo">IG</div><div>INGLY DESIGN<small>GENERATOR LAB PRO</small></div></div>
<div class="text"><div id="code"></div><h1><span id="t1"></span><br><span id="t2"></span></h1><p id="tagline"></p><div id="chips"></div></div>
<div id="visual"></div>
<div class="foot"><b>●</b> Compatibile con xTool · LightBurn · Glowforge · Cricut · Silhouette</div>
<script>${js.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;

const tmp = join(root, '.tmp-cover');
mkdirSync(tmp, { recursive: true });
writeFileSync(join(tmp, 'cover.html'), html);
const executablePath = [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium'].find((p) => p && existsSync(p));
const browser = await chromium.launch({ executablePath });
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(pathToFileURL(join(tmp, 'cover.html')).href);
await page.evaluate(() => Promise.all([document.fonts.load('800 100px Montserrat'), document.fonts.load('500 30px Montserrat')]));
for (const l of LISTINGS) {
  await page.evaluate((slug) => window.renderCover(slug), l.slug);
  await page.waitForTimeout(250);
  const out = join(root, 'atomm-release', l.slug, 'cover.png');
  await page.screenshot({ path: out, type: 'png' });
  console.log(`copertina → atomm-release/${l.slug}/cover.png`);
}
await browser.close();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
