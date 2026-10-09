// GENERATORE 05 — INGLY IMAGE PREP: preparazione di immagini per incisione e stampa.
// Tutto avviene nel browser: l'immagine non viene mai inviata a servizi esterni.
// I filtri sono elaborazioni grafiche, non parametri macchina certificati.
import { pngWithDpi, safeFilename } from '../core/export.ts';
import { fmt } from '../core/geometry.ts';
import { bool, hasErrors, normalizeParams, num, str } from '../core/params.ts';
import type { ExportOption, GeneratorDef, GeneratorResult, ParamDef, Params, RunContext } from '../core/types.ts';

export interface Raster {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export const MAX_OUTPUT_PIXELS = 40_000_000;
export const MAX_OUTPUT_SIDE = 12_000;

export const imageParams: ParamDef[] = [
  { key: 'image', label: 'Immagine (PNG, JPG, WebP)', type: 'file', group: 'Sorgente', accept: 'image/png,image/jpeg,image/webp,image/bmp', help: 'Resta sul tuo dispositivo. Massimo 25 MB.' },
  { key: 'widthMm', label: 'Larghezza di stampa', type: 'number', group: 'Dimensioni', unit: 'mm', min: 5, max: 2000, step: 0.5 },
  { key: 'dpi', label: 'Risoluzione', type: 'number', group: 'Dimensioni', unit: 'DPI', min: 50, max: 1200, step: 1 },
  { key: 'brightness', label: 'Luminosità', type: 'number', group: 'Regolazioni', min: -100, max: 100, step: 1 },
  { key: 'contrast', label: 'Contrasto', type: 'number', group: 'Regolazioni', min: -100, max: 100, step: 1 },
  { key: 'gamma', label: 'Gamma', type: 'number', group: 'Regolazioni', min: 0.2, max: 5, step: 0.05 },
  { key: 'invert', label: 'Inverti (negativo)', type: 'bool', group: 'Regolazioni', help: 'Utile per vetro, ardesia o materiali scuri.' },
  {
    key: 'mode', label: 'Modalità', type: 'select', group: 'Conversione',
    options: [
      { value: 'gray', label: 'Scala di grigi' }, { value: 'threshold', label: 'Soglia (bianco/nero)' },
      { value: 'floyd', label: 'Dithering Floyd–Steinberg' }, { value: 'atkinson', label: 'Dithering Atkinson' },
      { value: 'bayer4', label: 'Dithering ordinato Bayer 4×4' }, { value: 'bayer8', label: 'Dithering ordinato Bayer 8×8' },
      { value: 'halftone', label: 'Retino a punti' },
    ],
  },
  { key: 'threshold', label: 'Soglia', type: 'number', group: 'Conversione', min: 1, max: 254, step: 1, visibleIf: (p) => p.mode === 'threshold' },
  { key: 'lpi', label: 'Lineatura retino', type: 'number', group: 'Conversione', unit: 'LPI', min: 5, max: 150, step: 1, visibleIf: (p) => p.mode === 'halftone' },
  { key: 'angle', label: 'Angolo retino', type: 'number', group: 'Conversione', unit: '°', min: 0, max: 90, step: 1, visibleIf: (p) => p.mode === 'halftone' },
  { key: 'filename', label: 'Nome file', type: 'text', group: 'Esportazione', maxLength: 80 },
];

export const imageDefaults: Params = {
  image: '', widthMm: 100, dpi: 254, brightness: 0, contrast: 0, gamma: 1, invert: false, mode: 'floyd', threshold: 128, lpi: 40, angle: 45, filename: 'ingly-immagine',
};

export function outputSize(srcW: number, srcH: number, widthMm: number, dpi: number): { w: number; h: number; heightMm: number } {
  const w = Math.max(1, Math.round((widthMm / 25.4) * dpi));
  const h = Math.max(1, Math.round((w * srcH) / srcW));
  return { w, h, heightMm: (h / dpi) * 25.4 };
}

/** Ricampionamento a media d'area (riduzione) / bilineare (ingrandimento) in scala di grigi Rec.709. */
export function resizeGray(src: Raster, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  const sx = src.width / w, sy = src.height / h;
  const lum = (i: number) => {
    const a = src.data[i + 3] / 255;
    // la trasparenza diventa bianco (nessuna lavorazione)
    return (0.2126 * src.data[i] + 0.7152 * src.data[i + 1] + 0.0722 * src.data[i + 2]) * a + 255 * (1 - a);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (sx >= 1 && sy >= 1) {
        const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
        const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
        let s = 0, n = 0;
        for (let yy = y0; yy < y1 && yy < src.height; yy++)
          for (let xx = x0; xx < x1 && xx < src.width; xx++) {
            s += lum((yy * src.width + xx) * 4);
            n++;
          }
        out[y * w + x] = n ? s / n : 255;
      } else {
        const fx = Math.min(src.width - 1, Math.max(0, (x + 0.5) * sx - 0.5));
        const fy = Math.min(src.height - 1, Math.max(0, (y + 0.5) * sy - 0.5));
        const ix = Math.floor(fx), iy = Math.floor(fy);
        const ax = fx - ix, ay = fy - iy;
        const ix1 = Math.min(src.width - 1, ix + 1), iy1 = Math.min(src.height - 1, iy + 1);
        const p00 = lum((iy * src.width + ix) * 4), p10 = lum((iy * src.width + ix1) * 4);
        const p01 = lum((iy1 * src.width + ix) * 4), p11 = lum((iy1 * src.width + ix1) * 4);
        out[y * w + x] = (p00 * (1 - ax) + p10 * ax) * (1 - ay) + (p01 * (1 - ax) + p11 * ax) * ay;
      }
    }
  }
  return out;
}

export function adjust(g: Float32Array, brightness: number, contrast: number, gamma: number, invert: boolean): Float32Array {
  const out = new Float32Array(g.length);
  const c = contrast / 100;
  const k = c >= 0 ? 1 / Math.max(0.01, 1 - c) : 1 + c;
  for (let i = 0; i < g.length; i++) {
    let v = g[i] / 255 + brightness / 200;
    v = (v - 0.5) * k + 0.5;
    v = Math.min(1, Math.max(0, v));
    v = Math.pow(v, 1 / gamma);
    if (invert) v = 1 - v;
    out[i] = v * 255;
  }
  return out;
}

export function thresholdOp(g: Float32Array, t: number): Uint8Array {
  const o = new Uint8Array(g.length);
  for (let i = 0; i < g.length; i++) o[i] = g[i] >= t ? 255 : 0;
  return o;
}

export function errorDiffusion(g: Float32Array, w: number, h: number, kind: 'floyd' | 'atkinson'): Uint8Array {
  const buf = Float32Array.from(g);
  const o = new Uint8Array(g.length);
  const kernel = kind === 'floyd'
    ? [[1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16]]
    : [[1, 0, 1 / 8], [2, 0, 1 / 8], [-1, 1, 1 / 8], [0, 1, 1 / 8], [1, 1, 1 / 8], [0, 2, 1 / 8]];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const v = buf[i] >= 128 ? 255 : 0;
      o[i] = v;
      const err = buf[i] - v;
      for (const [dx, dy, f] of kernel) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && xx < w && yy < h) buf[yy * w + xx] += err * f;
      }
    }
  return o;
}

function bayerMatrix(n: number): number[][] {
  let m = [[0, 2], [3, 1]];
  while (m.length < n) {
    const s = m.length;
    const next: number[][] = Array.from({ length: s * 2 }, () => new Array(s * 2).fill(0));
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        const v = 4 * m[y][x];
        next[y][x] = v;
        next[y][x + s] = v + 2;
        next[y + s][x] = v + 3;
        next[y + s][x + s] = v + 1;
      }
    m = next;
  }
  return m;
}

export function ordered(g: Float32Array, w: number, h: number, n: 4 | 8): Uint8Array {
  const m = bayerMatrix(n);
  const o = new Uint8Array(g.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const t = ((m[y % n][x % n] + 0.5) / (n * n)) * 255;
      o[y * w + x] = g[y * w + x] >= t ? 255 : 0;
    }
  return o;
}

/** Retino ad ampiezza modulata: punti neri la cui area è proporzionale al tono della cella. */
export function halftone(g: Float32Array, w: number, h: number, cellPx: number, angleDeg: number): Uint8Array {
  const o = new Uint8Array(g.length);
  const a = (angleDeg * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
  const sample = (x: number, y: number) => g[Math.min(h - 1, Math.max(0, Math.round(y))) * w + Math.min(w - 1, Math.max(0, Math.round(x)))];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const u = x * ca + y * sa, v = -x * sa + y * ca;
      const cu = (Math.floor(u / cellPx) + 0.5) * cellPx, cv = (Math.floor(v / cellPx) + 0.5) * cellPx;
      const cx = cu * ca - cv * sa, cy = cu * sa + cv * ca;
      const dark = 1 - sample(cx, cy) / 255;
      const r = cellPx * Math.sqrt(dark / Math.PI);
      o[y * w + x] = Math.hypot(u - cu, v - cv) <= r ? 0 : 255;
    }
  return o;
}

export function process(src: Raster, p: Params): { gray: Uint8Array; w: number; h: number; heightMm: number } {
  const { w, h, heightMm } = outputSize(src.width, src.height, num(p, 'widthMm'), num(p, 'dpi'));
  const g = adjust(resizeGray(src, w, h), num(p, 'brightness'), num(p, 'contrast'), num(p, 'gamma'), bool(p, 'invert'));
  const mode = str(p, 'mode');
  let out: Uint8Array;
  if (mode === 'threshold') out = thresholdOp(g, num(p, 'threshold'));
  else if (mode === 'floyd' || mode === 'atkinson') out = errorDiffusion(g, w, h, mode);
  else if (mode === 'bayer4') out = ordered(g, w, h, 4);
  else if (mode === 'bayer8') out = ordered(g, w, h, 8);
  else if (mode === 'halftone') out = halftone(g, w, h, Math.max(2, num(p, 'dpi') / num(p, 'lpi')), num(p, 'angle'));
  else out = Uint8Array.from(g, (v) => Math.round(v));
  return { gray: out, w, h, heightMm };
}

function toImageData(gray: Uint8Array, w: number, h: number): ImageData {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < gray.length; i++) {
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = gray[i];
    d[i * 4 + 3] = 255;
  }
  return new ImageData(d, w, h);
}

async function encodePng(img: ImageData): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  canvas.getContext('2d')!.putImageData(img, 0, 0);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) throw new Error('Il browser non è riuscito a codificare il PNG (immagine troppo grande?).');
  return new Uint8Array(await blob.arrayBuffer());
}

export function runImagePrep(raw: Params, ctx: RunContext): GeneratorResult {
  const { values: p, issues } = normalizeParams(imageParams, raw, imageDefaults);
  issues.push({ level: 'info', message: 'Elaborazione grafica locale: non sostituisce i test di potenza e velocità sul tuo materiale.' });
  const file = ctx.files.image;
  if (!file) {
    issues.push({ level: 'error', field: 'image', message: 'Carica un\'immagine per iniziare.' });
    return { views: [], issues, stats: [], exports: [] };
  }
  if (hasErrors(issues)) return { views: [], issues, stats: [], exports: [] };
  const { w, h } = outputSize(file.image.width, file.image.height, num(p, 'widthMm'), num(p, 'dpi'));
  if (w * h > MAX_OUTPUT_PIXELS || w > MAX_OUTPUT_SIDE || h > MAX_OUTPUT_SIDE) {
    issues.push({ level: 'error', field: 'dpi', message: `Risultato troppo grande (${w}×${h} px): riduci larghezza o DPI.` });
    return { views: [], issues, stats: [], exports: [] };
  }
  const res = process(file.image, p);
  const mm = num(p, 'widthMm');
  const srcPpi = file.image.width / (mm / 25.4);
  if (srcPpi < num(p, 'dpi') * 0.5) issues.push({ level: 'warning', field: 'dpi', message: `L'originale ha solo ${Math.round(srcPpi)} pixel per pollice a questa misura: il dettaglio verrà interpolato.` });
  const after = toImageData(res.gray, res.w, res.h);
  const dpi = num(p, 'dpi');
  const exports: ExportOption[] = [{
    id: 'png', label: `PNG ${res.w}×${res.h} px a ${fmt(dpi)} DPI`, requiresValid: true, primary: true,
    build: async () => ({ filename: safeFilename(str(p, 'filename'), 'png', 'ingly-immagine'), blob: new Blob([pngWithDpi(await encodePng(after), dpi)], { type: 'image/png' }) }),
  }];
  return {
    views: [
      { id: 'after', label: 'Dopo', widthMm: mm, heightMm: res.heightMm, image: after },
      { id: 'before', label: 'Prima', widthMm: mm, heightMm: res.heightMm, image: file.image },
    ],
    issues,
    stats: [
      { label: 'Sorgente', value: `${file.image.width} × ${file.image.height} px` },
      { label: 'Uscita', value: `${res.w} × ${res.h} px` },
      { label: 'Formato', value: `${fmt(mm)} × ${fmt(res.heightMm)} mm @ ${fmt(dpi)} DPI` },
    ],
    exports,
  };
}

export const imagePrep: GeneratorDef = {
  id: 'image-prep',
  slug: 'image-prep',
  code: '05',
  title: 'INGLY Image Prep',
  tagline: 'Scala di grigi, soglia, dithering e retino in millimetri e DPI, tutto in locale.',
  params: imageParams,
  defaults: imageDefaults,
  presets: [
    { id: 'wood', label: 'Foto su legno', values: { mode: 'floyd', dpi: 254, contrast: 15, gamma: 1.2 } },
    { id: 'slate', label: 'Ardesia (negativo)', values: { mode: 'atkinson', invert: true, dpi: 254 } },
    { id: 'logo', label: 'Logo netto', values: { mode: 'threshold', threshold: 128, dpi: 500 } },
    { id: 'print', label: 'Retino stampa', values: { mode: 'halftone', lpi: 40, angle: 45, dpi: 300 } },
  ],
  run: (p, ctx) => runImagePrep(p, ctx),
};
