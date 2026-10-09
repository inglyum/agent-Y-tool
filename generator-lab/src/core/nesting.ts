// Nesting rettangolare deterministico: algoritmo MaxRects con euristica Best Short Side Fit.
// Rif.: J. Jylänki, "A Thousand Ways to Pack the Bin — A Practical Approach to Two-Dimensional
// Rectangle Bin Packing" (2010). Ogni lastra mantiene l'elenco dei rettangoli liberi massimali;
// ogni pezzo va nella posizione che minimizza lo scarto sul lato corto, con spareggi stabili.
// I pezzi sono trattati come rettangoli d'ingombro (bounding box), ruotabili di 90° se ammesso.
import { EPS, type Rect, rectInside, rectsOverlap } from './geometry.ts';

export interface PartSpec {
  id: string;
  name: string;
  w: number;
  h: number;
  qty: number;
  canRotate: boolean;
}

export interface PlacedPart {
  partId: string;
  name: string;
  instance: number;
  sheet: number;
  /** posizione del pezzo reale (senza spaziatura), in mm sulla lastra */
  x: number;
  y: number;
  w: number;
  h: number;
  rotated: boolean;
}

export interface NestOptions {
  sheetW: number;
  sheetH: number;
  margin: number;
  /** distanza minima fra i bordi di due pezzi */
  spacing: number;
  /** larghezza del taglio: si somma alla spaziatura */
  kerf: number;
  maxSheets: number;
}

export interface NestResult {
  placed: PlacedPart[];
  unplaced: { partId: string; name: string; count: number; reason: string }[];
  sheetsUsed: number;
  usedArea: number;
  sheetArea: number;
  utilization: number;
}

interface Bin {
  free: Rect[];
}

function scoreBSSF(free: Rect, w: number, h: number): [number, number] | null {
  if (w > free.w + EPS || h > free.h + EPS) return null;
  const lw = free.w - w, lh = free.h - h;
  return [Math.min(lw, lh), Math.max(lw, lh)];
}

function splitFree(bin: Bin, used: Rect): void {
  const next: Rect[] = [];
  for (const f of bin.free) {
    if (!rectsOverlap(f, used)) {
      next.push(f);
      continue;
    }
    if (used.x > f.x + EPS) next.push({ x: f.x, y: f.y, w: used.x - f.x, h: f.h });
    if (used.x + used.w < f.x + f.w - EPS) next.push({ x: used.x + used.w, y: f.y, w: f.x + f.w - (used.x + used.w), h: f.h });
    if (used.y > f.y + EPS) next.push({ x: f.x, y: f.y, w: f.w, h: used.y - f.y });
    if (used.y + used.h < f.y + f.h - EPS) next.push({ x: f.x, y: used.y + used.h, w: f.w, h: f.y + f.h - (used.y + used.h) });
  }
  // elimina i rettangoli contenuti in altri (mantiene solo quelli massimali)
  bin.free = next.filter((a, i) => !next.some((b, j) => j !== i && rectInside(a, b) && (!rectInside(b, a) || j < i)));
}

export function nest(parts: PartSpec[], o: NestOptions): NestResult {
  const gap = o.spacing + o.kerf;
  // L'area utile viene allargata di "gap" e ogni pezzo occupa (w+gap)×(h+gap): così la distanza fra
  // pezzi vale esattamente gap e quella dal bordo esattamente margin.
  const usableW = o.sheetW - 2 * o.margin + gap;
  const usableH = o.sheetH - 2 * o.margin + gap;
  const bins: Bin[] = [];
  const placed: PlacedPart[] = [];
  const unplacedMap = new Map<string, { partId: string; name: string; count: number; reason: string }>();

  // ordine deterministico: area decrescente, poi lato lungo, poi id
  const queue: { part: PartSpec; instance: number }[] = [];
  for (const part of parts) for (let i = 0; i < part.qty; i++) queue.push({ part, instance: i + 1 });
  queue.sort((a, b) => b.part.w * b.part.h - a.part.w * a.part.h || Math.max(b.part.w, b.part.h) - Math.max(a.part.w, a.part.h) || a.part.id.localeCompare(b.part.id) || a.instance - b.instance);

  const fitsEmpty = (pw: number, ph: number) => pw <= usableW + EPS && ph <= usableH + EPS;

  for (const { part, instance } of queue) {
    const W = part.w + gap, H = part.h + gap;
    const canNormal = fitsEmpty(W, H);
    const canRot = part.canRotate && fitsEmpty(H, W);
    if (!canNormal && !canRot) {
      addUnplaced(unplacedMap, part, 'più grande dell\'area utile della lastra');
      continue;
    }
    let best: { bin: number; rect: Rect; rotated: boolean; s: [number, number] } | null = null;
    const tryBin = (bi: number) => {
      for (const f of bins[bi].free) {
        for (const rotated of part.canRotate ? [false, true] : [false]) {
          const w = rotated ? H : W, h = rotated ? W : H;
          const s = scoreBSSF(f, w, h);
          if (!s) continue;
          if (!best || s[0] < best.s[0] - EPS || (Math.abs(s[0] - best.s[0]) <= EPS && (s[1] < best.s[1] - EPS || (Math.abs(s[1] - best.s[1]) <= EPS && (f.y < best.rect.y - EPS || (Math.abs(f.y - best.rect.y) <= EPS && f.x < best.rect.x - EPS))))))
            best = { bin: bi, rect: { x: f.x, y: f.y, w, h }, rotated, s };
        }
      }
    };
    // riempie le lastre in ordine: si apre una nuova lastra solo se il pezzo non entra nelle precedenti
    for (let bi = 0; bi < bins.length && !best; bi++) tryBin(bi);
    if (!best) {
      if (bins.length >= o.maxSheets) {
        addUnplaced(unplacedMap, part, `limite di ${o.maxSheets} lastre raggiunto`);
        continue;
      }
      bins.push({ free: [{ x: 0, y: 0, w: usableW, h: usableH }] });
      tryBin(bins.length - 1);
    }
    if (!best) {
      addUnplaced(unplacedMap, part, 'nessuna posizione disponibile');
      continue;
    }
    const b = best as { bin: number; rect: Rect; rotated: boolean };
    splitFree(bins[b.bin], b.rect);
    placed.push({
      partId: part.id, name: part.name, instance, sheet: b.bin,
      x: o.margin + b.rect.x, y: o.margin + b.rect.y,
      w: b.rotated ? part.h : part.w, h: b.rotated ? part.w : part.h, rotated: b.rotated,
    });
  }
  const sheetArea = bins.length * o.sheetW * o.sheetH;
  const usedArea = placed.reduce((s, p) => s + p.w * p.h, 0);
  return {
    placed,
    unplaced: [...unplacedMap.values()],
    sheetsUsed: bins.length,
    usedArea,
    sheetArea,
    utilization: sheetArea > 0 ? usedArea / sheetArea : 0,
  };
}

function addUnplaced(m: Map<string, { partId: string; name: string; count: number; reason: string }>, part: PartSpec, reason: string) {
  const e = m.get(part.id);
  if (e) e.count++;
  else m.set(part.id, { partId: part.id, name: part.name, count: 1, reason });
}

/** Verifica indipendente del risultato: margini, sovrapposizioni e distanza minima. */
export function verifyNest(r: NestResult, o: NestOptions): string[] {
  const errs: string[] = [];
  const gap = o.spacing + o.kerf;
  const sheet: Rect = { x: 0, y: 0, w: o.sheetW, h: o.sheetH };
  for (const p of r.placed) {
    if (!rectInside(p, sheet, o.margin)) errs.push(`${p.name} #${p.instance} viola il margine della lastra ${p.sheet + 1}`);
  }
  for (let i = 0; i < r.placed.length; i++)
    for (let j = i + 1; j < r.placed.length; j++) {
      const a = r.placed[i], b = r.placed[j];
      if (a.sheet === b.sheet && rectsOverlap(a, b, gap - 1e-4)) errs.push(`${a.name} #${a.instance} e ${b.name} #${b.instance} sono più vicini di ${gap} mm o sovrapposti`);
    }
  return errs;
}
