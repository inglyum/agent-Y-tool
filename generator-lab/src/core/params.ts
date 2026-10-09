// generator-core: normalizzazione e validazione dei parametri, cronologia annulla/ripristina.
import type { Issue, ParamDef, Params, ParamValue } from './types.ts';

/**
 * Converte i valori grezzi della UI nei tipi dichiarati e segnala quelli fuori intervallo.
 * I valori invalidi NON vengono corretti silenziosamente: restano invariati e generano un errore.
 */
export function normalizeParams(defs: ParamDef[], raw: Params, defaults: Params): { values: Params; issues: Issue[] } {
  const values: Params = { ...defaults };
  const issues: Issue[] = [];
  for (const d of defs) {
    const v = raw[d.key] ?? defaults[d.key];
    if (d.type === 'number') {
      if (v === '' || v === undefined) {
        issues.push({ level: 'error', field: d.key, message: `${d.label}: dato mancante, inseriscilo tu.` });
        values[d.key] = '';
        continue;
      }
      const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
      if (!Number.isFinite(n)) {
        issues.push({ level: 'error', field: d.key, message: `${d.label}: inserisci un numero valido.` });
        values[d.key] = defaults[d.key];
        continue;
      }
      values[d.key] = n;
      if (d.min !== undefined && n < d.min) issues.push({ level: 'error', field: d.key, message: `${d.label}: minimo ${d.min}${d.unit ? ' ' + d.unit : ''}.` });
      if (d.max !== undefined && n > d.max) issues.push({ level: 'error', field: d.key, message: `${d.label}: massimo ${d.max}${d.unit ? ' ' + d.unit : ''}.` });
    } else if (d.type === 'bool') {
      values[d.key] = v === true || v === 'true';
    } else if (d.type === 'select') {
      const s = String(v);
      if (d.options && !d.options.some((o) => o.value === s)) {
        issues.push({ level: 'error', field: d.key, message: `${d.label}: opzione non supportata.` });
        values[d.key] = defaults[d.key];
      } else values[d.key] = s;
    } else if (d.type === 'file') {
      values[d.key] = String(v ?? '');
    } else {
      let s = String(v ?? '');
      if (d.maxLength && s.length > d.maxLength) {
        issues.push({ level: 'error', field: d.key, message: `${d.label}: massimo ${d.maxLength} caratteri.` });
        s = s.slice(0, d.maxLength);
      }
      values[d.key] = s;
    }
  }
  return { values, issues };
}

export const num = (p: Params, k: string): number => Number(p[k]);
export const str = (p: Params, k: string): string => String(p[k] ?? '');
export const bool = (p: Params, k: string): boolean => p[k] === true;

export function hasErrors(issues: Issue[]): boolean {
  return issues.some((i) => i.level === 'error');
}

/** Cronologia lineare per annulla/ripristina. */
export class History {
  private past: Params[] = [];
  private future: Params[] = [];
  private readonly limit: number;
  constructor(limit = 100) {
    this.limit = limit;
  }
  push(state: Params): void {
    const last = this.past[this.past.length - 1];
    if (last && sameParams(last, state)) return;
    this.past.push({ ...state });
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }
  undo(current: Params): Params | null {
    const prev = this.past.pop();
    if (!prev) return null;
    this.future.push({ ...current });
    return prev;
  }
  redo(current: Params): Params | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push({ ...current });
    return next;
  }
  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }
}

export function sameParams(a: Params, b: Params): boolean {
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
}

/** Accetta solo chiavi note e tipi primitivi da un file di progetto importato. */
export function sanitizeImported(defs: ParamDef[], data: unknown): Params {
  const out: Params = {};
  if (!data || typeof data !== 'object') return out;
  const src = data as Record<string, unknown>;
  for (const d of defs) {
    const v = src[d.key];
    if (d.type === 'file') continue;
    if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') out[d.key] = v as ParamValue;
  }
  return out;
}
