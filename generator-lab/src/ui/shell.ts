// app-shell + ui-components: layout, dashboard, canvas con zoom/pan, pannello parametri, azioni.
// La shell non contiene logica geometrica: chiama generator.run() e mostra il risultato.
import { connectAtomm } from '../core/atomm.ts';
import { downloadFile, jsonFile, safeFilename } from '../core/export.ts';
import { History, hasErrors, sanitizeImported } from '../core/params.ts';
import type { ExportFile, FileInput, GeneratorDef, GeneratorResult, Issue, ParamDef, Params, RunContext, View } from '../core/types.ts';

const PX_PER_MM = 96 / 25.4;
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_UPLOAD_PIXELS = 50_000_000;

type Status = 'idle' | 'processing' | 'done' | 'error';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else e.setAttribute(k, v);
  }
  for (const c of children) e.append(c);
  return e;
}

function store<T>(key: string, value?: T): T | null {
  try {
    if (value === undefined) {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    }
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* archiviazione locale non disponibile (finestra privata, iframe) */
  }
  return null;
}

// ---------- Tema ----------
function initTheme(btn: HTMLButtonElement): void {
  const apply = (t: string) => {
    if (t === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
    btn.textContent = t === 'dark' ? '◐ Scuro' : t === 'light' ? '◑ Chiaro' : '◒ Auto';
    btn.setAttribute('aria-label', `Tema: ${btn.textContent}`);
  };
  let theme = store<string>('ingly.theme') ?? 'auto';
  apply(theme);
  btn.addEventListener('click', () => {
    theme = theme === 'auto' ? 'light' : theme === 'light' ? 'dark' : 'auto';
    store('ingly.theme', theme);
    apply(theme);
  });
}

// ---------- Canvas: zoom, pan, griglia ----------
class Stage {
  readonly root: HTMLElement;
  private readonly viewport: HTMLElement;
  private readonly paper: HTMLElement;
  private readonly content: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly dimX: HTMLElement;
  private readonly dimY: HTMLElement;
  private readonly zoomLabel: HTMLElement;
  private readonly placeholder: HTMLElement;
  private scale = 1;
  private tx = 0;
  private ty = 0;
  private wMm = 100;
  private hMm = 100;
  private fitted = false;

  constructor() {
    this.zoomLabel = el('span', { class: 'zoom-label', 'aria-live': 'polite' });
    const btn = (label: string, title: string, fn: () => void) => {
      const b = el('button', { class: 'btn icon', type: 'button', title, 'aria-label': title, text: label });
      b.addEventListener('click', fn);
      return b;
    };
    const gridToggle = el('input', { type: 'checkbox', checked: '' });
    const dimToggle = el('input', { type: 'checkbox', checked: '' });
    const toolbar = el('div', { class: 'stage-toolbar' },
      btn('−', 'Riduci', () => this.zoomBy(1 / 1.25)),
      this.zoomLabel,
      btn('+', 'Ingrandisci', () => this.zoomBy(1.25)),
      btn('⤢', 'Adatta alla tavola', () => this.fit()),
      btn('1:1', 'Scala reale (circa: dipende dallo schermo)', () => this.setScale(1)),
      el('label', { class: 'check' }, gridToggle, ' Griglia mm'),
      el('label', { class: 'check' }, dimToggle, ' Quote'),
    );
    this.grid = el('div', { class: 'grid', 'aria-hidden': 'true' });
    this.content = el('div', { class: 'content' });
    this.dimX = el('div', { class: 'dim dim-x', 'aria-hidden': 'true' });
    this.dimY = el('div', { class: 'dim dim-y', 'aria-hidden': 'true' });
    this.paper = el('div', { class: 'paper' }, this.grid, this.content, this.dimX, this.dimY);
    this.placeholder = el('div', { class: 'placeholder', text: 'Nessuna anteprima: completa i dati indicati in «Controlli».' });
    this.viewport = el('div', { class: 'viewport', tabindex: '0', 'aria-label': 'Anteprima: trascina per spostare, rotellina per lo zoom' }, this.paper, this.placeholder);
    this.root = el('section', { class: 'stage', 'aria-label': 'Anteprima' }, toolbar, this.viewport);
    gridToggle.addEventListener('change', () => this.grid.classList.toggle('hidden', !gridToggle.checked));
    dimToggle.addEventListener('change', () => this.paper.classList.toggle('no-dims', !dimToggle.checked));
    this.bindPointer();
    new ResizeObserver(() => {
      if (!this.fitted) this.fit();
    }).observe(this.viewport);
  }

  private bindPointer(): void {
    let drag: { x: number; y: number; tx: number; ty: number } | null = null;
    this.viewport.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, tx: this.tx, ty: this.ty };
      this.viewport.setPointerCapture(e.pointerId);
      this.viewport.classList.add('dragging');
    });
    this.viewport.addEventListener('pointermove', (e) => {
      if (!drag) return;
      this.tx = drag.tx + e.clientX - drag.x;
      this.ty = drag.ty + e.clientY - drag.y;
      this.fitted = true;
      this.apply();
    });
    const end = () => {
      drag = null;
      this.viewport.classList.remove('dragging');
    };
    this.viewport.addEventListener('pointerup', end);
    this.viewport.addEventListener('pointercancel', end);
    this.viewport.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = this.viewport.getBoundingClientRect();
      this.zoomBy(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    this.viewport.addEventListener('keydown', (e) => {
      const step = 40;
      if (e.key === '+' || e.key === '=') this.zoomBy(1.25);
      else if (e.key === '-') this.zoomBy(0.8);
      else if (e.key === '0') this.fit();
      else if (e.key === 'ArrowLeft') this.tx += step;
      else if (e.key === 'ArrowRight') this.tx -= step;
      else if (e.key === 'ArrowUp') this.ty += step;
      else if (e.key === 'ArrowDown') this.ty -= step;
      else return;
      e.preventDefault();
      this.apply();
    });
  }

  private zoomBy(k: number, cx?: number, cy?: number): void {
    const r = this.viewport.getBoundingClientRect();
    const px = cx ?? r.width / 2, py = cy ?? r.height / 2;
    const ns = Math.min(40, Math.max(0.02, this.scale * k));
    const f = ns / this.scale;
    this.tx = px - (px - this.tx) * f;
    this.ty = py - (py - this.ty) * f;
    this.scale = ns;
    this.fitted = true;
    this.apply();
  }

  private setScale(s: number): void {
    const r = this.viewport.getBoundingClientRect();
    this.scale = s;
    this.tx = (r.width - this.wMm * PX_PER_MM * s) / 2;
    this.ty = (r.height - this.hMm * PX_PER_MM * s) / 2;
    this.fitted = true;
    this.apply();
  }

  fit(): void {
    const r = this.viewport.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const pad = 56;
    const s = Math.min((r.width - pad * 2) / (this.wMm * PX_PER_MM), (r.height - pad * 2) / (this.hMm * PX_PER_MM));
    this.scale = Math.max(0.02, s);
    this.tx = (r.width - this.wMm * PX_PER_MM * this.scale) / 2;
    this.ty = (r.height - this.hMm * PX_PER_MM * this.scale) / 2;
    this.fitted = false;
    this.apply();
  }

  private apply(): void {
    this.paper.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.scale})`;
    this.paper.style.setProperty('--inv', String(1 / this.scale));
    // spessore delle linee in anteprima: ~1,3 px a schermo a qualsiasi zoom (in mm, unità del viewBox)
    this.paper.style.setProperty('--sw', String(1.3 / (PX_PER_MM * this.scale)));
    this.zoomLabel.textContent = `${Math.round(this.scale * 100)}%`;
    // griglia: 1 mm se abbastanza grande, altrimenti 10 mm
    const minor = this.scale * PX_PER_MM >= 4 ? 1 : 10;
    this.grid.style.setProperty('--g', `${minor * PX_PER_MM}px`);
    this.grid.style.setProperty('--G', `${minor * 10 * PX_PER_MM}px`);
  }

  show(view: View | null, keepView: boolean): void {
    this.content.replaceChildren();
    this.placeholder.hidden = !!view;
    if (!view) {
      this.paper.classList.add('empty');
      return;
    }
    this.paper.classList.remove('empty');
    const sizeChanged = Math.abs(view.widthMm - this.wMm) > 1e-6 || Math.abs(view.heightMm - this.hMm) > 1e-6;
    this.wMm = view.widthMm;
    this.hMm = view.heightMm;
    this.paper.style.width = `${view.widthMm * PX_PER_MM}px`;
    this.paper.style.height = `${view.heightMm * PX_PER_MM}px`;
    this.paper.classList.toggle('is-table', !!view.table);
    this.dimX.textContent = `${+view.widthMm.toFixed(2)} mm`;
    this.dimY.textContent = `${+view.heightMm.toFixed(2)} mm`;
    if (view.svg) {
      // l'SVG è prodotto dal motore (testi escapati); viene comunque analizzato come XML e non come HTML
      const doc = new DOMParser().parseFromString(view.svg, 'image/svg+xml');
      const svg = doc.documentElement;
      if (svg.nodeName === 'svg') {
        svg.querySelectorAll('script, foreignObject').forEach((n) => n.remove());
        svg.setAttribute('width', '100%');
        svg.setAttribute('height', '100%');
        svg.setAttribute('preserveAspectRatio', 'none');
        this.content.append(document.importNode(svg, true));
      }
    } else if (view.image) {
      const c = el('canvas', { class: 'raster' });
      c.width = view.image.width;
      c.height = view.image.height;
      c.getContext('2d')!.putImageData(view.image, 0, 0);
      this.content.append(c);
    } else if (view.table) {
      const t = el('table', { class: 'data' });
      t.append(el('thead', {}, el('tr', {}, ...view.table.columns.map((c) => el('th', { text: c })))));
      const tb = el('tbody');
      for (const row of view.table.rows) tb.append(el('tr', { class: row[0].startsWith('=') ? 'total' : '' }, ...row.map((c) => el('td', { text: c }))));
      t.append(tb);
      this.content.append(t);
    }
    if (!keepView || sizeChanged || !this.fitted) this.fit();
    else this.apply();
  }
}

// ---------- Pannello parametri ----------
interface FormHandle {
  root: HTMLElement;
  setValues: (p: Params) => void;
  markIssues: (issues: Issue[]) => void;
  focusField: (key: string) => void;
  rebuildOptions: () => void;
}

function buildForm(gen: GeneratorDef, getParams: () => Params, onInput: (key: string, value: Params[string], commit: boolean) => void, onFile: (key: string, file: File) => void): FormHandle {
  const root = el('form', { class: 'params', novalidate: '' });
  root.addEventListener('submit', (e) => e.preventDefault());
  const groups = new Map<string, HTMLElement>();
  const rows = new Map<string, { row: HTMLElement; input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement; def: ParamDef; msg: HTMLElement }>();
  for (const def of gen.params) {
    let g = groups.get(def.group);
    if (!g) {
      g = el('fieldset', { class: 'group' }, el('legend', { text: def.group }));
      groups.set(def.group, g);
      root.append(g);
    }
    const id = `p-${gen.id}-${def.key}`;
    let input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    if (def.type === 'select') {
      input = el('select', { id });
    } else if (def.type === 'textarea') {
      input = el('textarea', { id, rows: '8', spellcheck: 'false' });
    } else if (def.type === 'bool') {
      input = el('input', { id, type: 'checkbox' });
    } else if (def.type === 'file') {
      input = el('input', { id, type: 'file', accept: def.accept ?? '' });
    } else {
      input = el('input', { id, type: def.type === 'number' ? 'text' : 'text', inputmode: def.type === 'number' ? 'decimal' : 'text', autocomplete: 'off' });
      if (def.maxLength) input.setAttribute('maxlength', String(def.maxLength));
    }
    const label = el('label', { for: id, text: def.label });
    const unit = def.unit ? el('span', { class: 'unit', text: def.unit }) : null;
    const msg = el('div', { class: 'field-msg', id: `${id}-msg`, 'aria-live': 'polite' });
    const help = def.help ? el('div', { class: 'help', text: def.help }) : null;
    const control = el('div', { class: 'control' }, input);
    if (unit) control.append(unit);
    if (def.type === 'number') {
      const step = def.step ?? 1;
      const stepper = (dir: number) => {
        const b = el('button', { class: 'btn icon tiny', type: 'button', tabindex: '-1', 'aria-label': dir > 0 ? `Aumenta ${def.label}` : `Diminuisci ${def.label}`, text: dir > 0 ? '+' : '−' });
        b.addEventListener('click', () => {
          const cur = parseFloat(String(getParams()[def.key]).replace(',', '.'));
          let v = (Number.isFinite(cur) ? cur : def.min ?? 0) + dir * step;
          if (def.min !== undefined) v = Math.max(def.min, v);
          if (def.max !== undefined) v = Math.min(def.max, v);
          v = Math.round(v / step) * step;
          const r = +v.toFixed(6);
          input.value = String(r);
          onInput(def.key, r, true);
        });
        return b;
      };
      control.prepend(stepper(-1));
      control.append(stepper(1));
    }
    const row = el('div', { class: `field type-${def.type}` });
    if (def.type === 'bool') row.append(el('div', { class: 'control check' }, input, label));
    else row.append(label, control);
    if (help) row.append(help);
    row.append(msg);
    input.setAttribute('aria-describedby', `${id}-msg`);
    g.append(row);
    rows.set(def.key, { row, input, def, msg });

    const read = (): Params[string] => {
      if (def.type === 'bool') return (input as HTMLInputElement).checked;
      if (def.type === 'number') {
        const s = input.value.trim().replace(',', '.');
        if (s === '') return '';
        const n = Number(s);
        return Number.isFinite(n) ? n : input.value;
      }
      return input.value;
    };
    if (def.type === 'file') {
      input.addEventListener('change', () => {
        const f = (input as HTMLInputElement).files?.[0];
        if (f) onFile(def.key, f);
      });
    } else {
      input.addEventListener('input', () => onInput(def.key, read(), def.type === 'select' || def.type === 'bool'));
      input.addEventListener('change', () => onInput(def.key, read(), true));
    }
  }
  const fillOptions = () => {
    for (const { def, input } of rows.values()) {
      if (def.type !== 'select') continue;
      const sel = input as HTMLSelectElement;
      const cur = sel.value;
      sel.replaceChildren(...(def.options ?? []).map((o) => el('option', { value: o.value, text: o.label })));
      sel.value = cur;
    }
  };
  fillOptions();
  return {
    root,
    rebuildOptions: fillOptions,
    setValues(p) {
      for (const { def, input, row } of rows.values()) {
        const v = p[def.key];
        if (def.type === 'bool') (input as HTMLInputElement).checked = v === true;
        else if (def.type === 'file') {
          /* il file resta selezionato */
        } else if (document.activeElement !== input || def.type === 'select') input.value = v === undefined ? '' : String(v);
        row.hidden = def.visibleIf ? !def.visibleIf(p) : false;
      }
      for (const g of groups.values()) g.hidden = [...g.querySelectorAll<HTMLElement>('.field')].every((f) => f.hidden);
    },
    markIssues(issues) {
      for (const { input, msg, row } of rows.values()) {
        msg.textContent = '';
        row.classList.remove('invalid', 'warn');
        input.removeAttribute('aria-invalid');
      }
      for (const is of issues) {
        if (!is.field) continue;
        const r = rows.get(is.field);
        if (!r || is.level === 'info') continue;
        if (!r.msg.textContent) r.msg.textContent = is.message;
        r.row.classList.add(is.level === 'error' ? 'invalid' : 'warn');
        if (is.level === 'error') r.input.setAttribute('aria-invalid', 'true');
      }
    },
    focusField(key) {
      const r = rows.get(key);
      if (!r) return;
      r.row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      r.input.focus();
    },
  };
}

async function decodeImage(file: File): Promise<FileInput> {
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('Immagine troppo pesante (massimo 25 MB).');
  if (!/^image\/(png|jpeg|webp|bmp)$/.test(file.type)) throw new Error('Formato non supportato: usa PNG, JPG, WebP o BMP.');
  const bmp = await createImageBitmap(file);
  if (bmp.width * bmp.height > MAX_UPLOAD_PIXELS) {
    bmp.close();
    throw new Error('Immagine troppo grande (massimo 50 megapixel).');
  }
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return { name: file.name, image: ctx.getImageData(0, 0, c.width, c.height) };
}

// ---------- Workspace di un generatore ----------
interface Workspace {
  root: HTMLElement;
  exportPrimary: () => Promise<ExportFile>;
  activate: () => void;
}

function createWorkspace(gen: GeneratorDef, setStatus: (s: Status, msg: string) => void): Workspace {
  const storeKey = `ingly.params.${gen.id}`;
  const saved = store<Params>(storeKey);
  let params: Params = { ...gen.defaults, ...(saved ? sanitizeImported(gen.params, saved) : {}) };
  const files: RunContext['files'] = {};
  const history = new History();
  let result: GeneratorResult = { views: [], issues: [], stats: [], exports: [] };
  let viewId = '';
  let timer = 0;
  let lastCommitted: Params = { ...params };

  const stage = new Stage();
  const issuesBox = el('ul', { class: 'issues', role: 'status', 'aria-live': 'polite' });
  const statsBox = el('dl', { class: 'stats' });
  const viewTabs = el('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Viste' });
  const presetBox = el('div', { class: 'presets' });
  const exportSelect = el('select', { class: 'export-select', 'aria-label': 'Formato di esportazione' });
  const exportBtn = el('button', { class: 'btn primary', type: 'button', text: 'Esporta' });
  const exportHint = el('span', { class: 'export-hint' });
  const undoBtn = el('button', { class: 'btn', type: 'button', title: 'Annulla (Ctrl+Z)', text: '↶ Annulla' });
  const redoBtn = el('button', { class: 'btn', type: 'button', title: 'Ripristina (Ctrl+Shift+Z)', text: '↷ Ripristina' });
  const resetBtn = el('button', { class: 'btn', type: 'button', title: 'Riporta tutti i parametri ai valori iniziali', text: 'Reset' });

  const form = buildForm(gen, () => params, (key, value, commit) => {
    params = { ...params, [key]: value };
    if (commit) commitHistory();
    schedule();
  }, async (key, file) => {
    setStatus('processing', 'Lettura immagine…');
    try {
      files[key] = await decodeImage(file);
      params = { ...params, [key]: file.name };
      schedule(0);
    } catch (e) {
      files[key] = undefined;
      setStatus('error', (e as Error).message);
    }
  });

  function commitHistory(): void {
    if (JSON.stringify(lastCommitted) === JSON.stringify(params)) return;
    history.push(lastCommitted);
    lastCommitted = { ...params };
    updateHistoryButtons();
  }
  function updateHistoryButtons(): void {
    undoBtn.disabled = !history.canUndo;
    redoBtn.disabled = !history.canRedo;
  }
  function setParams(next: Params): void {
    params = { ...next };
    lastCommitted = { ...params };
    form.setValues(params);
    updateHistoryButtons();
    schedule(0);
  }
  undoBtn.addEventListener('click', () => {
    const prev = history.undo(params);
    if (prev) setParams(prev);
  });
  redoBtn.addEventListener('click', () => {
    const next = history.redo(params);
    if (next) setParams(next);
  });
  resetBtn.addEventListener('click', () => {
    history.push(params);
    setParams({ ...gen.defaults });
  });

  function schedule(delay = 140): void {
    form.setValues(params);
    setStatus('processing', 'Elaborazione…');
    clearTimeout(timer);
    timer = window.setTimeout(regenerate, delay);
  }

  function regenerate(): void {
    try {
      result = gen.run(params, { files });
    } catch (e) {
      result = { views: [], issues: [{ level: 'error', message: `Errore interno del generatore: ${(e as Error).message}` }], stats: [], exports: [] };
      console.error(e);
    }
    store(storeKey, params);
    render();
  }

  function render(keepView = true): void {
    form.markIssues(result.issues);
    // viste
    if (!result.views.some((v) => v.id === viewId)) viewId = result.views[0]?.id ?? '';
    viewTabs.replaceChildren(...result.views.map((v) => {
      const b = el('button', { class: `tab${v.id === viewId ? ' active' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(v.id === viewId), text: v.label });
      b.addEventListener('click', () => {
        viewId = v.id;
        render(false);
      });
      return b;
    }));
    viewTabs.hidden = result.views.length < 2;
    stage.show(result.views.find((v) => v.id === viewId) ?? null, keepView);
    // problemi
    const errors = result.issues.filter((i) => i.level === 'error');
    issuesBox.replaceChildren();
    if (!result.issues.length) issuesBox.append(el('li', { class: 'ok', text: '✓ Controlli superati: nessun problema rilevato.' }));
    for (const is of [...result.issues].sort((a, b) => rank(a) - rank(b))) {
      const item = el('li', { class: `issue ${is.level}` }, el('span', { class: 'badge', text: is.level === 'error' ? 'Errore' : is.level === 'warning' ? 'Attenzione' : 'Info' }), ' ', is.message);
      if (is.field) {
        item.classList.add('link');
        item.tabIndex = 0;
        const go = () => form.focusField(is.field!);
        item.addEventListener('click', go);
        item.addEventListener('keydown', (e) => e.key === 'Enter' && go());
      }
      issuesBox.append(item);
    }
    // statistiche
    statsBox.replaceChildren(...result.stats.flatMap((s) => [el('dt', { text: s.label }), el('dd', { text: s.value })]));
    // esportazioni
    const prev = exportSelect.value;
    exportSelect.replaceChildren(...result.exports.map((x) => el('option', { value: x.id, text: x.label })));
    if (result.exports.some((x) => x.id === prev)) exportSelect.value = prev;
    updateExportState();
    if (errors.length) setStatus('error', `${errors.length} ${errors.length === 1 ? 'errore' : 'errori'} da correggere`);
    else if (!result.views.length) setStatus('idle', 'In attesa di dati');
    else setStatus('done', 'Anteprima aggiornata');
  }
  const rank = (i: Issue) => (i.level === 'error' ? 0 : i.level === 'warning' ? 1 : 2);

  function updateExportState(): void {
    const opt = result.exports.find((x) => x.id === exportSelect.value);
    const blocked = !opt || (opt.requiresValid && hasErrors(result.issues));
    exportBtn.disabled = blocked;
    exportSelect.disabled = !result.exports.length;
    exportHint.textContent = !result.exports.length ? 'Nessun file esportabile finché ci sono errori o dati mancanti.' : blocked ? 'Esportazione bloccata: correggi gli errori.' : '';
  }
  exportSelect.addEventListener('change', updateExportState);
  exportBtn.addEventListener('click', async () => {
    const opt = result.exports.find((x) => x.id === exportSelect.value);
    if (!opt) return;
    exportBtn.disabled = true;
    setStatus('processing', 'Esportazione…');
    try {
      const f = await opt.build();
      downloadFile(f);
      setStatus('done', `File esportato: ${f.filename}`);
    } catch (e) {
      setStatus('error', `Esportazione non riuscita: ${(e as Error).message}`);
    } finally {
      updateExportState();
    }
  });

  // preset
  if (gen.presets?.length) {
    presetBox.append(el('h3', { text: 'Modelli rapidi' }));
    for (const pr of gen.presets) {
      const b = el('button', { class: 'chip', type: 'button', text: pr.label });
      b.addEventListener('click', () => {
        history.push(params);
        setParams({ ...gen.defaults, ...pr.values });
      });
      presetBox.append(b);
    }
  }

  // progetto: salva / apri parametri
  const projectInput = el('input', { type: 'file', accept: 'application/json,.json', hidden: '' });
  const saveProject = el('button', { class: 'btn small', type: 'button', text: 'Salva progetto' });
  const openProject = el('button', { class: 'btn small', type: 'button', text: 'Apri progetto' });
  saveProject.addEventListener('click', () => {
    const data = { format: 'ingly-project', version: 1, generator: gen.id, savedAt: new Date().toISOString(), params };
    downloadFile(jsonFile(data, safeFilename(`${String(params.filename ?? gen.id)}-progetto`, 'json')));
  });
  openProject.addEventListener('click', () => projectInput.click());
  projectInput.addEventListener('change', async () => {
    const f = projectInput.files?.[0];
    projectInput.value = '';
    if (!f) return;
    try {
      if (f.size > 1_000_000) throw new Error('File troppo grande.');
      const data = JSON.parse(await f.text());
      if (data?.format !== 'ingly-project' || data.generator !== gen.id) throw new Error('Non è un progetto di questo generatore.');
      history.push(params);
      setParams({ ...gen.defaults, ...sanitizeImported(gen.params, data.params) });
      setStatus('done', 'Progetto caricato');
    } catch (e) {
      setStatus('error', `Progetto non valido: ${(e as Error).message}`);
    }
  });

  const extraHost = el('div', { class: 'extra' });
  if (gen.mountExtra) gen.mountExtra(extraHost, () => {
    form.rebuildOptions();
    schedule(0);
  });

  const left = el('aside', { class: 'panel left', 'aria-label': 'Strumenti' },
    presetBox,
    el('div', { class: 'block' }, el('h3', { text: 'Risultato' }), statsBox),
    el('div', { class: 'block' }, el('h3', { text: 'Progetto' }), el('div', { class: 'row-actions' }, saveProject, openProject, projectInput),
      el('p', { class: 'muted small', text: 'I parametri restano anche in questo browser. Il file di progetto serve per backup e per riaprirli altrove.' })),
  );
  const right = el('aside', { class: 'panel right', 'aria-label': 'Parametri' },
    el('h2', { class: 'panel-title', text: 'Parametri' }), form.root, extraHost);
  const center = el('div', { class: 'center' }, viewTabs, stage.root, el('div', { class: 'block issues-wrap' }, el('h3', { text: 'Controlli' }), issuesBox));
  const actions = el('div', { class: 'actionbar', role: 'toolbar', 'aria-label': 'Azioni' },
    el('div', { class: 'group-btns' }, undoBtn, redoBtn, resetBtn),
    el('div', { class: 'export' }, exportHint, exportSelect, exportBtn));
  const root = el('div', { class: 'workspace' }, actions, el('div', { class: 'cols' }, left, center, right));

  root.addEventListener('keydown', (e) => {
    const tgt = e.target as HTMLElement;
    if (tgt.matches('input[type=text], textarea')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      (e.shiftKey ? redoBtn : undoBtn).click();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redoBtn.click();
    }
  });

  updateHistoryButtons();
  form.setValues(params);

  return {
    root,
    activate: () => {
      regenerate();
      requestAnimationFrame(() => stage.fit());
    },
    exportPrimary: async () => {
      const r = gen.run(params, { files });
      const errs = r.issues.filter((i) => i.level === 'error');
      if (errs.length) throw new Error(`Correggi prima: ${errs.map((e) => e.message).join(' ')}`);
      const opt = r.exports.find((x) => x.primary) ?? r.exports[0];
      if (!opt) throw new Error('Nessun file esportabile.');
      return opt.build();
    },
  };
}

// ---------- Montaggio dell'app ----------
export interface MountOptions {
  /** true = suite con dashboard; false = singolo generatore (pacchetto Atomm) */
  suite: boolean;
}

export function mountApp(host: HTMLElement, gens: GeneratorDef[], opts: MountOptions): void {
  const statusChip = el('span', { class: 'status idle', role: 'status', 'aria-live': 'polite', text: 'Pronto' });
  const atommChip = el('span', { class: 'chip-static', title: 'Integrazione piattaforma Atomm', text: 'Atomm: verifica…' });
  const themeBtn = el('button', { class: 'btn ghost small', type: 'button' });
  const title = el('span', { class: 'gen-title' });
  const homeBtn = el('button', { class: 'btn ghost small', type: 'button', text: '← Tutti i generatori' });
  homeBtn.hidden = true;
  const header = el('header', { class: 'topbar' },
    el('div', { class: 'brand' }, el('span', { class: 'logo', 'aria-hidden': 'true', text: 'IG' }), el('span', {}, el('b', { text: 'INGLY' }), ' Generator Lab', el('span', { class: 'pro', text: 'PRO' }))),
    homeBtn, title,
    el('div', { class: 'top-right' }, statusChip, atommChip, themeBtn));
  const main = el('main', { class: 'main' });
  host.replaceChildren(header, main);
  initTheme(themeBtn);

  const setStatus = (s: Status, msg: string) => {
    statusChip.className = `status ${s}`;
    statusChip.textContent = msg;
  };
  const workspaces = new Map<string, Workspace>();
  let active: Workspace | null = null;
  const open = (gen: GeneratorDef) => {
    let ws = workspaces.get(gen.id);
    if (!ws) {
      ws = createWorkspace(gen, setStatus);
      workspaces.set(gen.id, ws);
    }
    active = ws;
    title.textContent = `${gen.code} · ${gen.title}`;
    homeBtn.hidden = !opts.suite;
    main.replaceChildren(ws.root);
    ws.activate();
    if (opts.suite) history.replaceState(null, '', `#${gen.id}`);
  };
  const dashboard = () => {
    active = null;
    title.textContent = '';
    homeBtn.hidden = true;
    history.replaceState(null, '', '#');
    setStatus('idle', 'Scegli un generatore');
    main.replaceChildren(el('section', { class: 'dashboard' },
      el('h1', { text: 'Generatori' }),
      el('p', { class: 'muted', text: 'Strumenti parametrici per laser, CNC e stampa. Ogni file esportato è vettoriale, in millimetri e verificato.' }),
      el('div', { class: 'cards' }, ...gens.map((g) => {
        const card = el('button', { class: 'card', type: 'button' }, el('span', { class: 'code', text: g.code }), el('b', { text: g.title }), el('span', { class: 'muted', text: g.tagline }));
        card.addEventListener('click', () => open(g));
        return card;
      }))));
  };
  homeBtn.addEventListener('click', dashboard);

  connectAtomm(async () => {
    if (!active) throw new Error('Apri un generatore prima di esportare.');
    return active.exportPrimary();
  }, (s) => {
    atommChip.textContent = s === 'connected' ? 'Atomm: collegato' : 'Modalità autonoma';
    atommChip.classList.toggle('on', s === 'connected');
  });

  if (!opts.suite || gens.length === 1) open(gens[0]);
  else {
    const g = gens.find((x) => `#${x.id}` === location.hash);
    if (g) open(g);
    else dashboard();
  }
}
