// Copertine 4:3 per le schede Atomm. Ogni visual è disegnato dalla geometria reale del generatore
// (stesso codice dei file esportati), resa come prodotto finito: legno, adesivi, carta, schermo.
import { dataUrl } from '../../src/core/canvas.ts';
import { fmt, polygonPath, type Pt } from '../../src/core/geometry.ts';
import { nest } from '../../src/core/nesting.ts';
import { circlePath } from '../../src/core/geometry.ts';
import type { Rgba } from '../../src/core/raster.ts';
import { box, buildBox } from '../../src/generators/box.ts';
import { computeCost } from '../../src/generators/cost-lab.ts';
import { adjust, errorDiffusion, resizeGray } from '../../src/generators/image-prep.ts';
import { buildLayers, layerLight } from '../../src/generators/layer-light.ts';
import { parseParts } from '../../src/generators/nesting.ts';
import { batchNesting } from '../../src/generators/nesting.ts';
import { analyzeSticker, printCut } from '../../src/generators/print-cut.ts';
import { buildSignTag, signTag } from '../../src/generators/sign-tag.ts';
import { traceImage, vectorize } from '../../src/generators/vectorize.ts';

const WOOD_DEFS = `
<linearGradient id="wood" x1="0" y1="0" x2="1" y2="0.35">
  <stop offset="0" stop-color="#e7c79a"/><stop offset="0.45" stop-color="#d9b07a"/><stop offset="1" stop-color="#c99b62"/>
</linearGradient>
<linearGradient id="woodDark" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="#c79a63"/><stop offset="1" stop-color="#a87a45"/>
</linearGradient>
<pattern id="grain" width="40" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-4)">
  <path d="M0 3 Q10 1 20 3 T40 3" fill="none" stroke="#8a5a2b" stroke-opacity="0.10" stroke-width="0.8"/>
</pattern>
<filter id="shadow" x="-20%" y="-20%" width="140%" height="150%">
  <feDropShadow dx="0" dy="14" stdDeviation="16" flood-color="#000" flood-opacity="0.45"/>
</filter>
<filter id="soft" x="-10%" y="-10%" width="120%" height="130%">
  <feDropShadow dx="0" dy="5" stdDeviation="5" flood-color="#000" flood-opacity="0.35"/>
</filter>
<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="30"/></filter>`;

const svg = (w: number, h: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(w)} ${fmt(h)}" width="100%" height="100%"><defs>${WOOD_DEFS}</defs>${body}</svg>`;

/** Rgba → data URL tramite canvas. */
function url(img: Rgba): string {
  return dataUrl(img);
}

function canvasImage(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): Rgba {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  draw(g);
  const d = g.getImageData(0, 0, w, h);
  return { width: w, height: h, data: d.data };
}

// ---------------- 01 Sign & Tag ----------------
function signVisual(): string {
  const items = [
    { preset: 'sign', x: 30, y: 40, s: 1.55, rot: -3 },
    { preset: 'keychain', x: 120, y: 330, s: 3.2, rot: 8 },
    { preset: 'tag', x: 420, y: 330, s: 2.6, rot: -6 },
  ];
  let body = '';
  for (const it of items) {
    const p = { ...signTag.defaults, ...signTag.presets!.find((x) => x.id === it.preset)!.values };
    if (it.preset === 'sign') Object.assign(p, { line1: 'INGLY', line2: 'design lab', font: 'playfair', width: 400, height: 150 });
    if (it.preset === 'keychain') Object.assign(p, { line1: 'CASA', font: 'montserrat' });
    const { geo } = buildSignTag(p);
    const w = Number(p.width), h = Number(p.height);
    const k = it.preset === 'sign' ? 1.55 : it.s;
    const piece = [geo.outline, ...geo.holes.map(circlePath)].join('');
    body += `<g transform="translate(${it.x} ${it.y}) rotate(${it.rot} ${(w * k) / 2} ${(h * k) / 2}) scale(${k})" filter="url(#shadow)">
      <path d="${piece}" fill="url(#wood)" fill-rule="evenodd" stroke="#8a5a2b" stroke-width="${0.8 / k}"/>
      <path d="${piece}" fill="url(#grain)" fill-rule="evenodd"/>
      ${geo.border ? `<path d="${geo.border}" fill="none" stroke="#4a2c14" stroke-width="${1.6 / k}" opacity="0.85"/>` : ''}
      <path d="${geo.textPaths.join('')}" fill="#3e2310" opacity="0.92"/>
    </g>`;
  }
  return svg(760, 560, body);
}

// ---------------- 02 Box ----------------
function boxVisual(): string {
  const p = { ...box.defaults, width: 220, depth: 140, height: 70, divX: 1, divY: 2, fingerWidth: 12, dimMode: 'outer' };
  const m = buildBox(p, true).model!;
  const { W, D } = m.outer;
  const H = m.outer.H;
  const t = m.t;
  const c30 = Math.cos(Math.PI / 6), s30 = 0.5;
  const P = (x: number, y: number, z: number) => ({ x: (x - y) * c30, y: (x + y) * s30 - z });
  const faces: { depth: number; d: string; fill: string }[] = [];
  const face = (id: string, map: (u: number, v: number) => [number, number, number], fill: string, depth: number) => {
    const pn = m.panels.find((q) => q.id === id);
    if (!pn) return;
    faces.push({ depth, fill, d: polygonPath(pn.outline.map((q) => { const [x, y, z] = map(q.x, q.y); return P(x, y, z); })) });
  };
  face('bottom', (u, v) => [u, v, 0], '#b8894f', -1e9);
  face('front', (u, v) => [u, 0, H - v], '#c99a62', 0);
  face('left', (u, v) => [0, u, H - v], '#d4a86f', 1);
  const nx = 1, ny = 2, c = Number(p.clearance);
  const inner = m.inner;
  const cellW = (inner.W - ny * t) / (ny + 1), cellD = (inner.D - nx * t) / (nx + 1);
  const hDiv = inner.H;
  for (let i = 0; i < ny; i++) {
    const xc = t + (i + 1) * cellW + i * t + t / 2;
    face(`divy-${i + 1}`, (u, v) => [xc, t + c / 2 + u, t + hDiv - v], '#e2bd88', xc + D / 2);
  }
  for (let i = 0; i < nx; i++) {
    const yc = t + (i + 1) * cellD + i * t + t / 2;
    face(`divx-${i + 1}`, (u, v) => [t + c / 2 + u, yc, t + hDiv - v], '#dcb27b', W / 2 + yc + 0.5);
  }
  face('back', (u, v) => [u, D, H - v], '#e6c08c', 1e8);
  face('right', (u, v) => [W, u, H - v], '#d9ad73', 1e8 + 1);
  faces.sort((a, b) => a.depth - b.depth);
  const pts = faces.flatMap((f) => [...f.d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((q) => ({ x: +q[1], y: +q[2] })));
  const x0 = Math.min(...pts.map((q) => q.x)), x1 = Math.max(...pts.map((q) => q.x));
  const y0 = Math.min(...pts.map((q) => q.y)), y1 = Math.max(...pts.map((q) => q.y));
  const pad = 30;
  const body = `<g transform="translate(${pad - x0} ${pad - y0})" filter="url(#shadow)">${faces.map((f) => `<path d="${f.d}" fill="${f.fill}" stroke="#7a4f24" stroke-width="0.9" stroke-linejoin="round"/>`).join('')}</g>`;
  return svg(x1 - x0 + 2 * pad, y1 - y0 + 2 * pad, body);
}

// ---------------- 03 Layer & Light ----------------
function layerVisual(): string {
  const p = { ...layerLight.defaults, layers: 6, shape: 'arch', width: 200, height: 270, motif: 'landscape', seed: 11, frame: 14 };
  const { model } = buildLayers(p);
  const n = model.layers.length;
  const W = Number(p.width), Hh = Number(p.height);
  let body = `<ellipse cx="${W / 2 + 40}" cy="${Hh * 0.45 + 30}" rx="${W * 0.55}" ry="${Hh * 0.45}" fill="#facc15" opacity="0.55" filter="url(#glow)"/>`;
  for (let i = n - 1; i >= 0; i--) {
    const L = model.layers[i];
    const t = i / (n - 1);
    const light = Math.round(86 - t * 48);
    const d = [polygonPath(model.outline), ...L.windows.map((q) => polygonPath(q)), ...L.holes.map(circlePath)].join('');
    const off = (n - 1 - i) * 0;
    body += `<g transform="translate(${40 + off + i * 3} ${30 - i * 3})" filter="url(#soft)"><path d="${d}" fill-rule="evenodd" fill="hsl(${32 + t * 8} ${45 + t * 20}% ${light}%)" stroke="#5b3a1a" stroke-width="0.6"/></g>`;
  }
  return svg(W + 100, Hh + 60, body);
}

// ---------------- 04 Nesting ----------------
function nestingVisual(): string {
  const { parts } = parseParts(String(batchNesting.defaults.parts), 1, 'per-part');
  const o = { sheetW: 600, sheetH: 400, margin: 8, spacing: 3, kerf: 0.15, maxSheets: 1 };
  const r = nest(parts, o);
  const colors: Record<string, string> = {};
  const pal = ['#facc15', '#60a5fa', '#f87171', '#34d399', '#c084fc'];
  parts.forEach((q, i) => (colors[q.id] = pal[i % pal.length]));
  let body = `<g filter="url(#shadow)"><rect width="600" height="400" rx="4" fill="url(#wood)"/><rect width="600" height="400" rx="4" fill="url(#grain)"/></g>`;
  for (const q of r.placed)
    body += `<rect x="${fmt(q.x)}" y="${fmt(q.y)}" width="${fmt(q.w)}" height="${fmt(q.h)}" rx="2" fill="${colors[q.partId]}" fill-opacity="0.82" stroke="#7f1d1d" stroke-width="0.9"/>`;
  body += `<rect x="8" y="8" width="584" height="384" fill="none" stroke="#111827" stroke-opacity="0.35" stroke-dasharray="6 5"/>`;
  return svg(600, 400, `<g transform="translate(0 0)">${body}</g>`);
}

// ---------------- 05 Image Prep ----------------
function landscape(w: number, h: number): Rgba {
  return canvasImage(w, h, (g) => {
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#203a5c'); sky.addColorStop(0.6, '#f2b56b'); sky.addColorStop(1, '#f7d9a8');
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff3c4'; g.beginPath(); g.arc(w * 0.68, h * 0.42, h * 0.13, 0, Math.PI * 2); g.fill();
    const hill = (yb: number, amp: number, col: string, ph: number) => {
      g.fillStyle = col; g.beginPath(); g.moveTo(0, h);
      for (let x = 0; x <= w; x += 4) g.lineTo(x, yb + Math.sin(x / w * 7 + ph) * amp + Math.sin(x / w * 17 + ph * 2) * amp * 0.3);
      g.lineTo(w, h); g.fill();
    };
    hill(h * 0.6, h * 0.06, '#8a5a44', 1); hill(h * 0.7, h * 0.07, '#5b3b33', 2.4); hill(h * 0.82, h * 0.05, '#2b1d1f', 4.1);
  });
}

function imagePrepVisual(): string {
  const W = 760, H = 520;
  const src = landscape(W, H);
  const g = adjust(resizeGray(src, W, H), 0, 15, 1.1, false);
  const out = errorDiffusion(g, W, H, 'floyd');
  // risultato "inciso": nero → marrone bruciato, bianco → legno
  const burnt = canvasImage(W, H, (ctx) => {
    const d = ctx.createImageData(W, H);
    for (let i = 0; i < out.length; i++) {
      const v = out[i] ? [228, 190, 140] : [74, 42, 20];
      d.data.set([...v, 255], i * 4);
    }
    ctx.putImageData(d, 0, 0);
  });
  const half = W / 2;
  const body = `<g filter="url(#shadow)"><rect x="-14" y="-14" width="${W + 28}" height="${H + 28}" rx="10" fill="url(#woodDark)"/></g>
  <clipPath id="l"><rect width="${half}" height="${H}"/></clipPath><clipPath id="r"><rect x="${half}" width="${half}" height="${H}"/></clipPath>
  <image href="${url(src)}" width="${W}" height="${H}" clip-path="url(#l)"/>
  <image href="${url(burnt)}" width="${W}" height="${H}" clip-path="url(#r)" style="image-rendering:pixelated"/>
  <line x1="${half}" y1="-14" x2="${half}" y2="${H + 14}" stroke="#facc15" stroke-width="5"/>
  <circle cx="${half}" cy="${H / 2}" r="22" fill="#facc15"/><path d="M${half - 9} ${H / 2}l-8 0m8 -8l-8 8l8 8M${half + 9} ${H / 2}l8 0m-8 -8l8 8l-8 8" stroke="#111827" stroke-width="3.5" fill="none" stroke-linecap="round"/>`;
  return svg(W + 60, H + 60, `<g transform="translate(30 24)">${body}</g>`);
}

// ---------------- 06 Cost Lab ----------------
function costVisual(): string {
  const b = computeCost({ ppm2: 12 / (600 * 400), areaMm2: 80 * 30 * 50, wastePct: 15, machineMin: 45, machineRate: 18, laborMin: 40, laborRate: 22, consumables: 6, overheadPct: 10, commissionPct: 5, marginPct: 30, vatPct: 22, qty: 50 });
  const parts = [
    { l: 'Materiale', v: b.material + b.waste, c: '#d9b07a' }, { l: 'Macchina', v: b.machine, c: '#60a5fa' }, { l: 'Manodopera', v: b.labor, c: '#34d399' },
    { l: 'Altri costi', v: b.consumables + b.overhead + b.commission, c: '#c084fc' }, { l: 'Margine', v: b.margin, c: '#facc15' },
  ];
  const tot = parts.reduce((s, q) => s + q.v, 0);
  let a = -Math.PI / 2, arcs = '';
  const R = 150, r0 = 92, cx = 200, cy = 210;
  for (const q of parts) {
    const a2 = a + (q.v / tot) * Math.PI * 2;
    const big = a2 - a > Math.PI ? 1 : 0;
    const p1 = [cx + R * Math.cos(a), cy + R * Math.sin(a)], p2 = [cx + R * Math.cos(a2), cy + R * Math.sin(a2)];
    const p3 = [cx + r0 * Math.cos(a2), cy + r0 * Math.sin(a2)], p4 = [cx + r0 * Math.cos(a), cy + r0 * Math.sin(a)];
    arcs += `<path d="M${p1}A${R} ${R} 0 ${big} 1 ${p2}L${p3}A${r0} ${r0} 0 ${big} 0 ${p4}Z" fill="${q.c}" stroke="#151b23" stroke-width="3"/>`;
    a = a2;
  }
  const eur = (v: number) => `${v.toFixed(2).replace('.', ',')} €`;
  let legend = '';
  parts.forEach((q, i) => {
    legend += `<rect x="410" y="${88 + i * 52}" width="22" height="22" rx="5" fill="${q.c}"/><text x="446" y="${106 + i * 52}" fill="#e5e7eb" font-size="24" font-family="Montserrat" font-weight="500">${q.l}</text>`;
  });
  const body = `<g filter="url(#shadow)"><rect width="760" height="430" rx="26" fill="#151b23" stroke="#2b3442"/></g>
  ${arcs}<text x="${cx}" y="${cy - 6}" text-anchor="middle" fill="#9aa3ae" font-size="20" font-family="Montserrat" font-weight="500">al pezzo</text>
  <text x="${cx}" y="${cy + 30}" text-anchor="middle" fill="#fff" font-size="40" font-family="Montserrat" font-weight="800">${eur(b.perPieceGross)}</text>
  ${legend}
  <text x="40" y="404" fill="#6b7280" font-size="17" font-family="Montserrat" font-weight="500">Esempio illustrativo: 50 targhette, i dati reali li inserisci tu</text>`;
  return svg(760, 440, body);
}

// ---------------- 07 Print & Cut ----------------
function stickerArt(): Rgba {
  return canvasImage(800, 640, (g) => {
    g.translate(400, 320);
    g.fillStyle = '#facc15';
    g.beginPath();
    for (let i = 0; i < 28; i++) { const r = i % 2 ? 205 : 280, a = (i / 28) * Math.PI * 2; g.lineTo(r * Math.cos(a), r * Math.sin(a)); }
    g.closePath(); g.fill();
    const grd = g.createLinearGradient(0, -170, 0, 170);
    grd.addColorStop(0, '#1f2a44'); grd.addColorStop(1, '#0b1020');
    g.fillStyle = grd; g.beginPath(); g.arc(0, 0, 175, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#facc15'; g.font = '800 104px Montserrat'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('INGLY', 0, -8);
    g.fillStyle = '#e5e7eb'; g.font = '500 34px Montserrat'; g.fillText('design lab', 0, 70);
  });
}

function printCutVisual(): string {
  const art = stickerArt();
  const p = { ...printCut.defaults, widthMm: 60, offset: 2.5, smooth: 2 };
  const { model: m } = analyzeSticker(art, p);
  if (!m) return '';
  const W = 210, H = 297;
  const r = nest([{ id: 's', name: 's', w: m.w, h: m.h, qty: 12, canRotate: false }], { sheetW: W, sheetH: H, margin: 20, spacing: 5, kerf: 0, maxSheets: 1 });
  const u = url(art);
  let body = `<defs><clipPath id="cc"><path d="${m.cutPath}"/></clipPath></defs>
  <g filter="url(#shadow)"><rect width="${W}" height="${H}" rx="3" fill="#fbfbf8"/></g>`;
  for (const q of r.placed)
    body += `<g transform="translate(${fmt(q.x)} ${fmt(q.y)})"><g clip-path="url(#cc)"><rect x="-5" y="-5" width="${m.w + 10}" height="${m.h + 10}" fill="#fff"/><image href="${u}" x="${fmt(m.art.x)}" y="${fmt(m.art.y)}" width="${fmt(m.art.w)}" height="${fmt(m.art.h)}"/></g><path d="${m.cutPath}" fill="none" stroke="#ef4444" stroke-width="0.6" stroke-dasharray="2 1.4"/></g>`;
  for (const [x, y] of [[10, 10], [W - 16, 10], [10, H - 16]]) body += `<rect x="${x}" y="${y}" width="6" height="6" fill="#111827"/>`;
  // un adesivo staccato e sollevato in primo piano
  const big = 2.1;
  const peeled = `<g transform="translate(${W - 20} ${H - 120}) rotate(-14) scale(${big})" filter="url(#soft)"><g clip-path="url(#cc)"><rect x="-5" y="-5" width="${m.w + 10}" height="${m.h + 10}" fill="#fff"/><image href="${u}" x="${fmt(m.art.x)}" y="${fmt(m.art.y)}" width="${fmt(m.art.w)}" height="${fmt(m.art.h)}"/></g><path d="${m.cutPath}" fill="none" stroke="#d1d5db" stroke-width="0.4"/></g>`;
  return svg(W + 130, H + 20, `<g transform="translate(6 6) rotate(-4 105 150)">${body}</g>${peeled}`);
}

// ---------------- 08 Image → SVG ----------------
function logoArt(): Rgba {
  return canvasImage(600, 420, (g) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, 600, 420);
    g.fillStyle = '#1d4f91'; g.beginPath(); g.moveTo(40, 360); g.lineTo(220, 70); g.lineTo(400, 360); g.closePath(); g.fill();
    g.fillStyle = '#facc15'; g.beginPath(); g.arc(440, 140, 80, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#b42318'; g.beginPath(); g.moveTo(270, 360); g.lineTo(400, 175); g.lineTo(560, 360); g.closePath(); g.fill();
  });
}

function vectorVisual(): string {
  const art = logoArt();
  const p = { ...vectorize.defaults, mode: 'color', colors: 5, widthMm: 600, resolution: 600 };
  const { layers, heightMm } = traceImage(art, p);
  // metà sinistra: raster sgranato (pixel ingranditi); metà destra: vettoriale con nodi in evidenza
  const tiny = canvasImage(60, 42, (g) => {
    const c = document.createElement('canvas');
    c.width = art.width; c.height = art.height;
    c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(art.data), art.width, art.height), 0, 0);
    g.drawImage(c, 0, 0, 60, 42);
  });
  const W = 600, H = heightMm, half = W / 2;
  const nodes = layers.flatMap((l) => [...l.d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((q) => [+q[1], +q[2]])).filter(([x]) => x > half);
  const vec = layers.map((l) => `<path d="${l.d}" fill="${l.color}" fill-rule="evenodd"/>`).join('');
  const body = `<g filter="url(#shadow)"><rect width="${W}" height="${H}" rx="10" fill="#fff"/></g>
  <clipPath id="vl"><rect width="${half}" height="${H}"/></clipPath><clipPath id="vr"><rect x="${half}" width="${half}" height="${H}"/></clipPath>
  <image href="${url(tiny)}" width="${W}" height="${H}" clip-path="url(#vl)" style="image-rendering:pixelated"/>
  <g clip-path="url(#vr)">${vec}${layers.map((l) => `<path d="${l.d}" fill="none" stroke="#111827" stroke-opacity="0.55" stroke-width="1.2"/>`).join('')}
  ${nodes.map(([x, y]) => `<rect x="${x - 3}" y="${y - 3}" width="6" height="6" fill="#fff" stroke="#2563eb" stroke-width="1.4"/>`).join('')}</g>
  <line x1="${half}" y1="0" x2="${half}" y2="${H}" stroke="#facc15" stroke-width="5"/>
  <rect x="18" y="${H - 50}" width="96" height="34" rx="17" fill="#111827" fill-opacity="0.85"/><text x="66" y="${H - 27}" text-anchor="middle" fill="#fff" font-size="18" font-family="Montserrat" font-weight="800">PNG</text>
  <rect x="${W - 114}" y="${H - 50}" width="96" height="34" rx="17" fill="#facc15"/><text x="${W - 66}" y="${H - 27}" text-anchor="middle" fill="#111827" font-size="18" font-family="Montserrat" font-weight="800">SVG</text>`;
  return svg(W + 40, H + 50, `<g transform="translate(20 14)">${body}</g>`);
}

// ---------------- testi ----------------
const COVERS: Record<string, { code: string; title: [string, string]; tagline: string; chips: string[]; visual: () => string }> = {
  'label-generator': { code: '01', title: ['Sign', '& Tag'], tagline: 'Targhette, portachiavi e insegne pronte per il laser', chips: ['Testo in tracciati', 'Fori validati', 'SVG in mm'], visual: signVisual },
  'box-generator': { code: '02', title: ['Box &', 'Enclosure'], tagline: 'Scatole a incastro e organizer con scomparti', chips: ['Finger joint', 'Verifica 3D', 'Layout di taglio'], visual: boxVisual },
  'layer-light-generator': { code: '03', title: ['Layer', '& Light'], tagline: 'Quadri multilivello, insegne e lampade a strati', chips: ['2–12 livelli', 'Fori di registro', 'Luce LED'], visual: layerVisual },
  'batch-nesting': { code: '04', title: ['Batch &', 'Nesting'], tagline: 'Più pezzi per lastra, meno sfrido', chips: ['MaxRects', 'Kerf e margini', 'Report CSV'], visual: nestingVisual },
  'image-prep': { code: '05', title: ['Image', 'Prep'], tagline: 'Foto pronte per l\'incisione laser', chips: ['Dithering', 'mm e DPI', '100% locale'], visual: imagePrepVisual },
  'material-cost-lab': { code: '06', title: ['Material', '& Cost Lab'], tagline: 'Il prezzo giusto per ogni lavoro', chips: ['Catalogo materiali', 'Costi trasparenti', 'IVA e margine'], visual: costVisual },
  'print-and-cut': { code: '07', title: ['Print', '& Cut'], tagline: 'Adesivi e sagomati: stampa, poi taglio sul contorno', chips: ['Sfondo rimosso in automatico', 'Contorno di taglio', 'Crocini'], visual: printCutVisual },
  'image-to-svg': { code: '08', title: ['Image →', 'SVG'], tagline: 'Da immagine a vettoriale in un clic', chips: ['Bianco/nero e colori', 'Curve pulite', 'SVG in mm'], visual: vectorVisual },
};

export function render(slug: string): void {
  const c = COVERS[slug];
  if (!c) throw new Error(`copertina sconosciuta: ${slug}`);
  const set = (id: string, v: string) => (document.getElementById(id)!.textContent = v);
  set('code', c.code);
  set('t1', c.title[0]);
  set('t2', c.title[1]);
  set('tagline', c.tagline);
  document.getElementById('chips')!.replaceChildren(...c.chips.map((t) => Object.assign(document.createElement('span'), { textContent: t })));
  document.getElementById('visual')!.innerHTML = c.visual();
}

(window as unknown as { renderCover: typeof render }).renderCover = render;
