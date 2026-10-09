// GENERATORE 08 — INGLY IMAGE → SVG: vettorializzazione di loghi, disegni e foto in tracciati in mm.
// Bianco/nero (soglia) o a colori (k-means); ogni colore diventa un livello impilato senza fessure:
// il livello i contiene tutti i pixel di colore uguale o più scuro, quindi i livelli si sovrappongono
// come carta stratificata e non lasciano spazi tra un colore e l'altro.
import { dataUrl } from '../core/canvas.ts';
import { safeFilename, svgFile, zipFile } from '../core/export.ts';
import { fmt } from '../core/geometry.ts';
import { bool, hasErrors, normalizeParams, num, str } from '../core/params.ts';
import { type Mask, type Rgba, downscale, hex, newMask, quantize, smoothPath, traceMask, vectorLoops } from '../core/raster.ts';
import { type SvgLayer, svgDocument } from '../core/svg.ts';
import type { ExportOption, GeneratorDef, GeneratorResult, ParamDef, Params, RunContext } from '../core/types.ts';

export const vectorizeParams: ParamDef[] = [
  { key: 'image', label: 'Immagine (PNG, JPG, WebP)', type: 'file', group: 'Sorgente', accept: 'image/png,image/jpeg,image/webp,image/bmp', help: 'Resta sul tuo dispositivo.' },
  { key: 'widthMm', label: 'Larghezza finale', type: 'number', group: 'Sorgente', unit: 'mm', min: 5, max: 2000, step: 0.5 },
  { key: 'mode', label: 'Modalità', type: 'select', group: 'Colori', options: [{ value: 'bw', label: 'Bianco e nero (soglia)' }, { value: 'color', label: 'A colori (livelli)' }] },
  { key: 'threshold', label: 'Soglia', type: 'number', group: 'Colori', min: 1, max: 254, step: 1, visibleIf: (p) => p.mode === 'bw' },
  { key: 'invert', label: 'Inverti (traccia le zone chiare)', type: 'bool', group: 'Colori', visibleIf: (p) => p.mode === 'bw' },
  { key: 'colors', label: 'Numero di colori', type: 'number', group: 'Colori', min: 2, max: 12, step: 1, visibleIf: (p) => p.mode === 'color' },
  { key: 'dropLightest', label: 'Escludi il colore più chiaro (sfondo)', type: 'bool', group: 'Colori', visibleIf: (p) => p.mode === 'color' },
  { key: 'resolution', label: 'Risoluzione di analisi', type: 'number', group: 'Precisione', unit: 'px', min: 200, max: 2000, step: 50, help: 'Lato lungo usato per il tracciamento: più alto = più dettaglio, più lento.' },
  { key: 'speckle', label: 'Elimina macchioline sotto', type: 'number', group: 'Precisione', unit: 'mm²', min: 0, max: 100, step: 0.1 },
  { key: 'tolerance', label: 'Semplificazione', type: 'number', group: 'Precisione', unit: 'px', min: 0.3, max: 5, step: 0.1, help: 'Valori alti = meno nodi, contorni più morbidi.' },
  { key: 'corner', label: 'Soglia spigoli', type: 'number', group: 'Precisione', unit: '°', min: 20, max: 180, step: 5, help: 'Le svolte più nette di questo angolo restano spigoli vivi; 180 = tutto curvo.' },
  {
    key: 'output', label: 'Uscita', type: 'select', group: 'Esportazione',
    options: [{ value: 'fill', label: 'Forme piene (stampa / incisione)' }, { value: 'cut', label: 'Contorni di taglio (rosso)' }, { value: 'engrave', label: 'Riempimento incisione (nero)' }],
  },
  { key: 'filename', label: 'Nome file', type: 'text', group: 'Esportazione', maxLength: 80 },
];

export const vectorizeDefaults: Params = {
  image: '', widthMm: 100, mode: 'bw', threshold: 128, invert: false, colors: 4, dropLightest: true, resolution: 1000, speckle: 0.5, tolerance: 1, corner: 70, output: 'fill', filename: 'ingly-vettoriale',
};

export interface TracedLayer {
  color: string;
  d: string;
  loops: number;
  nodes: number;
}

let memo: { key: string; file: unknown; work: Rgba; labels?: { colors: [number, number, number][]; labels: Int16Array } } | null = null;

/** Livelli vettoriali dell'immagine (coordinate in mm, origine in alto a sinistra). */
export function traceImage(img: Rgba, p: Params): { layers: TracedLayer[]; heightMm: number; work: Rgba } {
  const res = Math.round(num(p, 'resolution'));
  const colorMode = str(p, 'mode') === 'color';
  const key = JSON.stringify([res, colorMode, colorMode ? num(p, 'colors') : 0]);
  if (!memo || memo.file !== img || memo.key !== key) {
    const work = downscale(img, res);
    memo = { key, file: img, work, labels: colorMode ? quantize(work, Math.round(num(p, 'colors'))) : undefined };
  }
  const { work } = memo;
  const scale = num(p, 'widthMm') / work.width;
  const vo = { scale, dx: 0, dy: 0, tolerance: num(p, 'tolerance'), cornerDeg: num(p, 'corner'), minArea: num(p, 'speckle') / (scale * scale) };
  const corner = num(p, 'corner');
  const layers: TracedLayer[] = [];
  const add = (mask: Mask, color: string) => {
    const loops = vectorLoops(traceMask(mask), vo);
    if (loops.length) layers.push({ color, d: smoothPath(loops, corner, 12 * scale), loops: loops.length, nodes: loops.reduce((s, l) => s + l.pts.length, 0) });
  };
  if (!colorMode) {
    const m = newMask(work.width, work.height);
    const t = num(p, 'threshold'), inv = bool(p, 'invert');
    for (let i = 0; i < m.data.length; i++) {
      const a = work.data[i * 4 + 3];
      const l = 0.2126 * work.data[i * 4] + 0.7152 * work.data[i * 4 + 1] + 0.0722 * work.data[i * 4 + 2];
      const dark = l < t;
      m.data[i] = a >= 128 && dark !== inv ? 1 : 0;
    }
    add(m, '#000000');
  } else {
    const { colors, labels } = memo.labels!;
    const start = bool(p, 'dropLightest') ? 1 : 0;
    for (let c = start; c < colors.length; c++) {
      const m = newMask(work.width, work.height);
      for (let i = 0; i < m.data.length; i++) m.data[i] = labels[i] >= c ? 1 : 0;
      add(m, hex(colors[c]));
    }
  }
  return { layers, heightMm: (num(p, 'widthMm') * work.height) / work.width, work };
}

export function runVectorize(raw: Params, ctx: RunContext): GeneratorResult {
  const { values: p, issues } = normalizeParams(vectorizeParams, raw, vectorizeDefaults);
  const file = ctx.files.image;
  if (!file) {
    issues.push({ level: 'error', field: 'image', message: 'Carica un\'immagine da vettorializzare.' });
    return { views: [], issues, stats: [], exports: [] };
  }
  if (hasErrors(issues)) return { views: [], issues, stats: [], exports: [] };
  const img = file.image as unknown as Rgba;
  const { layers, heightMm, work } = traceImage(img, p);
  const W = num(p, 'widthMm');
  if (!layers.length) {
    issues.push({ level: 'error', field: str(p, 'mode') === 'bw' ? 'threshold' : 'colors', message: 'Nessuna forma trovata: regola la soglia o i colori.' });
    return { views: [], issues, stats: [], exports: [] };
  }
  const nodes = layers.reduce((s, l) => s + l.nodes, 0);
  if (nodes > 60000) issues.push({ level: 'warning', field: 'tolerance', message: `File molto complesso (${nodes} nodi): aumenta semplificazione o soglia macchioline.` });
  if (str(p, 'output') === 'cut' && layers.length > 1)
    issues.push({ level: 'info', field: 'output', message: 'Contorni di taglio a colori: un livello per colore, impilati come carta stratificata (uno ZIP con un file per livello).' });
  const out = str(p, 'output');
  const toLayer = (l: TracedLayer, i: number): SvgLayer =>
    out === 'cut' ? { id: `livello-${i + 1}`, op: 'cut', label: `Livello ${i + 1} ${l.color}`, paths: [l.d] }
    : out === 'engrave' ? { id: `livello-${i + 1}`, op: 'engrave', label: `Livello ${i + 1}`, paths: [l.d] }
    : { id: `colore-${i + 1}`, op: 'engrave', label: `Colore ${l.color}`, color: l.color, paths: [l.d] };
  const svg = svgDocument({
    widthMm: W, heightMm, title: 'INGLY Image → SVG', layers: layers.map(toLayer),
    description: `Vettorializzato da ${file.name} (${img.width}×${img.height} px) a ${fmt(W)} mm. ${layers.length} livelli.`,
  });
  const base = str(p, 'filename');
  const layerSvg = (i: number) => svgDocument({ widthMm: W, heightMm, title: `Livello ${i + 1}`, layers: [toLayer(layers[i], i)] });
  const exports: ExportOption[] = [
    { id: 'svg', label: 'SVG completo', requiresValid: true, primary: true, build: async () => svgFile(svg, safeFilename(base, 'svg')) },
  ];
  if (layers.length > 1) exports.push({
    id: 'zip', label: `ZIP con ${layers.length} livelli separati`, requiresValid: true,
    build: async () => zipFile(layers.map((_, i) => svgFile(layerSvg(i), safeFilename(`${base}-livello-${String(i + 1).padStart(2, '0')}`, 'svg'))), safeFilename(base, 'zip')),
  });
  const url = dataUrl(work);
  const original = url
    ? `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(W)}mm" height="${fmt(heightMm)}mm" viewBox="0 0 ${fmt(W)} ${fmt(heightMm)}"><image width="${fmt(W)}" height="${fmt(heightMm)}" preserveAspectRatio="none" href="${url}"/></svg>`
    : undefined;
  return {
    views: [
      { id: 'vector', label: 'Vettoriale', widthMm: W, heightMm, svg },
      ...(original ? [{ id: 'original', label: 'Originale', widthMm: W, heightMm, svg: original }] : []),
    ],
    issues,
    stats: [
      { label: 'Formato', value: `${fmt(W)} × ${fmt(heightMm)} mm` },
      { label: 'Livelli', value: layers.map((l) => l.color).join(' ') },
      { label: 'Tracciati', value: String(layers.reduce((s, l) => s + l.loops, 0)) },
      { label: 'Nodi', value: String(nodes) },
      { label: 'Analisi', value: `${work.width} × ${work.height} px` },
    ],
    exports,
  };
}

export const vectorize: GeneratorDef = {
  id: 'vectorize',
  slug: 'image-to-svg',
  code: '08',
  title: 'INGLY Image → SVG',
  tagline: 'Vettorializza loghi, disegni e foto in SVG in millimetri: bianco e nero o a livelli di colore.',
  params: vectorizeParams,
  defaults: vectorizeDefaults,
  presets: [
    { id: 'logo', label: 'Logo nitido', values: { mode: 'bw', tolerance: 0.8, corner: 60, speckle: 0.3 } },
    { id: 'sketch', label: 'Disegno a mano', values: { mode: 'bw', tolerance: 1.5, corner: 120, speckle: 1 } },
    { id: 'poster', label: 'Poster 4 colori', values: { mode: 'color', colors: 4, tolerance: 1.2, corner: 90 } },
    { id: 'layered', label: 'Carta stratificata', values: { mode: 'color', colors: 5, output: 'cut', tolerance: 1.5, speckle: 2 } },
  ],
  run: (p, ctx) => runVectorize(p, ctx),
};
