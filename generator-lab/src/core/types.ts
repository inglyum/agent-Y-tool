// Contratti condivisi fra generator-core, UI ed export-engine.
// Ogni generatore è una funzione pura parametri → risultato; la UI non contiene logica geometrica.

export type ParamValue = number | string | boolean;
export type Params = Record<string, ParamValue>;

export type ParamType = 'number' | 'text' | 'textarea' | 'select' | 'bool' | 'file';

export interface ParamOption {
  value: string;
  label: string;
}

export interface ParamDef {
  key: string;
  label: string;
  type: ParamType;
  group: string;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: ParamOption[];
  help?: string;
  maxLength?: number;
  /** Il controllo viene mostrato solo se la condizione è vera. */
  visibleIf?: (p: Params) => boolean;
  /** Per type 'file': estensioni accettate. */
  accept?: string;
}

export type IssueLevel = 'error' | 'warning' | 'info';

export interface Issue {
  level: IssueLevel;
  message: string;
  field?: string;
}

export interface Stat {
  label: string;
  value: string;
}

/** Vista mostrata nel canvas centrale. Le dimensioni sono sempre in millimetri. */
export interface View {
  id: string;
  label: string;
  widthMm: number;
  heightMm: number;
  /** SVG generato dal motore (testi utente già escapati). */
  svg?: string;
  /** Raster (Image Prep): disegnato in un canvas dimensionato in mm. */
  image?: ImageData;
  /** Contenuto tabellare (Cost Lab): righe etichetta/valore, rese con textContent. */
  table?: { columns: string[]; rows: string[][] };
}

export interface ExportFile {
  filename: string;
  blob: Blob;
}

export interface ExportOption {
  id: string;
  label: string;
  /** Se true l'esportazione è bloccata quando ci sono errori. */
  requiresValid: boolean;
  /** L'opzione usata dall'hook di export di Atomm. */
  primary?: boolean;
  build: () => Promise<ExportFile>;
}

export interface GeneratorResult {
  views: View[];
  issues: Issue[];
  stats: Stat[];
  exports: ExportOption[];
}

export interface FileInput {
  name: string;
  image: ImageData;
}

export interface RunContext {
  files: Record<string, FileInput | undefined>;
}

export interface Preset {
  id: string;
  label: string;
  values: Params;
}

export interface GeneratorDef {
  id: string;
  /** slug usato per l'app Atomm e per il file .html */
  slug: string;
  code: string;
  title: string;
  tagline: string;
  params: ParamDef[];
  defaults: Params;
  presets?: Preset[];
  run: (p: Params, ctx: RunContext) => GeneratorResult;
  /** Pannello aggiuntivo opzionale (es. catalogo materiali). Riceve un callback per rigenerare. */
  mountExtra?: (host: HTMLElement, rerun: () => void) => void;
}
