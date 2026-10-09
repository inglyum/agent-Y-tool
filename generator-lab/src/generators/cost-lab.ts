// GENERATORE 06 — INGLY MATERIAL & COST LAB: catalogo materiali modificabile e calcolo del prezzo.
// Nessun prezzo, tempo o parametro macchina è precompilato: i dati mancanti vanno inseriti dall'utente.
import { csvEscape, jsonFile, safeFilename } from '../core/export.ts';
import { fmt } from '../core/geometry.ts';
import { hasErrors, normalizeParams, num, str } from '../core/params.ts';
import type { ExportOption, GeneratorDef, GeneratorResult, Issue, ParamDef, Params } from '../core/types.ts';

export interface Material {
  id: string;
  name: string;
  variant: string;
  manufacturer: string;
  source: string;
  widthMm: number | null;
  heightMm: number | null;
  thicknessMm: number | null;
  price: number | null;
  priceUnit: 'sheet' | 'm2';
  updatedAt: string;
  machine: string;
  machineVerified: boolean;
  techParams: string;
  techVerified: boolean;
  safety: string;
  /** 'manual' = inserito a mano; 'verified' = confermato dall'utente con fonte */
  origin: 'manual' | 'verified';
}

const blank = (id: string, name: string, variant: string, safety: string, w: number | null = null, h: number | null = null, t: number | null = null): Material => ({
  id, name, variant, manufacturer: '', source: '', widthMm: w, heightMm: h, thicknessMm: t, price: null, priceUnit: 'sheet',
  updatedAt: '', machine: '', machineVerified: false, techParams: '', techVerified: false, safety, origin: 'manual',
});

/** Modelli di partenza: solo nomi e note di sicurezza note. Prezzi e fonti da compilare. */
export const MATERIAL_TEMPLATES: Material[] = [
  blank('plywood-poplar', 'Compensato di pioppo', 'da compilare', 'Fumo e residui di colla: usa aspirazione e non lasciare la macchina incustodita.'),
  blank('mdf', 'MDF', 'da compilare', 'I leganti possono rilasciare formaldeide: aspirazione con filtro adeguato.'),
  blank('acrylic-cast', 'Acrilico (PMMA) colato', 'da compilare', 'Infiammabile: sorveglia sempre il taglio. Rimuovi la pellicola protettiva se non specificato diversamente dal produttore.'),
  blank('leather-veg', 'Cuoio conciato al vegetale', 'da compilare', 'Verifica che non sia cuoio conciato al cromo.'),
  blank('slate', 'Ardesia', 'solo incisione', 'Solo incisione superficiale.'),
  blank('pvc', 'PVC / vinile', 'NON LAVORARE', 'NON tagliare né incidere al laser: rilascia gas clorurati corrosivi e tossici.'),
];

const STORE_KEY = 'ingly.materials.v1';
let catalog: Material[] = loadCatalog();

function loadCatalog(): Material[] {
  try {
    const raw = globalThis.localStorage?.getItem(STORE_KEY);
    if (raw) return sanitizeCatalog(JSON.parse(raw));
  } catch {
    /* archivio locale non disponibile */
  }
  return MATERIAL_TEMPLATES.map((m) => ({ ...m }));
}

function saveCatalog(): void {
  try {
    globalThis.localStorage?.setItem(STORE_KEY, JSON.stringify(catalog));
  } catch {
    /* non bloccante */
  }
}

export function getCatalog(): Material[] {
  return catalog;
}

export function setCatalog(list: Material[]): void {
  catalog = list;
  saveCatalog();
}

/** Accetta un catalogo importato solo se rispetta lo schema; i campi sconosciuti vengono scartati. */
export function sanitizeCatalog(data: unknown): Material[] {
  const arr = Array.isArray(data) ? data : Array.isArray((data as { materials?: unknown })?.materials) ? (data as { materials: unknown[] }).materials : null;
  if (!arr) throw new Error('Il file non contiene un elenco di materiali.');
  if (arr.length > 500) throw new Error('Massimo 500 materiali.');
  const s = (v: unknown, max = 300) => (typeof v === 'string' ? v.slice(0, max) : '');
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
  return arr.map((x, i) => {
    const o = (x ?? {}) as Record<string, unknown>;
    return {
      id: s(o.id, 60) || `m${i + 1}`, name: s(o.name, 120) || `Materiale ${i + 1}`, variant: s(o.variant, 120), manufacturer: s(o.manufacturer, 120),
      source: s(o.source, 500), widthMm: n(o.widthMm), heightMm: n(o.heightMm), thicknessMm: n(o.thicknessMm), price: n(o.price),
      priceUnit: o.priceUnit === 'm2' ? 'm2' : 'sheet', updatedAt: s(o.updatedAt, 30), machine: s(o.machine, 120), machineVerified: o.machineVerified === true,
      techParams: s(o.techParams, 1000), techVerified: o.techVerified === true, safety: s(o.safety, 1000), origin: o.origin === 'verified' ? 'verified' : 'manual',
    } satisfies Material;
  });
}

/** Prezzo al mm² del materiale, oppure il motivo per cui non è calcolabile. */
export function pricePerMm2(m: Material): { value: number } | { missing: string } {
  if (m.price === null) return { missing: `prezzo di "${m.name}"` };
  if (m.priceUnit === 'm2') return { value: m.price / 1e6 };
  if (!m.widthMm || !m.heightMm) return { missing: `dimensioni della lastra di "${m.name}"` };
  return { value: m.price / (m.widthMm * m.heightMm) };
}

export const costParams: ParamDef[] = [
  { key: 'material', label: 'Materiale dal catalogo', type: 'select', group: 'Materiale', options: [] },
  { key: 'partW', label: 'Larghezza pezzo', type: 'number', group: 'Pezzo e quantità', unit: 'mm', min: 0.1, max: 5000, step: 0.5 },
  { key: 'partH', label: 'Altezza pezzo', type: 'number', group: 'Pezzo e quantità', unit: 'mm', min: 0.1, max: 5000, step: 0.5 },
  { key: 'qty', label: 'Quantità', type: 'number', group: 'Pezzo e quantità', min: 1, max: 100000, step: 1 },
  { key: 'waste', label: 'Sfrido', type: 'number', group: 'Pezzo e quantità', unit: '%', min: 0, max: 95, step: 0.5, help: 'Quota di materiale acquistato che non diventa pezzo (puoi ricavarla dal modulo Nesting: 100 − utilizzo).' },
  { key: 'machineMin', label: 'Tempo macchina totale', type: 'number', group: 'Tempi e tariffe', unit: 'min', min: 0, max: 100000, step: 0.5, help: 'Misuralo con una prova o leggilo dal software della macchina.' },
  { key: 'machineRate', label: 'Tariffa macchina', type: 'number', group: 'Tempi e tariffe', unit: '€/h', min: 0, max: 10000, step: 0.5 },
  { key: 'laborMin', label: 'Manodopera totale', type: 'number', group: 'Tempi e tariffe', unit: 'min', min: 0, max: 100000, step: 0.5 },
  { key: 'laborRate', label: 'Tariffa manodopera', type: 'number', group: 'Tempi e tariffe', unit: '€/h', min: 0, max: 10000, step: 0.5 },
  { key: 'consumables', label: 'Consumabili (totale)', type: 'number', group: 'Costi aggiuntivi', unit: '€', min: 0, max: 1e6, step: 0.01, help: 'Nastro, imballo, ferramenta…' },
  { key: 'overhead', label: 'Costi indiretti', type: 'number', group: 'Costi aggiuntivi', unit: '%', min: 0, max: 300, step: 0.5, help: 'Percentuale sui costi diretti (affitto, energia, ammortamenti).' },
  { key: 'commission', label: 'Commissioni (marketplace, pagamento)', type: 'number', group: 'Prezzo', unit: '%', min: 0, max: 80, step: 0.1 },
  { key: 'margin', label: 'Margine desiderato', type: 'number', group: 'Prezzo', unit: '%', min: 0, max: 90, step: 0.5, help: 'Percentuale del prezzo netto.' },
  { key: 'vat', label: 'IVA', type: 'number', group: 'Prezzo', unit: '%', min: 0, max: 50, step: 0.5, help: '0 se non applicabile al tuo regime.' },
  { key: 'filename', label: 'Nome file', type: 'text', group: 'Esportazione', maxLength: 80 },
];

export const costDefaults: Params = {
  material: '', partW: 80, partH: 30, qty: 10, waste: '', machineMin: '', machineRate: '', laborMin: '', laborRate: '',
  consumables: 0, overhead: 0, commission: 0, margin: '', vat: 22, filename: 'ingly-preventivo',
};

function refreshMaterialOptions(): void {
  const def = costParams.find((d) => d.key === 'material')!;
  def.options = [{ value: '', label: '— scegli un materiale —' }, ...catalog.map((m) => ({ value: m.id, label: `${m.name}${m.variant ? ' · ' + m.variant : ''}${m.thicknessMm ? ` ${m.thicknessMm} mm` : ''}` }))];
}
refreshMaterialOptions();

const eur = (v: number) => `${v.toFixed(2).replace('.', ',')} €`;

export interface CostBreakdown {
  material: number;
  waste: number;
  machine: number;
  labor: number;
  consumables: number;
  overhead: number;
  cost: number;
  commission: number;
  margin: number;
  net: number;
  vat: number;
  gross: number;
  perPieceNet: number;
  perPieceGross: number;
}

export function computeCost(i: { ppm2: number; areaMm2: number; wastePct: number; machineMin: number; machineRate: number; laborMin: number; laborRate: number; consumables: number; overheadPct: number; commissionPct: number; marginPct: number; vatPct: number; qty: number }): CostBreakdown {
  const gross = i.areaMm2 / (1 - i.wastePct / 100);
  const material = i.areaMm2 * i.ppm2;
  const waste = (gross - i.areaMm2) * i.ppm2;
  const machine = (i.machineMin / 60) * i.machineRate;
  const labor = (i.laborMin / 60) * i.laborRate;
  const direct = material + waste + machine + labor + i.consumables;
  const overhead = direct * (i.overheadPct / 100);
  const cost = direct + overhead;
  const net = cost / (1 - i.commissionPct / 100 - i.marginPct / 100);
  const commission = net * (i.commissionPct / 100);
  const margin = net * (i.marginPct / 100);
  const vat = net * (i.vatPct / 100);
  return { material, waste, machine, labor, consumables: i.consumables, overhead, cost, commission, margin, net, vat, gross: net + vat, perPieceNet: net / i.qty, perPieceGross: (net + vat) / i.qty };
}

export function runCost(raw: Params): GeneratorResult {
  refreshMaterialOptions();
  const { values: p, issues } = normalizeParams(costParams, raw, costDefaults);
  const mat = catalog.find((m) => m.id === str(p, 'material'));
  const extra: Issue[] = [];
  let ppm2 = NaN;
  if (!mat) extra.push({ level: 'error', field: 'material', message: 'Scegli un materiale dal catalogo (o aggiungilo).' });
  else {
    const pp = pricePerMm2(mat);
    if ('missing' in pp) extra.push({ level: 'error', field: 'material', message: `Dato mancante nel catalogo: ${pp.missing}.` });
    else ppm2 = pp.value;
    if (mat.origin === 'manual') extra.push({ level: 'info', message: `"${mat.name}": dati inseriti manualmente, non verificati con una fonte.` });
    if (mat.safety) extra.push({ level: /NON/.test(mat.safety) ? 'error' : 'warning', field: 'material', message: `Sicurezza — ${mat.name}: ${mat.safety}` });
  }
  if (num(p, 'commission') + num(p, 'margin') >= 100) extra.push({ level: 'error', field: 'margin', message: 'Commissioni + margine devono restare sotto il 100%.' });
  const all = [...issues, ...extra];
  if (hasErrors(all)) return { views: [], issues: all, stats: [], exports: [] };
  const qty = Math.round(num(p, 'qty'));
  const area = num(p, 'partW') * num(p, 'partH') * qty;
  const b = computeCost({
    ppm2, areaMm2: area, wastePct: num(p, 'waste'), machineMin: num(p, 'machineMin'), machineRate: num(p, 'machineRate'), laborMin: num(p, 'laborMin'),
    laborRate: num(p, 'laborRate'), consumables: num(p, 'consumables'), overheadPct: num(p, 'overhead'), commissionPct: num(p, 'commission'), marginPct: num(p, 'margin'), vatPct: num(p, 'vat'), qty,
  });
  const rows: [string, number, string][] = [
    ['Materiale (netto pezzi)', b.material, `${(area / 1e6).toFixed(4)} m²`],
    ['Sfrido', b.waste, `${fmt(num(p, 'waste'))}%`],
    ['Tempo macchina', b.machine, `${fmt(num(p, 'machineMin'))} min × ${fmt(num(p, 'machineRate'))} €/h`],
    ['Manodopera', b.labor, `${fmt(num(p, 'laborMin'))} min × ${fmt(num(p, 'laborRate'))} €/h`],
    ['Consumabili', b.consumables, ''],
    ['Costi indiretti', b.overhead, `${fmt(num(p, 'overhead'))}% dei diretti`],
    ['= Costo totale', b.cost, ''],
    ['Commissioni', b.commission, `${fmt(num(p, 'commission'))}% del netto`],
    ['Margine', b.margin, `${fmt(num(p, 'margin'))}% del netto`],
    ['= Prezzo netto', b.net, `${eur(b.perPieceNet)} al pezzo`],
    ['IVA', b.vat, `${fmt(num(p, 'vat'))}%`],
    ['= Prezzo IVA inclusa', b.gross, `${eur(b.perPieceGross)} al pezzo`],
  ];
  const base = str(p, 'filename');
  const exports: ExportOption[] = [
    {
      id: 'csv', label: 'Preventivo CSV', requiresValid: true, primary: true,
      build: async () => ({
        filename: safeFilename(base, 'csv'),
        blob: new Blob(['﻿' + ['voce;importo_eur;dettaglio', ...rows.map(([a, v, d]) => `${csvEscape(a)};${v.toFixed(2)};${csvEscape(d)}`)].join('\n')], { type: 'text/csv' }),
      }),
    },
    { id: 'json', label: 'Preventivo JSON', requiresValid: true, build: async () => jsonFile({ generatedAt: new Date().toISOString(), material: mat, params: p, breakdown: b }, safeFilename(base, 'json')) },
  ];
  return {
    views: [{ id: 'breakdown', label: 'Preventivo', widthMm: 170, heightMm: 16 + rows.length * 11.5, table: { columns: ['Voce', 'Importo', 'Dettaglio'], rows: rows.map(([a, v, d]) => [a, eur(v), d]) } }],
    issues: all,
    stats: [
      { label: 'Prezzo netto / pezzo', value: eur(b.perPieceNet) },
      { label: 'IVA inclusa / pezzo', value: eur(b.perPieceGross) },
      { label: 'Totale IVA inclusa', value: eur(b.gross) },
      { label: 'Costo totale', value: eur(b.cost) },
    ],
    exports,
  };
}

/** Editor del catalogo materiali (DOM, testi resi con textContent/value: nessun HTML utente). */
function mountCatalog(host: HTMLElement, rerun: () => void): void {
  host.replaceChildren();
  const h = document.createElement('h3');
  h.textContent = 'Catalogo materiali';
  const note = document.createElement('p');
  note.className = 'muted small';
  note.textContent = 'Salvato solo in questo browser. Esporta il JSON per backup o per spostarlo su un altro computer.';
  host.append(h, note);
  const fields: [keyof Material, string, 'text' | 'number' | 'bool' | 'unit' | 'origin'][] = [
    ['name', 'Nome', 'text'], ['variant', 'Variante', 'text'], ['manufacturer', 'Produttore', 'text'], ['source', 'Fonte (link o fattura)', 'text'],
    ['widthMm', 'Larghezza lastra mm', 'number'], ['heightMm', 'Altezza lastra mm', 'number'], ['thicknessMm', 'Spessore mm', 'number'],
    ['price', 'Prezzo €', 'number'], ['priceUnit', 'Unità di acquisto', 'unit'], ['updatedAt', 'Data aggiornamento', 'text'],
    ['machine', 'Macchina compatibile', 'text'], ['machineVerified', 'Compatibilità verificata', 'bool'],
    ['techParams', 'Parametri tecnici', 'text'], ['techVerified', 'Parametri validati da test', 'bool'],
    ['safety', 'Note di sicurezza', 'text'], ['origin', 'Stato dei dati', 'origin'],
  ];
  catalog.forEach((m, idx) => {
    const det = document.createElement('details');
    det.className = 'mat';
    const sum = document.createElement('summary');
    sum.textContent = `${m.name}${m.price === null ? ' — prezzo mancante' : ''}${m.origin === 'verified' ? ' ✓' : ''}`;
    det.append(sum);
    for (const [k, label, kind] of fields) {
      const row = document.createElement('label');
      row.className = 'field';
      const span = document.createElement('span');
      span.textContent = label;
      let input: HTMLInputElement | HTMLSelectElement;
      if (kind === 'unit' || kind === 'origin') {
        const sel = document.createElement('select');
        const opts = kind === 'unit' ? [['sheet', 'a lastra'], ['m2', 'al m²']] : [['manual', 'Inserito manualmente'], ['verified', 'Verificato con fonte']];
        for (const [v, t] of opts) {
          const o = document.createElement('option');
          o.value = v;
          o.textContent = t;
          sel.append(o);
        }
        sel.value = String(m[k]);
        input = sel;
      } else {
        const inp = document.createElement('input');
        if (kind === 'bool') {
          inp.type = 'checkbox';
          inp.checked = m[k] === true;
        } else {
          inp.type = kind === 'number' ? 'number' : 'text';
          if (kind === 'number') inp.step = 'any';
          inp.value = m[k] === null ? '' : String(m[k]);
        }
        input = inp;
      }
      input.addEventListener('change', () => {
        const next = { ...catalog[idx] } as Record<string, unknown>;
        if (kind === 'bool') next[k] = (input as HTMLInputElement).checked;
        else if (kind === 'number') {
          const v = parseFloat(input.value);
          next[k] = Number.isFinite(v) && v >= 0 ? v : null;
        } else next[k] = input.value.slice(0, 1000);
        if (k === 'price') next.updatedAt = new Date().toISOString().slice(0, 10);
        const list = [...catalog];
        list[idx] = sanitizeCatalog([next])[0];
        setCatalog(list);
        sum.textContent = `${list[idx].name}${list[idx].price === null ? ' — prezzo mancante' : ''}${list[idx].origin === 'verified' ? ' ✓' : ''}`;
        rerun();
      });
      row.append(span, input);
      det.append(row);
    }
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn ghost small';
    del.textContent = 'Elimina materiale';
    del.addEventListener('click', () => {
      setCatalog(catalog.filter((_, i) => i !== idx));
      mountCatalog(host, rerun);
      rerun();
    });
    det.append(del);
    host.append(det);
  });
  const bar = document.createElement('div');
  bar.className = 'row-actions';
  const mk = (label: string, fn: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn small';
    b.textContent = label;
    b.addEventListener('click', fn);
    bar.append(b);
  };
  mk('+ Nuovo materiale', () => {
    setCatalog([...catalog, blank(`m${Date.now().toString(36)}`, 'Nuovo materiale', '', '')]);
    mountCatalog(host, rerun);
    rerun();
  });
  mk('Esporta catalogo JSON', () => {
    const f = jsonFile({ format: 'ingly-materials', version: 1, materials: catalog }, 'ingly-materiali.json');
    const url = URL.createObjectURL(f.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = f.filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  });
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = 'application/json,.json';
  file.hidden = true;
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    try {
      if (f.size > 2_000_000) throw new Error('File troppo grande (max 2 MB).');
      setCatalog(sanitizeCatalog(JSON.parse(await f.text())));
      mountCatalog(host, rerun);
      rerun();
    } catch (e) {
      alert(`Importazione non riuscita: ${(e as Error).message}`);
    }
  });
  bar.append(file);
  mk('Importa catalogo JSON', () => file.click());
  mk('Ripristina modelli', () => {
    if (!confirm('Sostituire il catalogo con i modelli iniziali? I dati inseriti andranno persi se non li hai esportati.')) return;
    setCatalog(MATERIAL_TEMPLATES.map((m) => ({ ...m })));
    mountCatalog(host, rerun);
    rerun();
  });
  host.append(bar);
}

export const costLab: GeneratorDef = {
  id: 'cost-lab',
  slug: 'material-cost-lab',
  code: '06',
  title: 'INGLY Material & Cost Lab',
  tagline: 'Catalogo materiali e preventivo trasparente: materiale, sfrido, tempi, margini e IVA.',
  params: costParams,
  defaults: costDefaults,
  run: (p) => runCost(p),
  mountExtra: mountCatalog,
};
