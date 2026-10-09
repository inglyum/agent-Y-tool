// GENERATORE 07 — INGLY PRINT & CUT: adesivi, sagomati e gadget stampati e poi tagliati sul contorno.
// Dall'immagine ricava il soggetto (trasparenza o colore di sfondo), genera il contorno di taglio a
// distanza costante, l'abbondanza di stampa, il foglio con più copie e i crocini di registrazione.
// Produce due file allineati sulla stessa tavola in mm: STAMPA (PNG/SVG) e TAGLIO (SVG).
import { canvasPng, dataUrl, hasDom, rgbaCanvas } from '../core/canvas.ts';
import { pngWithDpi, safeFilename, svgFile, zipFile } from '../core/export.ts';
import { type Pt, fmt } from '../core/geometry.ts';
import { nest } from '../core/nesting.ts';
import { bool, hasErrors, normalizeParams, num, str } from '../core/params.ts';
import {
  type Mask, type Rgba, type VectorLoop, close, countFilled, dilate, downscale, fillHoles, hasTransparency, newMask, padMask,
  smoothPath, subjectMask, traceMask, vectorLoops,
} from '../core/raster.ts';
import { svgDocument } from '../core/svg.ts';
import type { ExportOption, GeneratorDef, GeneratorResult, Issue, ParamDef, Params, RunContext } from '../core/types.ts';

const WORK_SIDE = 1200;

export const printCutParams: ParamDef[] = [
  { key: 'image', label: 'Immagine (PNG con trasparenza consigliato)', type: 'file', group: 'Disegno', accept: 'image/png,image/jpeg,image/webp', help: 'Resta sul tuo dispositivo.' },
  { key: 'widthMm', label: 'Larghezza del disegno', type: 'number', group: 'Disegno', unit: 'mm', min: 5, max: 1000, step: 0.5 },
  {
    key: 'subject', label: 'Soggetto', type: 'select', group: 'Disegno',
    options: [{ value: 'auto', label: 'Automatico (trasparenza o sfondo uniforme)' }, { value: 'full', label: 'Tutta l\'immagine (rettangolo)' }],
  },
  { key: 'tolerance', label: 'Tolleranza sfondo', type: 'number', group: 'Disegno', min: 1, max: 200, step: 1, visibleIf: (p) => p.subject === 'auto', help: 'Usata solo se l\'immagine non ha trasparenza.' },
  { key: 'offset', label: 'Distanza del taglio dal disegno', type: 'number', group: 'Contorno di taglio', unit: 'mm', min: 0, max: 30, step: 0.1 },
  { key: 'smooth', label: 'Arrotondamento contorno', type: 'number', group: 'Contorno di taglio', unit: 'mm', min: 0, max: 20, step: 0.1, help: 'Chiude rientranze e fessure più strette del doppio di questo valore: il taglio resta pulito.' },
  { key: 'outerOnly', label: 'Solo contorno esterno (ignora i fori interni)', type: 'bool', group: 'Contorno di taglio' },
  { key: 'border', label: 'Bordo fra disegno e taglio', type: 'select', group: 'Stampa', options: [{ value: 'material', label: 'Colore del materiale (non stampato)' }, { value: 'extend', label: 'Estendi i colori del bordo' }] },
  { key: 'bleed', label: 'Abbondanza oltre il taglio', type: 'number', group: 'Stampa', unit: 'mm', min: 0, max: 5, step: 0.1, help: 'La stampa supera la linea di taglio: piccoli disallineamenti non lasciano filetti bianchi.' },
  { key: 'dpi', label: 'Risoluzione file di stampa', type: 'number', group: 'Stampa', unit: 'DPI', min: 72, max: 1200, step: 1 },
  { key: 'sheetW', label: 'Larghezza foglio', type: 'number', group: 'Foglio', unit: 'mm', min: 30, max: 2000, step: 1 },
  { key: 'sheetH', label: 'Altezza foglio', type: 'number', group: 'Foglio', unit: 'mm', min: 30, max: 2000, step: 1 },
  { key: 'copies', label: 'Copie', type: 'number', group: 'Foglio', min: 1, max: 500, step: 1 },
  { key: 'spacing', label: 'Distanza fra le copie', type: 'number', group: 'Foglio', unit: 'mm', min: 0, max: 50, step: 0.5 },
  { key: 'marks', label: 'Crocini di registrazione', type: 'select', group: 'Registrazione', options: [{ value: '3', label: '3 angoli (orientamento univoco)' }, { value: '4', label: '4 angoli' }, { value: '0', label: 'Nessuno' }] },
  { key: 'markSize', label: 'Lato del crocino', type: 'number', group: 'Registrazione', unit: 'mm', min: 2, max: 20, step: 0.5, visibleIf: (p) => p.marks !== '0' },
  { key: 'markInset', label: 'Distanza crocini dal bordo foglio', type: 'number', group: 'Registrazione', unit: 'mm', min: 0, max: 50, step: 0.5, visibleIf: (p) => p.marks !== '0' },
  { key: 'filename', label: 'Nome file', type: 'text', group: 'Esportazione', maxLength: 80 },
];

export const printCutDefaults: Params = {
  image: '', widthMm: 60, subject: 'auto', tolerance: 40, offset: 2, smooth: 1.5, outerOnly: true, border: 'material', bleed: 1, dpi: 300,
  sheetW: 210, sheetH: 297, copies: 6, spacing: 4, marks: '3', markSize: 5, markInset: 8, filename: 'ingly-sticker',
};

export interface StickerModel {
  /** dimensioni dell'adesivo (riquadro del contorno di taglio), mm */
  w: number;
  h: number;
  /** contorno di taglio e area di stampa, in coordinate locali dell'adesivo (mm) */
  cutLoops: VectorLoop[];
  cutPath: string;
  clipPath: string;
  /** posizione/dimensione del disegno originale nelle coordinate locali */
  art: { x: number; y: number; w: number; h: number };
  /** strato del bordo esteso (risoluzione di lavoro) e sua posizione */
  borderLayer: { img: Rgba; x: number; y: number; w: number; h: number } | null;
  /** anteprima a bassa risoluzione del disegno */
  preview: Rgba;
  subjectPx: number;
  touchesEdge: boolean;
}

/** Colori propagati verso l'esterno (BFS multi-sorgente) dentro la regione indicata. */
export function extendColors(img: Rgba, src: Mask, region: Mask, pad: number): Rgba {
  const W = src.w, H = src.h;
  const out = new Uint8ClampedArray(W * H * 4);
  const seen = new Uint8Array(W * H);
  let q: number[] = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const ix = x - pad, iy = y - pad;
      if (src.data[i] && ix >= 0 && iy >= 0 && ix < img.width && iy < img.height) {
        const s = (iy * img.width + ix) * 4;
        out.set([img.data[s], img.data[s + 1], img.data[s + 2], 255], i * 4);
        seen[i] = 1;
        q.push(i);
      }
    }
  while (q.length) {
    const next: number[] = [];
    for (const i of q) {
      const x = i % W, y = (i / W) | 0;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) {
        if (j < 0 || seen[j] || !region.data[j]) continue;
        seen[j] = 1;
        out[j * 4] = out[i * 4]; out[j * 4 + 1] = out[i * 4 + 1]; out[j * 4 + 2] = out[i * 4 + 2]; out[j * 4 + 3] = 255;
        next.push(j);
      }
    }
    q = next;
  }
  return { width: W, height: H, data: out };
}

let memo: { key: string; file: unknown; model: StickerModel | null; issues: Issue[] } | null = null;

export function analyzeSticker(img: Rgba, p: Params): { model: StickerModel | null; issues: Issue[] } {
  const keys = ['widthMm', 'subject', 'tolerance', 'offset', 'smooth', 'outerOnly', 'border', 'bleed'];
  const key = JSON.stringify(keys.map((k) => p[k]));
  if (memo && memo.file === img && memo.key === key) return { model: memo.model, issues: memo.issues };
  const issues: Issue[] = [];
  const work = downscale(img, WORK_SIDE);
  const scale = num(p, 'widthMm') / work.width;
  const offset = num(p, 'offset'), smooth = num(p, 'smooth'), bleed = num(p, 'bleed');
  const pad = Math.ceil((offset + smooth + bleed) / scale) + 3;
  let subj: Mask;
  if (str(p, 'subject') === 'full') {
    subj = newMask(work.width, work.height);
    subj.data.fill(1);
  } else subj = subjectMask(work, num(p, 'tolerance'));
  const subjectPx = countFilled(subj);
  let touchesEdge = false;
  for (let x = 0; x < work.width && !touchesEdge; x++) touchesEdge = !!(subj.data[x] || subj.data[(work.height - 1) * work.width + x]);
  for (let y = 0; y < work.height && !touchesEdge; y++) touchesEdge = !!(subj.data[y * work.width] || subj.data[y * work.width + work.width - 1]);
  if (subjectPx < 20) {
    issues.push({ level: 'error', field: 'tolerance', message: 'Soggetto non trovato: usa un PNG con sfondo trasparente oppure regola la tolleranza.' });
    const r = { model: null, issues };
    memo = { key, file: img, ...r };
    return r;
  }
  if (touchesEdge && str(p, 'subject') === 'auto' && !hasTransparency(work))
    issues.push({ level: 'warning', field: 'tolerance', message: 'Il soggetto tocca il bordo dell\'immagine: lo sfondo potrebbe non essere stato riconosciuto.' });
  const base = padMask(bool(p, 'outerOnly') ? fillHoles(subj) : subj, pad);
  const cut = close(dilate(base, offset / scale), smooth / scale);
  // il contorno di taglio deve comunque contenere il soggetto
  for (let i = 0; i < base.data.length; i++) if (base.data[i] && !cut.data[i]) cut.data[i] = 1;
  const vo = { scale, dx: -pad * scale, dy: -pad * scale, tolerance: 0.7, cornerDeg: 100, minArea: 1 / (scale * scale) };
  let loops = vectorLoops(traceMask(cut), vo);
  if (bool(p, 'outerOnly')) loops = loops.filter((l) => l.area > 0);
  const clipLoops = vectorLoops(traceMask(dilate(cut, bleed / scale)), vo).filter((l) => l.area > 0);
  const xs = loops.flatMap((l) => l.pts.map((q) => q.x)), ys = loops.flatMap((l) => l.pts.map((q) => q.y));
  const bx = Math.min(...xs), by = Math.min(...ys);
  const shift = (ls: VectorLoop[]) => ls.map((l) => ({ ...l, pts: l.pts.map((q) => ({ x: q.x - bx, y: q.y - by })) }));
  const cutLoops = shift(loops);
  const artH = (num(p, 'widthMm') * img.height) / img.width;
  let borderLayer: StickerModel['borderLayer'] = null;
  if (str(p, 'border') === 'extend') {
    const region = dilate(cut, bleed / scale + 1);
    borderLayer = { img: extendColors(work, base, region, pad), x: -pad * scale - bx, y: -pad * scale - by, w: base.w * scale, h: base.h * scale };
  } else if (offset < 0.5 && str(p, 'subject') === 'auto') {
    issues.push({ level: 'warning', field: 'border', message: 'Taglio quasi sul bordo del disegno: scegli "Estendi i colori del bordo" per evitare filetti bianchi.' });
  }
  const model: StickerModel = {
    w: Math.max(...xs) - bx, h: Math.max(...ys) - by, cutLoops, cutPath: smoothPath(cutLoops, 100), clipPath: smoothPath(shift(clipLoops), 100),
    art: { x: -bx, y: -by, w: num(p, 'widthMm'), h: artH }, borderLayer, preview: downscale(img, 900), subjectPx, touchesEdge,
  };
  memo = { key, file: img, model, issues };
  return { model, issues };
}

function perimeter(ls: VectorLoop[]): number {
  let s = 0;
  for (const { pts } of ls) for (let i = 0; i < pts.length; i++) s += Math.hypot(pts[(i + 1) % pts.length].x - pts[i].x, pts[(i + 1) % pts.length].y - pts[i].y);
  return s;
}

function marks(p: Params): { x: number; y: number; s: number }[] {
  const n = Number(str(p, 'marks'));
  if (!n) return [];
  const s = num(p, 'markSize'), i = num(p, 'markInset'), W = num(p, 'sheetW'), H = num(p, 'sheetH');
  const all = [{ x: i, y: i, s }, { x: W - i - s, y: i, s }, { x: i, y: H - i - s, s }, { x: W - i - s, y: H - i - s, s }];
  return n === 3 ? all.slice(0, 3) : all;
}

const sq = (m: { x: number; y: number; s: number }) => `M${fmt(m.x)} ${fmt(m.y)}H${fmt(m.x + m.s)}V${fmt(m.y + m.s)}H${fmt(m.x)}Z`;
const moved = (ls: VectorLoop[], dx: number, dy: number): VectorLoop[] => ls.map((l) => ({ ...l, pts: l.pts.map((q) => ({ x: q.x + dx, y: q.y + dy })) }));

function printRaw(m: StickerModel, places: Pt[], art: Rgba, withBorder: boolean): string {
  const artUrl = dataUrl(art);
  if (!artUrl) return '';
  let r = `<defs><clipPath id="ingly-clip" clipPathUnits="userSpaceOnUse"><path d="${m.clipPath}"/></clipPath>`;
  r += '<g id="ingly-sticker" clip-path="url(#ingly-clip)">';
  if (withBorder && m.borderLayer) {
    const u = dataUrl(m.borderLayer.img);
    const b = m.borderLayer;
    r += `<image x="${fmt(b.x)}" y="${fmt(b.y)}" width="${fmt(b.w)}" height="${fmt(b.h)}" preserveAspectRatio="none" href="${u}" xlink:href="${u}"/>`;
  }
  r += `<image x="${fmt(m.art.x)}" y="${fmt(m.art.y)}" width="${fmt(m.art.w)}" height="${fmt(m.art.h)}" preserveAspectRatio="none" href="${artUrl}" xlink:href="${artUrl}"/>`;
  r += '</g></defs>\n';
  for (const q of places) r += `<use href="#ingly-sticker" xlink:href="#ingly-sticker" x="${fmt(q.x)}" y="${fmt(q.y)}"/>\n`;
  return r;
}

export function runPrintCut(raw: Params, ctx: RunContext): GeneratorResult {
  const { values: p, issues } = normalizeParams(printCutParams, raw, printCutDefaults);
  issues.push({ level: 'info', message: 'Stampa il file STAMPA in scala 100%, poi allinea il file TAGLIO con i crocini o con la telecamera della macchina.' });
  const file = ctx.files.image;
  if (!file) {
    issues.push({ level: 'error', field: 'image', message: 'Carica un\'immagine (meglio un PNG con sfondo trasparente).' });
    return { views: [], issues, stats: [], exports: [] };
  }
  if (hasErrors(issues)) return { views: [], issues, stats: [], exports: [] };
  const img = file.image as unknown as Rgba;
  const { model: m, issues: ai } = analyzeSticker(img, p);
  issues.push(...ai);
  if (!m) return { views: [], issues, stats: [], exports: [] };

  const ppi = img.width / (num(p, 'widthMm') / 25.4);
  if (ppi < 150) issues.push({ level: 'warning', field: 'widthMm', message: `Risoluzione bassa per la stampa: ${Math.round(ppi)} pixel per pollice a questa misura (consigliati almeno 200).` });
  const shapes = m.cutLoops.filter((l) => l.area > 0).length;
  if (shapes > 1) issues.push({ level: 'info', field: 'smooth', message: `${shapes} sagome separate: aumenta l'arrotondamento per unirle in un unico adesivo.` });

  const W = num(p, 'sheetW'), H = num(p, 'sheetH');
  const mk = marks(p);
  const inset = mk.length ? num(p, 'markInset') + num(p, 'markSize') + Math.max(2, num(p, 'spacing')) : Math.max(2, num(p, 'spacing'));
  const copies = Math.round(num(p, 'copies'));
  const res = nest([{ id: 's', name: 'Adesivo', w: m.w, h: m.h, qty: copies, canRotate: false }], { sheetW: W, sheetH: H, margin: inset, spacing: num(p, 'spacing'), kerf: 0, maxSheets: 1 });
  if (!res.placed.length) {
    issues.push({ level: 'error', field: 'widthMm', message: `L'adesivo (${fmt(m.w)} × ${fmt(m.h)} mm) non entra nell'area utile del foglio.` });
    return { views: [], issues, stats: [], exports: [] };
  }
  const placed = res.placed.length;
  if (placed < copies) issues.push({ level: 'warning', field: 'copies', message: `Nel foglio entrano ${placed} copie su ${copies}.` });
  const places = res.placed.map((q) => ({ x: q.x, y: q.y }));
  const cutPaths = places.map((q) => smoothPath(moved(m.cutLoops, q.x, q.y), 100));
  const markPaths = mk.map(sq);
  const base = str(p, 'filename');
  const desc = `Foglio ${fmt(W)}×${fmt(H)} mm, ${placed} copie da ${fmt(m.w)}×${fmt(m.h)} mm. Taglio a ${fmt(num(p, 'offset'))} mm dal disegno.`;

  const cutSvg = svgDocument({
    widthMm: W, heightMm: H, title: 'INGLY Print & Cut — TAGLIO', description: `${desc} Rosso = taglio; azzurro = crocini di riferimento (non tagliare).`,
    layers: [{ id: 'taglio', op: 'cut', paths: cutPaths }, { id: 'crocini', op: 'guide', label: 'Crocini di registrazione (riferimento)', paths: markPaths }],
  });
  const printSvg = (art: Rgba) => svgDocument({
    widthMm: W, heightMm: H, title: 'INGLY Print & Cut — STAMPA', description: `${desc} Stampare in scala 100%.`, raw: printRaw(m, places, art, true),
    layers: [{ id: 'crocini', op: 'engrave', label: 'Crocini di registrazione (stampa)', paths: markPaths }],
  });
  const previewSvg = svgDocument({
    widthMm: W, heightMm: H, title: 'Anteprima stampa e taglio', raw: printRaw(m, places, m.preview, true),
    layers: [{ id: 'crocini', op: 'engrave', paths: markPaths }, { id: 'taglio', op: 'cut', paths: cutPaths }],
  });

  const dpi = num(p, 'dpi');
  const pxW = Math.round((W / 25.4) * dpi), pxH = Math.round((H / 25.4) * dpi);
  const printPng = async () => {
    if (!hasDom()) throw new Error('Esportazione PNG disponibile solo nel browser.');
    if (pxW * pxH > 80_000_000) throw new Error(`Foglio troppo grande a ${dpi} DPI (${pxW}×${pxH} px): riduci la risoluzione.`);
    const c = document.createElement('canvas');
    c.width = pxW;
    c.height = pxH;
    const g = c.getContext('2d')!;
    const k = dpi / 25.4;
    g.scale(k, k);
    const art = rgbaCanvas(img);
    const border = m.borderLayer ? rgbaCanvas(m.borderLayer.img) : null;
    const clip = new Path2D(m.clipPath);
    for (const q of places) {
      g.save();
      g.translate(q.x, q.y);
      g.clip(clip);
      if (border && m.borderLayer) g.drawImage(border, m.borderLayer.x, m.borderLayer.y, m.borderLayer.w, m.borderLayer.h);
      g.drawImage(art, m.art.x, m.art.y, m.art.w, m.art.h);
      g.restore();
    }
    g.fillStyle = '#000';
    for (const q of mk) g.fillRect(q.x, q.y, q.s, q.s);
    return { filename: safeFilename(`${base}-stampa`, 'png'), blob: new Blob([pngWithDpi(await canvasPng(c), dpi)], { type: 'image/png' }) };
  };
  const cutFile = () => svgFile(cutSvg, safeFilename(`${base}-taglio`, 'svg'));
  const printSvgFile = () => svgFile(printSvg(img), safeFilename(`${base}-stampa`, 'svg'));
  const exports: ExportOption[] = [
    { id: 'zip', label: 'ZIP: stampa (PNG + SVG) + taglio (SVG)', requiresValid: true, primary: true, build: async () => zipFile([await printPng(), printSvgFile(), cutFile()], safeFilename(base, 'zip')) },
    { id: 'cut', label: 'SVG di taglio', requiresValid: true, build: async () => cutFile() },
    { id: 'print-png', label: `PNG di stampa ${pxW}×${pxH} px a ${fmt(dpi)} DPI`, requiresValid: true, build: printPng },
    { id: 'print-svg', label: 'SVG di stampa (immagine incorporata)', requiresValid: true, build: async () => printSvgFile() },
  ];
  return {
    views: [
      { id: 'sheet', label: 'Stampa + taglio', widthMm: W, heightMm: H, svg: previewSvg },
      { id: 'cut', label: 'File di taglio', widthMm: W, heightMm: H, svg: cutSvg },
    ],
    issues,
    stats: [
      { label: 'Adesivo', value: `${fmt(m.w)} × ${fmt(m.h)} mm` },
      { label: 'Copie nel foglio', value: `${placed} / ${copies}` },
      { label: 'Lunghezza di taglio', value: `${fmt(perimeter(m.cutLoops) * placed / 1000)} m` },
      { label: 'Risoluzione disegno', value: `${Math.round(ppi)} ppi a questa misura` },
      { label: 'Sagome', value: String(shapes) },
      { label: 'Bordo stampato', value: m.borderLayer ? `colori estesi + ${fmt(num(p, 'bleed'))} mm di abbondanza` : 'colore del materiale' },
    ],
    exports,
  };
}

export const printCut: GeneratorDef = {
  id: 'print-cut',
  slug: 'print-and-cut',
  code: '07',
  title: 'INGLY Print & Cut',
  tagline: 'Adesivi e sagomati: contorno di taglio automatico, abbondanza, crocini e foglio pronto.',
  params: printCutParams,
  defaults: printCutDefaults,
  presets: [
    { id: 'stickers-a4', label: 'Adesivi A4', values: { sheetW: 210, sheetH: 297, widthMm: 60, copies: 6, offset: 2, border: 'material' } },
    { id: 'die-cut', label: 'Taglio a filo (bordo esteso)', values: { offset: 0.3, border: 'extend', bleed: 1.5, smooth: 1 } },
    { id: 'magnet', label: 'Magneti 80 mm', values: { widthMm: 80, offset: 3, smooth: 4, copies: 4 } },
    { id: 'xtool-uv', label: 'Foglio 300×200', values: { sheetW: 300, sheetH: 200, copies: 8, widthMm: 50 } },
  ],
  run: (p, ctx) => runPrintCut(p, ctx),
};
