// geometry-engine: primitive 2D in millimetri, trasformazioni e controlli geometrici.
// Convenzione: assi SVG (x verso destra, y verso il basso), unità = mm.

export interface Pt {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Circle {
  cx: number;
  cy: number;
  r: number;
}

export const EPS = 1e-6;

/** Formattazione numerica compatta e stabile per SVG (max 3 decimali = 1 µm). */
export function fmt(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`Valore non finito nella geometria: ${n}`);
  const r = Math.round(n * 1000) / 1000;
  return (Object.is(r, -0) ? 0 : r).toString();
}

export function polygonPath(pts: Pt[], closed = true): string {
  if (pts.length === 0) return '';
  let d = `M${fmt(pts[0].x)} ${fmt(pts[0].y)}`;
  for (let i = 1; i < pts.length; i++) d += `L${fmt(pts[i].x)} ${fmt(pts[i].y)}`;
  return closed ? d + 'Z' : d;
}

export function circlePath(c: Circle): string {
  const { cx, cy, r } = c;
  return `M${fmt(cx - r)} ${fmt(cy)}A${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(cx + r)} ${fmt(cy)}A${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(cx - r)} ${fmt(cy)}Z`;
}

export type CornerStyle = 'round' | 'chamfer' | 'square';

/** Rettangolo con angoli raccordati o smussati. Ritorna un path SVG chiuso (senso orario). */
export function roundedRectPath(x: number, y: number, w: number, h: number, r: number, style: CornerStyle = 'round'): string {
  const rr = style === 'square' ? 0 : Math.max(0, Math.min(r, w / 2, h / 2));
  if (rr <= EPS) return polygonPath([{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]);
  if (style === 'chamfer') {
    return polygonPath([
      { x: x + rr, y }, { x: x + w - rr, y }, { x: x + w, y: y + rr }, { x: x + w, y: y + h - rr },
      { x: x + w - rr, y: y + h }, { x: x + rr, y: y + h }, { x, y: y + h - rr }, { x, y: y + rr },
    ]);
  }
  const R = fmt(rr);
  return (
    `M${fmt(x + rr)} ${fmt(y)}H${fmt(x + w - rr)}A${R} ${R} 0 0 1 ${fmt(x + w)} ${fmt(y + rr)}` +
    `V${fmt(y + h - rr)}A${R} ${R} 0 0 1 ${fmt(x + w - rr)} ${fmt(y + h)}` +
    `H${fmt(x + rr)}A${R} ${R} 0 0 1 ${fmt(x)} ${fmt(y + h - rr)}` +
    `V${fmt(y + rr)}A${R} ${R} 0 0 1 ${fmt(x + rr)} ${fmt(y)}Z`
  );
}

/** Approssimazione poligonale (per controlli) di un rettangolo con angoli. */
export function roundedRectPolygon(x: number, y: number, w: number, h: number, r: number, style: CornerStyle = 'round', seg = 8): Pt[] {
  const rr = style === 'square' ? 0 : Math.max(0, Math.min(r, w / 2, h / 2));
  if (rr <= EPS) return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
  if (style === 'chamfer') {
    return [
      { x: x + rr, y }, { x: x + w - rr, y }, { x: x + w, y: y + rr }, { x: x + w, y: y + h - rr },
      { x: x + w - rr, y: y + h }, { x: x + rr, y: y + h }, { x, y: y + h - rr }, { x, y: y + rr },
    ];
  }
  const pts: Pt[] = [];
  const corners = [
    { cx: x + w - rr, cy: y + rr, a0: -Math.PI / 2 },
    { cx: x + w - rr, cy: y + h - rr, a0: 0 },
    { cx: x + rr, cy: y + h - rr, a0: Math.PI / 2 },
    { cx: x + rr, cy: y + rr, a0: Math.PI },
  ];
  for (const c of corners) {
    for (let i = 0; i <= seg; i++) {
      const a = c.a0 + (i / seg) * (Math.PI / 2);
      pts.push({ x: c.cx + rr * Math.cos(a), y: c.cy + rr * Math.sin(a) });
    }
  }
  return pts;
}

export function regularPolygon(cx: number, cy: number, rx: number, ry: number, n: number, rot = -Math.PI / 2): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    pts.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
  }
  return pts;
}

export function translate(pts: Pt[], dx: number, dy: number): Pt[] {
  return pts.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

export function bbox(pts: Pt[]): Rect {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Area con segno (positiva = orario negli assi SVG). */
export function signedArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j].x * pts[i].y - pts[i].x * pts[j].y);
  return a / 2;
}

export function area(pts: Pt[]): number {
  return Math.abs(signedArea(pts));
}

export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function distPointSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  let t = l2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Distanza minima fra un punto e il contorno di un poligono. */
export function distToPolygonEdge(p: Pt, poly: Pt[]): number {
  let d = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) d = Math.min(d, distPointSegment(p, poly[j], poly[i]));
  return d;
}

/** Margine fra un cerchio e il contorno di un poligono (negativo se esce). */
export function circleClearanceInPolygon(c: Circle, poly: Pt[]): number {
  const center = { x: c.cx, y: c.cy };
  if (!pointInPolygon(center, poly)) return -Infinity;
  return distToPolygonEdge(center, poly) - c.r;
}

export function circlesGap(a: Circle, b: Circle): number {
  return Math.hypot(a.cx - b.cx, a.cy - b.cy) - a.r - b.r;
}

export function rectsOverlap(a: Rect, b: Rect, gap = 0): boolean {
  return a.x < b.x + b.w + gap - EPS && b.x < a.x + a.w + gap - EPS && a.y < b.y + b.h + gap - EPS && b.y < a.y + a.h + gap - EPS;
}

export function rectInside(inner: Rect, outer: Rect, margin = 0): boolean {
  return (
    inner.x >= outer.x + margin - EPS &&
    inner.y >= outer.y + margin - EPS &&
    inner.x + inner.w <= outer.x + outer.w - margin + EPS &&
    inner.y + inner.h <= outer.y + outer.h - margin + EPS
  );
}

function segIntersect(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (Math.abs(d) < 1e-12) return false;
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
  return t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9;
}

/** True se il poligono chiuso ha lati che si incrociano (geometria non tagliabile). */
export function selfIntersects(pts: Pt[]): boolean {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a1 = pts[i], a2 = pts[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segIntersect(a1, a2, pts[j], pts[(j + 1) % n])) return true;
    }
  }
  return false;
}

/** Rimuove vertici consecutivi duplicati e collineari. */
export function simplify(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.x - p.x) > EPS || Math.abs(last.y - p.y) > EPS) out.push(p);
  }
  if (out.length > 1 && Math.abs(out[0].x - out[out.length - 1].x) < EPS && Math.abs(out[0].y - out[out.length - 1].y) < EPS) out.pop();
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const a = out[(i - 1 + out.length) % out.length], b = out[i], c = out[(i + 1) % out.length];
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (Math.abs(cross) < 1e-9) {
        out.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return out;
}

/** Generatore pseudo-casuale deterministico (mulberry32) per motivi riproducibili. */
export function rng(seed: number): () => number {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Intervallo verticale [top, bottom] di un poligono convesso alla coordinata x (null se fuori). */
export function convexYRange(poly: Pt[], x: number): [number, number] | null {
  let top = Infinity, bot = -Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i];
    const lo = Math.min(a.x, b.x), hi = Math.max(a.x, b.x);
    if (x < lo - EPS || x > hi + EPS) continue;
    let ys: number[];
    if (Math.abs(b.x - a.x) < EPS) ys = [a.y, b.y];
    else ys = [a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y)];
    for (const y of ys) {
      top = Math.min(top, y);
      bot = Math.max(bot, y);
    }
  }
  return top <= bot ? [top, bot] : null;
}
