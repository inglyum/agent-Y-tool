-- INGLY xTool Expert Agent — schema iniziale (SQLite).
-- Convenzioni: id INTEGER PK, timestamp ISO-8601 UTC in TEXT, JSON in TEXT.

-- ---------- Workspace, utenti, ruoli, permessi ----------
-- Un solo workspace in uso (INGLY DESIGN); la tabella prepara la separazione per più attività.
CREATE TABLE workspaces (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE roles (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT
);
CREATE TABLE permissions (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  description TEXT
);
CREATE TABLE role_permissions (
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  workspace_id INTEGER NOT NULL DEFAULT 1 REFERENCES workspaces(id),
  email TEXT NOT NULL UNIQUE,            -- sempre salvata in minuscolo
  password_hash TEXT NOT NULL,
  role_id INTEGER NOT NULL REFERENCES roles(id),
  active INTEGER NOT NULL DEFAULT 1,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- ---------- Fonti e documenti ----------
CREATE TABLE sources (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  base_url TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('official','official_support','official_training','official_community','host','community','independent')),
  priority INTEGER NOT NULL,             -- 1 = più autorevole
  region TEXT,                           -- es. it-IT, global
  crawl_enabled INTEGER NOT NULL DEFAULT 0,
  crawl_interval_hours INTEGER NOT NULL DEFAULT 24,
  allowed_path_prefixes TEXT,            -- JSON array
  last_crawl_at TEXT,
  last_crawl_status TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE documents (
  id INTEGER PRIMARY KEY,
  source_id INTEGER NOT NULL REFERENCES sources(id),
  url TEXT NOT NULL UNIQUE,
  title TEXT,
  content_type TEXT,
  language TEXT,
  region TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','gone','error','removed')),
  removed_reason TEXT,
  current_version_id INTEGER,
  content_hash TEXT,
  first_seen_at TEXT NOT NULL,
  last_checked_at TEXT,
  last_changed_at TEXT,
  http_status INTEGER,
  etag TEXT,
  last_modified TEXT
);
CREATE INDEX idx_documents_source ON documents(source_id);
CREATE INDEX idx_documents_hash ON documents(content_hash);

CREATE TABLE document_versions (
  id INTEGER PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  title TEXT,
  text TEXT NOT NULL,
  metadata TEXT,                         -- JSON
  fetched_at TEXT NOT NULL,
  UNIQUE (document_id, version)
);

CREATE TABLE document_chunks (
  id INTEGER PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version_id INTEGER NOT NULL REFERENCES document_versions(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  heading TEXT,                          -- sezione del documento
  page INTEGER,                          -- pagina (PDF)
  text TEXT NOT NULL,
  product_keys TEXT,                     -- JSON array di prodotti citati
  region TEXT,
  embedding BLOB,                        -- float32 little-endian
  embedding_model TEXT,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_document_chunks_document ON document_chunks(document_id, active);
CREATE VIRTUAL TABLE document_chunks_fts USING fts5(
  text, heading, title,
  tokenize='unicode61 remove_diacritics 2'          -- rowid = document_chunks.id
);

CREATE TABLE crawl_jobs (
  id INTEGER PRIMARY KEY,
  source_id INTEGER NOT NULL REFERENCES sources(id),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,                  -- running | done | failed
  pages_seen INTEGER NOT NULL DEFAULT 0,
  pages_changed INTEGER NOT NULL DEFAULT 0,
  pages_gone INTEGER NOT NULL DEFAULT 0,
  error TEXT
);
CREATE TABLE crawl_results (
  id INTEGER PRIMARY KEY,
  crawl_job_id INTEGER NOT NULL REFERENCES crawl_jobs(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  outcome TEXT NOT NULL,                 -- new | changed | unchanged | gone | skipped_robots | error
  http_status INTEGER,
  detail TEXT,
  at TEXT NOT NULL
);

-- ---------- Catalogo ----------
CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,              -- slug stabile
  brand TEXT NOT NULL DEFAULT 'xTool',
  official_name TEXT NOT NULL,
  family TEXT,
  model TEXT,
  revision TEXT,
  category TEXT,                         -- laser | printer | metalfab | ...
  market TEXT,                           -- es. EU-IT
  technology TEXT,
  source_type TEXT,                      -- tipo di sorgente laser
  nominal_power TEXT,
  work_area TEXT,
  supported_materials TEXT,              -- JSON array
  declared_limitations TEXT,             -- JSON array
  software TEXT,                         -- JSON array
  firmware_notes TEXT,
  manual_urls TEXT,                      -- JSON array
  aliases TEXT,                          -- JSON array per il riconoscimento nei testi
  status TEXT NOT NULL DEFAULT 'to_verify' CHECK (status IN ('verified','to_verify','superseded','retired')),
  source_url TEXT,
  verified_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE product_specs (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  value TEXT NOT NULL,
  unit TEXT,
  source_url TEXT NOT NULL,
  document_id INTEGER REFERENCES documents(id),
  verified_at TEXT,
  status TEXT NOT NULL DEFAULT 'to_verify' CHECK (status IN ('verified','to_verify','superseded','retired')),
  UNIQUE (product_id, name, source_url)
);
CREATE TABLE accessories (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  official_name TEXT NOT NULL,
  category TEXT,
  function TEXT,
  aliases TEXT,
  status TEXT NOT NULL DEFAULT 'to_verify' CHECK (status IN ('verified','to_verify','superseded','retired')),
  source_url TEXT,
  verified_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE compatibility_rules (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  accessory_id INTEGER NOT NULL REFERENCES accessories(id) ON DELETE CASCADE,
  relation TEXT NOT NULL CHECK (relation IN ('compatible','incompatible','required','recommended')),
  conditions TEXT,
  source_url TEXT NOT NULL,
  verified_at TEXT,
  status TEXT NOT NULL DEFAULT 'to_verify' CHECK (status IN ('verified','to_verify','superseded','retired')),
  UNIQUE (product_id, accessory_id, relation, source_url)
);
CREATE TABLE materials (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  aliases TEXT,
  precautions TEXT,                      -- JSON array
  avoid INTEGER NOT NULL DEFAULT 0,      -- materiale da non lavorare
  avoid_reason TEXT,
  source_url TEXT,
  verified_at TEXT,
  status TEXT NOT NULL DEFAULT 'to_verify' CHECK (status IN ('verified','to_verify','superseded','retired')),
  updated_at TEXT NOT NULL
);
CREATE TABLE product_materials (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  material_id INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  operation TEXT NOT NULL CHECK (operation IN ('engrave','cut','mark','print')),
  max_thickness TEXT,
  official_params TEXT,                  -- JSON, solo da fonti ufficiali
  source_url TEXT NOT NULL,
  verified_at TEXT,
  UNIQUE (product_id, material_id, operation, source_url)
);
CREATE TABLE faqs (
  id INTEGER PRIMARY KEY,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  product_key TEXT,
  source_url TEXT NOT NULL,
  verified_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE knowledge_updates (
  id INTEGER PRIMARY KEY,
  document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,                    -- new_document | changed | gone | conflict
  summary TEXT NOT NULL,
  detected_at TEXT NOT NULL,
  acknowledged INTEGER NOT NULL DEFAULT 0
);

-- ---------- Social ----------
CREATE TABLE social_connections (
  id INTEGER PRIMARY KEY,
  platform TEXT NOT NULL CHECK (platform IN ('facebook','instagram','manual')),
  external_id TEXT NOT NULL,
  name TEXT,
  auth_type TEXT NOT NULL,               -- oauth_page_token | oauth_user_token | none
  token_encrypted TEXT,
  token_expires_at TEXT,
  scopes TEXT,                           -- JSON array concessi
  status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected','expired','error','disconnected')),
  last_error TEXT,
  connected_at TEXT,
  UNIQUE (platform, external_id)
);
CREATE TABLE social_sources (
  id INTEGER PRIMARY KEY,
  connection_id INTEGER REFERENCES social_connections(id) ON DELETE SET NULL,
  platform TEXT NOT NULL,
  kind TEXT NOT NULL,                    -- page | ig_business | fb_group_manual | website | manual
  external_id TEXT,
  name TEXT NOT NULL,
  url TEXT,
  active INTEGER NOT NULL DEFAULT 0,
  poll_interval_minutes INTEGER NOT NULL DEFAULT 30,
  last_success_at TEXT,
  last_error TEXT,
  last_error_at TEXT,
  limits_note TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE social_items (
  id INTEGER PRIMARY KEY,
  source_id INTEGER NOT NULL REFERENCES social_sources(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  external_id TEXT NOT NULL,             -- ID piattaforma o hash stabile per import manuale
  parent_external_id TEXT,
  kind TEXT NOT NULL,                    -- post | comment | message
  author_ref TEXT,                       -- ID pseudonimo / nome visibile, mai email
  author_name TEXT,
  text TEXT NOT NULL,
  permalink TEXT,
  created_at_platform TEXT,
  collected_at TEXT NOT NULL,
  language TEXT,
  products TEXT,                         -- JSON array chiavi prodotto
  materials TEXT,                        -- JSON array
  category TEXT,                         -- technical | compatibility | price | commercial | demo_course | problem | complaint | misinformation | sensitive | spam | other
  intent TEXT,
  priority TEXT,                         -- high | medium | low
  risk_flags TEXT,                       -- JSON array
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','processing','drafted','in_review','approved','published','rejected','ignored','handled','error')),
  decision_reason TEXT,
  processed_at TEXT,
  UNIQUE (platform, external_id)
);
CREATE INDEX idx_items_status ON social_items(status, collected_at);

CREATE TABLE conversations (
  id INTEGER PRIMARY KEY,
  social_item_id INTEGER REFERENCES social_items(id) ON DELETE SET NULL,
  lead_id INTEGER REFERENCES leads(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  summary TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE response_drafts (
  id INTEGER PRIMARY KEY,
  social_item_id INTEGER NOT NULL REFERENCES social_items(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  language TEXT,
  citations TEXT,                        -- JSON [{chunk_id, url, title}]
  confidence REAL,
  evidence_score REAL,
  risk_flags TEXT,                       -- JSON
  validation_errors TEXT,                -- JSON
  decision TEXT NOT NULL,                -- publish | review | ignore
  decision_reason TEXT,
  generated_by TEXT NOT NULL,            -- provider:model | template
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','published','failed','superseded')),
  edited_by INTEGER REFERENCES users(id),
  approved_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_drafts_status ON response_drafts(status);

CREATE TABLE published_responses (
  id INTEGER PRIMARY KEY,
  draft_id INTEGER NOT NULL REFERENCES response_drafts(id),
  social_item_id INTEGER NOT NULL REFERENCES social_items(id),
  idempotency_key TEXT NOT NULL UNIQUE,  -- impedisce doppie pubblicazioni
  platform TEXT NOT NULL,
  external_response_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('reserved','published','failed')),
  error TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL
);

-- ---------- Automazioni ----------
CREATE TABLE automation_rules (
  id INTEGER PRIMARY KEY,
  category TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT '*',
  mode TEXT NOT NULL CHECK (mode IN ('OFF','MONITOR','DRAFT','APPROVAL','AUTO_SAFE')),
  min_confidence REAL NOT NULL DEFAULT 0.85,
  min_evidence REAL NOT NULL DEFAULT 0.6,
  max_per_hour INTEGER NOT NULL DEFAULT 5,
  max_per_day INTEGER NOT NULL DEFAULT 30,
  include_cta INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (category, channel)
);

-- ---------- CRM ----------
CREATE TABLE leads (
  id INTEGER PRIMARY KEY,
  display_name TEXT,
  platform TEXT,
  platform_user_ref TEXT,
  source_item_id INTEGER REFERENCES social_items(id) ON DELETE SET NULL,
  category TEXT NOT NULL,                -- curious | machine | accessory | materials | support | course | demo | quote | b2b
  owned_machine TEXT,
  desired_machine TEXT,
  materials TEXT,                        -- JSON
  applications TEXT,
  score INTEGER NOT NULL DEFAULT 0,
  score_explanation TEXT,                -- JSON [{signal, points}]
  stage TEXT NOT NULL DEFAULT 'NEW' CHECK (stage IN ('NEW','QUALIFIED','CONTACT_REQUESTED','CONTACTED','DEMO_BOOKED','QUOTE_REQUESTED','WON','LOST')),
  contact_email TEXT,                    -- solo con consenso
  contact_phone TEXT,                    -- solo con consenso
  notes TEXT,
  retention_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (platform, platform_user_ref, source_item_id)
);
CREATE INDEX idx_leads_stage ON leads(stage);
CREATE TABLE lead_events (
  id INTEGER PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                    -- created | stage_change | note | demo_request | course_request | quote_request | follow_up
  detail TEXT,
  due_at TEXT,
  done INTEGER NOT NULL DEFAULT 0,
  user_id INTEGER REFERENCES users(id),
  at TEXT NOT NULL
);
CREATE TABLE consents (
  id INTEGER PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL,                 -- contact | marketing | demo
  granted INTEGER NOT NULL,
  channel TEXT,
  legal_basis TEXT NOT NULL,             -- consent | contract | legitimate_interest
  evidence TEXT,
  at TEXT NOT NULL
);

-- ---------- Audit, valutazione, uso AI, impostazioni, job ----------
CREATE TABLE audit_events (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  user_id INTEGER,
  actor TEXT NOT NULL,                   -- user:<id> | system | job:<name>
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  detail TEXT                            -- JSON, già redatto
);
CREATE INDEX idx_audit_at ON audit_events(at);

CREATE TABLE evaluation_cases (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  input_text TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'it',
  expected_category TEXT,
  expected_decision TEXT,
  must_include TEXT,                     -- JSON
  must_not_include TEXT,                 -- JSON
  notes TEXT
);
CREATE TABLE evaluation_runs (
  id INTEGER PRIMARY KEY,
  started_at TEXT NOT NULL,
  provider TEXT NOT NULL,
  results TEXT NOT NULL,                 -- JSON
  summary TEXT NOT NULL                  -- JSON
);

CREATE TABLE ai_usage (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT,
  purpose TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_eur REAL NOT NULL DEFAULT 0,
  latency_ms INTEGER,
  ok INTEGER NOT NULL,
  error TEXT
);

CREATE TABLE system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,                   -- JSON
  updated_at TEXT NOT NULL,
  updated_by INTEGER
);
CREATE TABLE prompt_versions (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  text TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  created_by INTEGER,
  UNIQUE (name, version)
);

CREATE TABLE jobs (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  dedupe_key TEXT UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('queued','running','done','failed','dead')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  run_after TEXT NOT NULL,
  locked_by TEXT,
  lease_until TEXT,
  last_error TEXT,
  duration_ms INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_jobs_ready ON jobs(status, run_after);
CREATE TABLE job_schedules (
  name TEXT PRIMARY KEY,
  interval_minutes INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  payload TEXT NOT NULL DEFAULT '{}',
  last_enqueued_at TEXT
);
CREATE TABLE rate_limits (
  bucket TEXT NOT NULL,
  window_start TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (bucket, window_start)
);
