// Contorni di regioni rettilinee: rettangolo base meno rettangoli rimossi (dita, cave, intagli).
// Il calcolo avviene su griglia a coordinate compresse, quindi è esatto (nessuna discretizzazione).
import { EPS, type Pt, type Rect, simplify } from './geometry.ts';

export interface RectRegion {
  w: number;
  h: number;
  /** rettangoli di materiale rimosso, in coordinate locali */
  cuts: Rect[];
}

function uniq(v: number[]): number[] {
  const s = [...v].sort((a, b) => a - b);
  const out: number[] = [];
  for (const x of s) if (!out.length || x - out[out.length - 1] > EPS) out.push(x);
  return out;
}

function inside(px: number, py: number, r: Rect): boolean {
  return px > r.x && px < r.x + r.w && py > r.y && py < r.y + r.h;
}

/** Vero se il punto (interno, non sul bordo) è materiale. */
export function regionContains(reg: RectRegion, px: number, py: number): boolean {
  if (px <= 0 || py <= 0 || px >= reg.w || py >= reg.h) return false;
  return !reg.cuts.some((c) => inside(px, py, c));
}

/** Contorni chiusi (orari negli assi SVG) della regione. Più di un contorno = pezzo diviso o con fori. */
export function traceRegion(reg: RectRegion): Pt[][] {
  const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));
  const xs = uniq([0, reg.w, ...reg.cuts.flatMap((c) => [clamp(c.x, reg.w), clamp(c.x + c.w, reg.w)])]);
  const ys = uniq([0, reg.h, ...reg.cuts.flatMap((c) => [clamp(c.y, reg.h), clamp(c.y + c.h, reg.h)])]);
  const nx = xs.length - 1, ny = ys.length - 1;
  const filled: boolean[][] = [];
  for (let i = 0; i < nx; i++) {
    filled.push([]);
    for (let j = 0; j < ny; j++) filled[i].push(regionContains(reg, (xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2));
  }
  const F = (i: number, j: number) => i >= 0 && j >= 0 && i < nx && j < ny && filled[i][j];
  // lati orientati: la materia resta sempre a destra del verso di percorrenza
  const edges = new Map<string, { a: [number, number]; b: [number, number] }[]>();
  const key = (i: number, j: number) => `${i},${j}`;
  const add = (a: [number, number], b: [number, number]) => {
    const k = key(a[0], a[1]);
    const l = edges.get(k);
    if (l) l.push({ a, b });
    else edges.set(k, [{ a, b }]);
  };
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++) {
      if (!filled[i][j]) continue;
      if (!F(i, j - 1)) add([i, j], [i + 1, j]);
      if (!F(i + 1, j)) add([i + 1, j], [i + 1, j + 1]);
      if (!F(i, j + 1)) add([i + 1, j + 1], [i, j + 1]);
      if (!F(i - 1, j)) add([i, j + 1], [i, j]);
    }
  const loops: Pt[][] = [];
  for (;;) {
    const firstKey = [...edges.keys()].find((k) => edges.get(k)!.length);
    if (!firstKey) break;
    const loop: Pt[] = [];
    let e = edges.get(firstKey)!.pop()!;
    const start = key(e.a[0], e.a[1]);
    for (let guard = 0; guard < 1e6; guard++) {
      loop.push({ x: xs[e.a[0]], y: ys[e.a[1]] });
      const k = key(e.b[0], e.b[1]);
      if (k === start) break;
      const l = edges.get(k);
      if (!l || !l.length) throw new Error('Contorno aperto: geometria non valida');
      e = l.pop()!;
    }
    loops.push(simplify(loop));
  }
  return loops;
}
