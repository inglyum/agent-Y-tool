// GENERATORE 02 — INGLY BOX & ENCLOSURE: scatole a incastro e organizer con scomparti.
//
// Modello delle giunzioni a dita (finger joint):
// - ogni lato di giunzione è diviso in n segmenti uguali (n dispari ≥ 3) sull'intera lunghezza esterna;
// - fase A = segmenti pari "pieni", dispari "rientrati" di uno spessore; fase B = complementare;
// - un angolo del pannello esiste solo se entrambi i lati adiacenti sono pieni in quel punto;
// - pareti frontali/posteriori: verticali in fase A; laterali: fase B; fondo e coperchio a incastro:
//   fase B su tutti i lati, con le pareti in fase A sui lati corrispondenti.
// Con queste regole ogni volume d'angolo appartiene a un solo pannello: verifyAssembly() lo controlla in 3D.
import { safeFilename, svgFile, zipFile } from '../core/export.ts';
import { type Pt, type Rect, fmt, polygonPath, translate } from '../core/geometry.ts';
import { nest } from '../core/nesting.ts';
import { bool, hasErrors, normalizeParams, num, str } from '../core/params.ts';
import { type RectRegion, regionContains, traceRegion } from '../core/rectilinear.ts';
import { svgDocument } from '../core/svg.ts';
import type { ExportOption, GeneratorDef, GeneratorResult, Issue, ParamDef, Params } from '../core/types.ts';

export const boxParams: ParamDef[] = [
  { key: 'dimMode', label: 'Le misure indicate sono', type: 'select', group: 'Dimensioni', options: [{ value: 'inner', label: 'Interne (spazio utile)' }, { value: 'outer', label: 'Esterne (ingombro)' }] },
  { key: 'width', label: 'Larghezza (X)', type: 'number', group: 'Dimensioni', unit: 'mm', min: 10, max: 2000, step: 0.5 },
  { key: 'depth', label: 'Profondità (Y)', type: 'number', group: 'Dimensioni', unit: 'mm', min: 10, max: 2000, step: 0.5 },
  { key: 'height', label: 'Altezza (Z)', type: 'number', group: 'Dimensioni', unit: 'mm', min: 5, max: 2000, step: 0.5 },
  { key: 'thickness', label: 'Spessore materiale', type: 'number', group: 'Materiale e giunzioni', unit: 'mm', min: 0.5, max: 25, step: 0.1, help: 'Misura reale del pannello (calibro): i compensati variano di ±0,2 mm.' },
  { key: 'joint', label: 'Tipo di giunzione', type: 'select', group: 'Materiale e giunzioni', options: [{ value: 'finger', label: 'A dita (finger joint)' }, { value: 'butt', label: 'Testa a testa (da incollare)' }] },
  { key: 'fingerWidth', label: 'Larghezza dita (indicativa)', type: 'number', group: 'Materiale e giunzioni', unit: 'mm', min: 2, max: 200, step: 0.5, visibleIf: (p) => p.joint === 'finger' },
  { key: 'clearance', label: 'Gioco di montaggio', type: 'number', group: 'Materiale e giunzioni', unit: 'mm', min: 0, max: 1, step: 0.01, help: 'Riduce le dita: valori più alti = montaggio più morbido.' },
  { key: 'kerf', label: 'Compensazione kerf', type: 'number', group: 'Materiale e giunzioni', unit: 'mm', min: 0, max: 1, step: 0.01, help: 'Larghezza del taglio laser: allarga le dita. Lascia 0 se la compensi nel software della macchina.' },
  { key: 'bottom', label: 'Fondo', type: 'bool', group: 'Fondo e coperchio' },
  { key: 'lid', label: 'Coperchio', type: 'select', group: 'Fondo e coperchio', options: [{ value: 'none', label: 'Nessuno (scatola aperta)' }, { value: 'fixed', label: 'Fisso a incastro' }, { value: 'lift', label: 'Appoggiato con battuta interna' }] },
  { key: 'divX', label: 'Divisori paralleli al fronte', type: 'number', group: 'Scomparti', min: 0, max: 20, step: 1 },
  { key: 'divY', label: 'Divisori paralleli ai fianchi', type: 'number', group: 'Scomparti', min: 0, max: 20, step: 1 },
  { key: 'sheetW', label: 'Larghezza lastra', type: 'number', group: 'Layout di taglio', unit: 'mm', min: 50, max: 3000, step: 1 },
  { key: 'sheetH', label: 'Altezza lastra', type: 'number', group: 'Layout di taglio', unit: 'mm', min: 50, max: 3000, step: 1 },
  { key: 'margin', label: 'Margine lastra', type: 'number', group: 'Layout di taglio', unit: 'mm', min: 0, max: 100, step: 0.5 },
  { key: 'spacing', label: 'Distanza fra pezzi', type: 'number', group: 'Layout di taglio', unit: 'mm', min: 0.5, max: 50, step: 0.5 },
  { key: 'labels', label: 'Nomi dei pezzi come guida (non lavorati)', type: 'bool', group: 'Layout di taglio' },
  { key: 'filename', label: 'Nome file', type: 'text', group: 'Esportazione', maxLength: 80 },
];

export const boxDefaults: Params = {
  dimMode: 'inner', width: 120, depth: 80, height: 50, thickness: 3, joint: 'finger', fingerWidth: 10,
  clearance: 0.1, kerf: 0, bottom: true, lid: 'none', divX: 0, divY: 0,
  sheetW: 600, sheetH: 400, margin: 5, spacing: 3, labels: true, filename: 'ingly-box',
};

type Phase = 'A' | 'B' | 'flat';
type Side = 'top' | 'right' | 'bottom' | 'left';

export interface Panel {
  id: string;
  name: string;
  region: RectRegion;
  outline: Pt[];
}

export interface BoxModel {
  outer: { W: number; D: number; H: number };
  inner: { W: number; D: number; H: number };
  t: number;
  panels: Panel[];
  /** pannelli dell'involucro con la loro posizione 3D (per la verifica) */
  placements: Placement[];
  compartments: number;
}

interface Placement {
  panel: Panel;
  /** mappa un punto 3D nelle coordinate locali (u, v) e dice se è nello spessore */
  map: (x: number, y: number, z: number) => { u: number; v: number } | null;
}

/** Numero di segmenti (dispari ≥ 3) per un lato lungo L. Ritorna 0 se il lato è troppo corto. */
export function segmentCount(L: number, target: number, t: number): number {
  let n = Math.floor(L / target);
  if (n % 2 === 0) n -= 1;
  while (n >= 3 && L / n < 2 * t) n -= 2;
  return n >= 3 ? n : 0;
}

/** Rettangoli rimossi lungo un lato in base alla fase. delta = (kerf − gioco)/2 allarga le dita. */
function edgeCuts(side: Side, phase: Phase, Lu: number, Lv: number, t: number, n: number, delta: number): Rect[] {
  if (phase === 'flat') return [];
  const L = side === 'top' || side === 'bottom' ? Lu : Lv;
  const seg = L / n;
  const cuts: Rect[] = [];
  for (let k = 0; k < n; k++) {
    const isIn = phase === 'A' ? k % 2 === 1 : k % 2 === 0;
    if (!isIn) continue;
    let a = k * seg, b = (k + 1) * seg;
    if (k > 0) a += delta;
    if (k < n - 1) b -= delta;
    if (k === 0) a -= 1; // oltre il bordo: niente lamine residue
    if (k === n - 1) b += 1;
    if (side === 'top') cuts.push({ x: a, y: -1, w: b - a, h: t + 1 });
    if (side === 'bottom') cuts.push({ x: a, y: Lv - t, w: b - a, h: t + 1 });
    if (side === 'left') cuts.push({ x: -1, y: a, w: t + 1, h: b - a });
    if (side === 'right') cuts.push({ x: Lu - t, y: a, w: t + 1, h: b - a });
  }
  return cuts;
}

function makePanel(id: string, name: string, Lu: number, Lv: number, t: number, phases: Record<Side, Phase>, counts: Record<Side, number>, delta: number, extra: Rect[] = []): Panel {
  const cuts: Rect[] = [...extra];
  (Object.keys(phases) as Side[]).forEach((s) => cuts.push(...edgeCuts(s, phases[s], Lu, Lv, t, counts[s], delta)));
  const region: RectRegion = { w: Lu, h: Lv, cuts };
  const loops = traceRegion(region);
  if (loops.length !== 1) throw new Error(`Il pannello "${name}" risulta diviso in ${loops.length} parti`);
  return { id, name, region, outline: loops[0] };
}

export function buildBox(p: Params, nominal = false): { model: BoxModel | null; issues: Issue[] } {
  const issues: Issue[] = [];
  const t = num(p, 'thickness');
  const finger = str(p, 'joint') === 'finger';
  const lid = str(p, 'lid');
  const hasBottom = bool(p, 'bottom');
  const c = num(p, 'clearance');
  const delta = nominal ? 0 : (num(p, 'kerf') - c) / 2;
  const zBottom = hasBottom ? t : 0;
  const zTop = lid === 'fixed' ? t : 0;
  let W = num(p, 'width'), D = num(p, 'depth'), H = num(p, 'height');
  if (str(p, 'dimMode') === 'inner') {
    W += 2 * t; D += 2 * t; H += zBottom + zTop;
  }
  const inner = { W: W - 2 * t, D: D - 2 * t, H: H - zBottom - zTop };
  if (inner.W <= 0 || inner.D <= 0 || inner.H <= 0) {
    issues.push({ level: 'error', field: 'thickness', message: 'Lo spessore non lascia volume interno: aumenta le dimensioni.' });
    return { model: null, issues };
  }
  if (!hasBottom && lid === 'none') issues.push({ level: 'warning', field: 'bottom', message: 'Senza fondo né coperchio si ottiene una cornice: verifica che sia voluto.' });

  const fw = num(p, 'fingerWidth');
  const nW = finger ? segmentCount(W, fw, t) : 1;
  const nD = finger ? segmentCount(D, fw, t) : 1;
  const nH = finger ? segmentCount(H, fw, t) : 1;
  if (finger) {
    for (const [L, n, lab] of [[W, nW, 'larghezza'], [D, nD, 'profondità'], [H, nH, 'altezza']] as [number, number, string][])
      if (!n) issues.push({ level: 'error', field: 'fingerWidth', message: `Lato ${lab} (${fmt(L)} mm) troppo corto per un incastro a dita con spessore ${fmt(t)} mm: riduci la larghezza delle dita o aumenta la misura.` });
    const minSeg = Math.min(W / nW, D / nD, H / nH);
    if (nW && nD && nH && Math.abs(delta) * 2 > minSeg / 3) issues.push({ level: 'error', field: 'clearance', message: 'Gioco o kerf troppo grandi rispetto alle dita.' });
    if (fw < 1.5 * t) issues.push({ level: 'warning', field: 'fingerWidth', message: 'Dita più strette di 1,5 × spessore: rischio di rottura in montaggio.' });
  }
  if (hasErrors(issues)) return { model: null, issues };

  const j = (ph: Phase): Phase => (finger ? ph : 'flat');
  const wallTop: Phase = lid === 'fixed' ? j('A') : 'flat';
  const wallBottom: Phase = hasBottom ? j('A') : 'flat';
  const cnt = (u: number, v: number) => ({ top: u, bottom: u, left: v, right: v });
  const panels: Panel[] = [];
  const placements: Placement[] = [];
  const within = (val: number, a: number, b: number) => val > a && val < b;

  // testa a testa: fianchi, fondo e coperchio stanno fra fronte e retro
  const butt = !finger;
  const front = makePanel('front', 'Fronte', W, H, t, { top: wallTop, bottom: wallBottom, left: j('A'), right: j('A') }, cnt(nW, nH), delta);
  const back = makePanel('back', 'Retro', W, H, t, { top: wallTop, bottom: wallBottom, left: j('A'), right: j('A') }, cnt(nW, nH), delta);
  const sideW = butt ? D - 2 * t : D;
  const left = makePanel('left', 'Fianco sinistro', sideW, H, t, { top: wallTop, bottom: wallBottom, left: j('B'), right: j('B') }, cnt(nD, nH), delta);
  const right = makePanel('right', 'Fianco destro', sideW, H, t, { top: wallTop, bottom: wallBottom, left: j('B'), right: j('B') }, cnt(nD, nH), delta);
  const wallZ = (z: number) => H - z; // v misurata dall'alto
  placements.push(
    { panel: front, map: (x, y, z) => (within(y, 0, t) ? { u: x, v: wallZ(z) } : null) },
    { panel: back, map: (x, y, z) => (within(y, D - t, D) ? { u: x, v: wallZ(z) } : null) },
    { panel: left, map: (x, y, z) => (within(x, 0, t) ? (butt ? { u: y - t, v: wallZ(z) } : { u: y, v: wallZ(z) }) : null) },
    { panel: right, map: (x, y, z) => (within(x, W - t, W) ? (butt ? { u: y - t, v: wallZ(z) } : { u: y, v: wallZ(z) }) : null) },
  );
  panels.push(front, back, left, right);
  if (hasBottom) {
    const bw = butt ? W - 2 * t : W, bd = butt ? D - 2 * t : D;
    const bottom = makePanel('bottom', 'Fondo', bw, bd, t, { top: j('B'), bottom: j('B'), left: j('B'), right: j('B') }, cnt(nW, nD), delta);
    panels.push(bottom);
    placements.push({ panel: bottom, map: (x, y, z) => (within(z, 0, t) ? (butt ? { u: x - t, v: y - t } : { u: x, v: y }) : null) });
  }
  if (lid === 'fixed') {
    const tw = butt ? W - 2 * t : W, td = butt ? D - 2 * t : D;
    const top = makePanel('lid', 'Coperchio', tw, td, t, { top: j('B'), bottom: j('B'), left: j('B'), right: j('B') }, cnt(nW, nD), delta);
    panels.push(top);
    placements.push({ panel: top, map: (x, y, z) => (within(z, H - t, H) ? (butt ? { u: x - t, v: y - t } : { u: x, v: y }) : null) });
  } else if (lid === 'lift') {
    const flat = { top: 'flat', bottom: 'flat', left: 'flat', right: 'flat' } as Record<Side, Phase>;
    panels.push(makePanel('lid', 'Coperchio', W, D, t, flat, cnt(1, 1), 0));
    const lw = inner.W - 2 * c, ld = inner.D - 2 * c;
    if (lw > 2 && ld > 2) panels.push(makePanel('lid-lip', 'Battuta coperchio (incollare sotto)', lw, ld, t, flat, cnt(1, 1), 0));
  }

  // --- divisori a incastro a croce, appoggiati sul fondo ---
  const nxDiv = Math.round(num(p, 'divX')), nyDiv = Math.round(num(p, 'divY'));
  const hDiv = inner.H - (lid === 'none' ? 0 : c);
  const slot = t + c;
  const cellsX = nyDiv + 1, cellsY = nxDiv + 1;
  const cellW = (inner.W - nyDiv * t) / cellsX, cellD = (inner.D - nxDiv * t) / cellsY;
  if ((nxDiv || nyDiv) && (cellW < 5 || cellD < 5)) issues.push({ level: 'error', field: 'divX', message: 'Troppi divisori: gli scomparti risultano più stretti di 5 mm.' });
  if ((nxDiv || nyDiv) && hDiv < 4) issues.push({ level: 'error', field: 'height', message: 'Altezza interna insufficiente per i divisori.' });
  if (!hasErrors(issues)) {
    const xCenters = Array.from({ length: nyDiv }, (_, i) => (i + 1) * cellW + i * t + t / 2);
    const yCenters = Array.from({ length: nxDiv }, (_, i) => (i + 1) * cellD + i * t + t / 2);
    const flat = { top: 'flat', bottom: 'flat', left: 'flat', right: 'flat' } as Record<Side, Phase>;
    const lenX = inner.W - c, lenY = inner.D - c;
    for (let i = 0; i < nxDiv; i++) {
      const slots = xCenters.map((xc) => ({ x: xc - c / 2 - slot / 2, y: -1, w: slot, h: hDiv / 2 + 1 }));
      panels.push(makePanel(`divx-${i + 1}`, `Divisore X ${i + 1}`, lenX, hDiv, t, flat, cnt(1, 1), 0, slots));
    }
    for (let i = 0; i < nyDiv; i++) {
      const slots = nxDiv ? yCenters.map((yc) => ({ x: yc - c / 2 - slot / 2, y: hDiv / 2, w: slot, h: hDiv / 2 + 1 })) : [];
      panels.push(makePanel(`divy-${i + 1}`, `Divisore Y ${i + 1}`, lenY, hDiv, t, flat, cnt(1, 1), 0, slots));
    }
  }
  return {
    model: { outer: { W, D, H }, inner, t, panels, placements, compartments: (nxDiv + 1) * (nyDiv + 1) },
    issues,
  };
}

/**
 * Verifica 3D dell'involucro sulla geometria nominale: ogni cella del guscio deve appartenere
 * a esattamente un pannello (0 = buco, 2+ = collisione). Le coordinate sono i punti medi della
 * griglia compressa, quindi il controllo è esatto per geometrie rettilinee.
 */
export function verifyAssembly(m: BoxModel, openTop: boolean, openBottom: boolean): { collisions: number; gaps: number } {
  const { W, D, H } = m.outer;
  const t = m.t;
  const coords = (L: number, panelsU: number[][]) => {
    const s = new Set<number>([0, L, t, L - t]);
    for (const arr of panelsU) for (const v of arr) if (v > 0 && v < L) s.add(Math.round(v * 1e6) / 1e6);
    const a = [...s].sort((x, y) => x - y);
    const mids: number[] = [];
    for (let i = 0; i + 1 < a.length; i++) if (a[i + 1] - a[i] > 1e-6) mids.push((a[i] + a[i + 1]) / 2);
    return mids;
  };
  const cutCoords = (pl: Placement, axis: 'u' | 'v') => pl.panel.region.cuts.flatMap((c) => (axis === 'u' ? [c.x, c.x + c.w] : [c.y, c.y + c.h]));
  const byId = (id: string) => m.placements.filter((pl) => pl.panel.id === id);
  const xs = coords(W, [...byId('front'), ...byId('back'), ...byId('bottom'), ...byId('lid')].map((pl) => cutCoords(pl, 'u')).concat([[t, W - t]]));
  const ys = coords(D, [...byId('left'), ...byId('right')].map((pl) => cutCoords(pl, 'u')).concat([...byId('bottom'), ...byId('lid')].map((pl) => cutCoords(pl, 'v'))));
  const zs = coords(H, m.placements.filter((pl) => ['front', 'back', 'left', 'right'].includes(pl.panel.id)).map((pl) => cutCoords(pl, 'v').map((v) => H - v)));
  let collisions = 0, gaps = 0;
  for (const x of xs)
    for (const y of ys)
      for (const z of zs) {
        const inShell = x < t || x > W - t || y < t || y > D - t || (z < t && !openBottom) || (z > H - t && !openTop);
        let owners = 0;
        for (const pl of m.placements) {
          const uv = pl.map(x, y, z);
          if (uv && regionContains(pl.panel.region, uv.u, uv.v)) owners++;
        }
        if (owners > 1) collisions++;
        if (inShell && owners === 0) {
          // con fondo/coperchio assenti gli spigoli superiori/inferiori sono aperti per costruzione
          if ((z < t && openBottom) || (z > H - t && openTop)) continue;
          gaps++;
        }
      }
  return { collisions, gaps };
}

function layoutSvgs(p: Params, panels: Panel[]): { svgs: string[]; issues: Issue[]; sheets: number; util: number } {
  const issues: Issue[] = [];
  const opts = { sheetW: num(p, 'sheetW'), sheetH: num(p, 'sheetH'), margin: num(p, 'margin'), spacing: num(p, 'spacing'), kerf: 0, maxSheets: 20 };
  const res = nest(panels.map((pn) => ({ id: pn.id, name: pn.name, w: pn.region.w, h: pn.region.h, qty: 1, canRotate: true })), opts);
  for (const u of res.unplaced) issues.push({ level: 'error', field: 'sheetW', message: `"${u.name}" non entra nella lastra (${u.reason}).` });
  const svgs: string[] = [];
  for (let s = 0; s < res.sheetsUsed; s++) {
    const cut: string[] = [];
    const texts: { x: number; y: number; size: number; text: string; family: string; anchor: 'middle' }[] = [];
    for (const pl of res.placed.filter((q) => q.sheet === s)) {
      const pn = panels.find((q) => q.id === pl.partId)!;
      let pts = pn.outline;
      if (pl.rotated) pts = pts.map((q) => ({ x: pn.region.h - q.y, y: q.x }));
      cut.push(polygonPath(translate(pts, pl.x, pl.y)));
      if (bool(p, 'labels')) texts.push({ x: pl.x + pl.w / 2, y: pl.y + pl.h / 2, size: Math.max(2, Math.min(6, pl.h / 5)), text: pn.name, family: 'sans-serif', anchor: 'middle' });
    }
    svgs.push(svgDocument({
      widthMm: opts.sheetW, heightMm: opts.sheetH, title: `INGLY Box — lastra ${s + 1}`,
      description: `Spessore ${fmt(num(p, 'thickness'))} mm, gioco ${fmt(num(p, 'clearance'))} mm, kerf ${fmt(num(p, 'kerf'))} mm. Rosso = taglio; azzurro = guida, da non lavorare.`,
      layers: [{ id: 'taglio', op: 'cut', paths: cut }, { id: 'etichette', op: 'guide', label: 'Nomi pezzi (non lavorare)', paths: [], texts }],
    }));
  }
  return { svgs, issues, sheets: res.sheetsUsed, util: res.utilization };
}

export function runBox(raw: Params): GeneratorResult {
  const { values: p, issues: pi } = normalizeParams(boxParams, raw, boxDefaults);
  if (hasErrors(pi)) return { views: [], issues: pi, stats: [], exports: [] };
  let built: ReturnType<typeof buildBox>;
  try {
    built = buildBox(p);
  } catch (e) {
    return { views: [], issues: [...pi, { level: 'error', message: `Geometria non supportata: ${(e as Error).message}` }], stats: [], exports: [] };
  }
  const issues = [...pi, ...built.issues];
  const m = built.model;
  if (!m || hasErrors(issues)) return { views: [], issues, stats: [], exports: [] };
  // verifica di assemblaggio sulla geometria nominale (senza gioco/kerf)
  const nominal = buildBox(p, true).model!;
  const check = verifyAssembly(nominal, str(p, 'lid') !== 'fixed', !bool(p, 'bottom'));
  if (check.collisions) issues.push({ level: 'error', message: `Verifica 3D: ${check.collisions} zone in cui due pannelli si sovrappongono.` });
  if (check.gaps) issues.push({ level: 'error', message: `Verifica 3D: ${check.gaps} zone del guscio senza materiale (pannello mancante).` });
  const lay = layoutSvgs(p, m.panels);
  issues.push(...lay.issues);
  const base = str(p, 'filename');
  const views = lay.svgs.map((svg, i) => ({ id: `sheet-${i + 1}`, label: `Lastra ${i + 1}`, widthMm: num(p, 'sheetW'), heightMm: num(p, 'sheetH'), svg }));
  const files = () => lay.svgs.map((svg, i) => svgFile(svg, safeFilename(lay.svgs.length > 1 ? `${base}-lastra-${i + 1}` : base, 'svg')));
  const exports: ExportOption[] = lay.svgs.length === 1
    ? [{ id: 'svg', label: 'SVG layout di taglio', requiresValid: true, primary: true, build: async () => files()[0] }]
    : [{ id: 'zip', label: `ZIP con ${lay.svgs.length} lastre`, requiresValid: true, primary: true, build: async () => zipFile(files(), safeFilename(base, 'zip')) }];
  if (lay.svgs.length === 1) exports.push({ id: 'zip', label: 'ZIP (layout + pezzi singoli)', requiresValid: true, build: async () => zipFile([...files(), ...panelFiles(p, m.panels, base)], safeFilename(base, 'zip')) });
  const stats = [
    { label: 'Esterno', value: `${fmt(m.outer.W)} × ${fmt(m.outer.D)} × ${fmt(m.outer.H)} mm` },
    { label: 'Interno utile', value: `${fmt(m.inner.W)} × ${fmt(m.inner.D)} × ${fmt(m.inner.H)} mm` },
    { label: 'Pannelli', value: String(m.panels.length) },
    { label: 'Scomparti', value: String(m.compartments) },
    { label: 'Lastre', value: `${lay.sheets} (utilizzo ${(lay.util * 100).toFixed(1)}%)` },
    { label: 'Verifica 3D', value: check.collisions || check.gaps ? 'non superata' : 'nessuna collisione' },
  ];
  return { views, issues, stats, exports };
}

function panelFiles(p: Params, panels: Panel[], base: string) {
  return panels.map((pn) => svgFile(svgDocument({
    widthMm: pn.region.w, heightMm: pn.region.h, title: pn.name,
    layers: [{ id: 'taglio', op: 'cut', paths: [polygonPath(pn.outline)] }],
    description: `Spessore ${fmt(num(p, 'thickness'))} mm`,
  }), safeFilename(`${base}-${pn.id}`, 'svg')));
}

export const box: GeneratorDef = {
  id: 'box',
  slug: 'box-generator',
  code: '02',
  title: 'INGLY Box & Enclosure',
  tagline: 'Scatole a incastro e organizer con scomparti, verificati in 3D prima del taglio.',
  params: boxParams,
  defaults: boxDefaults,
  presets: [
    { id: 'small', label: 'Scatolina 100×70×40', values: { width: 100, depth: 70, height: 40, lid: 'lift', divX: 0, divY: 0 } },
    { id: 'organizer', label: 'Organizer 6 scomparti', values: { width: 240, depth: 150, height: 60, lid: 'none', divX: 1, divY: 2, fingerWidth: 12 } },
    { id: 'closed', label: 'Scatola chiusa', values: { width: 150, depth: 100, height: 80, lid: 'fixed', fingerWidth: 12 } },
  ],
  run: (p) => runBox(p),
};
