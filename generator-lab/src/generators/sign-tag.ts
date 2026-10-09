// GENERATORE 01 — INGLY SIGN & TAG: targhette, portachiavi e insegne.
import { safeFilename, svgFile, zipFile } from '../core/export.ts';
import { FONTS, missingGlyphs, textToPath } from '../core/fonts.ts';
import {
  type Circle, type CornerStyle, type Rect, circlePath, circleClearanceInPolygon, circlesGap, distToPolygonEdge, fmt,
  rectsOverlap, roundedRectPath, roundedRectPolygon,
} from '../core/geometry.ts';
import { bool, hasErrors, normalizeParams, num, str } from '../core/params.ts';
import { type SvgLayer, svgDocument } from '../core/svg.ts';
import type { ExportOption, GeneratorDef, GeneratorResult, Issue, ParamDef, Params } from '../core/types.ts';

const FONT_FAMILY: Record<string, string> = {
  montserrat: 'Montserrat',
  oswald: 'Oswald',
  playfair: 'Playfair Display',
  greatvibes: 'Great Vibes',
};

const always = () => true;

export const signTagParams: ParamDef[] = [
  { key: 'width', label: 'Larghezza', type: 'number', group: 'Forma', unit: 'mm', min: 10, max: 1200, step: 0.5 },
  { key: 'height', label: 'Altezza', type: 'number', group: 'Forma', unit: 'mm', min: 8, max: 1200, step: 0.5 },
  {
    key: 'corner', label: 'Angoli', type: 'select', group: 'Forma',
    options: [{ value: 'round', label: 'Raccordati' }, { value: 'chamfer', label: 'Smussati' }, { value: 'square', label: 'Vivi' }],
  },
  { key: 'radius', label: 'Raggio / smusso', type: 'number', group: 'Forma', unit: 'mm', min: 0, max: 600, step: 0.5, visibleIf: (p) => p.corner !== 'square' },
  { key: 'thickness', label: 'Spessore materiale', type: 'number', group: 'Forma', unit: 'mm', min: 0.1, max: 30, step: 0.1, help: 'Usato per i controlli di robustezza dei fori.' },

  { key: 'line1', label: 'Testo riga 1', type: 'text', group: 'Testo', maxLength: 60 },
  { key: 'line2', label: 'Testo riga 2', type: 'text', group: 'Testo', maxLength: 60 },
  { key: 'font', label: 'Font', type: 'select', group: 'Testo', options: FONTS.map((f) => ({ value: f.id, label: f.label })) },
  { key: 'fit', label: 'Adatta il testo all\'area sicura', type: 'bool', group: 'Testo' },
  { key: 'textSize', label: 'Corpo del testo (max)', type: 'number', group: 'Testo', unit: 'mm', min: 1, max: 400, step: 0.5 },
  {
    key: 'align', label: 'Allineamento', type: 'select', group: 'Testo',
    options: [{ value: 'start', label: 'Sinistra' }, { value: 'middle', label: 'Centro' }, { value: 'end', label: 'Destra' }],
  },
  {
    key: 'textMode', label: 'Formato del testo', type: 'select', group: 'Testo',
    options: [{ value: 'paths', label: 'Tracciati vettoriali (consigliato)' }, { value: 'live', label: 'Testo modificabile (richiede il font installato)' }],
  },
  {
    key: 'textOp', label: 'Lavorazione del testo', type: 'select', group: 'Testo',
    options: [{ value: 'engrave', label: 'Incisione' }, { value: 'cut', label: 'Taglio passante' }],
  },

  {
    key: 'holes', label: 'Fori di fissaggio', type: 'select', group: 'Fori',
    options: [
      { value: 'none', label: 'Nessuno' },
      { value: 'top-center', label: '1 in alto al centro' },
      { value: 'left-center', label: '1 a sinistra (portachiavi)' },
      { value: 'sides', label: '2 laterali' },
      { value: 'top-corners', label: '2 negli angoli superiori' },
      { value: 'corners', label: '4 negli angoli' },
    ],
  },
  { key: 'holeDiameter', label: 'Diametro foro', type: 'number', group: 'Fori', unit: 'mm', min: 0.8, max: 100, step: 0.1, visibleIf: (p) => p.holes !== 'none' },
  { key: 'holeOffset', label: 'Distanza centro foro dal bordo', type: 'number', group: 'Fori', unit: 'mm', min: 0.5, max: 300, step: 0.1, visibleIf: (p) => p.holes !== 'none' },
  { key: 'minWeb', label: 'Materiale minimo attorno ai fori', type: 'number', group: 'Fori', unit: 'mm', min: 0.3, max: 50, step: 0.1, visibleIf: (p) => p.holes !== 'none' },

  { key: 'margin', label: 'Margine di sicurezza', type: 'number', group: 'Margini e bordo', unit: 'mm', min: 0, max: 200, step: 0.5 },
  { key: 'border', label: 'Cornice incisa', type: 'bool', group: 'Margini e bordo' },
  { key: 'borderInset', label: 'Rientro cornice', type: 'number', group: 'Margini e bordo', unit: 'mm', min: 0.5, max: 200, step: 0.5, visibleIf: (p) => p.border === true },
  { key: 'filename', label: 'Nome file', type: 'text', group: 'Esportazione', maxLength: 80, visibleIf: always },
];

export const signTagDefaults: Params = {
  width: 80, height: 30, corner: 'round', radius: 4, thickness: 3,
  line1: 'INGLY DESIGN', line2: 'Laboratorio creativo', font: 'montserrat', fit: true, textSize: 10, align: 'middle',
  textMode: 'paths', textOp: 'engrave',
  holes: 'left-center', holeDiameter: 5, holeOffset: 6, minWeb: 2,
  margin: 3, border: false, borderInset: 2, filename: 'ingly-tag',
};

export interface SignTagGeometry {
  outline: string;
  outlinePoly: { x: number; y: number }[];
  holes: Circle[];
  textBox: Rect;
  textPaths: string[];
  textBounds: Rect | null;
  textSize: number;
  border: string | null;
}

/** Posizioni dei fori in funzione della configurazione. */
export function holePositions(kind: string, w: number, h: number, off: number, r: number): Circle[] {
  switch (kind) {
    case 'top-center': return [{ cx: w / 2, cy: off, r }];
    case 'left-center': return [{ cx: off, cy: h / 2, r }];
    case 'sides': return [{ cx: off, cy: h / 2, r }, { cx: w - off, cy: h / 2, r }];
    case 'top-corners': return [{ cx: off, cy: off, r }, { cx: w - off, cy: off, r }];
    case 'corners': return [{ cx: off, cy: off, r }, { cx: w - off, cy: off, r }, { cx: w - off, cy: h - off, r }, { cx: off, cy: h - off, r }];
    default: return [];
  }
}

/** Riduce il riquadro del testo finché non tocca più i fori (+ margine), togliendo il lato che costa meno area. */
export function textBoxAvoidingHoles(box: Rect, holes: Circle[], margin: number): Rect {
  let b = { ...box };
  for (const c of holes) {
    const k: Rect = { x: c.cx - c.r - margin, y: c.cy - c.r - margin, w: 2 * (c.r + margin), h: 2 * (c.r + margin) };
    if (!rectsOverlap(b, k)) continue;
    const options: Rect[] = [
      { x: k.x + k.w, y: b.y, w: b.x + b.w - (k.x + k.w), h: b.h }, // taglia a sinistra
      { x: b.x, y: b.y, w: k.x - b.x, h: b.h }, // taglia a destra
      { x: b.x, y: k.y + k.h, w: b.w, h: b.y + b.h - (k.y + k.h) }, // taglia in alto
      { x: b.x, y: b.y, w: b.w, h: k.y - b.y }, // taglia in basso
    ].filter((o) => o.w > 0 && o.h > 0);
    if (!options.length) return { x: b.x, y: b.y, w: 0, h: 0 };
    options.sort((p, q) => q.w * q.h - p.w * p.h);
    b = options[0];
  }
  return b;
}

export function buildSignTag(p: Params): { geo: SignTagGeometry; issues: Issue[] } {
  const issues: Issue[] = [];
  const w = num(p, 'width'), h = num(p, 'height');
  const corner = str(p, 'corner') as CornerStyle;
  const maxR = Math.min(w, h) / 2;
  let radius = corner === 'square' ? 0 : num(p, 'radius');
  if (radius > maxR + 1e-9) {
    issues.push({ level: 'error', field: 'radius', message: `Raggio troppo grande: massimo ${fmt(maxR)} mm per queste dimensioni.` });
    radius = maxR;
  }
  const outline = roundedRectPath(0, 0, w, h, radius, corner);
  const outlinePoly = roundedRectPolygon(0, 0, w, h, radius, corner, 16);

  // --- fori ---
  const holeKind = str(p, 'holes');
  const r = num(p, 'holeDiameter') / 2;
  const minWeb = num(p, 'minWeb');
  const holes = holeKind === 'none' ? [] : holePositions(holeKind, w, h, num(p, 'holeOffset'), r);
  holes.forEach((c, i) => {
    const clearance = circleClearanceInPolygon(c, outlinePoly);
    if (clearance < minWeb - 1e-6) {
      issues.push({
        level: 'error', field: 'holeOffset',
        message: clearance < 0
          ? `Il foro ${i + 1} esce dal pezzo: aumenta la distanza dal bordo o riduci il diametro.`
          : `Il foro ${i + 1} lascia solo ${fmt(clearance)} mm di materiale (minimo ${fmt(minWeb)} mm).`,
      });
    }
  });
  for (let i = 0; i < holes.length; i++)
    for (let j = i + 1; j < holes.length; j++)
      if (circlesGap(holes[i], holes[j]) < minWeb) issues.push({ level: 'error', field: 'holeDiameter', message: `I fori ${i + 1} e ${j + 1} sono troppo vicini o sovrapposti.` });
  if (holes.length && 2 * r < num(p, 'thickness') * 0.5)
    issues.push({ level: 'warning', field: 'holeDiameter', message: 'Foro molto piccolo rispetto allo spessore: verifica che il laser lo passi completamente.' });

  // --- cornice ---
  let border: string | null = null;
  if (bool(p, 'border')) {
    const ins = num(p, 'borderInset');
    if (2 * ins >= Math.min(w, h)) issues.push({ level: 'error', field: 'borderInset', message: 'Rientro della cornice troppo grande per il pezzo.' });
    else {
      border = roundedRectPath(ins, ins, w - 2 * ins, h - 2 * ins, Math.max(0, radius - ins), corner);
      const bpoly = roundedRectPolygon(ins, ins, w - 2 * ins, h - 2 * ins, Math.max(0, radius - ins), corner, 16);
      if (holes.some((c) => distToPolygonEdge({ x: c.cx, y: c.cy }, bpoly) < c.r + 0.3))
        issues.push({ level: 'warning', field: 'borderInset', message: 'La cornice attraversa un foro: aumenta il rientro o sposta i fori.' });
    }
  }

  // --- testo ---
  const margin = num(p, 'margin');
  const safe: Rect = { x: margin, y: margin, w: w - 2 * margin, h: h - 2 * margin };
  if (safe.w <= 0 || safe.h <= 0) issues.push({ level: 'error', field: 'margin', message: 'Il margine di sicurezza non lascia spazio utile.' });
  const textBox = textBoxAvoidingHoles(safe, holes, margin);
  const lines = [str(p, 'line1'), str(p, 'line2')].map((s) => s.trim()).filter(Boolean);
  const fontId = str(p, 'font');
  const align = str(p, 'align') as 'start' | 'middle' | 'end';
  const textPaths: string[] = [];
  let textBounds: Rect | null = null;
  let size = num(p, 'textSize');
  if (lines.length) {
    const miss = missingGlyphs(fontId, lines.join(''));
    if (miss.length) issues.push({ level: 'warning', field: 'line1', message: `Caratteri non presenti nel font ed esclusi: ${miss.join(' ')}` });
    if (textBox.w <= 1 || textBox.h <= 1) issues.push({ level: 'error', field: 'margin', message: 'Non resta spazio per il testo: riduci margine o fori.' });
    else {
      const lineGap = 1.15;
      // misura a corpo 1 mm, poi scala: l'ingombro dei contorni è lineare nel corpo
      const unit = layoutText(fontId, lines, 1, lineGap, 0, 0, 'start');
      const uw = unit.bounds.w, uh = unit.bounds.h;
      if (bool(p, 'fit') && uw > 0 && uh > 0) size = Math.min(size, (textBox.w / uw) * 0.999, (textBox.h / uh) * 0.999);
      const ax = align === 'start' ? textBox.x : align === 'end' ? textBox.x + textBox.w : textBox.x + textBox.w / 2;
      const probe = layoutText(fontId, lines, size, lineGap, ax, 0, align);
      // allinea i contorni reali dei glifi (non le spalle del font) al riquadro
      const pb = probe.bounds;
      const dy = textBox.y + textBox.h / 2 - (pb.y + pb.h / 2);
      const dx = align === 'start' ? textBox.x - pb.x : align === 'end' ? textBox.x + textBox.w - (pb.x + pb.w) : textBox.x + textBox.w / 2 - (pb.x + pb.w / 2);
      const final = layoutText(fontId, lines, size, lineGap, ax + dx, dy, align);
      textPaths.push(...final.paths);
      textBounds = final.bounds;
      const tol = 0.01;
      if (
        final.bounds.x < textBox.x - tol || final.bounds.y < textBox.y - tol ||
        final.bounds.x + final.bounds.w > textBox.x + textBox.w + tol || final.bounds.y + final.bounds.h > textBox.y + textBox.h + tol
      ) issues.push({ level: 'error', field: 'textSize', message: 'Il testo esce dall\'area sicura: riduci il corpo o attiva l\'adattamento.' });
      if (size < 2) issues.push({ level: 'warning', field: 'textSize', message: `Testo molto piccolo (${fmt(size)} mm): i dettagli potrebbero non essere leggibili.` });
    }
  }
  if (str(p, 'textOp') === 'cut' && textPaths.length) {
    issues.push({ level: 'warning', field: 'textOp', message: 'Testo a taglio passante: le parti interne di lettere come O, A, B si staccheranno (nessun ponte stencil).' });
    if (str(p, 'textMode') === 'live') issues.push({ level: 'error', field: 'textMode', message: 'Il taglio richiede il testo in tracciati: un testo modificabile non è una geometria tagliabile validata.' });
  }
  if (str(p, 'textMode') === 'live' && lines.length)
    issues.push({ level: 'warning', field: 'textMode', message: `Testo modificabile: l'aspetto dipende dal font "${FONT_FAMILY[fontId]}" installato sul computer che apre il file.` });

  return { geo: { outline, outlinePoly, holes, textBox, textPaths, textBounds, textSize: size, border }, issues };
}

function layoutText(fontId: string, lines: string[], size: number, gap: number, x: number, dy: number, anchor: 'start' | 'middle' | 'end') {
  const paths: string[] = [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  lines.forEach((line, i) => {
    const s = textToPath(fontId, line, x, dy + i * size * gap, size, anchor);
    paths.push(s.d);
    x0 = Math.min(x0, s.x0); y0 = Math.min(y0, s.y0); x1 = Math.max(x1, s.x1); y1 = Math.max(y1, s.y1);
  });
  return { paths, bounds: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } as Rect };
}

export type SignVariant = 'all' | 'cut' | 'engrave';

export function signTagSvg(p: Params, geo: SignTagGeometry, variant: SignVariant): string {
  const w = num(p, 'width'), h = num(p, 'height');
  const textIsCut = str(p, 'textOp') === 'cut';
  const live = str(p, 'textMode') === 'live';
  const cutPaths = [geo.outline, ...geo.holes.map(circlePath), ...(textIsCut && !live ? geo.textPaths : [])];
  const engravePaths = !textIsCut && !live ? geo.textPaths : [];
  const layers: SvgLayer[] = [];
  if (variant !== 'engrave') layers.push({ id: 'taglio', op: 'cut', paths: cutPaths });
  if (variant !== 'cut') {
    const lines = [str(p, 'line1'), str(p, 'line2')].map((s) => s.trim()).filter(Boolean);
    const texts = live && geo.textBounds && !textIsCut
      ? lines.map((t, i) => ({
          x: str(p, 'align') === 'start' ? geo.textBox.x : str(p, 'align') === 'end' ? geo.textBox.x + geo.textBox.w : geo.textBox.x + geo.textBox.w / 2,
          y: geo.textBounds!.y + geo.textSize * 0.75 + i * geo.textSize * 1.15,
          size: geo.textSize, text: t, family: `${FONT_FAMILY[str(p, 'font')]}, sans-serif`, anchor: str(p, 'align') as 'start' | 'middle' | 'end',
        }))
      : [];
    layers.push({ id: 'incisione', op: 'engrave', paths: engravePaths, texts });
    if (geo.border) layers.push({ id: 'cornice', op: 'score', label: 'Cornice (marcatura)', paths: [geo.border] });
    // nella variante solo-incisione il contorno serve come riferimento di allineamento
    if (variant === 'engrave') layers.push({ id: 'riferimento', op: 'guide', label: 'Contorno di riferimento (non lavorare)', paths: [geo.outline] });
  }
  const desc = `INGLY Sign & Tag — ${fmt(w)}×${fmt(h)} mm, spessore ${fmt(num(p, 'thickness'))} mm, fori: ${str(p, 'holes')} Ø${fmt(num(p, 'holeDiameter'))} mm. Rosso=taglio, nero=incisione, blu=marcatura.`;
  return svgDocument({ widthMm: w, heightMm: h, title: `INGLY Sign & Tag ${variant}`, description: desc, layers });
}

export function runSignTag(raw: Params): GeneratorResult {
  const { values: p, issues: paramIssues } = normalizeParams(signTagParams, raw, signTagDefaults);
  if (hasErrors(paramIssues)) return { views: [], issues: paramIssues, stats: [], exports: [] };
  const { geo, issues: geoIssues } = buildSignTag(p);
  const issues = [...paramIssues, ...geoIssues];
  const w = num(p, 'width'), h = num(p, 'height');
  const svgAll = signTagSvg(p, geo, 'all');
  const base = str(p, 'filename');
  const exports: ExportOption[] = [
    { id: 'svg', label: 'SVG completo (taglio + incisione)', requiresValid: true, primary: true, build: async () => svgFile(svgAll, safeFilename(base, 'svg', 'ingly-tag')) },
    { id: 'svg-cut', label: 'SVG solo taglio', requiresValid: true, build: async () => svgFile(signTagSvg(p, geo, 'cut'), safeFilename(`${base}-taglio`, 'svg')) },
    { id: 'svg-engrave', label: 'SVG solo incisione', requiresValid: true, build: async () => svgFile(signTagSvg(p, geo, 'engrave'), safeFilename(`${base}-incisione`, 'svg')) },
    {
      id: 'zip', label: 'ZIP con varianti separate', requiresValid: true,
      build: async () => zipFile([
        svgFile(svgAll, safeFilename(base, 'svg')),
        svgFile(signTagSvg(p, geo, 'cut'), safeFilename(`${base}-taglio`, 'svg')),
        svgFile(signTagSvg(p, geo, 'engrave'), safeFilename(`${base}-incisione`, 'svg')),
      ], safeFilename(base, 'zip')),
    },
  ];
  const stats = [
    { label: 'Dimensioni', value: `${fmt(w)} × ${fmt(h)} mm` },
    { label: 'Fori', value: geo.holes.length ? `${geo.holes.length} × Ø${fmt(num(p, 'holeDiameter'))} mm` : 'nessuno' },
    {
      label: 'Materiale attorno ai fori',
      value: geo.holes.length ? `${fmt(Math.min(...geo.holes.map((c) => circleClearanceInPolygon(c, geo.outlinePoly))))} mm (min ${fmt(num(p, 'minWeb'))})` : '—',
    },
    { label: 'Corpo testo', value: geo.textPaths.length ? `${fmt(geo.textSize)} mm` : '—' },
    { label: 'Area sicura testo', value: `${fmt(geo.textBox.w)} × ${fmt(geo.textBox.h)} mm` },
  ];
  return { views: [{ id: 'pezzo', label: 'Pezzo', widthMm: w, heightMm: h, svg: svgAll }], issues, stats, exports };
}

export const signTag: GeneratorDef = {
  id: 'sign-tag',
  slug: 'label-generator',
  code: '01',
  title: 'INGLY Sign & Tag',
  tagline: 'Targhette, portachiavi e insegne con fori validati e testo in tracciati.',
  params: signTagParams,
  defaults: signTagDefaults,
  presets: [
    { id: 'keychain', label: 'Portachiavi 60×25', values: { width: 60, height: 25, radius: 6, holes: 'left-center', holeDiameter: 5, holeOffset: 6, line1: 'CASA', line2: '', margin: 2.5, thickness: 3, filename: 'portachiavi' } },
    { id: 'tag', label: 'Targhetta 80×30', values: { width: 80, height: 30, radius: 3, holes: 'sides', holeDiameter: 3.5, holeOffset: 5, line1: 'INGLY DESIGN', line2: 'Laboratorio creativo', margin: 3, filename: 'targhetta' } },
    { id: 'sign', label: 'Insegna 400×150', values: { width: 400, height: 150, radius: 10, holes: 'corners', holeDiameter: 6, holeOffset: 12, line1: 'BOTTEGA', line2: 'dal 1987', font: 'playfair', textSize: 90, margin: 18, border: true, borderInset: 6, thickness: 6, filename: 'insegna' } },
    { id: 'door', label: 'Targa porta 150×60', values: { width: 150, height: 60, radius: 0, corner: 'square', holes: 'top-corners', holeDiameter: 4, holeOffset: 7, line1: 'Studio', line2: 'Dott.ssa Rossi', font: 'greatvibes', margin: 6, filename: 'targa-porta' } },
  ],
  run: (p) => runSignTag(p),
};
