import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adaptSvg, applyProfile, flattenPath, parseEngineSvg, svgToDxf } from '../src/core/compat.ts';
import { unzipStore } from '../src/core/export.ts';
import { circlePath } from '../src/core/geometry.ts';
import { checkSvg } from '../src/core/svg.ts';
import { box } from '../src/generators/box.ts';
import { runSignTag, signTag } from '../src/generators/sign-tag.ts';
import { runBox } from '../src/generators/box.ts';

const len = (pts: [number, number][]) => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);

test('flattenPath: cerchi, archi e curve con lunghezze corrette', () => {
  const [c] = flattenPath(circlePath({ cx: 10, cy: 10, r: 5 }));
  assert.ok(c.closed);
  assert.ok(Math.abs(len(c.pts) / (2 * Math.PI * 5) - 1) < 0.005, `circonferenza ${len(c.pts)}`);
  for (const [x, y] of c.pts) assert.ok(Math.abs(Math.hypot(x - 10, y - 10) - 5) < 0.06);
  const [q] = flattenPath('M0 0Q10 10 20 0');
  assert.deepEqual(q.pts.at(-1), [20, 0]);
  const [cb] = flattenPath('M0 0C0 10 10 10 10 0Z');
  assert.ok(cb.closed && cb.pts.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)));
  const rel = flattenPath('m1 1l2 0h3v4z')[0];
  assert.deepEqual(rel.pts.map((p) => p.map((v) => +v.toFixed(6))), [[1, 1], [3, 1], [6, 1], [6, 5], [1, 1]]);
});

test('DXF: livelli per operazione, mm, coordinate CAD (Y verso l\'alto)', () => {
  const r = runSignTag({ ...signTag.defaults, width: 80, height: 30 });
  const dxf = svgToDxf(r.views[0].svg!);
  assert.match(dxf, /\$INSUNITS\r\n70\r\n4/);
  assert.match(dxf, /LAYER\r\n2\r\nTAGLIO\r\n70\r\n0\r\n62\r\n1/);
  assert.match(dxf, /LAYER\r\n2\r\nINCISIONE/);
  assert.ok(dxf.trimEnd().endsWith('EOF'));
  const ys = [...dxf.matchAll(/\r\n20\r\n(-?[\d.]+)/g)].map((m) => +m[1]).filter((v) => v !== 0);
  assert.ok(Math.max(...ys) <= 30.0001 && Math.min(...ys) >= -0.0001);
  assert.ok(!dxf.includes('NaN'));
  const polylines = dxf.split('POLYLINE').length - 1;
  assert.ok(polylines >= 3, `polilinee ${polylines}`);
});

test('Profili: guide rimosse, colori LightBurn, livelli Inkscape, forme Cricut', () => {
  const svg = runBox({ ...box.defaults }).views[0].svg!;
  assert.match(svg, /data-operation="guide"/);
  for (const p of ['xtool', 'lightburn', 'glowforge', 'cricut'] as const) {
    const out = adaptSvg(svg, p);
    assert.doesNotMatch(out, /data-operation="guide"/, p);
    assert.ok(checkSvg(out).ok, p);
  }
  const uni = adaptSvg(svg, 'universal');
  assert.match(uni, /inkscape:groupmode="layer" inkscape:label="Taglio"/);
  assert.ok(checkSvg(uni).ok);
  assert.match(adaptSvg(svg, 'lightburn'), /data-operation="cut"[^>]*stroke="#FF0000"/);
  assert.match(adaptSvg(svg, 'cricut'), /data-operation="cut"[^>]*fill="#FFFFFF"/);
  assert.equal(parseEngineSvg(svg).groups.find((g) => g.op === 'cut')!.paths.length, 5);
});

test('applyProfile: SVG → DXF e conversione dentro gli ZIP', async () => {
  const r = runBox({ ...box.defaults });
  const zipOpt = r.exports.find((x) => x.id === 'zip')!;
  const z = await applyProfile(await zipOpt.build(), 'dxf');
  const names = unzipStore(new Uint8Array(await z.blob.arrayBuffer())).map((e) => e.name);
  assert.ok(names.length > 1 && names.every((n) => n.endsWith('.dxf')), names.join());
  const svg = await applyProfile(await r.exports[0].build(), 'lightburn');
  assert.ok(svg.filename.endsWith('.svg'));
  assert.doesNotMatch(await svg.blob.text(), /data-operation="guide"/);
  const csv = { filename: 'a.csv', blob: new Blob(['x']) };
  assert.equal(await applyProfile(csv, 'dxf'), csv);
});
