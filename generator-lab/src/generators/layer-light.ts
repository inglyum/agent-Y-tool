// GENERATORE 03 — INGLY LAYER & LIGHT: quadri multilivello, insegne e lampade a strati.
// Ogni livello è una sagoma vettoriale: cornice esterna + finestra interna ritagliata secondo un motivo.
// Il livello 1 è quello frontale (finestra più ampia); l'ultimo è il fondo pieno.
import { safeFilename, svgFile, zipFile } from '../core/export.ts';
import {
  type Circle, type Pt, area, circleClearanceInPolygon, circlePath, convexYRange, distToPolygonEdge, fmt, pointInPolygon,
  polygonPath, regularPolygon, rng, roundedRectPolygon, selfIntersects,
} from '../core/geometry.ts';
import { bool, hasErrors, normalizeParams, num, str } from '../core/params.ts';
import { svgDocument } from '../core/svg.ts';
import type { ExportOption, GeneratorDef, GeneratorResult, Issue, ParamDef, Params } from '../core/types.ts';

export const layerParams: ParamDef[] = [
  { key: 'layers', label: 'Numero di livelli', type: 'number', group: 'Composizione', min: 2, max: 12, step: 1 },
  {
    key: 'shape', label: 'Sagoma', type: 'select', group: 'Composizione',
    options: [
      { value: 'rect', label: 'Rettangolo' }, { value: 'rounded', label: 'Rettangolo arrotondato' }, { value: 'circle', label: 'Cerchio / ellisse' },
      { value: 'hexagon', label: 'Esagono' }, { value: 'arch', label: 'Arco' },
    ],
  },
  { key: 'width', label: 'Larghezza', type: 'number', group: 'Composizione', unit: 'mm', min: 40, max: 1200, step: 1 },
  { key: 'height', label: 'Altezza', type: 'number', group: 'Composizione', unit: 'mm', min: 40, max: 1200, step: 1 },
  { key: 'frame', label: 'Larghezza cornice', type: 'number', group: 'Composizione', unit: 'mm', min: 3, max: 200, step: 0.5, help: 'Fascia piena che tiene insieme ogni livello e ospita i fori di allineamento.' },
  {
    key: 'motif', label: 'Motivo', type: 'select', group: 'Motivo',
    options: [{ value: 'landscape', label: 'Paesaggio (colline)' }, { value: 'waves', label: 'Onde regolari' }, { value: 'tunnel', label: 'Tunnel concentrico' }],
  },
  { key: 'amplitude', label: 'Ampiezza del motivo', type: 'number', group: 'Motivo', unit: '%', min: 0, max: 60, step: 1, visibleIf: (p) => p.motif !== 'tunnel' },
  { key: 'frequency', label: 'Frequenza', type: 'number', group: 'Motivo', min: 0.5, max: 8, step: 0.1, visibleIf: (p) => p.motif !== 'tunnel' },
  { key: 'seed', label: 'Variante (seme)', type: 'number', group: 'Motivo', min: 1, max: 99999, step: 1, visibleIf: (p) => p.motif === 'landscape' },
  { key: 'minWeb', label: 'Spessore minimo del materiale', type: 'number', group: 'Motivo', unit: 'mm', min: 0.5, max: 30, step: 0.1, help: 'Le finestre più sottili di questo valore vengono eliminate.' },
  { key: 'thickness', label: 'Spessore di ogni livello', type: 'number', group: 'Materiale', unit: 'mm', min: 0.5, max: 20, step: 0.1 },
  { key: 'spacer', label: 'Distanziale fra livelli', type: 'number', group: 'Materiale', unit: 'mm', min: 0, max: 50, step: 0.5, help: 'Solo per calcolare la profondità totale.' },
  {
    key: 'regHoles', label: 'Fori di allineamento', type: 'select', group: 'Registrazione',
    options: [{ value: '0', label: 'Nessuno' }, { value: '2', label: '2 (in alto)' }, { value: '4', label: '4 (angoli)' }],
  },
  { key: 'regDiameter', label: 'Diametro fori di allineamento', type: 'number', group: 'Registrazione', unit: 'mm', min: 1, max: 20, step: 0.1, visibleIf: (p) => p.regHoles !== '0' },
  { key: 'registration', label: 'Margine di registrazione', type: 'number', group: 'Registrazione', unit: 'mm', min: 0, max: 20, step: 0.1, help: 'Distanza minima fra fori, finestre e bordi.' },
  { key: 'light', label: 'Predisposizione luce (foro cavo sul fondo)', type: 'bool', group: 'Luce' },
  { key: 'cableDiameter', label: 'Diametro foro cavo', type: 'number', group: 'Luce', unit: 'mm', min: 3, max: 30, step: 0.5, visibleIf: (p) => p.light === true },
  { key: 'filename', label: 'Nome file', type: 'text', group: 'Esportazione', maxLength: 80 },
];

export const layerDefaults: Params = {
  layers: 5, shape: 'rounded', width: 200, height: 260, frame: 14, motif: 'landscape', amplitude: 22, frequency: 2.2, seed: 7,
  minWeb: 2, thickness: 3, spacer: 3, regHoles: '4', regDiameter: 3, registration: 1.5, light: false, cableDiameter: 6, filename: 'ingly-layer',
};

export function outerShape(shape: string, w: number, h: number, inset = 0): Pt[] {
  const x = inset, y = inset, W = w - 2 * inset, H = h - 2 * inset;
  switch (shape) {
    case 'rounded': return roundedRectPolygon(x, y, W, H, Math.min(W, H) * 0.12, 'round', 12);
    case 'circle': return regularPolygon(w / 2, h / 2, W / 2, H / 2, 160);
    case 'hexagon': return regularPolygon(w / 2, h / 2, W / 2, H / 2, 6, 0);
    case 'arch': {
      const r = W / 2;
      const pts: Pt[] = [];
      const cy = y + Math.min(r, H);
      for (let i = 0; i <= 64; i++) {
        const a = Math.PI + (i / 64) * Math.PI;
        pts.push({ x: x + r + r * Math.cos(a), y: cy + Math.min(r, H) * Math.sin(a) });
      }
      pts.push({ x: x + W, y: y + H }, { x, y: y + H });
      return pts;
    }
    default: return [{ x, y }, { x: x + W, y }, { x: x + W, y: y + H }, { x, y: y + H }];
  }
}

/** Finestre del livello: regione della finestra al di sopra della curva y = f(x). */
function windowsAboveCurve(win: Pt[], f: (x: number) => number, minWeb: number, samples = 240): Pt[][] {
  const xs = win.map((q) => q.x);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const out: Pt[][] = [];
  let cur: { x: number; top: number; bot: number }[] = [];
  const flush = () => {
    if (cur.length >= 3) {
      const poly = [...cur.map((c) => ({ x: c.x, y: c.top })), ...cur.slice().reverse().map((c) => ({ x: c.x, y: c.bot }))];
      if (area(poly) > minWeb * minWeb * 4) out.push(poly);
    }
    cur = [];
  };
  for (let i = 0; i <= samples; i++) {
    const x = x0 + ((x1 - x0) * i) / samples;
    const r = convexYRange(win, x);
    if (!r) { flush(); continue; }
    const bot = Math.min(f(x), r[1]);
    if (bot - r[0] > minWeb) cur.push({ x, top: r[0], bot });
    else flush();
  }
  flush();
  return out;
}

function scaleAbout(pts: Pt[], cx: number, cy: number, k: number): Pt[] {
  return pts.map((q) => ({ x: cx + (q.x - cx) * k, y: cy + (q.y - cy) * k }));
}

export interface LayerModel {
  outline: Pt[];
  layers: { index: number; windows: Pt[][]; holes: Circle[] }[];
  /** materiale più sottile fra cornice e ponti tra finestre, in mm */
  minBridge: number;
  /** distanza minima fra fori di allineamento e bordi/finestre, in mm */
  minHoleGap: number;
}

export function buildLayers(p: Params): { model: LayerModel; issues: Issue[] } {
  const issues: Issue[] = [];
  const w = num(p, 'width'), h = num(p, 'height');
  const n = Math.round(num(p, 'layers'));
  const frame = num(p, 'frame');
  const shape = str(p, 'shape');
  const minWeb = num(p, 'minWeb');
  const reg = num(p, 'registration');
  const outline = outerShape(shape, w, h);
  const win = outerShape(shape, w, h, frame);
  if (frame * 2 >= Math.min(w, h) - 10) issues.push({ level: 'error', field: 'frame', message: 'Cornice troppo larga: non resta spazio per le finestre.' });
  if (frame < minWeb) issues.push({ level: 'error', field: 'frame', message: 'La cornice è più sottile dello spessore minimo del materiale.' });

  // fori di allineamento nella fascia della cornice, identici su tutti i livelli
  const rr = num(p, 'regDiameter') / 2;
  const nh = Number(str(p, 'regHoles'));
  const holes: Circle[] = [];
  if (nh) {
    const off = frame / 2;
    const ring = (angles: number[]) => angles.map((a) => ({ x: w / 2 + (w / 2 - off) * Math.cos(a), y: h / 2 + (h / 2 - off) * Math.sin(a) }));
    const hex = regularPolygon(w / 2, h / 2, w / 2 - off * 1.4, h / 2 - off * 1.4, 6, 0);
    const cand: Pt[] = shape === 'circle'
      ? ring(nh === 2 ? [-0.75 * Math.PI, -0.25 * Math.PI] : [-0.75 * Math.PI, -0.25 * Math.PI, 0.25 * Math.PI, 0.75 * Math.PI])
      : shape === 'hexagon'
        ? (nh === 2 ? [hex[4], hex[5]] : [hex[4], hex[5], hex[1], hex[2]])
      : shape === 'arch'
        ? (nh === 2 ? [{ x: off, y: h - off }, { x: w - off, y: h - off }] : [{ x: off, y: h * 0.55 }, { x: w - off, y: h * 0.55 }, { x: w - off, y: h - off }, { x: off, y: h - off }])
        : nh === 2
          ? [{ x: w * 0.25, y: off }, { x: w * 0.75, y: off }]
          : [{ x: off * 1.6, y: off * 1.6 }, { x: w - off * 1.6, y: off * 1.6 }, { x: w - off * 1.6, y: h - off * 1.6 }, { x: off * 1.6, y: h - off * 1.6 }];
    for (const c of cand) holes.push({ cx: c.x, cy: c.y, r: rr });
    holes.forEach((c, i) => {
      if (circleClearanceInPolygon(c, outline) < reg) issues.push({ level: 'error', field: 'regDiameter', message: `Il foro di allineamento ${i + 1} è troppo vicino al bordo esterno.` });
      const inWin = pointInPolygon({ x: c.cx, y: c.cy }, win) || distToPolygonEdge({ x: c.cx, y: c.cy }, win) < c.r + reg;
      if (inWin) issues.push({ level: 'error', field: 'frame', message: `Il foro di allineamento ${i + 1} invade la finestra: allarga la cornice o riduci il diametro.` });
    });
  }

  const motif = str(p, 'motif');
  const amp = (num(p, 'amplitude') / 100) * h;
  const freq = num(p, 'frequency');
  const rand = rng(Math.round(num(p, 'seed')));
  const layers: LayerModel['layers'] = [];
  let minBridge = Infinity;
  let minHoleGap = Infinity;
  const winBB = { y0: Math.min(...win.map((q) => q.y)), y1: Math.max(...win.map((q) => q.y)) };
  for (let i = 0; i < n; i++) {
    let windows: Pt[][] = [];
    if (i < n - 1) {
      // livello frontale: linea più bassa → finestra più ampia
      const depth = (i + 1) / n;
      const base = winBB.y0 + (winBB.y1 - winBB.y0) * (1 - depth * 0.85);
      if (motif === 'tunnel') {
        const k = 1 - (i / (n - 1)) * 0.75;
        windows = [scaleAbout(win, w / 2, h / 2, k)];
      } else {
        const ph = [rand() * Math.PI * 2, rand() * Math.PI * 2, rand() * Math.PI * 2];
        const f = motif === 'waves'
          ? (x: number) => base + amp * 0.5 * Math.sin((x / w) * Math.PI * 2 * freq + i * 0.9)
          : (x: number) => base + amp * (0.55 * Math.sin((x / w) * Math.PI * 2 * freq * 0.5 + ph[0]) + 0.3 * Math.sin((x / w) * Math.PI * 2 * freq + ph[1]) + 0.15 * Math.sin((x / w) * Math.PI * 2 * freq * 2.3 + ph[2]));
        windows = windowsAboveCurve(win, f, minWeb);
      }
      // le finestre rispettano il margine di registrazione rispetto ai fori
      windows = windows.filter((poly) => !selfIntersects(poly));
      // ponti fra finestre adiacenti più sottili del minimo: si elimina la finestra più piccola
      const span = (q: Pt[]) => [Math.min(...q.map((v) => v.x)), Math.max(...q.map((v) => v.x))];
      windows.sort((a, b) => span(a)[0] - span(b)[0]);
      for (let k = 0; k + 1 < windows.length; ) {
        if (span(windows[k + 1])[0] - span(windows[k])[1] < minWeb) {
          windows.splice(area(windows[k]) < area(windows[k + 1]) ? k : k + 1, 1);
          issues.push({ level: 'info', field: 'minWeb', message: `Livello ${i + 1}: rimossa una finestra separata da un ponte più sottile di ${fmt(minWeb)} mm.` });
        } else k++;
      }
      for (const c of holes)
        if (windows.some((poly) => pointInPolygon({ x: c.cx, y: c.cy }, poly) || distToPolygonEdge({ x: c.cx, y: c.cy }, poly) < c.r + reg))
          issues.push({ level: 'error', field: 'registration', message: `Livello ${i + 1}: una finestra invade un foro di allineamento.` });
      if (!windows.length) issues.push({ level: 'warning', field: 'amplitude', message: `Livello ${i + 1}: nessuna finestra (motivo fuori dalla sagoma). Il livello sarà pieno.` });
    }
    const layerHoles = [...holes];
    if (i === n - 1 && bool(p, 'light')) {
      const cr = num(p, 'cableDiameter') / 2;
      const cable = { cx: w / 2, cy: h - frame - cr - reg - 2, r: cr };
      if (circleClearanceInPolygon(cable, outline) < reg) issues.push({ level: 'error', field: 'cableDiameter', message: 'Il foro del cavo esce dal fondo.' });
      layerHoles.push(cable);
    }
    for (let k = 0; k + 1 < windows.length; k++) {
      const gap = Math.min(...windows[k + 1].map((v) => v.x)) - Math.max(...windows[k].map((v) => v.x));
      minBridge = Math.min(minBridge, gap);
    }
    for (const c of holes) {
      minHoleGap = Math.min(minHoleGap, circleClearanceInPolygon(c, outline));
      for (const poly of windows) minHoleGap = Math.min(minHoleGap, distToPolygonEdge({ x: c.cx, y: c.cy }, poly) - c.r);
    }
    layers.push({ index: i + 1, windows, holes: layerHoles });
  }
  return { model: { outline, layers, minBridge: Math.min(frame, minBridge), minHoleGap }, issues };
}

function layerSvg(p: Params, m: LayerModel, li: number): string {
  const L = m.layers[li];
  const w = num(p, 'width'), h = num(p, 'height');
  return svgDocument({
    widthMm: w, heightMm: h, title: `INGLY Layer — livello ${L.index} di ${m.layers.length}`,
    description: `Livello ${L.index} (1 = fronte). Spessore ${fmt(num(p, 'thickness'))} mm. Rosso = taglio.`,
    layers: [{ id: `livello-${L.index}`, op: 'cut', paths: [polygonPath(m.outline), ...L.windows.map((q) => polygonPath(q)), ...L.holes.map(circlePath)] }],
  });
}

/** Anteprima della composizione: livelli sovrapposti con tinte per profondità (vettoriale, solo preview). */
function compositionSvg(p: Params, m: LayerModel): string {
  const w = num(p, 'width'), h = num(p, 'height');
  const n = m.layers.length;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(w)}mm" height="${fmt(h)}mm" viewBox="0 0 ${fmt(w)} ${fmt(h)}">`;
  for (let i = n - 1; i >= 0; i--) {
    const L = m.layers[i];
    const t = n === 1 ? 0 : i / (n - 1);
    const light = Math.round(30 + (1 - t) * 50);
    const d = [polygonPath(m.outline), ...L.windows.map((q) => polygonPath(q)), ...L.holes.map(circlePath)].join('');
    s += `<path d="${d}" fill="hsl(43 ${Math.round(40 + t * 40)}% ${light}%)" fill-rule="evenodd" stroke="#111827" stroke-width="0.3"/>`;
  }
  return s + '</svg>';
}

export function runLayers(raw: Params): GeneratorResult {
  const { values: p, issues: pi } = normalizeParams(layerParams, raw, layerDefaults);
  if (hasErrors(pi)) return { views: [], issues: pi, stats: [], exports: [] };
  const { model, issues: gi } = buildLayers(p);
  const issues = [...pi, ...gi];
  const w = num(p, 'width'), h = num(p, 'height');
  const svgs = model.layers.map((_, i) => layerSvg(p, model, i));
  const base = str(p, 'filename');
  const files = () => svgs.map((s, i) => svgFile(s, safeFilename(`${base}-livello-${String(i + 1).padStart(2, '0')}`, 'svg')));
  const exports: ExportOption[] = [
    { id: 'zip', label: `ZIP con ${svgs.length} livelli separati`, requiresValid: true, primary: true, build: async () => zipFile(files(), safeFilename(base, 'zip')) },
    ...svgs.map((_, i) => ({ id: `layer-${i + 1}`, label: `SVG livello ${i + 1}`, requiresValid: true, build: async () => files()[i] })),
  ];
  const views = [
    { id: 'composition', label: 'Composizione', widthMm: w, heightMm: h, svg: compositionSvg(p, model) },
    ...svgs.map((svg, i) => ({ id: `layer-${i + 1}`, label: `Livello ${i + 1}`, widthMm: w, heightMm: h, svg })),
  ];
  const depth = model.layers.length * num(p, 'thickness') + (model.layers.length - 1) * num(p, 'spacer');
  const stats = [
    { label: 'Livelli', value: String(model.layers.length) },
    { label: 'Formato', value: `${fmt(w)} × ${fmt(h)} mm` },
    { label: 'Profondità totale', value: `${fmt(depth)} mm` },
    { label: 'Materiale più sottile', value: `${fmt(model.minBridge)} mm (min ${fmt(num(p, 'minWeb'))})` },
    { label: 'Registrazione fori', value: Number.isFinite(model.minHoleGap) ? `${fmt(model.minHoleGap)} mm dai bordi (min ${fmt(num(p, 'registration'))})` : '—' },
    { label: 'Finestre per livello', value: model.layers.map((l) => l.windows.length).join(' / ') },
  ];
  return { views, issues, stats, exports };
}

export const layerLight: GeneratorDef = {
  id: 'layer-light',
  slug: 'layer-light-generator',
  code: '03',
  title: 'INGLY Layer & Light',
  tagline: 'Quadri multilivello, insegne e lampade a strati con fori di registrazione.',
  params: layerParams,
  defaults: layerDefaults,
  presets: [
    { id: 'landscape', label: 'Paesaggio 200×260', values: { motif: 'landscape', shape: 'rounded', layers: 5 } },
    { id: 'lamp', label: 'Lampada ad arco', values: { motif: 'waves', shape: 'arch', layers: 6, width: 180, height: 240, light: true, frame: 16 } },
    { id: 'tunnel', label: 'Tunnel esagonale', values: { motif: 'tunnel', shape: 'hexagon', layers: 7, width: 240, height: 210, frame: 18, regHoles: '4' } },
  ],
  run: (p) => runLayers(p),
};
