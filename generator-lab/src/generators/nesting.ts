// GENERATORE 04 — INGLY BATCH & NESTING: disposizione dei pezzi su lastre.
import { csvEscape, safeFilename, svgFile, zipFile } from '../core/export.ts';
import { fmt } from '../core/geometry.ts';
import { type NestOptions, type PartSpec, nest, verifyNest } from '../core/nesting.ts';
import { hasErrors, normalizeParams, num, str } from '../core/params.ts';
import { svgDocument } from '../core/svg.ts';
import type { ExportOption, GeneratorDef, GeneratorResult, Issue, ParamDef, Params } from '../core/types.ts';

export const nestingParams: ParamDef[] = [
  {
    key: 'parts', label: 'Pezzi (uno per riga)', type: 'textarea', group: 'Pezzi', maxLength: 20000,
    help: 'Formato: nome; larghezza; altezza; quantità; ruota (sì/no). Misure in mm. Righe che iniziano con # ignorate.',
  },
  { key: 'lots', label: 'Numero di lotti', type: 'number', group: 'Pezzi', min: 1, max: 1000, step: 1, help: 'Le quantità vengono moltiplicate per il numero di lotti.' },
  { key: 'allowRotate', label: 'Rotazione 90° ammessa', type: 'select', group: 'Pezzi', options: [{ value: 'per-part', label: 'Come indicato per ogni pezzo' }, { value: 'all', label: 'Sempre' }, { value: 'none', label: 'Mai (venatura/stampa orientata)' }] },
  { key: 'sheetW', label: 'Larghezza lastra', type: 'number', group: 'Lastra', unit: 'mm', min: 20, max: 5000, step: 1 },
  { key: 'sheetH', label: 'Altezza lastra', type: 'number', group: 'Lastra', unit: 'mm', min: 20, max: 5000, step: 1 },
  { key: 'margin', label: 'Margine dal bordo', type: 'number', group: 'Lastra', unit: 'mm', min: 0, max: 200, step: 0.5 },
  { key: 'spacing', label: 'Distanza minima fra pezzi', type: 'number', group: 'Lastra', unit: 'mm', min: 0, max: 100, step: 0.1 },
  { key: 'kerf', label: 'Kerf (larghezza del taglio)', type: 'number', group: 'Lastra', unit: 'mm', min: 0, max: 5, step: 0.01, help: 'Aggiunto alla distanza fra pezzi.' },
  { key: 'maxSheets', label: 'Numero massimo di lastre', type: 'number', group: 'Lastra', min: 1, max: 200, step: 1 },
  { key: 'filename', label: 'Nome file', type: 'text', group: 'Esportazione', maxLength: 80 },
];

export const nestingDefaults: Params = {
  parts: '# nome; larghezza; altezza; quantità; ruota\nPortachiavi; 60; 25; 20; sì\nTarghetta; 80; 30; 10; sì\nSottobicchiere; 95; 95; 8; no\nInsegna; 300; 120; 1; sì',
  lots: 1, allowRotate: 'per-part', sheetW: 600, sheetH: 400, margin: 5, spacing: 2, kerf: 0.15, maxSheets: 10, filename: 'ingly-nesting',
};

/** Parser robusto della lista pezzi: accetta ; , o tab come separatori e la virgola decimale con ;. */
export function parseParts(text: string, lots: number, rotateMode: string): { parts: PartSpec[]; issues: Issue[] } {
  const parts: PartSpec[] = [];
  const issues: Issue[] = [];
  const lines = text.split(/\r?\n/);
  if (lines.length > 500) issues.push({ level: 'error', field: 'parts', message: 'Massimo 500 righe di pezzi.' });
  lines.slice(0, 500).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const sep = line.includes(';') ? ';' : line.includes('\t') ? '\t' : ',';
    const cells = line.split(sep).map((c) => c.trim());
    const toNum = (s: string | undefined) => parseFloat(String(s ?? '').replace(',', '.'));
    const [name, ws, hs, qs, rs] = cells;
    const w = toNum(ws), h = toNum(hs), q = qs === undefined || qs === '' ? 1 : toNum(qs);
    const row = i + 1;
    if (!name) return void issues.push({ level: 'error', field: 'parts', message: `Riga ${row}: nome mancante.` });
    if (!(w > 0) || !(h > 0)) return void issues.push({ level: 'error', field: 'parts', message: `Riga ${row} (${name}): larghezza e altezza devono essere numeri positivi.` });
    if (!(Number.isInteger(q) && q >= 0)) return void issues.push({ level: 'error', field: 'parts', message: `Riga ${row} (${name}): quantità non valida.` });
    const rot = rotateMode === 'all' ? true : rotateMode === 'none' ? false : !/^(no|n|false|0)$/i.test(rs ?? 'sì');
    parts.push({ id: `p${row}`, name: name.slice(0, 60), w, h, qty: q * lots, canRotate: rot });
  });
  const total = parts.reduce((s, p) => s + p.qty, 0);
  if (total > 5000) issues.push({ level: 'error', field: 'lots', message: `Troppi pezzi (${total}): massimo 5000 per calcolo.` });
  if (!parts.length && !issues.length) issues.push({ level: 'error', field: 'parts', message: 'Inserisci almeno un pezzo.' });
  return { parts, issues };
}

export function runNesting(raw: Params): GeneratorResult {
  const { values: p, issues: pi } = normalizeParams(nestingParams, raw, nestingDefaults);
  if (hasErrors(pi)) return { views: [], issues: pi, stats: [], exports: [] };
  const { parts, issues: parseIssues } = parseParts(str(p, 'parts'), Math.round(num(p, 'lots')), str(p, 'allowRotate'));
  const issues = [...pi, ...parseIssues];
  if (hasErrors(issues)) return { views: [], issues, stats: [], exports: [] };
  const o: NestOptions = { sheetW: num(p, 'sheetW'), sheetH: num(p, 'sheetH'), margin: num(p, 'margin'), spacing: num(p, 'spacing'), kerf: num(p, 'kerf'), maxSheets: Math.round(num(p, 'maxSheets')) };
  if (2 * o.margin >= Math.min(o.sheetW, o.sheetH)) return { views: [], issues: [...issues, { level: 'error', field: 'margin', message: 'Il margine non lascia area utile sulla lastra.' }], stats: [], exports: [] };
  const r = nest(parts, o);
  const errs = verifyNest(r, o);
  for (const e of errs) issues.push({ level: 'error', message: `Verifica fallita: ${e}` });
  issues.push({ level: 'info', message: 'Il nesting usa i rettangoli d\'ingombro dei pezzi: per sagome non rettangolari usa il layout come piano di posizionamento.' });
  for (const u of r.unplaced) issues.push({ level: 'warning', field: 'parts', message: `${u.count} × "${u.name}" non collocati: ${u.reason}.` });

  const svgs: string[] = [];
  for (let s = 0; s < r.sheetsUsed; s++) {
    const items = r.placed.filter((q) => q.sheet === s);
    svgs.push(svgDocument({
      widthMm: o.sheetW, heightMm: o.sheetH, title: `INGLY Nesting — lastra ${s + 1}`,
      description: `Rettangoli d'ingombro dei pezzi. Margine ${fmt(o.margin)} mm, distanza ${fmt(o.spacing)} + kerf ${fmt(o.kerf)} mm.`,
      layers: [
        { id: 'ingombri', op: 'cut', label: 'Ingombri pezzi (rettangoli)', paths: items.map((q) => `M${fmt(q.x)} ${fmt(q.y)}H${fmt(q.x + q.w)}V${fmt(q.y + q.h)}H${fmt(q.x)}Z`) },
        { id: 'area-utile', op: 'guide', label: 'Area utile (non lavorare)', paths: [`M${fmt(o.margin)} ${fmt(o.margin)}H${fmt(o.sheetW - o.margin)}V${fmt(o.sheetH - o.margin)}H${fmt(o.margin)}Z`] },
        { id: 'etichette', op: 'guide', label: 'Nomi (non lavorare)', paths: [], texts: items.map((q) => ({ x: q.x + q.w / 2, y: q.y + q.h / 2 + 1, size: Math.max(1.5, Math.min(8, q.h / 4, q.w / 8)), text: `${q.name}${q.rotated ? ' ↻' : ''}`, family: 'sans-serif', anchor: 'middle' as const })) },
      ],
    }));
  }
  const totalReq = parts.reduce((s, q) => s + q.qty, 0);
  const residual = r.sheetArea - r.usedArea;
  const stats = [
    { label: 'Pezzi collocati', value: `${r.placed.length} / ${totalReq}` },
    { label: 'Lastre usate', value: `${r.sheetsUsed} (massimo ${o.maxSheets})` },
    { label: 'Superficie pezzi', value: `${(r.usedArea / 1e6).toFixed(4)} m²` },
    { label: 'Superficie residua', value: `${(residual / 1e6).toFixed(4)} m²` },
    { label: 'Utilizzo', value: `${(r.utilization * 100).toFixed(1)}%` },
    { label: 'Non collocabili', value: String(r.unplaced.reduce((s, u) => s + u.count, 0)) },
  ];
  const base = str(p, 'filename');
  const files = () => svgs.map((svg, i) => svgFile(svg, safeFilename(`${base}-lastra-${i + 1}`, 'svg')));
  const report = () => {
    const rows = [['lastra', 'pezzo', 'istanza', 'x_mm', 'y_mm', 'larghezza_mm', 'altezza_mm', 'ruotato'].join(';')];
    for (const q of r.placed) rows.push([q.sheet + 1, csvEscape(q.name), q.instance, fmt(q.x), fmt(q.y), fmt(q.w), fmt(q.h), q.rotated ? 'sì' : 'no'].join(';'));
    return { filename: safeFilename(`${base}-report`, 'csv'), blob: new Blob(['﻿' + rows.join('\n')], { type: 'text/csv' }) };
  };
  const exports: ExportOption[] = [
    { id: 'zip', label: 'ZIP (lastre SVG + report CSV)', requiresValid: true, primary: true, build: async () => zipFile([...files(), report()], safeFilename(base, 'zip')) },
    { id: 'csv', label: 'Report posizioni CSV', requiresValid: true, build: async () => report() },
    ...svgs.map((_, i) => ({ id: `sheet-${i + 1}`, label: `SVG lastra ${i + 1}`, requiresValid: true, build: async () => files()[i] })),
  ];
  const views = svgs.map((svg, i) => ({ id: `sheet-${i + 1}`, label: `Lastra ${i + 1}`, widthMm: o.sheetW, heightMm: o.sheetH, svg }));
  return { views, issues, stats, exports };
}

export const batchNesting: GeneratorDef = {
  id: 'nesting',
  slug: 'batch-nesting',
  code: '04',
  title: 'INGLY Batch & Nesting',
  tagline: 'Disposizione deterministica dei pezzi su lastra (MaxRects), con verifica di margini e distanze.',
  params: nestingParams,
  defaults: nestingDefaults,
  presets: [
    { id: 'xtool-s1', label: 'Lastra 600×400', values: { sheetW: 600, sheetH: 400 } },
    { id: 'small', label: 'Lastra 300×200', values: { sheetW: 300, sheetH: 200 } },
    { id: 'big', label: 'Pannello 1220×610', values: { sheetW: 1220, sheetH: 610 } },
  ],
  run: (p) => runNesting(p),
};
