// Adapter opzionale per la piattaforma Atomm.
//
// Riferimento: https://dev.atomm.com/docs/atomm — l'SDK (platform-sdk.js) inietta l'oggetto globale
// `atomm`; l'hook di esportazione si registra con atomm.lifecycle.on('export', handler) e l'handler
// restituisce { filename, blob }. Dalla v1.3.0 l'handler riceve un argomento `intent`
// (Download / Open in Studio) che qui non serve.
//
// Senza SDK l'app funziona in modo autonomo: il pulsante Esporta della UI scarica i file direttamente.
import type { ExportFile } from './types.ts';

interface AtommLike {
  lifecycle?: { on?: (event: string, handler: (...args: unknown[]) => unknown) => unknown };
  ui?: { toast?: (...args: unknown[]) => unknown };
}

export type AtommStatus = 'connected' | 'unavailable';

function getAtomm(): AtommLike | null {
  const g = globalThis as unknown as { atomm?: AtommLike };
  const a = g.atomm;
  return a && typeof a === 'object' && a.lifecycle && typeof a.lifecycle.on === 'function' ? a : null;
}

/**
 * Registra l'hook di esportazione se l'SDK è presente. `provider` deve restituire il file principale
 * del generatore attivo o lanciare un errore se la geometria non è valida.
 */
export function connectAtomm(provider: () => Promise<ExportFile>, onStatus: (s: AtommStatus) => void): void {
  let done = false;
  const tryConnect = (): boolean => {
    if (done) return true;
    const a = getAtomm();
    if (!a) return false;
    a.lifecycle!.on!('export', async () => {
      try {
        const f = await provider();
        if (!(f.blob instanceof Blob) || !f.filename) throw new Error('Esportazione non valida');
        return { filename: f.filename, blob: f.blob };
      } catch (e) {
        notify(e instanceof Error ? e.message : String(e));
        throw e;
      }
    });
    done = true;
    onStatus('connected');
    return true;
  };
  if (tryConnect()) return;
  // lo script dell'SDK è sincrono nell'<head>; un ultimo tentativo dopo il load copre i caricamenti lenti
  const onLoad = () => {
    if (!tryConnect()) onStatus('unavailable');
  };
  if (typeof document !== 'undefined' && document.readyState !== 'complete') window.addEventListener('load', onLoad, { once: true });
  else onLoad();
}

function notify(message: string): void {
  try {
    getAtomm()?.ui?.toast?.(message);
  } catch {
    /* il toast è facoltativo */
  }
}
