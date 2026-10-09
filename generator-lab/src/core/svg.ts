// svg-engine: documenti SVG vettoriali in millimetri, con livelli separati per lavorazione.
import { fmt } from './geometry.ts';

export type Operation = 'cut' | 'engrave' | 'score' | 'guide';

/** Colori convenzionali usati da LightBurn, xTool Creative Space e simili per distinguere le lavorazioni. */
export const OP_STYLE: Record<Operation, { color: string; label: string }> = {
  cut: { color: '#FF0000', label: 'Taglio' },
  engrave: { color: '#000000', label: 'Incisione' },
  score: { color: '#0000FF', label: 'Marcatura linea' },
  guide: { color: '#00A0E0', label: 'Guida (non lavorare)' },
};

export interface SvgLayer {
  id: string;
  op: Operation;
  label?: string;
  /** Path data (attributo d), già in mm. */
  paths: string[];
  /** Testo live opzionale (dipende dal font installato). */
  texts?: { x: number; y: number; size: number; text: string; family: string; anchor: 'start' | 'middle' | 'end' }[];
}

export interface SvgDocOptions {
  widthMm: number;
  heightMm: number;
  title: string;
  layers: SvgLayer[];
  /** Metadati descrittivi (parametri usati), scritti in <desc>. */
  description?: string;
}

const XML_ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };

/** Escape XML. Rimuove anche i caratteri di controllo non ammessi in XML 1.0. */
export function escapeXml(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '').replace(/[&<>"']/g, (c) => XML_ESC[c]);
}

export function slugId(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'layer';
}

/** Costruisce un documento SVG standalone. width/height in mm, viewBox in mm (1 unità = 1 mm). */
export function svgDocument(o: SvgDocOptions): string {
  if (!(o.widthMm > 0 && o.heightMm > 0)) throw new Error('Dimensioni del documento SVG non valide');
  const W = fmt(o.widthMm), H = fmt(o.heightMm);
  let s = '<?xml version="1.0" encoding="UTF-8"?>\n';
  s += `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}">\n`;
  s += `<title>${escapeXml(o.title)}</title>\n`;
  if (o.description) s += `<desc>${escapeXml(o.description)}</desc>\n`;
  for (const L of o.layers) {
    if (!L.paths.length && !(L.texts && L.texts.length)) continue;
    const st = OP_STYLE[L.op];
    const fill = L.op === 'engrave' ? st.color : 'none';
    const stroke = L.op === 'engrave' ? 'none' : st.color;
    const label = escapeXml(L.label ?? st.label);
    s += `<g id="${slugId(L.id)}" data-operation="${L.op}" data-label="${label}" fill="${fill}" stroke="${stroke}" stroke-width="${L.op === 'engrave' ? 0 : 0.1}" fill-rule="evenodd">\n`;
    for (const d of L.paths) s += `<path d="${d}"/>\n`;
    for (const t of L.texts ?? []) {
      // il testo è sempre pieno (mai solo contorno), nel colore della lavorazione del livello
      s += `<text x="${fmt(t.x)}" y="${fmt(t.y)}" font-size="${fmt(t.size)}" font-family="${escapeXml(t.family)}" text-anchor="${t.anchor}" fill="${st.color}" stroke="none">${escapeXml(t.text)}</text>\n`;
    }
    s += '</g>\n';
  }
  s += '</svg>\n';
  return s;
}

// ---------- Validazione del documento esportato (usata da UI e test) ----------

export interface SvgCheck {
  ok: boolean;
  errors: string[];
  widthMm?: number;
  heightMm?: number;
  viewBox?: number[];
  pathCount: number;
  textCount: number;
}

/**
 * Verifica di buona formazione XML (bilanciamento dei tag, attributi tra virgolette) e coerenza
 * delle unità: width/height in mm, viewBox con le stesse dimensioni. Non esegue script.
 */
export function checkSvg(svg: string): SvgCheck {
  const errors: string[] = [];
  const stack: string[] = [];
  let pathCount = 0, textCount = 0;
  const body = svg.replace(/^<\?xml[^?]*\?>\s*/, '');
  const re = /<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>|<!--[\s\S]*?-->|<|>/g;
  let m: RegExpExecArray | null;
  let rootAttrs = '';
  let lastIndex = 0;
  while ((m = re.exec(body))) {
    const between = body.slice(lastIndex, m.index);
    if (/[<>]/.test(between)) errors.push('Caratteri < o > non escapati nel testo');
    lastIndex = re.lastIndex;
    if (m[0].startsWith('<!--')) continue;
    if (m[0] === '<' || m[0] === '>') {
      errors.push(`Tag malformato vicino a posizione ${m.index}`);
      continue;
    }
    const [, closing, name, attrs, selfClose] = m;
    if (/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/.test(attrs)) errors.push(`Entità non valida negli attributi di <${name}>`);
    if (name === 'script' || /\son\w+=/.test(attrs)) errors.push('Il documento contiene script o gestori di eventi');
    if (!closing && stack.length === 0) {
      if (name !== 'svg') errors.push('L\'elemento radice non è <svg>');
      rootAttrs = attrs;
    }
    if (name === 'path' && !closing) pathCount++;
    if (name === 'text' && !closing) textCount++;
    if (closing) {
      const top = stack.pop();
      if (top !== name) errors.push(`Tag di chiusura </${name}> non corrispondente (atteso </${top ?? '-'}>)`);
    } else if (!selfClose) stack.push(name);
  }
  if (/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/.test(body.replace(/<[^>]*>/g, ''))) errors.push('Entità non valida nel testo');
  if (stack.length) errors.push(`Tag non chiusi: ${stack.join(', ')}`);
  const attr = (n: string) => new RegExp(`\\s${n}="([^"]*)"`).exec(rootAttrs)?.[1];
  const w = attr('width'), h = attr('height'), vb = attr('viewBox');
  let widthMm: number | undefined, heightMm: number | undefined, viewBox: number[] | undefined;
  if (!w || !/^\d+(\.\d+)?mm$/.test(w)) errors.push('width non espresso in mm');
  else widthMm = parseFloat(w);
  if (!h || !/^\d+(\.\d+)?mm$/.test(h)) errors.push('height non espresso in mm');
  else heightMm = parseFloat(h);
  if (!vb) errors.push('viewBox mancante');
  else {
    viewBox = vb.trim().split(/[\s,]+/).map(Number);
    if (viewBox.length !== 4 || viewBox.some((v) => !Number.isFinite(v))) errors.push('viewBox non valido');
    else if (widthMm !== undefined && heightMm !== undefined && (Math.abs(viewBox[2] - widthMm) > 1e-3 || Math.abs(viewBox[3] - heightMm) > 1e-3))
      errors.push('viewBox non coerente con width/height (1 unità ≠ 1 mm)');
  }
  return { ok: errors.length === 0, errors, widthMm, heightMm, viewBox, pathCount, textCount };
}
