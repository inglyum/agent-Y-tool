// raster-engine: maschere binarie, trasformata di distanza esatta, tracciamento dei contorni
// e conversione in tracciati vettoriali. Tutto in pixel; la conversione in mm avviene alla fine.
import { type Pt, fmt, signedArea } from './geometry.ts';

export interface Rgba {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Maschera binaria: 1 = pieno. */
export interface Mask {
  w: number;
  h: number;
  data: Uint8Array;
}

export function newMask(w: number, h: number): Mask {
  return { w, h, data: new Uint8Array(w * h) };
}

/** Ridimensionamento RGBA a media d'area (solo riduzione; se più piccola restituisce una copia). */
export function downscale(src: Rgba, maxSide: number): Rgba {
  const k = Math.min(1, maxSide / Math.max(src.width, src.height));
  const w = Math.max(1, Math.round(src.width * k)), h = Math.max(1, Math.round(src.height * k));
  if (w === src.width && h === src.height) return { width: w, height: h, data: new Uint8ClampedArray(src.data) };
  const out = new Uint8ClampedArray(w * h * 4);
  const sx = src.width / w, sy = src.height / h;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy++)
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * src.width + xx) * 4;
          const al = src.data[i + 3];
          // media pesata sull'alfa: i bordi trasparenti non scuriscono i colori
          r += src.data[i] * al; g += src.data[i + 1] * al; b += src.data[i + 2] * al; a += al; n++;
        }
      const o = (y * w + x) * 4;
      out[o] = a ? r / a : 255; out[o + 1] = a ? g / a : 255; out[o + 2] = a ? b / a : 255; out[o + 3] = a / n;
    }
  return { width: w, height: h, data: out };
}

export function hasTransparency(img: Rgba): boolean {
  let n = 0;
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i] < 128) n++;
  return n > img.width * img.height * 0.01;
}

/** Colore di sfondo stimato: mediana dei pixel del bordo. */
export function borderColor(img: Rgba): [number, number, number] {
  const rs: number[] = [], gs: number[] = [], bs: number[] = [];
  const push = (x: number, y: number) => {
    const i = (y * img.width + x) * 4;
    rs.push(img.data[i]); gs.push(img.data[i + 1]); bs.push(img.data[i + 2]);
  };
  for (let x = 0; x < img.width; x++) { push(x, 0); push(x, img.height - 1); }
  for (let y = 0; y < img.height; y++) { push(0, y); push(img.width - 1, y); }
  const med = (a: number[]) => a.sort((p, q) => p - q)[a.length >> 1];
  return [med(rs), med(gs), med(bs)];
}

/** Soggetto = pixel opachi (se c'è trasparenza) o diversi dallo sfondo oltre la tolleranza (0–255). */
export function subjectMask(img: Rgba, tolerance: number): Mask {
  const m = newMask(img.width, img.height);
  if (hasTransparency(img)) {
    for (let i = 0; i < m.data.length; i++) m.data[i] = img.data[i * 4 + 3] >= 128 ? 1 : 0;
    return m;
  }
  const [br, bg, bb] = borderColor(img);
  const t2 = tolerance * tolerance * 3;
  for (let i = 0; i < m.data.length; i++) {
    const dr = img.data[i * 4] - br, dg = img.data[i * 4 + 1] - bg, db = img.data[i * 4 + 2] - bb;
    m.data[i] = dr * dr + dg * dg + db * db > t2 ? 1 : 0;
  }
  return m;
}

/** Riempie i buchi interni: resta vuoto solo ciò che è collegato al bordo. */
export function fillHoles(m: Mask): Mask {
  const { w, h } = m;
  const outside = new Uint8Array(w * h);
  const stack: number[] = [];
  const seed = (i: number) => {
    if (!m.data[i] && !outside[i]) { outside[i] = 1; stack.push(i); }
  };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w, y = (i / w) | 0;
    if (x > 0) seed(i - 1);
    if (x < w - 1) seed(i + 1);
    if (y > 0) seed(i - w);
    if (y < h - 1) seed(i + w);
  }
  const out = newMask(w, h);
  for (let i = 0; i < out.data.length; i++) out.data[i] = outside[i] ? 0 : 1;
  return out;
}

/** Aggiunge un bordo vuoto di p pixel (per dilatare oltre i limiti dell'immagine). */
export function padMask(m: Mask, p: number): Mask {
  const out = newMask(m.w + 2 * p, m.h + 2 * p);
  for (let y = 0; y < m.h; y++) out.data.set(m.data.subarray(y * m.w, (y + 1) * m.w), (y + p) * out.w + p);
  return out;
}

const INF = 1e20;

function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0; z[0] = -INF; z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q; z[k] = s; z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/**
 * Trasformata di distanza euclidea esatta (Felzenszwalb & Huttenlocher, 2012):
 * per ogni pixel, distanza al quadrato dal pixel pieno più vicino.
 */
export function edtSquared(m: Mask): Float64Array {
  const { w, h } = m;
  const n = Math.max(w, h);
  const f = new Float64Array(n), d = new Float64Array(n), z = new Float64Array(n + 1);
  const v = new Int32Array(n);
  const out = new Float64Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = m.data[i] ? 0 : INF;
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = out[y * w + x];
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) out[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = out[y * w + x];
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) out[y * w + x] = d[x];
  }
  return out;
}

export function dilate(m: Mask, r: number): Mask {
  if (r <= 0) return { ...m, data: new Uint8Array(m.data) };
  const d = edtSquared(m);
  const out = newMask(m.w, m.h);
  const r2 = r * r;
  for (let i = 0; i < d.length; i++) out.data[i] = d[i] <= r2 ? 1 : 0;
  return out;
}

export function erode(m: Mask, r: number): Mask {
  if (r <= 0) return { ...m, data: new Uint8Array(m.data) };
  const inv = newMask(m.w, m.h);
  for (let i = 0; i < inv.data.length; i++) inv.data[i] = m.data[i] ? 0 : 1;
  const d = edtSquared(inv);
  const out = newMask(m.w, m.h);
  const r2 = r * r;
  for (let i = 0; i < d.length; i++) out.data[i] = m.data[i] && d[i] > r2 ? 1 : 0;
  return out;
}

/** Chiusura morfologica: elimina rientranze e fessure più strette di 2r. */
export function close(m: Mask, r: number): Mask {
  return erode(dilate(m, r), r);
}

export function countFilled(m: Mask): number {
  let n = 0;
  for (let i = 0; i < m.data.length; i++) n += m.data[i];
  return n;
}

/**
 * Contorni della maschera sui bordi dei pixel (materia sempre a destra del verso di percorrenza).
 * Ai vertici a sella si gira a destra: due pixel che si toccano solo in diagonale restano separati.
 * Esterni in senso orario (area > 0), buchi in senso antiorario (area < 0).
 */
export function traceMask(m: Mask): Pt[][] {
  const { w, h } = m;
  const W = w + 1;
  const F = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && m.data[y * w + x] === 1;
  // per ogni vertice: bitmask delle direzioni uscenti 1=destra 2=giù 4=sinistra 8=su
  const out = new Uint8Array(W * (h + 1));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!F(x, y)) continue;
      if (!F(x, y - 1)) out[y * W + x] |= 1;
      if (!F(x + 1, y)) out[y * W + x + 1] |= 2;
      if (!F(x, y + 1)) out[(y + 1) * W + x + 1] |= 4;
      if (!F(x - 1, y)) out[(y + 1) * W + x] |= 8;
    }
  const DX = [0, 1, 0, 0, -1, 0, 0, 0, 0], DY = [0, 0, 1, 0, 0, 0, 0, 0, -1];
  // direzione → bit: destra=1, giù=2, sinistra=4, su=8; ordine di preferenza: destra, dritto, sinistra
  const rightOf: Record<number, number> = { 1: 2, 2: 4, 4: 8, 8: 1 };
  const leftOf: Record<number, number> = { 1: 8, 2: 1, 4: 2, 8: 4 };
  const loops: Pt[][] = [];
  for (let s = 0; s < out.length; s++) {
    while (out[s]) {
      const sx = s % W, sy = (s / W) | 0;
      let dir = out[s] & -out[s];
      out[s] &= ~dir;
      let x = sx + DX[dir], y = sy + DY[dir];
      const pts: Pt[] = [{ x: sx, y: sy }];
      let prev = dir;
      let guard = 0;
      while ((x !== sx || y !== sy) && guard++ < 4 * W * (h + 1)) {
        const vi = y * W + x;
        const avail = out[vi];
        const choice = [rightOf[prev], prev, leftOf[prev]].find((d) => avail & d);
        if (!choice) break;
        out[vi] &= ~choice;
        if (choice !== prev) pts.push({ x, y });
        prev = choice;
        x += DX[choice];
        y += DY[choice];
      }
      if (pts.length >= 3) loops.push(pts);
      void dir;
    }
  }
  return loops;
}

function rdp(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts.slice();
  const a = pts[0], b = pts[pts.length - 1];
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1e-9;
  let best = -1, bi = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs(dy * pts[i].x - dx * pts[i].y + b.x * a.y - b.y * a.x) / len;
    if (d > best) { best = d; bi = i; }
  }
  if (best <= eps) return [a, b];
  const l = rdp(pts.slice(0, bi + 1), eps), r = rdp(pts.slice(bi), eps);
  return [...l.slice(0, -1), ...r];
}

/**
 * Rimuove la "scaletta" dei pixel: ogni tratto è rappresentato dal suo punto medio e un vertice resta
 * solo dove si incontrano due tratti lunghi (spigolo vero). Le diagonali e le curve diventano lisce,
 * gli angoli dei rettangoli restano vivi.
 */
export function destair(loop: Pt[]): Pt[] {
  const n = loop.length;
  if (n < 4) return loop;
  const len = (i: number) => {
    const a = loop[i], b = loop[(i + 1) % n];
    return Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
  };
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = loop[i], b = loop[(i + 1) % n];
    if (len((i - 1 + n) % n) > 1.5 && len(i) > 1.5) out.push(a);
    out.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  }
  return out;
}

/** Semplificazione Ramer–Douglas–Peucker di un contorno chiuso. */
export function simplifyLoop(loop: Pt[], eps: number): Pt[] {
  if (loop.length <= 4 || eps <= 0) return loop;
  let far = 0, fd = -1;
  for (let i = 1; i < loop.length; i++) {
    const d = (loop[i].x - loop[0].x) ** 2 + (loop[i].y - loop[0].y) ** 2;
    if (d > fd) { fd = d; far = i; }
  }
  const a = rdp(loop.slice(0, far + 1), eps);
  const b = rdp([...loop.slice(far), loop[0]], eps);
  const out = [...a.slice(0, -1), ...b.slice(0, -1)];
  return out.length >= 3 ? out : loop;
}

export interface VectorOptions {
  /** mm per pixel */
  scale: number;
  dx: number;
  dy: number;
  /** tolleranza di semplificazione in pixel */
  tolerance: number;
  /** angolo oltre il quale un vertice resta spigolo (gradi); 180 = tutto spigoli */
  cornerDeg: number;
  /** contorni con area inferiore (pixel²) vengono scartati */
  minArea: number;
}

export interface VectorLoop {
  pts: Pt[];
  /** area con segno in mm² (positiva = contorno esterno) */
  area: number;
}

/** Contorni semplificati in mm, senza i frammenti più piccoli di minArea. */
export function vectorLoops(loops: Pt[][], o: VectorOptions): VectorLoop[] {
  const out: VectorLoop[] = [];
  for (const l of loops) {
    const a = signedArea(l);
    if (Math.abs(a) < o.minArea) continue;
    const s = simplifyLoop(destair(l), o.tolerance).map((p) => ({ x: o.dx + p.x * o.scale, y: o.dy + p.y * o.scale }));
    if (s.length >= 3) out.push({ pts: s, area: a * o.scale * o.scale });
  }
  return out;
}

/**
 * Path SVG con curve quadratiche fra i punti medi. Restano spigoli vivi i vertici più acuti di
 * cornerDeg e quelli fra due tratti lunghi almeno cornerLen (bordi dritti che si incontrano).
 */
export function smoothPath(loops: VectorLoop[], cornerDeg: number, cornerLen = Infinity): string {
  const lim = (cornerDeg * Math.PI) / 180;
  let d = '';
  for (const { pts: p } of loops) {
    const n = p.length;
    const mid = (a: Pt, b: Pt) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const isCorner = (i: number) => {
      const a = p[(i - 1 + n) % n], b = p[i], c = p[(i + 1) % n];
      const t1 = Math.atan2(b.y - a.y, b.x - a.x), t2 = Math.atan2(c.y - b.y, c.x - b.x);
      let t = Math.abs(t2 - t1);
      if (t > Math.PI) t = 2 * Math.PI - t;
      if (t >= lim) return true;
      return t > 0.12 && Math.hypot(b.x - a.x, b.y - a.y) >= cornerLen && Math.hypot(c.x - b.x, c.y - b.y) >= cornerLen;
    };
    const m0 = mid(p[n - 1], p[0]);
    d += `M${fmt(m0.x)} ${fmt(m0.y)}`;
    for (let i = 0; i < n; i++) {
      const m = mid(p[i], p[(i + 1) % n]);
      if (isCorner(i)) d += `L${fmt(p[i].x)} ${fmt(p[i].y)}L${fmt(m.x)} ${fmt(m.y)}`;
      else d += `Q${fmt(p[i].x)} ${fmt(p[i].y)} ${fmt(m.x)} ${fmt(m.y)}`;
    }
    d += 'Z';
  }
  return d;
}

// ---------- quantizzazione colori ----------
export interface Palette {
  colors: [number, number, number][];
  /** etichetta per pixel (−1 = trasparente) */
  labels: Int16Array;
}

const lum = (c: [number, number, number]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** k-means deterministico (inizializzazione per quantili di luminosità), colori ordinati dal più chiaro. */
export function quantize(img: Rgba, k: number, iterations = 12): Palette {
  const n = img.width * img.height;
  const idx: number[] = [];
  for (let i = 0; i < n; i++) if (img.data[i * 4 + 3] >= 128) idx.push(i);
  const labels = new Int16Array(n).fill(-1);
  if (!idx.length) return { colors: [], labels };
  const stride = Math.max(1, Math.floor(idx.length / 30000));
  const sample = idx.filter((_, i) => i % stride === 0);
  const px = (i: number): [number, number, number] => [img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2]];
  // inizializzazione "punto più lontano" (deterministica): anche un colore con poca superficie
  // ottiene il suo centro invece di essere assorbito da quelli dominanti
  const sorted = [...sample].sort((a, b) => lum(px(a)) - lum(px(b)));
  let C: [number, number, number][] = [px(sorted[sorted.length >> 1])];
  const dmin = sample.map((i) => { const c = px(i); return (c[0] - C[0][0]) ** 2 + (c[1] - C[0][1]) ** 2 + (c[2] - C[0][2]) ** 2; });
  while (C.length < k) {
    let bi = -1, bd = 0;
    for (let s = 0; s < sample.length; s++) if (dmin[s] > bd) { bd = dmin[s]; bi = s; }
    if (bi < 0) break;
    const c = px(sample[bi]);
    C.push(c);
    for (let s = 0; s < sample.length; s++) {
      const q = px(sample[s]);
      dmin[s] = Math.min(dmin[s], (q[0] - c[0]) ** 2 + (q[1] - c[1]) ** 2 + (q[2] - c[2]) ** 2);
    }
  }
  const nearest = (c: [number, number, number]) => {
    let bi = 0, bd = Infinity;
    for (let j = 0; j < C.length; j++) {
      const d = (c[0] - C[j][0]) ** 2 + (c[1] - C[j][1]) ** 2 + (c[2] - C[j][2]) ** 2;
      if (d < bd) { bd = d; bi = j; }
    }
    return bi;
  };
  for (let it = 0; it < iterations; it++) {
    const acc = C.map(() => [0, 0, 0, 0]);
    for (const i of sample) {
      const c = px(i), j = nearest(c);
      acc[j][0] += c[0]; acc[j][1] += c[1]; acc[j][2] += c[2]; acc[j][3]++;
    }
    C = C.map((c, j) => (acc[j][3] ? [acc[j][0] / acc[j][3], acc[j][1] / acc[j][3], acc[j][2] / acc[j][3]] : c));
  }
  // rimuove i duplicati e ordina dal più chiaro al più scuro
  const uniq: [number, number, number][] = [];
  for (const c of C) if (!uniq.some((u) => (u[0] - c[0]) ** 2 + (u[1] - c[1]) ** 2 + (u[2] - c[2]) ** 2 < 4)) uniq.push(c.map(Math.round) as [number, number, number]);
  uniq.sort((a, b) => lum(b) - lum(a));
  C = uniq;
  for (const i of idx) labels[i] = nearest(px(i));
  return { colors: C, labels };
}

export function hex(c: [number, number, number]): string {
  return '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
}

// ---------- rimozione intelligente dello sfondo ----------

/** sRGB (0–255) → CIELAB (D65): distanze percettive fra colori. */
const LIN = (() => {
  const t = new Float64Array(256);
  for (let v = 0; v < 256; v++) { const c = v / 255; t[v] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
  return t;
})();

export function toLab(r: number, g: number, b: number): [number, number, number] {
  const R = LIN[r | 0], G = LIN[g | 0], B = LIN[b | 0];
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047), y = f(0.2126 * R + 0.7152 * G + 0.0722 * B), z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

export interface BackgroundOptions {
  /** sensibilità 1–100: più alta = rimuove più colori simili allo sfondo */
  tolerance: number;
  /** tiene solo il soggetto principale (il gruppo di pixel più grande) */
  keepMain: boolean;
  /** rimuove anche le zone di sfondo racchiuse nel soggetto (es. fra braccio e corpo) */
  enclosed: boolean;
}

export interface BackgroundResult {
  /** 1 = soggetto */
  mask: Mask;
  /** immagine con lo sfondo trasparente e bordi ammorbiditi */
  cutout: Rgba;
  /** colori di sfondo riconosciuti */
  background: [number, number, number][];
  /** quota dell'immagine rimossa (0–1) */
  removed: number;
  method: 'alpha' | 'flood';
}

/**
 * Rimozione dello sfondo senza servizi esterni:
 * 1. modello dello sfondo = colori dominanti del bordo dell'immagine (k-means in Lab);
 * 2. crescita di regione dal bordo: un pixel è sfondo se è vicino al modello, oppure se continua
 *    in modo graduale un pixel di sfondo vicino (sfumature, ombre leggere, vignettature);
 * 3. pulizia: isole minuscole eliminate, buchi del soggetto riempiti, soggetto principale opzionale,
 *    sfondo racchiuso opzionale; 4. bordo morbido (alfa proporzionale alla distanza dallo sfondo).
 * Se l'immagine ha già la trasparenza viene usata quella.
 */
export function removeBackground(img: Rgba, o: BackgroundOptions): BackgroundResult {
  const { width: w, height: h } = img;
  const n = w * h;
  if (hasTransparency(img)) {
    const mask = newMask(w, h);
    for (let i = 0; i < n; i++) mask.data[i] = img.data[i * 4 + 3] >= 128 ? 1 : 0;
    return { mask, cutout: { width: w, height: h, data: new Uint8ClampedArray(img.data) }, background: [], removed: 1 - countFilled(mask) / n, method: 'alpha' };
  }
  const lab = new Float32Array(n * 3);
  const cache = new Map<number, [number, number, number]>();
  for (let i = 0; i < n; i++) {
    const key = (img.data[i * 4] << 16) | (img.data[i * 4 + 1] << 8) | img.data[i * 4 + 2];
    let L = cache.get(key);
    if (!L) { L = toLab(img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2]); if (cache.size < 400000) cache.set(key, L); }
    lab[i * 3] = L[0]; lab[i * 3 + 1] = L[1]; lab[i * 3 + 2] = L[2];
  }
  // 1. colori del bordo → fino a 4 gruppi, scartando quelli rari (oggetti che toccano il bordo)
  const border: number[] = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) border.push(y * w, y * w + w - 1);
  const K = 4;
  const sorted = [...border].sort((a, b) => lab[a * 3] - lab[b * 3]);
  let C = Array.from({ length: K }, (_, k) => { const i = sorted[Math.floor(((k + 0.5) / K) * sorted.length)]; return [lab[i * 3], lab[i * 3 + 1], lab[i * 3 + 2]]; });
  const d2 = (i: number, c: number[]) => (lab[i * 3] - c[0]) ** 2 + (lab[i * 3 + 1] - c[1]) ** 2 + (lab[i * 3 + 2] - c[2]) ** 2;
  let counts: number[] = [];
  for (let it = 0; it < 10; it++) {
    const acc = C.map(() => [0, 0, 0, 0]);
    for (const i of border) {
      let bk = 0, bd = Infinity;
      C.forEach((c, k) => { const d = d2(i, c); if (d < bd) { bd = d; bk = k; } });
      acc[bk][0] += lab[i * 3]; acc[bk][1] += lab[i * 3 + 1]; acc[bk][2] += lab[i * 3 + 2]; acc[bk][3]++;
    }
    C = C.map((c, k) => (acc[k][3] ? [acc[k][0] / acc[k][3], acc[k][1] / acc[k][3], acc[k][2] / acc[k][3]] : c));
    counts = acc.map((a) => a[3]);
  }
  const model = C.filter((_, k) => counts[k] >= border.length * 0.12);
  const T = 4 + o.tolerance * 0.45; // soglia ΔE dal modello di sfondo
  const step = 1.5 + o.tolerance * 0.04; // variazione massima fra pixel vicini di sfondo
  const dm = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let best = Infinity;
    for (let k = 0; k < model.length; k++) {
      const c = model[k];
      const d = (lab[i * 3] - c[0]) ** 2 + (lab[i * 3 + 1] - c[1]) ** 2 + (lab[i * 3 + 2] - c[2]) ** 2;
      if (d < best) best = d;
    }
    dm[i] = Math.sqrt(best);
  }
  // 2. crescita della regione di sfondo dal bordo
  const bg = new Uint8Array(n);
  const queue = new Int32Array(n);
  let qh = 0, qt = 0;
  for (const i of border) if (dm[i] < T && !bg[i]) { bg[i] = 1; queue[qt++] = i; }
  while (qh < qt) {
    const i = queue[qh++];
    const x = i % w, y = (i / w) | 0;
    const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
    for (const j of nb) {
      if (j < 0 || bg[j]) continue;
      const local = Math.sqrt((lab[i * 3] - lab[j * 3]) ** 2 + (lab[i * 3 + 1] - lab[j * 3 + 1]) ** 2 + (lab[i * 3 + 2] - lab[j * 3 + 2]) ** 2);
      if (dm[j] < T || (local < step && dm[j] < T * 2.5)) { bg[j] = 1; queue[qt++] = j; }
    }
  }
  // 3. sfondo racchiuso: zone interne molto simili allo sfondo e non minuscole
  if (o.enclosed) {
    const seen = new Uint8Array(n);
    for (let s = 0; s < n; s++) {
      if (bg[s] || seen[s] || dm[s] >= T * 0.7) continue;
      const comp: number[] = [s];
      seen[s] = 1;
      for (let k = 0; k < comp.length; k++) {
        const i = comp[k], x = i % w, y = (i / w) | 0;
        for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1])
          if (j >= 0 && !seen[j] && !bg[j] && dm[j] < T * 0.7) { seen[j] = 1; comp.push(j); }
      }
      if (comp.length > n * 0.004) for (const i of comp) bg[i] = 1;
    }
  }
  let mask = newMask(w, h);
  for (let i = 0; i < n; i++) mask.data[i] = bg[i] ? 0 : 1;
  // pulizia: componenti del soggetto
  const comps = components(mask);
  const largest = Math.max(0, ...comps.map((c) => c.length));
  for (const c of comps) {
    // solo puntini di rumore: lettere e dettagli piccoli restano (a meno di "solo soggetto principale")
    const drop = c.length < Math.max(6, Math.min(n * 0.00005, largest * 0.002)) || (o.keepMain && c.length !== largest);
    if (drop) for (const i of c) mask.data[i] = 0;
  }
  // buchi piccoli nel soggetto (riflessi, occhi bianchi) restano parte del soggetto
  if (!o.enclosed) mask = fillHoles(mask);
  else {
    const holes = fillHoles(mask);
    const inv = newMask(w, h);
    for (let i = 0; i < n; i++) inv.data[i] = holes.data[i] && !mask.data[i] ? 1 : 0;
    for (const c of components(inv)) if (c.length < n * 0.004) for (const i of c) mask.data[i] = 1;
  }
  // 4. ritaglio con bordo morbido sui pixel di confine
  const cutout = new Uint8ClampedArray(img.data);
  for (let i = 0; i < n; i++) {
    if (!mask.data[i]) { cutout[i * 4 + 3] = 0; continue; }
    const x = i % w, y = (i / w) | 0;
    const edge = (x > 0 && !mask.data[i - 1]) || (x < w - 1 && !mask.data[i + 1]) || (y > 0 && !mask.data[i - w]) || (y < h - 1 && !mask.data[i + w]);
    if (edge) cutout[i * 4 + 3] = Math.round(255 * Math.max(0.35, Math.min(1, (dm[i] - T * 0.5) / T)));
  }
  const bgRgb = model.map(([L, a, b]) => labToRgb(L, a, b));
  return { mask, cutout: { width: w, height: h, data: cutout }, background: bgRgb, removed: 1 - countFilled(mask) / n, method: 'flood' };
}

/** Componenti connesse (4-vicinato) dei pixel pieni. */
export function components(m: Mask): number[][] {
  const seen = new Uint8Array(m.w * m.h);
  const out: number[][] = [];
  for (let s = 0; s < m.data.length; s++) {
    if (!m.data[s] || seen[s]) continue;
    const comp = [s];
    seen[s] = 1;
    for (let k = 0; k < comp.length; k++) {
      const i = comp[k], x = i % m.w, y = (i / m.w) | 0;
      for (const j of [x > 0 ? i - 1 : -1, x < m.w - 1 ? i + 1 : -1, y > 0 ? i - m.w : -1, y < m.h - 1 ? i + m.w : -1])
        if (j >= 0 && m.data[j] && !seen[j]) { seen[j] = 1; comp.push(j); }
    }
    out.push(comp);
  }
  return out;
}

function labToRgb(L: number, a: number, b: number): [number, number, number] {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const inv = (t: number) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  const X = inv(fx) * 0.95047, Y = inv(fy), Z = inv(fz) * 1.08883;
  const R = 3.2406 * X - 1.5372 * Y - 0.4986 * Z, G = -0.9689 * X + 1.8758 * Y + 0.0415 * Z, B = 0.0557 * X - 0.204 * Y + 1.057 * Z;
  const g = (v: number) => Math.round(255 * Math.max(0, Math.min(1, v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)));
  return [g(R), g(G), g(B)];
}
