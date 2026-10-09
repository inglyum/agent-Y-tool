// Punto di ingresso unico. Il build definisce __GENERATOR__ ('' = suite completa, altrimenti un id).
import { findGenerator, GENERATORS } from '../generators/registry.ts';
import { mountApp } from '../ui/shell.ts';

declare const __GENERATOR__: string;

const host = document.getElementById('app')!;
const only = __GENERATOR__ ? findGenerator(__GENERATOR__) : undefined;
mountApp(host, only ? [only] : GENERATORS, { suite: !only });
