// Motore font: converte il testo in tracciati vettoriali con opentype.js e font OFL incorporati.
// Così l'SVG esportato non dipende dai font installati sul computer di chi lo apre.
import opentype from 'opentype.js';
import { FONT_DATA } from '../fonts/font-data.gen.ts';

export interface FontInfo {
  id: string;
  label: string;
}

export const FONTS: FontInfo[] = FONT_DATA.map(({ id, label }) => ({ id, label }));

const cache = new Map<string, opentype.Font>();

function b64ToArrayBuffer(b64: string): ArrayBuffer {
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u.buffer;
  }
  throw new Error('Decodifica base64 non disponibile');
}

export function getFont(id: string): opentype.Font {
  const hit = cache.get(id);
  if (hit) return hit;
  const data = FONT_DATA.find((f) => f.id === id);
  if (!data) throw new Error(`Font sconosciuto: ${id}`);
  const font = opentype.parse(b64ToArrayBuffer(data.base64));
  cache.set(id, font);
  return font;
}

export interface TextShape {
  d: string;
  /** Riquadro reale dei contorni dei glifi, in mm. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  missing: string[];
}

/** Caratteri che il font non contiene (verrebbero resi come riquadro vuoto). */
export function missingGlyphs(fontId: string, text: string): string[] {
  const font = getFont(fontId);
  const miss = new Set<string>();
  for (const ch of text) if (!/\s/.test(ch) && font.charToGlyphIndex(ch) === 0) miss.add(ch);
  return [...miss];
}

/** Larghezza di avanzamento del testo per una data altezza del corpo (mm). */
export function measure(fontId: string, text: string, size: number): number {
  return getFont(fontId).getAdvanceWidth(text, size, { kerning: true });
}

/**
 * Tracciato del testo. (x, baseline) è il punto di ancoraggio; anchor come text-anchor SVG.
 * I glifi mancanti vengono esclusi e segnalati.
 */
export function textToPath(fontId: string, text: string, x: number, baseline: number, size: number, anchor: 'start' | 'middle' | 'end' = 'middle'): TextShape {
  const font = getFont(fontId);
  const missing = missingGlyphs(fontId, text);
  const clean = [...text].filter((c) => !missing.includes(c)).join('');
  const w = font.getAdvanceWidth(clean, size, { kerning: true });
  const x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
  const path = font.getPath(clean, x0, baseline, size, { kerning: true });
  const bb = path.getBoundingBox();
  const empty = !Number.isFinite(bb.x1) || bb.x2 <= bb.x1;
  return {
    d: path.toPathData(3),
    x0: empty ? x0 : bb.x1,
    y0: empty ? baseline : bb.y1,
    x1: empty ? x0 : bb.x2,
    y1: empty ? baseline : bb.y2,
    missing,
  };
}

/** Metriche verticali del font (ascendente/discendente) per una dimensione data. */
export function verticalMetrics(fontId: string, size: number): { ascent: number; descent: number } {
  const f = getFont(fontId);
  const k = size / f.unitsPerEm;
  return { ascent: f.ascender * k, descent: -f.descender * k };
}
