// generator-registry: elenco dei generatori disponibili. Per aggiungerne uno: crea il modulo in
// src/generators/, esporta un GeneratorDef e aggiungilo qui (il build crea anche il pacchetto Atomm).
import type { GeneratorDef } from '../core/types.ts';
import { box } from './box.ts';
import { costLab } from './cost-lab.ts';
import { imagePrep } from './image-prep.ts';
import { layerLight } from './layer-light.ts';
import { batchNesting } from './nesting.ts';
import { printCut } from './print-cut.ts';
import { signTag } from './sign-tag.ts';
import { vectorize } from './vectorize.ts';

export const GENERATORS: GeneratorDef[] = [signTag, box, layerLight, batchNesting, imagePrep, costLab, printCut, vectorize];

export function findGenerator(id: string): GeneratorDef | undefined {
  return GENERATORS.find((g) => g.id === id || g.slug === id);
}
