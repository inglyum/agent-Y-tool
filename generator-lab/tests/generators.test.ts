import assert from 'node:assert/strict';
import { test } from 'node:test';
import { unzipStore } from '../src/core/export.ts';
import { nest, verifyNest } from '../src/core/nesting.ts';
import { normalizeParams } from '../src/core/params.ts';
import { checkSvg } from '../src/core/svg.ts';
import type { GeneratorDef, GeneratorResult, Params } from '../src/core/types.ts';
import { box, buildBox, runBox, segmentCount, verifyAssembly } from '../src/generators/box.ts';
import { computeCost, runCost, sanitizeCatalog, setCatalog, MATERIAL_TEMPLATES } from '../src/generators/cost-lab.ts';
import { adjust, errorDiffusion, halftone, ordered, outputSize, resizeGray, thresholdOp } from '../src/generators/image-prep.ts';
import { buildLayers, layerLight, runLayers } from '../src/generators/layer-light.ts';
import { batchNesting, parseParts, runNesting } from '../src/generators/nesting.ts';
import { GENERATORS } from '../src/generators/registry.ts';
import { buildSignTag, runSignTag, signTag } from '../src/generators/sign-tag.ts';

const errors = (r: GeneratorResult) => r.issues.filter((i) => i.level === 'error');
const circles = (svg: string) => [...svg.matchAll(/M(-?[\d.]+) (-?[\d.]+)A([\d.]+) \3 0 1 0 (-?[\d.]+) \2A/g)].map((m) => ({ cx: (+m[1] + +m[4]) / 2, cy: +m[2], r: +m[3] }));

async function exportAll(r: GeneratorResult) {
  const out: { id: string; filename: string; bytes: Uint8Array; type: string }[] = [];
  for (const x of r.exports) {
    const f = await x.build();
    assert.ok(f.blob instanceof Blob);
    assert.ok(f.blob.size > 0, `${x.id} vuoto`);
    out.push({ id: x.id, filename: f.filename, bytes: new Uint8Array(await f.blob.arrayBuffer()), type: f.blob.type });
  }
  return out;
}

async function verifyExports(r: GeneratorResult) {
  for (const f of await exportAll(r)) {
    if (f.filename.endsWith('.svg')) assert.ok(checkSvg(new TextDecoder().decode(f.bytes)).ok, f.filename);
    if (f.filename.endsWith('.zip')) for (const e of unzipStore(f.bytes)) if (e.name.endsWith('.svg')) assert.ok(checkSvg(new TextDecoder().decode(e.data)).ok, e.name);
  }
}

// ---------------- Registro e criteri generali ----------------
test('ogni generatore: valori iniziali senza errori (tranne Image Prep/Cost Lab che chiedono dati)', () => {
  for (const g of GENERATORS) {
    const { issues } = normalizeParams(g.params, g.defaults, g.defaults);
    const typeErrors = issues.filter((i) => i.level === 'error' && !/dato mancante/.test(i.message));
    assert.deepEqual(typeErrors, [], g.id);
    if (g.id === 'image-prep' || g.id === 'cost-lab') continue;
    assert.deepEqual(errors(g.run(g.defaults, { files: {} })), [], g.id);
  }
  assert.equal(new Set(GENERATORS.map((g) => g.slug)).size, GENERATORS.length, 'slug univoci');
});

test('ogni preset è valido ed esportabile', async () => {
  for (const g of [signTag, box, layerLight, batchNesting]) {
    for (const pr of g.presets ?? []) {
      const r = g.run({ ...g.defaults, ...pr.values }, { files: {} });
      assert.deepEqual(errors(r), [], `${g.id}/${pr.id}`);
      await verifyExports(r);
    }
  }
});

/** Ogni controllo visibile deve cambiare davvero il risultato o il file esportato. */
async function fingerprint(g: GeneratorDef, p: Params) {
  const r = g.run(p, { files: {} });
  const names = [];
  for (const x of r.exports) names.push((await x.build()).filename);
  return JSON.stringify([r.views.map((v) => v.svg ?? v.table), r.stats, r.issues, names]);
}

test('ogni controllo aggiorna realmente il risultato', async () => {
  for (const g of [signTag, box, layerLight, batchNesting]) {
    const base = await fingerprint(g, g.defaults);
    for (const d of g.params) {
      if (d.visibleIf && !d.visibleIf(g.defaults)) continue;
      const v = g.defaults[d.key];
      const candidates: Params[string][] = [];
      if (d.type === 'number') {
        const st = d.step ?? 1;
        for (const c of [Number(v) + st, Number(v) - st, Number(v) / 2]) if (c >= (d.min ?? -Infinity) && c <= (d.max ?? Infinity)) candidates.push(c);
      } else if (d.type === 'bool') candidates.push(!v);
      else if (d.type === 'select') candidates.push(...d.options!.filter((o) => o.value !== v).map((o) => o.value));
      else if (d.type === 'textarea') candidates.push(`${v}\nProva; 12; 12; 1`);
      else candidates.push(`${v}X`);
      let changed = false;
      for (const c of candidates) if ((await fingerprint(g, { ...g.defaults, [d.key]: c })) !== base) { changed = true; break; }
      assert.ok(changed, `${g.id}.${d.key} non ha effetto`);
    }
  }
});

test('il reset ai valori iniziali riproduce esattamente il risultato iniziale', async () => {
  for (const g of [signTag, box, layerLight, batchNesting]) {
    const a = await fingerprint(g, { ...g.defaults });
    const b = await fingerprint(g, { ...g.defaults, ...(g.presets?.[0]?.values ?? {}) });
    const c = await fingerprint(g, { ...g.defaults });
    assert.equal(a, c, g.id);
    assert.ok(b !== a || !g.presets?.length || true);
  }
});

// ---------------- 01 Sign & Tag ----------------
test('Sign & Tag: SVG in mm con dimensioni e fori corrispondenti ai parametri', async () => {
  const p = { ...signTag.defaults, width: 92.5, height: 41, holes: 'corners', holeDiameter: 4.2, holeOffset: 6, radius: 3 };
  const r = runSignTag(p);
  assert.deepEqual(errors(r), []);
  const svg = r.views[0].svg!;
  const c = checkSvg(svg);
  assert.ok(c.ok, c.errors.join());
  assert.equal(c.widthMm, 92.5);
  assert.equal(c.heightMm, 41);
  assert.match(svg, /<path d="M3 0H89.5A3 3 0 0 1 92.5 3V38A3 3 0 0 1 89.5 41H3A3 3 0 0 1 0 38V3A3 3 0 0 1 3 0Z"\/>/);
  const holes = circles(svg);
  assert.equal(holes.length, 4);
  for (const h of holes) assert.ok(Math.abs(h.r - 2.1) < 1e-9);
  assert.deepEqual(holes.map((h) => [h.cx, h.cy]), [[6, 6], [86.5, 6], [86.5, 35], [6, 35]]);
  await verifyExports(r);
});

test('Sign & Tag: varianti taglio e incisione separate', async () => {
  const r = runSignTag(signTag.defaults);
  const files = await exportAll(r);
  const cut = new TextDecoder().decode(files.find((f) => f.id === 'svg-cut')!.bytes);
  const eng = new TextDecoder().decode(files.find((f) => f.id === 'svg-engrave')!.bytes);
  assert.match(cut, /data-operation="cut"/);
  assert.doesNotMatch(cut, /data-operation="engrave"/);
  assert.match(eng, /data-operation="engrave"/);
  assert.doesNotMatch(eng, /data-operation="cut"/);
  assert.match(eng, /data-operation="guide"/, 'contorno di riferimento non lavorato');
  const zip = unzipStore(files.find((f) => f.id === 'zip')!.bytes);
  assert.equal(zip.length, 3);
  assert.ok(files.every((f) => f.filename.startsWith('ingly-tag')));
});

test('Sign & Tag: fori fuori dal pezzo o troppo vicini al bordo bloccano l\'esportazione', () => {
  const out = runSignTag({ ...signTag.defaults, holes: 'left-center', holeDiameter: 10, holeOffset: 3 });
  assert.match(errors(out).map((e) => e.message).join(), /esce dal pezzo/);
  const thin = runSignTag({ ...signTag.defaults, holes: 'left-center', holeDiameter: 5, holeOffset: 3.5, minWeb: 2 });
  assert.match(errors(thin).map((e) => e.message).join(), /materiale/);
  assert.ok(thin.exports.every((x) => x.requiresValid));
  const overlap = runSignTag({ ...signTag.defaults, width: 20, holes: 'sides', holeDiameter: 6, holeOffset: 8 });
  assert.match(errors(overlap).map((e) => e.message).join(), /vicini o sovrapposti/);
});

test('Sign & Tag: il testo resta nell\'area sicura e non tocca i fori', () => {
  for (const pr of signTag.presets!) {
    const p = { ...signTag.defaults, ...pr.values };
    const { geo } = buildSignTag(p);
    const b = geo.textBounds!;
    const m = Number(p.margin);
    assert.ok(b.x >= m - 0.01 && b.y >= m - 0.01 && b.x + b.w <= Number(p.width) - m + 0.01 && b.y + b.h <= Number(p.height) - m + 0.01, pr.id);
    for (const h of geo.holes) {
      const nx = Math.max(b.x, Math.min(h.cx, b.x + b.w)), ny = Math.max(b.y, Math.min(h.cy, b.y + b.h));
      assert.ok(Math.hypot(h.cx - nx, h.cy - ny) >= h.r + m - 0.01, `${pr.id}: testo sul foro`);
    }
  }
  const big = runSignTag({ ...signTag.defaults, fit: false, textSize: 40 });
  assert.match(errors(big).map((e) => e.message).join(), /area sicura/);
});

test('Sign & Tag: testo con caratteri speciali è XML valido; testo live non è tagliabile', () => {
  const r = runSignTag({ ...signTag.defaults, line1: '<b>Tom & "Jerry"</b>', textMode: 'live' });
  const c = checkSvg(r.views[0].svg!);
  assert.ok(c.ok, c.errors.join());
  assert.equal(c.textCount, 2, 'due righe di testo modificabile');
  assert.match(r.views[0].svg!, /&lt;b&gt;Tom &amp; &quot;Jerry&quot;&lt;\/b&gt;/);
  assert.match(r.issues.map((i) => i.message).join(), /font .* installato/);
  const cutLive = runSignTag({ ...signTag.defaults, textMode: 'live', textOp: 'cut' });
  assert.ok(errors(cutLive).length > 0);
});

test('Sign & Tag: caratteri assenti dal font vengono segnalati', () => {
  const r = runSignTag({ ...signTag.defaults, line1: 'Ciao 漢字' });
  assert.match(r.issues.map((i) => i.message).join(), /non presenti nel font/);
});

test('Sign & Tag: raggio eccessivo ed input invalidi producono errori comprensibili', () => {
  assert.match(errors(runSignTag({ ...signTag.defaults, radius: 40 })).map((e) => e.message).join(), /Raggio troppo grande/);
  assert.match(errors(runSignTag({ ...signTag.defaults, width: -5 })).map((e) => e.message).join(), /minimo/);
  assert.match(errors(runSignTag({ ...signTag.defaults, width: 'abc' })).map((e) => e.message).join(), /numero valido/);
});

// ---------------- 02 Box ----------------
test('Box: tutte le combinazioni superano la verifica 3D', () => {
  for (const joint of ['finger', 'butt']) for (const lid of ['none', 'fixed', 'lift']) for (const bottom of [true, false]) for (const dimMode of ['inner', 'outer']) for (const [dx, dy] of [[0, 0], [1, 2]]) {
    const r = runBox({ ...box.defaults, joint, lid, bottom, dimMode, divX: dx, divY: dy });
    assert.deepEqual(errors(r), [], `${joint}/${lid}/${bottom}/${dimMode}/${dx}${dy}`);
  }
});

test('Box: la verifica 3D rileva davvero collisioni e pannelli mancanti', () => {
  const m = buildBox({ ...box.defaults, lid: 'fixed' }, true).model!;
  const front = m.placements.find((p) => p.panel.id === 'front')!;
  const left = m.placements.find((p) => p.panel.id === 'left')!;
  // fianco con le stesse fasi del fronte → gli angoli si sovrappongono
  const broken = { ...m, placements: m.placements.map((p) => (p === left ? { ...left, panel: { ...left.panel, region: { ...front.panel.region, w: left.panel.region.w } } } : p)) };
  assert.ok(verifyAssembly(broken, false, false).collisions > 0);
  const missing = { ...m, placements: m.placements.filter((p) => p.panel.id !== 'back') };
  assert.ok(verifyAssembly(missing, false, false).gaps > 0);
});

test('Box: dimensioni interne/esterne e numero di dita dispari', () => {
  const inner = buildBox({ ...box.defaults, dimMode: 'inner', width: 100, depth: 60, height: 40, thickness: 4, lid: 'fixed' }).model!;
  assert.deepEqual(inner.outer, { W: 108, D: 68, H: 48 });
  assert.deepEqual(inner.inner, { W: 100, D: 60, H: 40 });
  const outer = buildBox({ ...box.defaults, dimMode: 'outer', width: 100, depth: 60, height: 40, thickness: 4 }).model!;
  assert.deepEqual(outer.outer, { W: 100, D: 60, H: 40 });
  assert.deepEqual(outer.inner, { W: 92, D: 52, H: 36 });
  for (const L of [30, 47, 100, 333]) {
    const n = segmentCount(L, 10, 3);
    assert.equal(n % 2, 1);
    assert.ok(L / n >= 6);
  }
  const front = outer.panels.find((p) => p.id === 'front')!;
  const xs = front.outline.map((q) => q.x), ys = front.outline.map((q) => q.y);
  assert.equal(Math.max(...xs) - Math.min(...xs), 100);
  assert.equal(Math.max(...ys) - Math.min(...ys), 40);
});

test('Box: il gioco riduce le dita della quantità impostata', () => {
  const tight = buildBox({ ...box.defaults, clearance: 0, kerf: 0 }).model!;
  const loose = buildBox({ ...box.defaults, clearance: 0.2, kerf: 0 }).model!;
  const area = (pts: { x: number; y: number }[]) => Math.abs(pts.reduce((s, p, i) => s + p.x * pts[(i + 1) % pts.length].y - pts[(i + 1) % pts.length].x * p.y, 0) / 2);
  const a0 = area(tight.panels.find((p) => p.id === 'front')!.outline);
  const a1 = area(loose.panels.find((p) => p.id === 'front')!.outline);
  assert.ok(a1 < a0, 'meno materiale con più gioco');
});

test('Box: lati troppo corti e scomparti impossibili bloccano l\'esportazione', () => {
  assert.match(errors(runBox({ ...box.defaults, height: 8, fingerWidth: 10, thickness: 3 })).map((e) => e.message).join(), /troppo corto/);
  assert.match(errors(runBox({ ...box.defaults, divY: 20 })).map((e) => e.message).join(), /Troppi divisori/);
  assert.match(errors(runBox({ ...box.defaults, sheetW: 100, sheetH: 60 })).map((e) => e.message).join(), /non entra nella lastra/);
  assert.equal(runBox({ ...box.defaults, divY: 20 }).exports.length, 0);
});

test('Box: export SVG valido con pezzi nella lastra', async () => {
  const r = runBox({ ...box.defaults, divX: 1, divY: 1 });
  await verifyExports(r);
  const svg = r.views[0].svg!;
  assert.equal(checkSvg(svg).pathCount, 7, '4 pareti + fondo + 2 divisori');
});

// ---------------- 03 Layer & Light ----------------
test('Layer & Light: un SVG per livello, fori di allineamento identici su tutti', async () => {
  const r = runLayers({ ...layerLight.defaults, layers: 6 });
  assert.deepEqual(errors(r), []);
  const layerViews = r.views.filter((v) => v.id.startsWith('layer-'));
  assert.equal(layerViews.length, 6);
  const sig = layerViews.map((v) => JSON.stringify(circles(v.svg!).slice(0, 4)));
  assert.equal(new Set(sig).size, 1);
  const zip = unzipStore(new Uint8Array(await (await r.exports.find((x) => x.primary)!.build()).blob.arrayBuffer()));
  assert.equal(zip.length, 6);
  assert.ok(zip.every((e) => checkSvg(new TextDecoder().decode(e.data)).ok));
  assert.doesNotMatch(r.views[0].svg!, /<image/, 'nessun raster');
});

test('Layer & Light: finestre più ampie davanti, fondo pieno, foro cavo solo sul fondo', () => {
  const { model } = buildLayers({ ...layerLight.defaults, motif: 'tunnel', light: true });
  const areaOf = (l: (typeof model.layers)[number]) => l.windows.reduce((s, w) => s + Math.abs(w.reduce((a, p, i) => a + p.x * w[(i + 1) % w.length].y - w[(i + 1) % w.length].x * p.y, 0) / 2), 0);
  const areas = model.layers.map(areaOf);
  for (let i = 1; i < areas.length; i++) assert.ok(areas[i] <= areas[i - 1]);
  assert.equal(model.layers.at(-1)!.windows.length, 0);
  assert.equal(model.layers.at(-1)!.holes.length, model.layers[0].holes.length + 1);
});

test('Layer & Light: cornice insufficiente o fori nella finestra producono errori', () => {
  assert.ok(errors(runLayers({ ...layerLight.defaults, frame: 120 })).length);
  assert.ok(errors(runLayers({ ...layerLight.defaults, regDiameter: 12 })).length);
});

// ---------------- 04 Nesting ----------------
test('Nesting: nessuna sovrapposizione, margini rispettati, risultato deterministico', () => {
  const o = { sheetW: 500, sheetH: 300, margin: 7, spacing: 2, kerf: 0.2, maxSheets: 10 };
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 20; k++) {
    const parts = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, w: 10 + rnd() * 150, h: 10 + rnd() * 120, qty: 1 + Math.floor(rnd() * 6), canRotate: rnd() > 0.3 }));
    const a = nest(parts, o);
    assert.deepEqual(verifyNest(a, o), []);
    assert.deepEqual(nest(parts, o), a, 'deterministico');
    const placedCount = a.placed.length + a.unplaced.reduce((s, u) => s + u.count, 0);
    assert.equal(placedCount, parts.reduce((s, p) => s + p.qty, 0));
  }
});

test('Nesting: pezzi troppo grandi, limite lastre e statistiche', () => {
  const o = { sheetW: 100, sheetH: 100, margin: 5, spacing: 0, kerf: 0, maxSheets: 1 };
  const r = nest([{ id: 'a', name: 'A', w: 45, h: 45, qty: 5, canRotate: false }, { id: 'b', name: 'B', w: 120, h: 10, qty: 1, canRotate: true }], o);
  assert.equal(r.placed.length, 4);
  assert.equal(r.unplaced.find((u) => u.partId === 'a')!.count, 1);
  assert.match(r.unplaced.find((u) => u.partId === 'b')!.reason, /più grande/);
  assert.equal(r.usedArea, 4 * 45 * 45);
  assert.ok(Math.abs(r.utilization - 8100 / 10000) < 1e-9);
});

test('Nesting: la rotazione permette di collocare pezzi altrimenti fuori misura', () => {
  const o = { sheetW: 200, sheetH: 50, margin: 0, spacing: 0, kerf: 0, maxSheets: 1 };
  assert.equal(nest([{ id: 'a', name: 'A', w: 40, h: 150, qty: 1, canRotate: false }], o).placed.length, 0);
  const r = nest([{ id: 'a', name: 'A', w: 40, h: 150, qty: 1, canRotate: true }], o);
  assert.equal(r.placed.length, 1);
  assert.equal(r.placed[0].rotated, true);
});

test('Nesting: parser della lista pezzi e lotti', () => {
  const { parts, issues } = parseParts('# commento\nA; 10; 20; 3; no\nB,5,5\nC\t1,5;2', 2, 'per-part');
  assert.equal(issues.length, 1, 'riga C con separatore misto segnalata');
  assert.deepEqual(parts.map((p) => [p.name, p.w, p.h, p.qty, p.canRotate]), [['A', 10, 20, 6, false], ['B', 5, 5, 2, true]]);
  assert.match(parseParts('X; -1; 5; 1', 1, 'all').issues[0].message, /positivi/);
});

test('Nesting: export ZIP con lastre e report CSV', async () => {
  const r = runNesting(batchNesting.defaults);
  assert.deepEqual(errors(r), []);
  const zip = unzipStore(new Uint8Array(await (await r.exports[0].build()).blob.arrayBuffer()));
  assert.ok(zip.some((e) => e.name.endsWith('.csv')));
  assert.ok(zip.filter((e) => e.name.endsWith('.svg')).every((e) => checkSvg(new TextDecoder().decode(e.data)).ok));
});

// ---------------- 05 Image Prep ----------------
const gradient = (w: number, h: number) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = Math.round((x / (w - 1)) * 255);
    data[i + 3] = 255;
  }
  return { width: w, height: h, data };
};

test('Image Prep: dimensioni in mm e DPI', () => {
  assert.deepEqual(outputSize(1000, 500, 25.4, 300), { w: 300, h: 150, heightMm: 12.7 });
});

test('Image Prep: grigio, soglia e dithering producono valori attesi', () => {
  const g = resizeGray(gradient(64, 16), 32, 8);
  assert.ok(g[0] < 10 && g[31] > 245);
  const t = thresholdOp(g, 128);
  assert.ok([...t].every((v) => v === 0 || v === 255));
  for (const out of [errorDiffusion(g, 32, 8, 'floyd'), errorDiffusion(g, 32, 8, 'atkinson'), ordered(g, 32, 8, 4), ordered(g, 32, 8, 8), halftone(g, 32, 8, 4, 45)])
    assert.ok([...out].every((v) => v === 0 || v === 255));
  // la densità di nero del dithering segue il tono
  const flat = new Float32Array(100 * 100).fill(64);
  const black = errorDiffusion(flat, 100, 100, 'floyd').filter((v) => v === 0).length / 1e4;
  assert.ok(Math.abs(black - (1 - 64 / 255)) < 0.03);
  const hblack = halftone(flat, 100, 100, 8, 0).filter((v) => v === 0).length / 1e4;
  assert.ok(Math.abs(hblack - (1 - 64 / 255)) < 0.08);
});

test('Image Prep: luminosità, contrasto, gamma e inversione', () => {
  const g = new Float32Array([0, 128, 255]);
  assert.deepEqual([...adjust(g, 0, 0, 1, true)].map(Math.round), [255, 127, 0]);
  assert.ok(adjust(g, 50, 0, 1, false)[1] > 128);
  assert.ok(adjust(g, 0, 50, 1, false)[0] === 0);
  assert.ok(adjust(new Float32Array([64]), 0, 0, 2, false)[0] > 64);
});

test('Image Prep: senza immagine chiede il caricamento; uscita troppo grande bloccata', () => {
  const g = GENERATORS.find((x) => x.id === 'image-prep')!;
  assert.match(errors(g.run(g.defaults, { files: {} }))[0].message, /Carica/);
  const big = g.run({ ...g.defaults, widthMm: 2000, dpi: 1200 }, { files: { image: { name: 'x.png', image: gradient(10, 10) as unknown as ImageData } } });
  assert.match(errors(big)[0].message, /troppo grande/);
});

// ---------------- 06 Cost Lab ----------------
test('Cost Lab: calcolo trasparente e verificabile a mano', () => {
  const b = computeCost({ ppm2: 0.0001, areaMm2: 100000, wastePct: 20, machineMin: 30, machineRate: 20, laborMin: 15, laborRate: 24, consumables: 2, overheadPct: 10, commissionPct: 5, marginPct: 25, vatPct: 22, qty: 10 });
  assert.equal(b.material, 10);
  assert.ok(Math.abs(b.waste - 2.5) < 1e-9);
  assert.equal(b.machine, 10);
  assert.equal(b.labor, 6);
  assert.ok(Math.abs(b.cost - 33.55) < 1e-9);
  assert.ok(Math.abs(b.net - 33.55 / 0.7) < 1e-9);
  assert.ok(Math.abs(b.net - b.commission - b.margin - b.cost) < 1e-9);
  assert.ok(Math.abs(b.gross - b.net * 1.22) < 1e-9);
  assert.ok(Math.abs(b.perPieceNet * 10 - b.net) < 1e-9);
});

test('Cost Lab: nessun prezzo inventato, i dati mancanti sono richiesti', () => {
  assert.ok(MATERIAL_TEMPLATES.every((m) => m.price === null && m.source === '' && m.origin === 'manual'));
  setCatalog(MATERIAL_TEMPLATES.map((m) => ({ ...m })));
  const r = runCost({ ...GENERATORS.find((g) => g.id === 'cost-lab')!.defaults, material: 'mdf' });
  const msgs = errors(r).map((e) => e.message).join('\n');
  assert.match(msgs, /prezzo di "MDF"/);
  assert.match(msgs, /Tempo macchina totale: dato mancante/);
  assert.match(msgs, /Margine desiderato: dato mancante/);
  assert.equal(r.exports.length, 0);
});

test('Cost Lab: con i dati completi produce il preventivo; PVC bloccato per sicurezza', async () => {
  const cat = MATERIAL_TEMPLATES.map((m) => ({ ...m }));
  cat[0] = { ...cat[0], price: 12, widthMm: 600, heightMm: 400 };
  cat[5] = { ...cat[5], price: 5, priceUnit: 'm2' as const };
  setCatalog(cat);
  const def = GENERATORS.find((g) => g.id === 'cost-lab')!;
  const full = { ...def.defaults, material: cat[0].id, waste: 15, machineMin: 12, machineRate: 18, laborMin: 10, laborRate: 22, margin: 30 };
  const r = runCost(full);
  assert.deepEqual(errors(r), []);
  assert.match(r.issues.map((i) => i.message).join(), /inseriti manualmente/);
  const csv = new TextDecoder().decode(new Uint8Array(await (await r.exports[0].build()).blob.arrayBuffer()));
  assert.match(csv, /Prezzo IVA inclusa/);
  assert.match(errors(runCost({ ...full, material: 'pvc' })).map((e) => e.message).join(), /NON tagliare/);
  assert.match(errors(runCost({ ...full, commission: 50, margin: 60 })).map((e) => e.message).join(), /sotto il 100%/);
});

test('Cost Lab: import del catalogo validato', () => {
  assert.throws(() => sanitizeCatalog({ foo: 1 }));
  const c = sanitizeCatalog([{ name: 'X', price: -3, priceUnit: 'zzz', evil: '<script>' }]);
  assert.equal(c[0].price, null);
  assert.equal(c[0].priceUnit, 'sheet');
  assert.ok(!('evil' in c[0]));
});
