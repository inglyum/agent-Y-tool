import assert from 'node:assert/strict';
import { test } from 'node:test';
import { connectAtomm } from '../src/core/atomm.ts';
import { crc32, csvEscape, pngWithDpi, readPngDpi, safeFilename, svgFile, unzipStore, zipFile, zipStore } from '../src/core/export.ts';
import { circleClearanceInPolygon, roundedRectPolygon, selfIntersects } from '../src/core/geometry.ts';
import { History, normalizeParams, sanitizeImported } from '../src/core/params.ts';
import { traceRegion } from '../src/core/rectilinear.ts';
import { checkSvg, escapeXml, svgDocument } from '../src/core/svg.ts';
import type { ParamDef } from '../src/core/types.ts';

test('escapeXml neutralizza markup e caratteri di controllo', () => {
  assert.equal(escapeXml('<script>&"\'\u0001'), '&lt;script&gt;&amp;&quot;&apos;');
});

test('svgDocument produce width/height in mm e viewBox coerente', () => {
  const svg = svgDocument({ widthMm: 80.5, heightMm: 30, title: 'A & B <x>', layers: [{ id: 'cut', op: 'cut', paths: ['M0 0H10V10Z'] }] });
  const c = checkSvg(svg);
  assert.ok(c.ok, c.errors.join());
  assert.equal(c.widthMm, 80.5);
  assert.deepEqual(c.viewBox, [0, 0, 80.5, 30]);
  assert.equal(c.pathCount, 1);
});

test('checkSvg rifiuta documenti malformati o con unità sbagliate', () => {
  assert.equal(checkSvg('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"></svg>').ok, false);
  assert.equal(checkSvg('<svg width="10mm" height="10mm" viewBox="0 0 20 20"></svg>').ok, false);
  assert.equal(checkSvg('<svg width="10mm" height="10mm" viewBox="0 0 10 10"><g></svg>').ok, false);
  assert.equal(checkSvg('<svg width="10mm" height="10mm" viewBox="0 0 10 10"><script>x</script></svg>').ok, false);
  assert.equal(checkSvg('<svg width="10mm" height="10mm" viewBox="0 0 10 10"><text>a < b</text></svg>').ok, false);
  assert.throws(() => svgFile('<svg></svg>', 'x.svg'));
});

test('safeFilename elimina percorsi e caratteri riservati', () => {
  assert.equal(safeFilename('../Targa Così: 1/2', 'svg'), 'Targa-Cosi-1-2.svg');
  assert.equal(safeFilename('', 'zip'), 'ingly.zip');
  assert.equal(safeFilename('nome.svg', 'svg'), 'nome.svg');
});

test('csvEscape impedisce formula injection e gestisce i separatori', () => {
  assert.equal(csvEscape('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(csvEscape('a;b'), '"a;b"');
});

test('crc32 corrisponde al valore di riferimento', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('ZIP store: andata e ritorno con CRC verificato', async () => {
  const z = zipStore([{ name: 'a.svg', data: new TextEncoder().encode('<svg/>') }, { name: 'b/è.txt', data: new Uint8Array([1, 2, 3]) }]);
  const back = unzipStore(z);
  assert.deepEqual(back.map((e) => e.name), ['a.svg', 'b/è.txt']);
  assert.deepEqual([...back[1].data], [1, 2, 3]);
  assert.throws(() => zipStore([{ name: 'x', data: new Uint8Array() }, { name: 'x', data: new Uint8Array() }]));
  const f = await zipFile([{ filename: 'x.txt', blob: new Blob(['ciao']) }], 'p.zip');
  assert.equal(f.blob.type, 'application/zip');
  assert.equal(unzipStore(new Uint8Array(await f.blob.arrayBuffer()))[0].name, 'x.txt');
});

test('pngWithDpi scrive e sostituisce il chunk pHYs', () => {
  const chunk = (type: string, data: number[]) => {
    const b = new Uint8Array(12 + data.length);
    const dv = new DataView(b.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) b[4 + i] = type.charCodeAt(i);
    b.set(data, 8);
    dv.setUint32(8 + data.length, crc32(b.subarray(4, 8 + data.length)));
    return b;
  };
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0]), chunk('IDAT', [1, 2]), chunk('IEND', [])];
  const png = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { png.set(p, o); o += p.length; }
  const a = pngWithDpi(png, 300);
  assert.equal(readPngDpi(a), 300);
  const b = pngWithDpi(a, 254);
  assert.equal(readPngDpi(b), 254);
  assert.equal(b.length, a.length, 'il vecchio pHYs viene sostituito, non duplicato');
});

test('geometria: distanze dai bordi e auto-intersezioni', () => {
  const poly = roundedRectPolygon(0, 0, 50, 20, 0, 'square');
  assert.ok(Math.abs(circleClearanceInPolygon({ cx: 5, cy: 10, r: 2 }, poly) - 3) < 1e-9);
  assert.equal(circleClearanceInPolygon({ cx: -1, cy: 10, r: 2 }, poly), -Infinity);
  assert.equal(selfIntersects([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 }]), true);
  assert.equal(selfIntersects(poly), false);
});

test('traceRegion: rettangolo con intaglio = un contorno con i vertici giusti', () => {
  const loops = traceRegion({ w: 10, h: 10, cuts: [{ x: 4, y: -1, w: 2, h: 4 }] });
  assert.equal(loops.length, 1);
  assert.equal(loops[0].length, 8);
  const split = traceRegion({ w: 10, h: 10, cuts: [{ x: 4, y: -1, w: 2, h: 12 }] });
  assert.equal(split.length, 2, 'un taglio passante divide il pezzo');
});

const defs: ParamDef[] = [
  { key: 'w', label: 'Larghezza', type: 'number', group: 'g', min: 1, max: 10 },
  { key: 's', label: 'Scelta', type: 'select', group: 'g', options: [{ value: 'a', label: 'A' }] },
  { key: 't', label: 'Testo', type: 'text', group: 'g', maxLength: 3 },
];

test('normalizeParams segnala valori fuori intervallo, mancanti e opzioni sconosciute', () => {
  const d = { w: 5, s: 'a', t: '' };
  assert.equal(normalizeParams(defs, d, d).issues.length, 0);
  assert.match(normalizeParams(defs, { ...d, w: 50 }, d).issues[0].message, /massimo 10/);
  assert.match(normalizeParams(defs, { ...d, w: '' }, d).issues[0].message, /dato mancante/);
  assert.match(normalizeParams(defs, { ...d, w: 'abc' }, d).issues[0].message, /numero valido/);
  assert.match(normalizeParams(defs, { ...d, s: 'zzz' }, d).issues[0].message, /opzione/);
  assert.match(normalizeParams(defs, { ...d, t: 'abcd' }, d).issues[0].message, /massimo 3/);
  assert.equal(normalizeParams(defs, { ...d, w: '7,5' }, d).values.w, 7.5);
});

test('sanitizeImported accetta solo chiavi note e tipi primitivi', () => {
  assert.deepEqual(sanitizeImported(defs, { w: 3, evil: 'x', s: { a: 1 }, t: 'ok' }), { w: 3, t: 'ok' });
  assert.deepEqual(sanitizeImported(defs, null), {});
});

test('History: annulla e ripristina', () => {
  const h = new History();
  h.push({ a: 1 });
  h.push({ a: 2 });
  assert.deepEqual(h.undo({ a: 3 }), { a: 2 });
  assert.deepEqual(h.undo({ a: 2 }), { a: 1 });
  assert.equal(h.undo({ a: 1 }), null);
  assert.deepEqual(h.redo({ a: 1 }), { a: 2 });
  assert.ok(h.canRedo);
});

test('adapter Atomm: registra l\'hook export e restituisce un vero Blob', async () => {
  const handlers: Record<string, (...a: unknown[]) => unknown> = {};
  (globalThis as Record<string, unknown>).atomm = { lifecycle: { on: (ev: string, fn: (...a: unknown[]) => unknown) => { handlers[ev] = fn; } } };
  const states: string[] = [];
  connectAtomm(async () => ({ filename: 'tag.svg', blob: new Blob(['<svg/>'], { type: 'image/svg+xml' }) }), (s) => states.push(s));
  assert.deepEqual(states, ['connected']);
  const out = (await handlers.export('download')) as { filename: string; blob: Blob };
  assert.equal(out.filename, 'tag.svg');
  assert.ok(out.blob instanceof Blob);
  delete (globalThis as Record<string, unknown>).atomm;
});

test('adapter Atomm: senza SDK l\'app resta autonoma', () => {
  const states: string[] = [];
  connectAtomm(async () => { throw new Error('mai chiamato'); }, (s) => states.push(s));
  assert.deepEqual(states, ['unavailable']);
});

test('adapter Atomm: un errore di validazione viene propagato, non mascherato', async () => {
  const handlers: Record<string, (...a: unknown[]) => unknown> = {};
  (globalThis as Record<string, unknown>).atomm = { lifecycle: { on: (ev: string, fn: (...a: unknown[]) => unknown) => { handlers[ev] = fn; } } };
  connectAtomm(async () => { throw new Error('foro fuori dal pezzo'); }, () => {});
  await assert.rejects(async () => handlers.export(), /foro fuori/);
  delete (globalThis as Record<string, unknown>).atomm;
});
