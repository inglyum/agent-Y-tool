// Compatibilità con i software di lavorazione: adatta gli SVG prodotti dal motore e genera DXF.
//
// Convenzioni comuni a tutti i generatori (svg.ts): gruppi <g data-operation="cut|engrave|score|guide">,
// tracciati assoluti in mm, rosso = taglio, nero pieno = incisione, blu = marcatura, azzurro = guida.
//  - xTool Creative Space / xTool Studio: legge SVG in mm; contorni = taglio/marcatura, riempimenti = incisione.
//  - LightBurn: assegna i livelli in base al colore esatto della sua tavolozza (00 nero, 01 blu, 02 rosso).
//  - Glowforge: separa le operazioni per colore; accetta SVG in mm.
//  - Cricut Design Space: ogni forma diventa un livello di taglio; le guide vanno tolte; per "Stampa e taglia"
//    vuole un PNG con sfondo trasparente (export dedicato nel Print & Cut).
//  - Silhouette Studio (edizione base) e CAD: non aprono SVG, si usa DXF (R12, mm).
//  - Inkscape / Illustrator: i gruppi diventano livelli con nome.
import { unzipStore, zipStore } from './export.ts';
import type { ExportFile } from './types.ts';

export type SoftwareProfile = 'universal' | 'xtool' | 'lightburn' | 'glowforge' | 'cricut' | 'dxf';

export const SOFTWARE_PROFILES: { value: SoftwareProfile; label: string; hint: string }[] = [
  { value: 'universal', label: 'Universale (SVG)', hint: 'xTool, LightBurn, Glowforge, Inkscape, Illustrator: livelli con nome e colori standard.' },
  { value: 'xtool', label: 'xTool Creative Space / Studio', hint: 'SVG in mm senza guide: contorni = taglio o marcatura, riempimenti = incisione.' },
  { value: 'lightburn', label: 'LightBurn', hint: 'Colori della tavolozza LightBurn: 00 nero incisione, 01 blu marcatura, 02 rosso taglio. Guide rimosse.' },
  { value: 'glowforge', label: 'Glowforge', hint: 'Un colore per operazione, guide rimosse.' },
  { value: 'cricut', label: 'Cricut Design Space', hint: 'Forme chiuse senza guide; per Stampa e taglia usa il PNG scontornato.' },
  { value: 'dxf', label: 'DXF (Silhouette, CAD, Cricut)', hint: 'DXF R12 in millimetri, un livello per operazione; curve convertite in segmenti.' },
];

// ---------- lettura degli SVG del motore ----------
export interface SvgGroup {
  op: string;
  label: string;
  paths: string[];
}

export function parseEngineSvg(svg: string): { width: number; height: number; groups: SvgGroup[] } {
  const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  if (!vb) throw new Error('SVG senza viewBox in mm');
  const groups: SvgGroup[] = [];
  const re = /<g [^>]*data-operation="([a-z]+)"[^>]*data-label="([^"]*)"[^>]*>([\s\S]*?)<\/g>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg))) {
    const paths = [...m[3].matchAll(/<path d="([^"]*)"/g)].map((p) => p[1]);
    groups.push({ op: m[1], label: m[2], paths });
  }
  return { width: +vb[1], height: +vb[2], groups };
}

// ---------- conversione dei tracciati in segmenti ----------
type P = [number, number];

/** Converte un path SVG (comandi assoluti M L H V Q C A Z, anche relativi) in polilinee. */
export function flattenPath(d: string, tol = 0.05): { pts: P[]; closed: boolean }[] {
  const tok = d.match(/[MLHVQCSTAZmlhvqcstaz]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
  const out: { pts: P[]; closed: boolean }[] = [];
  let cur: P[] = [];
  let i = 0, x = 0, y = 0, sx = 0, sy = 0, cmd = '';
  let lastCtrl: P | null = null;
  const num = () => parseFloat(tok[i++]);
  const push = (p: P) => cur.push(p);
  const flush = (closed: boolean) => {
    if (cur.length > 1) out.push({ pts: cur, closed });
    cur = [];
  };
  const steps = (len: number) => Math.max(2, Math.min(200, Math.ceil(Math.sqrt(len / tol) )));
  while (i < tok.length) {
    if (/[a-zA-Z]/.test(tok[i])) cmd = tok[i++];
    const rel = cmd === cmd.toLowerCase() && cmd !== 'z';
    const C = cmd.toUpperCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    if (C === 'Z') {
      if (cur.length) push([sx, sy]);
      flush(true);
      x = sx; y = sy;
      lastCtrl = null;
      continue;
    }
    if (C === 'M') {
      flush(false);
      x = ox + num(); y = oy + num();
      sx = x; sy = y;
      push([x, y]);
      cmd = rel ? 'l' : 'L';
      lastCtrl = null;
    } else if (C === 'L') {
      x = ox + num(); y = oy + num();
      push([x, y]);
      lastCtrl = null;
    } else if (C === 'H') {
      x = (rel ? x : 0) + num();
      push([x, y]);
      lastCtrl = null;
    } else if (C === 'V') {
      y = (rel ? y : 0) + num();
      push([x, y]);
      lastCtrl = null;
    } else if (C === 'Q' || C === 'T') {
      const c1: P = C === 'Q' ? [ox + num(), oy + num()] : lastCtrl ? [2 * x - lastCtrl[0], 2 * y - lastCtrl[1]] : [x, y];
      const e: P = [ox + num(), oy + num()];
      const n = steps(Math.hypot(c1[0] - x, c1[1] - y) + Math.hypot(e[0] - c1[0], e[1] - c1[1]));
      for (let k = 1; k <= n; k++) {
        const t = k / n, u = 1 - t;
        push([u * u * x + 2 * u * t * c1[0] + t * t * e[0], u * u * y + 2 * u * t * c1[1] + t * t * e[1]]);
      }
      lastCtrl = c1;
      [x, y] = e;
    } else if (C === 'C' || C === 'S') {
      const c1: P = C === 'C' ? [ox + num(), oy + num()] : lastCtrl ? [2 * x - lastCtrl[0], 2 * y - lastCtrl[1]] : [x, y];
      const c2: P = [ox + num(), oy + num()];
      const e: P = [ox + num(), oy + num()];
      const n = steps(Math.hypot(c1[0] - x, c1[1] - y) + Math.hypot(c2[0] - c1[0], c2[1] - c1[1]) + Math.hypot(e[0] - c2[0], e[1] - c2[1]));
      for (let k = 1; k <= n; k++) {
        const t = k / n, u = 1 - t;
        push([u ** 3 * x + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t ** 3 * e[0], u ** 3 * y + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t ** 3 * e[1]]);
      }
      lastCtrl = c2;
      [x, y] = e;
    } else if (C === 'A') {
      const rx0 = Math.abs(num()), ry0 = Math.abs(num()), rot = (num() * Math.PI) / 180, large = num(), sweep = num();
      const e: P = [ox + num(), oy + num()];
      for (const p of arcPoints([x, y], e, rx0, ry0, rot, large !== 0, sweep !== 0, tol)) push(p);
      [x, y] = e;
      lastCtrl = null;
    } else {
      i++;
    }
  }
  flush(false);
  return out;
}

/** Arco SVG → punti (conversione da estremi a centro, SVG 1.1 appendice F.6.5). */
function arcPoints(p0: P, p1: P, rx: number, ry: number, phi: number, large: boolean, sweep: boolean, tol: number): P[] {
  if (rx === 0 || ry === 0 || (p0[0] === p1[0] && p0[1] === p1[1])) return [p1];
  const cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (p0[0] - p1[0]) / 2, dy = (p0[1] - p1[1]) / 2;
  const x1 = cos * dx + sin * dy, y1 = -sin * dx + cos * dy;
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) { rx *= Math.sqrt(lambda); ry *= Math.sqrt(lambda); }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cx1 = (k * rx * y1) / ry, cy1 = (-k * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (p0[0] + p1[0]) / 2, cy = sin * cx1 + cos * cy1 + (p0[1] + p1[1]) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const t1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let dt = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const r = Math.max(rx, ry);
  const seg = Math.max(4, Math.ceil(Math.abs(dt) / (2 * Math.acos(Math.max(-1, 1 - tol / r)))));
  const pts: P[] = [];
  for (let s = 1; s <= seg; s++) {
    const t = t1 + (dt * s) / seg;
    const ex = rx * Math.cos(t), ey = ry * Math.sin(t);
    pts.push([cos * ex - sin * ey + cx, sin * ex + cos * ey + cy]);
  }
  pts[pts.length - 1] = p1;
  return pts;
}

// ---------- DXF R12 ----------
const DXF_LAYER: Record<string, { name: string; color: number }> = {
  cut: { name: 'TAGLIO', color: 1 }, // rosso ACI
  engrave: { name: 'INCISIONE', color: 7 }, // nero/bianco ACI
  score: { name: 'MARCATURA', color: 5 }, // blu ACI
  guide: { name: 'GUIDA', color: 4 },
};

/** SVG del motore → DXF R12 ASCII in mm (asse Y verso l'alto come nei CAD). */
export function svgToDxf(svg: string, includeGuides = false): string {
  const { height, groups } = parseEngineSvg(svg);
  const lines: string[] = [];
  const g = (code: number, v: string | number) => lines.push(String(code), String(v));
  g(0, 'SECTION'); g(2, 'HEADER');
  g(9, '$ACADVER'); g(1, 'AC1009');
  g(9, '$INSUNITS'); g(70, 4); // millimetri
  g(9, '$MEASUREMENT'); g(70, 1);
  g(0, 'ENDSEC');
  const used = [...new Set(groups.filter((x) => includeGuides || x.op !== 'guide').map((x) => x.op))];
  g(0, 'SECTION'); g(2, 'TABLES');
  g(0, 'TABLE'); g(2, 'LAYER'); g(70, used.length);
  for (const op of used) {
    const L = DXF_LAYER[op] ?? { name: op.toUpperCase(), color: 7 };
    g(0, 'LAYER'); g(2, L.name); g(70, 0); g(62, L.color); g(6, 'CONTINUOUS');
  }
  g(0, 'ENDTAB'); g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'ENTITIES');
  const f = (v: number) => (Math.round(v * 10000) / 10000).toString();
  for (const grp of groups) {
    if (grp.op === 'guide' && !includeGuides) continue;
    const L = DXF_LAYER[grp.op] ?? { name: grp.op.toUpperCase(), color: 7 };
    for (const d of grp.paths)
      for (const poly of flattenPath(d)) {
        let pts = poly.pts;
        const closed = poly.closed || (pts.length > 2 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-6);
        if (closed && pts.length > 2) pts = pts.slice(0, -1);
        g(0, 'POLYLINE'); g(8, L.name); g(66, 1); g(70, closed ? 1 : 0); g(10, 0); g(20, 0); g(30, 0);
        for (const [x, y] of pts) { g(0, 'VERTEX'); g(8, L.name); g(10, f(x)); g(20, f(height - y)); g(30, 0); }
        g(0, 'SEQEND'); g(8, L.name);
      }
  }
  g(0, 'ENDSEC'); g(0, 'EOF');
  return lines.join('\r\n') + '\r\n';
}

// ---------- adattamento degli SVG ----------
const LIGHTBURN: Record<string, string> = { cut: '#FF0000', engrave: '#000000', score: '#0000FF' };

/** Trasforma un SVG del motore secondo il software di destinazione. */
export function adaptSvg(svg: string, profile: SoftwareProfile): string {
  let s = svg;
  const dropGuides = profile !== 'universal';
  if (dropGuides) s = s.replace(/<g [^>]*data-operation="guide"[^>]*>[\s\S]*?<\/g>\n?/g, '');
  if (profile === 'universal') {
    if (!s.includes('xmlns:inkscape')) s = s.replace('<svg xmlns="http://www.w3.org/2000/svg"', '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"');
    s = s.replace(/<g ([^>]*)data-label="([^"]*)"/g, (_m, pre: string, label: string) => `<g ${pre}data-label="${label}" inkscape:groupmode="layer" inkscape:label="${label}"`);
  }
  if (profile === 'lightburn')
    s = s.replace(/<g ([^>]*)data-operation="(cut|score)"([^>]*)stroke="#[0-9A-Fa-f]{6}"/g, (_m, a: string, op: string, b: string) => `<g ${a}data-operation="${op}"${b}stroke="${LIGHTBURN[op]}"`);
  if (profile === 'cricut') {
    // Cricut legge i contorni chiusi come forme da tagliare: un riempimento chiaro le rende visibili nell'area di lavoro
    s = s.replace(/<g ([^>]*)data-operation="cut"([^>]*)fill="none"/g, (_m, a: string, b: string) => `<g ${a}data-operation="cut"${b}fill="#FFFFFF"`);
  }
  return s;
}

/** Applica il profilo a un file esportato (SVG singolo o ZIP); gli altri formati passano invariati. */
export async function applyProfile(file: ExportFile, profile: SoftwareProfile): Promise<ExportFile> {
  if (profile === 'universal' && !file.filename.endsWith('.svg') && !file.filename.endsWith('.zip')) return file;
  const isPrintSvg = (text: string) => /<image /.test(text);
  if (file.filename.endsWith('.svg')) {
    const text = await file.blob.text();
    if (profile === 'dxf' && !isPrintSvg(text)) return { filename: file.filename.replace(/\.svg$/, '.dxf'), blob: new Blob([svgToDxf(text)], { type: 'application/dxf' }) };
    return { filename: file.filename, blob: new Blob([adaptSvg(text, profile === 'dxf' ? 'universal' : profile)], { type: 'image/svg+xml' }) };
  }
  if (file.filename.endsWith('.zip')) {
    const entries = unzipStore(new Uint8Array(await file.blob.arrayBuffer()));
    const enc = new TextEncoder(), dec = new TextDecoder();
    const out = entries.map((e) => {
      if (!e.name.endsWith('.svg')) return e;
      const text = dec.decode(e.data);
      if (profile === 'dxf' && !isPrintSvg(text)) return { name: e.name.replace(/\.svg$/, '.dxf'), data: enc.encode(svgToDxf(text)) };
      return { name: e.name, data: enc.encode(adaptSvg(text, profile === 'dxf' ? 'universal' : profile)) };
    });
    return { filename: file.filename, blob: new Blob([zipStore(out)], { type: 'application/zip' }) };
  }
  return file;
}
