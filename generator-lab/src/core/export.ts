// export-engine: nomi file, Blob reali, archivi ZIP (metodo store), PNG con DPI, download.
import { checkSvg } from './svg.ts';
import type { ExportFile } from './types.ts';

/** Nome file sicuro: niente percorsi, caratteri riservati o nomi vuoti. */
export function safeFilename(name: string, ext: string, fallback = 'ingly'): string {
  const base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\.[a-z0-9]{2,4}$/i, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80);
  return `${base || fallback}.${ext.replace(/^\./, '')}`;
}

/** Crea il Blob SVG dopo averlo verificato: un documento non valido non viene mai esportato. */
export function svgFile(svg: string, filename: string): ExportFile {
  const check = checkSvg(svg);
  if (!check.ok) throw new Error(`SVG non valido: ${check.errors.join('; ')}`);
  return { filename, blob: new Blob([svg], { type: 'image/svg+xml' }) };
}

// ---------- CRC32 ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array, start = 0xffffffff): number {
  let c = start;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------- ZIP (store, nessuna compressione: compatibile con qualsiasi decompressore) ----------
export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

export function zipStore(entries: ZipEntry[], date = new Date()): Uint8Array {
  const enc = new TextEncoder();
  const dosTime = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) & 0xffff;
  const dosDate = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff;
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.name)) throw new Error(`Nome duplicato nello ZIP: ${e.name}`);
    seen.add(e.name);
    const name = enc.encode(e.name);
    const crc = crc32(e.data);
    const lh = new Uint8Array(30 + name.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8
    lv.setUint16(8, 0, true);
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, e.data.length, true);
    lv.setUint32(22, e.data.length, true);
    lv.setUint16(26, name.length, true);
    lh.set(name, 30);
    const ch = new Uint8Array(46 + name.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, e.data.length, true);
    cv.setUint32(24, e.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    ch.set(name, 46);
    locals.push(lh, e.data);
    centrals.push(ch);
    offset += lh.length + e.data.length;
  }
  const cdSize = centrals.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const total = new Uint8Array(offset + cdSize + 22);
  let p = 0;
  for (const part of [...locals, ...centrals, end]) {
    total.set(part, p);
    p += part.length;
  }
  return total;
}

/** Lettura di uno ZIP store (usata nei test e per verificare gli archivi esportati). */
export function unzipStore(buf: Uint8Array): ZipEntry[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out: ZipEntry[] = [];
  let p = 0;
  const dec = new TextDecoder();
  while (p + 4 <= buf.length && dv.getUint32(p, true) === 0x04034b50) {
    const size = dv.getUint32(p + 18, true);
    const nlen = dv.getUint16(p + 26, true);
    const xlen = dv.getUint16(p + 28, true);
    const crc = dv.getUint32(p + 14, true);
    const name = dec.decode(buf.subarray(p + 30, p + 30 + nlen));
    const data = buf.slice(p + 30 + nlen + xlen, p + 30 + nlen + xlen + size);
    if (crc32(data) !== crc) throw new Error(`CRC errato per ${name}`);
    out.push({ name, data });
    p += 30 + nlen + xlen + size;
  }
  return out;
}

export async function zipFile(files: ExportFile[], filename: string): Promise<ExportFile> {
  const entries: ZipEntry[] = [];
  for (const f of files) entries.push({ name: f.filename, data: new Uint8Array(await f.blob.arrayBuffer()) });
  return { filename, blob: new Blob([zipStore(entries)], { type: 'application/zip' }) };
}

// ---------- PNG con risoluzione (chunk pHYs) ----------
/** Inserisce/sostituisce il chunk pHYs così che i software leggano i DPI corretti. */
export function pngWithDpi(png: Uint8Array, dpi: number): Uint8Array {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (png[i] !== sig[i]) throw new Error('Non è un file PNG');
  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // 'pHYs'
  dv.setUint32(8, ppm);
  dv.setUint32(12, ppm);
  chunk[16] = 1; // unità: metro
  dv.setUint32(17, crc32(chunk.subarray(4, 17)));
  // scorre i chunk: rimuove pHYs esistenti e inserisce il nuovo dopo IHDR
  const parts: Uint8Array[] = [png.subarray(0, 8)];
  const pv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let p = 8;
  while (p < png.length) {
    const len = pv.getUint32(p);
    const type = String.fromCharCode(png[p + 4], png[p + 5], png[p + 6], png[p + 7]);
    const full = png.subarray(p, p + 12 + len);
    if (type !== 'pHYs') parts.push(full);
    if (type === 'IHDR') parts.push(chunk);
    p += 12 + len;
  }
  const out = new Uint8Array(parts.reduce((s, x) => s + x.length, 0));
  let o = 0;
  for (const x of parts) {
    out.set(x, o);
    o += x.length;
  }
  return out;
}

export function readPngDpi(png: Uint8Array): number | null {
  const pv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let p = 8;
  while (p + 8 < png.length) {
    const len = pv.getUint32(p);
    const type = String.fromCharCode(png[p + 4], png[p + 5], png[p + 6], png[p + 7]);
    if (type === 'pHYs' && png[p + 16] === 1) return Math.round(pv.getUint32(p + 8) * 0.0254);
    p += 12 + len;
  }
  return null;
}

/** Download nel browser tramite link temporaneo. */
export function downloadFile(f: ExportFile): void {
  const url = URL.createObjectURL(f.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = f.filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function jsonFile(data: unknown, filename: string): ExportFile {
  return { filename, blob: new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }) };
}

export function csvEscape(v: string): string {
  // evita formula injection nei fogli di calcolo
  const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
