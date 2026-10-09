// Utilità browser per raster: codifica PNG e data URL. In Node (test) restituiscono valori vuoti.
import type { Rgba } from './raster.ts';

const urlCache = new WeakMap<object, string>();

function toCanvas(img: Rgba): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  return c;
}

export const hasDom = (): boolean => typeof document !== 'undefined' && typeof ImageData !== 'undefined';

/** Data URL PNG (memorizzato per immagine): '' fuori dal browser. */
export function dataUrl(img: Rgba): string {
  if (!hasDom()) return '';
  const hit = urlCache.get(img.data);
  if (hit) return hit;
  const url = toCanvas(img).toDataURL('image/png');
  urlCache.set(img.data, url);
  return url;
}

export function rgbaCanvas(img: Rgba): HTMLCanvasElement {
  return toCanvas(img);
}

export async function canvasPng(c: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'));
  if (!blob) throw new Error('Il browser non è riuscito a creare il PNG (foglio troppo grande per la risoluzione scelta?).');
  return new Uint8Array(await blob.arrayBuffer());
}
