import assert from 'node:assert/strict';
import { test } from 'node:test';
import { unzipStore } from '../src/core/export.ts';
import { distPointSegment, signedArea } from '../src/core/geometry.ts';
import { close, dilate, edtSquared, fillHoles, newMask, quantize, simplifyLoop, subjectMask, traceMask, type Rgba } from '../src/core/raster.ts';
import { checkSvg } from '../src/core/svg.ts';
import type { GeneratorResult, Params } from '../src/core/types.ts';
import { analyzeSticker, printCut, runPrintCut } from '../src/generators/print-cut.ts';
import { runVectorize, vectorize } from '../src/generators/vectorize.ts';

const errors = (r: GeneratorResult) => r.issues.filter((i) => i.level === 'error');

/** Immagine sintetica: disegna con una funzione colore (null = trasparente). */
function image(w: number, h: number, f: (x: number, y: number) => [number, number, number] | null): Rgba {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = f(x + 0.5, y + 0.5);
      if (c) data.set([...c, 255], (y * w + x) * 4);
    }
  return { width: w, height: h, data };
}
const files = (img: Rgba) => ({ files: { image: { name: 'prova.png', image: img as unknown as ImageData } } });

test('EDT esatta rispetto al calcolo a forza bruta', () => {
  const m = newMask(23, 17);
  let s = 7;
  for (let i = 0; i < m.data.length; i++) m.data[i] = (s = (s * 16807) % 2147483647) % 13 === 0 ? 1 : 0;
  const d = edtSquared(m);
  for (let y = 0; y < m.h; y++)
    for (let x = 0; x < m.w; x++) {
      let best = Infinity;
      for (let j = 0; j < m.data.length; j++) if (m.data[j]) best = Math.min(best, (x - (j % m.w)) ** 2 + (y - Math.floor(j / m.w)) ** 2);
      assert.equal(d[y * m.w + x], best);
    }
});

test('dilatazione e chiusura morfologica', () => {
  const m = newMask(41, 41);
  m.data[20 * 41 + 20] = 1;
  const disc = dilate(m, 10);
  const n = disc.data.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(n - Math.PI * 100) < 25, `area disco ${n}`);
  const two = newMask(30, 10);
  for (let y = 2; y < 8; y++) for (const x of [5, 6, 7, 8, 11, 12, 13, 14]) two.data[y * 30 + x] = 1;
  assert.equal(traceMask(two).length, 2);
  assert.equal(traceMask(close(two, 3)).length, 1, 'la chiusura unisce le forme vicine');
});

test('traceMask: orientamento di esterni e buchi, pixel in diagonale separati', () => {
  const ring = newMask(10, 10);
  for (let y = 1; y < 9; y++) for (let x = 1; x < 9; x++) ring.data[y * 10 + x] = x < 3 || x > 6 || y < 3 || y > 6 ? 1 : 0;
  const loops = traceMask(ring);
  assert.equal(loops.length, 2);
  assert.deepEqual(loops.map((l) => Math.sign(signedArea(l))).sort(), [-1, 1]);
  assert.deepEqual(loops.map((l) => Math.abs(signedArea(l))).sort((a, b) => a - b), [16, 64]);
  assert.equal(traceMask(fillHoles(ring)).length, 1);
  const diag = newMask(4, 4);
  diag.data[1 * 4 + 1] = 1;
  diag.data[2 * 4 + 2] = 1;
  assert.equal(traceMask(diag).length, 2);
});

test('simplifyLoop elimina le scalette mantenendo la forma', () => {
  const m = newMask(60, 60);
  for (let y = 0; y < 60; y++) for (let x = 0; x < 60; x++) if (x + y < 60 && x > 5 && y > 5) m.data[y * 60 + x] = 1;
  const [loop] = traceMask(m);
  const s = simplifyLoop(loop, 1);
  assert.ok(s.length <= 6, `${loop.length} → ${s.length} vertici`);
  for (const p of loop) assert.ok(Math.min(...s.map((a, i) => distPointSegment(p, a, s[(i + 1) % s.length]))) <= 1.0001);
});

test('quantize: colori ordinati dal più chiaro, etichette coerenti', () => {
  const img = image(30, 10, (x) => (x < 10 ? [250, 250, 250] : x < 20 ? [200, 20, 20] : [10, 10, 10]));
  const q = quantize(img, 3);
  assert.equal(q.colors.length, 3);
  assert.deepEqual(q.colors[0], [250, 250, 250]);
  assert.deepEqual(q.colors[2], [10, 10, 10]);
  assert.equal(q.labels[0], 0);
  assert.equal(q.labels[25], 2);
});

test('subjectMask: trasparenza o sfondo uniforme', () => {
  const t = image(20, 20, (x, y) => ((x - 10) ** 2 + (y - 10) ** 2 < 25 ? [0, 0, 255] : null));
  const opaque = image(20, 20, (x, y) => ((x - 10) ** 2 + (y - 10) ** 2 < 25 ? [0, 0, 255] : [255, 255, 255]));
  const a = subjectMask(t, 30).data.join(''), b = subjectMask(opaque, 30).data.join('');
  assert.equal(a, b);
});

// ---------------- 07 Print & Cut ----------------
const circle = image(400, 300, (x, y) => ((x - 200) ** 2 + (y - 150) ** 2 < 100 ** 2 ? [30, 120, 200] : null));

test('Print & Cut: il contorno di taglio è a distanza costante dal soggetto', () => {
  const p: Params = { ...printCut.defaults, widthMm: 80, offset: 3, smooth: 0.5 };
  const { model } = analyzeSticker(circle, p);
  assert.ok(model);
  const scale = 80 / 400; // mm per pixel
  const r = 100 * scale;
  // cerchio del soggetto nelle coordinate locali dell'adesivo
  const cx = model!.art.x + 200 * scale, cy = model!.art.y + 150 * scale;
  for (const { pts } of model!.cutLoops)
    for (const q of pts) {
      const d = Math.hypot(q.x - cx, q.y - cy) - r;
      assert.ok(Math.abs(d - 3) < 0.35, `distanza ${d.toFixed(3)} mm`);
    }
  assert.ok(Math.abs(model!.w - (2 * r + 6)) < 0.5);
});

test('Print & Cut: foglio, copie, crocini e file validi', async () => {
  const r = runPrintCut({ ...printCut.defaults, widthMm: 50, copies: 6, marks: '3' }, files(circle));
  assert.deepEqual(errors(r), []);
  const cut = r.views.find((v) => v.id === 'cut')!.svg!;
  const c = checkSvg(cut);
  assert.ok(c.ok, c.errors.join());
  assert.equal(c.widthMm, 210);
  assert.equal(c.pathCount, 6 + 3, '6 contorni + 3 crocini');
  assert.match(cut, /data-operation="guide"[^>]*Crocini/);
  const zipless = r.exports.find((x) => x.id === 'cut')!;
  assert.ok(checkSvg(await (await zipless.build()).blob.text()).ok);
  assert.ok(r.exports.find((x) => x.primary)!.id === 'zip');
});

test('Print & Cut: le copie non invadono i crocini né il bordo', () => {
  const p = { ...printCut.defaults, widthMm: 40, copies: 80, marks: '4', markSize: 6, markInset: 8 };
  const r = runPrintCut(p, files(circle));
  const placed = Number(r.stats.find((s) => s.label === 'Copie nel foglio')!.value.split(' / ')[0]);
  assert.ok(placed > 10 && placed < 80);
  assert.match(r.issues.map((i) => i.message).join(), /entrano \d+ copie su 80/);
  const svg = r.views.find((v) => v.id === 'cut')!.svg!;
  const nums = [...svg.matchAll(/d="M([\d.]+) ([\d.]+)/g)].slice(0, placed).map((m) => [+m[1], +m[2]]);
  for (const [x, y] of nums) assert.ok(x > 8 + 6 && y > 8 + 6 - 30, 'nessun contorno nella zona crocini');
});

test('Print & Cut: arrotondamento unisce sagome vicine; soggetto assente = errore', () => {
  const two = image(400, 200, (x, y) => ((x - 120) ** 2 + (y - 100) ** 2 < 60 ** 2 || (x - 280) ** 2 + (y - 100) ** 2 < 60 ** 2 ? [0, 0, 0] : null));
  const shapes = (s: number) => runPrintCut({ ...printCut.defaults, widthMm: 80, offset: 1, smooth: s }, files(two)).stats.find((x) => x.label === 'Sagome')!.value;
  assert.equal(shapes(0.2), '2');
  assert.equal(shapes(5), '1');
  const empty = image(50, 50, () => null);
  assert.match(errors(runPrintCut(printCut.defaults, files(empty)))[0].message, /Soggetto non trovato/);
  assert.match(errors(runPrintCut(printCut.defaults, { files: {} }))[0].message, /Carica/);
  assert.match(errors(runPrintCut({ ...printCut.defaults, widthMm: 400 }, files(circle))).map((e) => e.message).join(), /non entra/);
});

test('Print & Cut: ogni controllo ha effetto', () => {
  const fp = (p: Params) => {
    const r = runPrintCut(p, files(circle));
    return JSON.stringify([r.views.map((v) => v.svg), r.stats, r.issues, r.exports.map((x) => x.label)]);
  };
  const base = { ...printCut.defaults, border: 'extend', subject: 'auto' } as Params;
  const b0 = fp(base);
  // forma a C: l'arrotondamento chiude la rientranza
  const notch = image(300, 300, (x, y) => ((x - 150) ** 2 + (y - 150) ** 2 < 120 ** 2 && !(x > 140 && Math.abs(y - 150) < 12) ? [0, 0, 0] : null));
  const nfp = (sm: number) => runPrintCut({ ...printCut.defaults, smooth: sm }, files(notch)).views[1].svg;
  assert.notEqual(nfp(0.5), nfp(5), 'smooth non ha effetto sulla rientranza');
  const changes: Params = { widthMm: 70, subject: 'full', offset: 4, border: 'material', bleed: 2, dpi: 200, sheetW: 300, sheetH: 200, copies: 3, spacing: 8, marks: '4', markSize: 8, markInset: 12, filename: 'x' };
  for (const [k, v] of Object.entries(changes)) {
    if (k === 'filename') continue;
    assert.notEqual(fp({ ...base, [k]: v }), b0, `${k} non ha effetto`);
  }
  const ring = image(300, 300, (x, y) => { const d = Math.hypot(x - 150, y - 150); return d < 120 && d > 60 ? [0, 0, 0] : null; });
  const cutLen = (o: boolean) => parseFloat(runPrintCut({ ...printCut.defaults, outerOnly: o, copies: 1 }, files(ring)).stats.find((x) => x.label === 'Lunghezza di taglio')!.value);
  assert.ok(cutLen(false) > cutLen(true) * 1.3, 'con i fori interni si taglia anche il contorno del foro');
  const tol = image(100, 100, (x, y) => ((x - 50) ** 2 + (y - 50) ** 2 < 900 ? [235, 235, 235] : [255, 255, 255]));
  const tfp = (t: number) => JSON.stringify(runPrintCut({ ...printCut.defaults, tolerance: t }, files(tol)).views[1]?.svg ?? 'nessuno');
  assert.notEqual(tfp(5), tfp(60), 'tolerance non ha effetto');
});

// ---------------- 08 Image → SVG ----------------
test('Image → SVG: un quadrato nero diventa un tracciato con le misure giuste', () => {
  const img = image(200, 100, (x, y) => (x >= 50 && x < 150 && y >= 20 && y < 80 ? [0, 0, 0] : [255, 255, 255]));
  const r = runVectorize({ ...vectorize.defaults, widthMm: 100, corner: 60 }, files(img));
  assert.deepEqual(errors(r), []);
  const svg = r.views[0].svg!;
  const c = checkSvg(svg);
  assert.ok(c.ok, c.errors.join());
  assert.equal(c.widthMm, 100);
  assert.equal(c.heightMm, 50);
  assert.match(svg, /L25 10L/);
  assert.match(svg, /L75 40L/);
  // invertito: traccia lo sfondo bianco (con il quadrato come buco)
  const inv = runVectorize({ ...vectorize.defaults, widthMm: 100, invert: true }, files(img));
  assert.equal(inv.stats.find((s) => s.label === 'Tracciati')!.value, '2');
});

test('Image → SVG: livelli di colore impilati e macchioline eliminate', async () => {
  const img = image(240, 120, (x, y) => {
    if ((x - 5) ** 2 + (y - 5) ** 2 < 4) return [0, 0, 0]; // macchiolina
    if (x > 40 && x < 200 && y > 20 && y < 100) return (x - 120) ** 2 + (y - 60) ** 2 < 900 ? [20, 20, 20] : [220, 40, 40];
    return [255, 255, 255];
  });
  const r = runVectorize({ ...vectorize.defaults, mode: 'color', colors: 3, dropLightest: true, widthMm: 120, speckle: 5 }, files(img));
  assert.deepEqual(errors(r), []);
  assert.equal(r.stats.find((s) => s.label === 'Livelli')!.value.split(' ').length, 2);
  const svg = r.views[0].svg!;
  assert.match(svg, /fill="#DC2828"|fill="#D[0-9A-F]{5}"/);
  const zip = unzipStore(new Uint8Array(await (await r.exports.find((x) => x.id === 'zip')!.build()).blob.arrayBuffer()));
  assert.equal(zip.length, 2);
  assert.ok(zip.every((e) => checkSvg(new TextDecoder().decode(e.data)).ok));
  const noSpeckle = Number(r.stats.find((s) => s.label === 'Tracciati')!.value);
  const withSpeckle = Number(runVectorize({ ...vectorize.defaults, mode: 'color', colors: 3, widthMm: 120, speckle: 0 }, files(img)).stats.find((s) => s.label === 'Tracciati')!.value);
  assert.ok(withSpeckle > noSpeckle);
  const cut = runVectorize({ ...vectorize.defaults, mode: 'color', colors: 3, widthMm: 120, output: 'cut' }, files(img));
  assert.match(cut.views[0].svg!, /data-operation="cut"/);
});

test('Image → SVG: ogni controllo ha effetto', () => {
  const img = image(200, 120, (x, y) => ((x - 100) ** 2 + (y - 60) ** 2 < 2500 ? [20, 60, 160] : (x - 20) ** 2 + (y - 20) ** 2 < 64 ? [200, 30, 30] : [250, 250, 250]));
  const fp = (p: Params) => {
    const r = runVectorize(p, files(img));
    return JSON.stringify([r.views[0]?.svg, r.stats, r.issues]);
  };
  const bw = { ...vectorize.defaults } as Params, col = { ...vectorize.defaults, mode: 'color' } as Params;
  const cases: [Params, string, Params[string]][] = [
    [bw, 'widthMm', 80], [bw, 'mode', 'color'], [bw, 'threshold', 40], [bw, 'invert', true], [bw, 'resolution', 300], [{ ...bw, widthMm: 40 }, 'speckle', 100],
    [bw, 'tolerance', 3], [bw, 'corner', 20], [bw, 'output', 'cut'], [col, 'colors', 2], [col, 'dropLightest', false],
  ];
  cases[4][2] = 150;
  for (const [base, k, v] of cases) assert.notEqual(fp({ ...base, [k]: v }), fp(base), `${k} non ha effetto`);
  assert.match(errors(runVectorize({ ...bw, threshold: 1 }, files(img)))[0].message, /Nessuna forma/);
});
