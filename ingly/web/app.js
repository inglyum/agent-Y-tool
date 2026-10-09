"use strict";
/* INGLY Agent Control Center — dashboard vanilla JS. Tutti i dati inseriti nell'HTML passano da esc(). */

const SECTIONS = [
  ["overview", "Overview"], ["agent", "AI Agent"], ["kb", "xTool Knowledge Base"], ["products", "Prodotti e Macchine"],
  ["accessories", "Accessori e Compatibilità"], ["materials", "Materiali"], ["sources", "Fonti e Crawler"],
  ["listening", "Social Listening"], ["facebook", "Facebook"], ["instagram", "Instagram"], ["queue", "Coda Risposte"],
  ["leads", "Lead CRM"], ["requests", "Demo e Corsi"], ["analytics", "Analytics"], ["eval", "Test e Valutazione AI"],
  ["automation", "Automazioni"], ["users", "Utenti e Permessi"], ["security", "Sicurezza e Audit"],
  ["settings", "Impostazioni"], ["usage", "Costi e Utilizzo AI"],
];
const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDate = (s) => (s ? new Date(s).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" }) : "—");
const state = { csrf: null, me: null, section: "overview" };

// ---------- API ----------
async function api(method, path, body, isForm) {
  const opts = { method, headers: {}, credentials: "same-origin" };
  if (state.csrf && method !== "GET") opts.headers["X-CSRF-Token"] = state.csrf;
  if (body !== undefined) {
    if (isForm) opts.body = body;
    else { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
  }
  const r = await fetch(path, opts);
  if (r.status === 401 && path !== "/api/auth/login") { showLogin(); throw new Error("Sessione scaduta: accedi di nuovo"); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = data.error || (Array.isArray(data.detail) ? data.detail.map((d) => d.msg).join("; ") : data.detail) || `Errore ${r.status}`;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return data;
}
function toast(msg, bad) {
  const t = $("#toast");
  t.textContent = msg; t.classList.toggle("bad", !!bad); t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), bad ? 6000 : 3000);
}
async function act(fn, okMsg) {
  try { const r = await fn(); if (okMsg) toast(okMsg); return r; } catch (e) { toast(e.message, true); return null; }
}
const can = (p) => state.me && state.me.permissions.includes(p);

// ---------- helpers UI ----------
const STATUS_TONE = {
  connected: "good", verified: "good", published: "good", done: "good", active: "good", approved: "good", WON: "good",
  to_verify: "warn", pending: "warn", in_review: "warn", queued: "warn", expired: "bad", error: "bad", failed: "bad", dead: "bad",
  gone: "bad", rejected: "bad", LOST: "bad", disconnected: "", superseded: "", retired: "", high: "bad", medium: "gold", low: "",
  review: "warn", publish: "good", draft: "info", monitor: "", ignore: "", running: "info",
};
const badge = (v, tone) => `<span class="badge ${tone ?? STATUS_TONE[v] ?? ""}">${esc(v ?? "—")}</span>`;
const empty = (msg) => `<div class="empty">${msg}</div>`;
function table(cols, rows, emptyMsg = "Nessun dato") {
  if (!rows || !rows.length) return empty(emptyMsg);
  return `<div class="table-wrap"><table><thead><tr>${cols.map((c) => `<th>${esc(c[0])}</th>`).join("")}</tr></thead><tbody>${
    rows.map((r) => `<tr>${cols.map((c) => `<td class="${c[2] || ""}">${c[1](r)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
const panel = (title, body, extra = "", sub = "") =>
  `<section class="panel"><header><div><h2>${esc(title)}</h2>${sub ? `<p class="muted">${sub}</p>` : ""}</div><div class="row">${extra}</div></header>${body}</section>`;
const tile = (label, value) => value === null || value === undefined
  ? `<div class="tile empty"><b>nessun dato</b><span>${esc(label)}</span></div>`
  : `<div class="tile"><b>${esc(value)}</b><span>${esc(label)}</span></div>`;
function bars(rows, labelKey, valueKey, emptyMsg) {
  if (!rows || !rows.length) return empty(emptyMsg || "Nessun dato nel periodo");
  const max = Math.max(...rows.map((r) => r[valueKey])) || 1;
  const html = `<div class="bars" role="table">${rows.map((r) => `<div class="bar-row" role="row" title="${esc(r[labelKey])}: ${esc(r[valueKey])}">
      <span class="lbl" role="cell">${esc(r[labelKey])}</span><span class="track" role="cell"><span class="fill" data-w="${(r[valueKey] / max) * 100}"></span></span>
      <span class="val" role="cell">${esc(r[valueKey])}</span></div>`).join("")}</div>`;
  return html;
}
function applyBarWidths(root) { root.querySelectorAll(".fill[data-w]").forEach((el) => { el.style.width = `${el.dataset.w}%`; el.style.display = "block"; }); }
const link = (url, text) => (url && /^https?:\/\//.test(url) ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(text || url)}</a>` : esc(text || url || "—"));
function openModal(html) { $("#modal-body").innerHTML = html; $("#modal").showModal(); }
function formData(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === "checkbox") o[el.name] = el.checked;
    else if (el.dataset.type === "list") o[el.name] = el.value.split(",").map((s) => s.trim()).filter(Boolean);
    else if (el.dataset.type === "number") o[el.name] = el.value === "" ? null : Number(el.value);
    else o[el.name] = el.value === "" ? null : el.value;
  }
  return o;
}
const field = (name, label, opts = {}) => {
  const id = `f-${name}-${Math.random().toString(36).slice(2, 7)}`;
  const attrs = `id="${id}" name="${esc(name)}" ${opts.required ? "required" : ""} ${opts.type === "number" ? 'data-type="number"' : ""} ${opts.list ? 'data-type="list"' : ""}`;
  let input;
  if (opts.options) input = `<select ${attrs}>${opts.options.map((o) => `<option value="${esc(o)}" ${o === opts.value ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
  else if (opts.textarea) input = `<textarea ${attrs} placeholder="${esc(opts.placeholder || "")}">${esc(opts.value || "")}</textarea>`;
  else input = `<input ${attrs} type="${opts.type === "number" ? "number" : opts.type || "text"}" step="any" value="${esc(opts.value ?? "")}" placeholder="${esc(opts.placeholder || "")}">`;
  return `<div><label for="${id}">${esc(label)}</label>${input}</div>`;
};

// ---------- sezioni ----------
const R = {};

R.overview = async () => {
  const o = await api("GET", "/api/overview");
  const s = o.social_30d, k = o.kb, c = o.crm_30d;
  const accounts = o.connections.accounts;
  return [
    o.kill_switch ? `<div class="notice bad"><b>Kill switch globale attivo</b>: nessuna azione automatica verso l'esterno.</div>` : "",
    !o.ai.available ? `<div class="notice">Nessun provider AI configurato: l'agente classifica con regole e prepara bozze prudenti da rivedere. Vedi <a href="#settings">Impostazioni</a>.</div>` : "",
    `<div class="tiles">${tile("Documenti KB attivi", k.documents)}${tile("Prodotti (verificati)", `${k.products} (${k.products_verified})`)}
      ${tile("Novità KB da leggere", k.updates_unread)}${tile("Post analizzati 30g", s.analyzed)}${tile("Bozze in revisione", s.in_review)}
      ${tile("Risposte pubblicate 30g", s.published)}${tile("Lead 30g", c.leads)}${tile("Richieste demo 30g", c.demo_requests)}
      ${tile(`Costo AI mese (budget ${o.ai.budget_eur} €)`, `${o.ai.month_cost_eur} €`)}</div>`,
    `<div class="grid">${panel("Connessioni",
      (accounts.length ? table([["Piattaforma", (r) => esc(r.platform)], ["Account", (r) => esc(r.name)], ["Stato", (r) => badge(r.status)], ["Errore", (r) => esc(r.last_error || "")]], accounts)
        : empty(`Nessun account social collegato.${o.connections.meta_configured ? "" : `<br>Configurazione Meta mancante: ${esc(o.connections.meta_missing.join(", "))}`}`)) +
      `<p class="muted">Provider AI: <b>${esc(o.ai.provider)}</b> ${badge(o.ai.available ? "attivo" : "non configurato", o.ai.available ? "good" : "warn")}</p>`)}
    ${panel("Errori e avvisi", table([["Tipo", (r) => esc(r.kind)], ["Cosa", (r) => esc(r.what)], ["Errore", (r) => esc(r.error), "wrap"], ["Quando", (r) => fmtDate(r.at)]], o.errors, "Nessun errore registrato"))}</div>`,
    panel("Ultime attività", table([["Quando", (r) => fmtDate(r.at)], ["Chi", (r) => esc(r.actor)], ["Azione", (r) => `<span class="mono">${esc(r.action)}</span>`], ["Oggetto", (r) => esc(`${r.target_type || ""} ${r.target_id || ""}`)]], o.recent, "Nessuna attività ancora")),
  ].join("");
};

R.agent = async () => {
  const st = await api("GET", "/api/settings");
  const prompts = can("settings.edit") ? await api("GET", "/api/prompts") : [];
  return [
    panel("Stato agente", `<dl class="kv"><dt>Provider</dt><dd>${esc(st.ai.provider)} ${badge(st.ai.available ? "attivo" : "non configurato", st.ai.available ? "good" : "warn")}</dd>
      <dt>Modello</dt><dd>${esc(st.ai.model || "—")}</dd><dt>Timeout / retry</dt><dd>${esc(st.ai.timeout_s)} s / ${esc(st.ai.max_retries)}</dd>
      <dt>Identità</dt><dd>${esc(st.settings["brand.name"])} — ${esc(st.settings["brand.disclosure"])}</dd></dl>
      <p class="muted">Provider e chiavi si configurano con le variabili d'ambiente (docs/AI_PROVIDER.md); non sono modificabili da qui per sicurezza.</p>`),
    panel("Prova una domanda", `<form id="agent-test"><label for="agent-text">Messaggio di esempio</label>
      <textarea id="agent-text" name="text" required placeholder="Es.: Quale macchina xTool mi consigliate per incidere l'ardesia?"></textarea>
      <div class="row"><button class="btn primary" type="submit">Analizza senza pubblicare</button><span class="muted">Nessuna scrittura sui social, nessun lead creato.</span></div></form>
      <div id="agent-test-out"></div>`),
    can("settings.edit") ? panel("Prompt di sistema (versionato)", table([["Nome", (r) => esc(r.name)], ["Versione", (r) => esc(r.version)],
      ["Stato", (r) => (r.active ? badge("attivo", "good") : badge("inattivo"))], ["Creato", (r) => fmtDate(r.created_at)],
      ["", (r) => `<div class="actions"><button class="btn small" data-act="prompt-view" data-id="${r.id}">Vedi</button>${r.active ? "" : `<button class="btn small" data-act="prompt-activate" data-id="${r.id}">Attiva</button>`}</div>`]], prompts) +
      `<details><summary>Nuova versione del prompt</summary><form id="prompt-new">${field("text", "Testo del prompt", { textarea: true, required: true, value: prompts.find((p) => p.active)?.text || "" })}<button class="btn primary" type="submit">Salva come nuova versione</button></form></details>`) : "",
  ].join("");
};
function renderTestResult(r) {
  const c = r.classification;
  let h = `<div class="card"><div class="meta"><span>Categoria ${badge(c.category, "gold")}</span><span>Intento ${badge(c.intent)}</span><span>Priorità ${badge(c.priority)}</span>
    ${c.risk_flags.length ? `<span>Rischi ${c.risk_flags.map((f) => badge(f, "bad")).join(" ")}</span>` : ""}<span>Prodotti: ${esc(r.products.join(", ") || "nessuno")}</span></div>`;
  if (r.draft) {
    const d = r.draft;
    h += `<h3>Bozza (${esc(d.generated_by)})</h3><p class="quote">${esc(d.text)}</p>
      <div class="meta"><span>Confidenza ${esc(d.confidence.toFixed(2))}</span><span>Copertura fonti ${esc(d.evidence.toFixed(2))}</span>
      <span>Decisione se il canale fosse collegato: ${badge(r.decision_if_connected.action)}</span></div>
      ${d.validation_errors.length ? `<div class="notice bad">${d.validation_errors.map(esc).join("<br>")}</div>` : ""}
      ${d.notes && d.notes.length ? `<p class="muted">${d.notes.map(esc).join("<br>")}</p>` : ""}
      <details><summary>Motivi della decisione</summary><ul>${r.decision_if_connected.reasons.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></details>
      <details><summary>Fonti recuperate (${r.sources.length})</summary>${r.sources.length ? `<ul>${r.sources.map((s) => `<li>${link(s.url, s.title)} <span class="muted">${esc(s.heading || "")}</span></li>`).join("")}</ul>` : empty("Nessuna fonte nella knowledge base per questa domanda")}</details>`;
  } else h += `<p>Nessuna bozza: ${esc(r.pre_decision.reasons.join("; "))}</p>`;
  return h + "</div>";
}

R.kb = async () => {
  const [docs, updates, conflicts, sources] = await Promise.all([api("GET", "/api/kb/documents"), api("GET", "/api/kb/updates"),
    api("GET", "/api/kb/conflicts"), api("GET", "/api/sources")]);
  return [
    panel("Ricerca nella knowledge base", `<form id="kb-search" class="row"><input name="q" placeholder="Es.: area di lavoro, rotativo, ardesia" required minlength="2" aria-label="Cerca"><button class="btn primary">Cerca</button></form><div id="kb-results"></div>`),
    `<div class="grid">${panel("Novità rilevate", table([["Quando", (r) => fmtDate(r.detected_at)], ["Tipo", (r) => badge(r.kind, r.kind === "gone" ? "bad" : "info")], ["Dettaglio", (r) => esc(r.summary), "wrap"],
      ["", (r) => (r.acknowledged ? '<span class="muted">letto</span>' : `<button class="btn small" data-act="kb-ack" data-id="${r.id}">Segna letto</button>`)]], updates.slice(0, 30), "Nessuna novità: avvia un crawling o importa un documento"))}
    ${panel("Dati in conflitto", table([["Prodotto", (r) => esc(r.product)], ["Specifica", (r) => esc(r.spec)], ["Valori", (r) => esc(r.values.join(" | ")), "wrap"]], conflicts, "Nessun conflitto tra fonti"))}</div>`,
    can("kb.crawl") ? panel("Importa documento (PDF o HTML)", `<form id="kb-import" class="form-grid">
      <div><label for="imp-src">Fonte</label><select id="imp-src" name="source_id">${sources.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("")}</select></div>
      <div><label for="imp-url">URL ufficiale di origine (facoltativo)</label><input id="imp-url" name="url" type="url" placeholder="https://support.xtool.com/..."></div>
      <div><label for="imp-file">File</label><input id="imp-file" name="file" type="file" accept=".pdf,.html,.htm" required></div>
      <div><label>&nbsp;</label><button class="btn primary">Importa</button></div></form>
      <p class="muted">Usa manuali e guide scaricati dalle fonti ufficiali. Ogni import crea una nuova versione se il contenuto cambia.</p>`, `<a class="btn small" href="/api/kb/export" target="_blank">Esporta catalogo (JSON)</a>`) : "",
    panel("Documenti", table([["Titolo", (r) => link(r.url, r.title || r.url), "wrap"], ["Fonte", (r) => esc(r.source)], ["Stato", (r) => badge(r.status)],
      ["Lingua", (r) => esc(r.language || "—")], ["Versioni", (r) => esc(r.versions || 1)], ["Ultima verifica", (r) => fmtDate(r.last_checked_at)],
      ["", (r) => `<button class="btn small" data-act="doc-view" data-id="${r.id}">Dettagli</button>`]], docs,
      "La knowledge base è vuota. Importa un documento ufficiale o abilita il crawling di una fonte in <a href='#sources'>Fonti e Crawler</a>.")),
  ].join("");
};

R.products = async () => {
  const rows = await api("GET", "/api/products");
  return [
    panel("Prodotti e macchine", table([["Nome ufficiale", (r) => `<b>${esc(r.official_name)}</b><br><span class="muted mono">${esc(r.key)}</span>`],
      ["Famiglia", (r) => esc(r.family || "—")], ["Tecnologia", (r) => esc(r.technology || "—")], ["Potenza", (r) => esc(r.nominal_power || "—")],
      ["Area di lavoro", (r) => esc(r.work_area || "—")], ["Stato", (r) => badge(r.status)],
      ["Campi mancanti", (r) => (r.missing_fields.length ? r.missing_fields.map((f) => badge(f, "warn")).join(" ") : badge("completo", "good")), "wrap"],
      ["Fonte", (r) => link(r.source_url, "apri")], ["", (r) => `<button class="btn small" data-act="product-view" data-key="${esc(r.key)}">Dettagli</button>`]], rows,
      "Catalogo vuoto. Inserisci solo dati verificati sulle fonti ufficiali xTool, con URL e data di verifica."),
      can("kb.edit") ? `<button class="btn small" data-act="import-yaml">Importa schede YAML</button>` : ""),
    can("kb.edit") ? panel("Aggiungi o aggiorna prodotto", `<form id="product-form"><div class="form-grid">
      ${field("official_name", "Nome ufficiale", { required: true })}${field("key", "Chiave (slug, opzionale)")}${field("family", "Famiglia")}${field("model", "Modello")}
      ${field("category", "Categoria", { options: ["", "laser", "printer", "metalfab", "cutter", "other"] })}${field("technology", "Tecnologia")}
      ${field("nominal_power", "Potenza nominale")}${field("work_area", "Area di lavoro")}${field("market", "Mercato", { placeholder: "EU-IT" })}
      ${field("supported_materials", "Materiali (separati da virgola)", { list: true })}${field("software", "Software (virgola)", { list: true })}
      ${field("aliases", "Alias per il riconoscimento (virgola)", { list: true })}${field("source_url", "URL fonte ufficiale", { type: "url" })}
      ${field("verified_at", "Data verifica", { type: "date" })}${field("status", "Stato", { options: ["to_verify", "verified", "superseded", "retired"] })}</div>
      <button class="btn primary" type="submit">Salva</button> <span class="muted">Lo stato "verified" richiede URL fonte e data di verifica.</span></form>`) : "",
  ].join("");
};

R.accessories = async () => {
  const [acc, prods] = await Promise.all([api("GET", "/api/accessories"), api("GET", "/api/products")]);
  const pOpts = prods.map((p) => p.key), aOpts = acc.map((a) => a.key);
  return [
    panel("Verifica compatibilità", pOpts.length && aOpts.length ? `<form id="compat-check" class="row"><select name="product" aria-label="Prodotto">${pOpts.map((k) => `<option>${esc(k)}</option>`).join("")}</select>
      <select name="accessory" aria-label="Accessorio">${aOpts.map((k) => `<option>${esc(k)}</option>`).join("")}</select><button class="btn primary">Verifica</button></form><div id="compat-out"></div>`
      : empty("Servono almeno un prodotto e un accessorio nel catalogo")),
    panel("Accessori", table([["Nome", (r) => `<b>${esc(r.official_name)}</b><br><span class="muted mono">${esc(r.key)}</span>`], ["Categoria", (r) => esc(r.category || "—")],
      ["Funzione", (r) => esc(r.function || "—"), "wrap"], ["Stato", (r) => badge(r.status)],
      ["Compatibilità registrate", (r) => (r.compatible_with.length ? r.compatible_with.map((c) => `${esc(c.official_name)} ${badge(c.relation, c.relation === "incompatible" ? "bad" : "info")} ${badge(c.status)}`).join("<br>") : '<span class="muted">nessuna verificata</span>'), "wrap"]],
      acc, "Nessun accessorio. Non dichiarare compatibilità senza una fonte ufficiale.")),
    can("kb.edit") ? `<div class="grid">${panel("Aggiungi accessorio", `<form id="accessory-form">${field("official_name", "Nome ufficiale", { required: true })}${field("key", "Chiave (opzionale)")}
      ${field("category", "Categoria", { options: ["", "rotary", "air_assist", "extraction", "safety", "riser", "spare_part", "other"] })}${field("function", "Funzione")}
      ${field("source_url", "URL fonte", { type: "url" })}${field("verified_at", "Data verifica", { type: "date" })}${field("status", "Stato", { options: ["to_verify", "verified"] })}
      <button class="btn primary">Salva</button></form>`)}
      ${panel("Registra compatibilità", pOpts.length && aOpts.length ? `<form id="compat-form">${field("product_key", "Prodotto", { options: pOpts })}${field("accessory_key", "Accessorio", { options: aOpts })}
      ${field("relation", "Relazione", { options: ["compatible", "incompatible", "required", "recommended"] })}${field("conditions", "Condizioni / note")}
      ${field("source_url", "URL fonte ufficiale (obbligatorio)", { type: "url", required: true })}${field("verified_at", "Data verifica", { type: "date" })}
      ${field("status", "Stato", { options: ["to_verify", "verified"] })}<button class="btn primary">Salva</button></form>` : empty("Aggiungi prima prodotti e accessori"))}</div>` : "",
  ].join("");
};

R.materials = async () => {
  const rows = await api("GET", "/api/materials");
  return [
    panel("Materiali", table([["Materiale", (r) => `<b>${esc(r.name)}</b>`], ["Alias", (r) => esc(r.aliases.join(", "))],
      ["Da evitare", (r) => (r.avoid ? badge("sì", "bad") + ` ${esc(r.avoid_reason || "")}` : "no"), "wrap"], ["Precauzioni", (r) => esc(r.precautions.join("; ")), "wrap"],
      ["Stato", (r) => badge(r.status)], ["Fonte", (r) => link(r.source_url, "apri")]], rows, "Nessun materiale. Aggiungili con fonte ufficiale (es. guide materiali xTool).")),
    can("kb.edit") ? panel("Aggiungi materiale", `<form id="material-form"><div class="form-grid">${field("name", "Nome", { required: true })}${field("aliases", "Alias (virgola)", { list: true })}
      ${field("precautions", "Precauzioni (virgola)", { list: true })}${field("avoid_reason", "Motivo per evitarlo (se da evitare)")}
      ${field("source_url", "URL fonte", { type: "url" })}${field("verified_at", "Data verifica", { type: "date" })}${field("status", "Stato", { options: ["to_verify", "verified"] })}</div>
      <label class="check"><input type="checkbox" name="avoid"> Materiale da non lavorare</label><button class="btn primary">Salva</button></form>`) : "",
  ].join("");
};

R.sources = async () => {
  const [rows, jobs] = await Promise.all([api("GET", "/api/sources"), api("GET", "/api/crawl/jobs")]);
  return [
    `<div class="notice">Prima di abilitare il crawling di un sito verifica le sue condizioni d'uso. Il crawler rispetta robots.txt, rallenta tra le richieste e si ferma su 401/403/429: non aggira login, CAPTCHA o blocchi.</div>`,
    panel("Fonti", table([["Priorità", (r) => `<span class="num">${esc(r.priority)}</span>`], ["Fonte", (r) => `<b>${esc(r.name)}</b><br>${link(r.base_url)}`, "wrap"],
      ["Tipo", (r) => badge(r.kind, r.kind.startsWith("official") ? "gold" : "")], ["Documenti", (r) => esc(r.documents)],
      ["Crawling", (r) => (r.base_url && !["community", "official_community"].includes(r.kind) && can("kb.crawl")
        ? `<label class="check"><input type="checkbox" data-act="src-toggle" data-id="${r.id}" ${r.crawl_enabled ? "checked" : ""}> attivo</label>` : badge(r.crawl_enabled ? "attivo" : "no"))],
      ["Ogni (ore)", (r) => (can("kb.crawl") ? `<input type="number" min="1" class="num" data-act="src-interval" data-id="${r.id}" value="${esc(r.crawl_interval_hours)}" aria-label="Intervallo ore">` : esc(r.crawl_interval_hours))],
      ["Ultimo controllo", (r) => `${fmtDate(r.last_crawl_at)} ${r.last_crawl_status ? badge(r.last_crawl_status) : ""}`],
      ["Errore", (r) => esc(r.last_error || ""), "wrap"],
      ["", (r) => (r.crawl_enabled && can("kb.crawl") ? `<button class="btn small" data-act="src-crawl" data-id="${r.id}">Scansiona ora</button>` : "")]], rows)),
    panel("Esecuzioni del crawler", table([["Avvio", (r) => fmtDate(r.started_at)], ["Fonte", (r) => esc(r.source)], ["Stato", (r) => badge(r.status)],
      ["Pagine", (r) => esc(r.pages_seen)], ["Nuove/modificate", (r) => esc(r.pages_changed)], ["Rimosse", (r) => esc(r.pages_gone)], ["Errore", (r) => esc(r.error || ""), "wrap"]],
      jobs, "Nessuna scansione eseguita. Le scansioni girano nel worker (python -m ingly worker).")),
  ].join("");
};

async function itemsView(filter) {
  const q = new URLSearchParams(filter || {});
  const rows = await api("GET", `/api/social/items?${q}`);
  return table([["Data", (r) => fmtDate(r.created_at_platform || r.collected_at)], ["Piattaforma", (r) => esc(r.platform)], ["Fonte", (r) => esc(r.source_name), "wrap"],
    ["Contenuto", (r) => `<p class="quote">${esc(r.text.slice(0, 400))}</p>`, "wrap"], ["Autore", (r) => esc(r.author_name || "—")],
    ["Prodotto", (r) => esc(r.products.join(", ") || "—")], ["Categoria", (r) => badge(r.category || "—", "gold")], ["Intento", (r) => esc(r.intent || "—")],
    ["Priorità", (r) => badge(r.priority || "—")], ["Risposta candidata", (r) => (r.draft_text ? `<p class="quote">${esc(r.draft_text.slice(0, 300))}</p>` : '<span class="muted">—</span>'), "wrap"],
    ["Fonti", (r) => (r.citations.length ? r.citations.map((c) => link(c.url, c.title)).join("<br>") : '<span class="muted">nessuna</span>'), "wrap"],
    ["Stato", (r) => badge(r.status)], ["Azione consigliata", (r) => esc(r.decision_reason || r.decision || "—"), "wrap"],
    ["", (r) => `<div class="actions">${r.permalink ? link(r.permalink, "Apri originale") : ""}
      ${can("drafts.edit") ? `<button class="btn small" data-act="item-process" data-id="${r.id}">Genera risposta</button>
      <button class="btn small" data-act="item-handled" data-id="${r.id}">Segna gestito</button>` : ""}
      ${r.draft_id ? `<a class="btn small" href="#queue">Vai alla bozza</a>` : ""}</div>`]],
    rows, "Nessun contenuto raccolto. Collega una Pagina o usa l'import manuale qui sopra.");
}

R.listening = async () => {
  const sources = await api("GET", "/api/social/sources");
  const manual = sources.filter((s) => s.platform === "manual");
  const f = state.listenFilter || {};
  return [
    panel("Import manuale", manual.length ? `<form id="manual-import">
      ${field("source_id", "Fonte", { options: manual.map((m) => String(m.id)) })}
      <p class="muted">${manual.map((m) => `${esc(m.id)} = ${esc(m.name)}`).join("<br>")}</p>
      ${field("content", "Testo (un messaggio per blocco, riga vuota tra i messaggi; opzionale 'Nome: messaggio')", { textarea: true, required: true, placeholder: "Mario R.: Quale laser per tagliare compensato da 6 mm?\n\nGiulia: Il rotativo funziona con la mia macchina?" })}
      ${field("format", "Formato", { options: ["text", "csv", "json"] })}<button class="btn primary">Analizza e prepara bozze</button></form>
      <p class="muted">Per i gruppi Facebook non esiste un'API Meta di lettura: incolla qui i messaggi che vedi. Le risposte approvate vanno pubblicate a mano.</p>` : empty("Nessuna fonte manuale")),
    panel("Contenuti monitorati", `<form id="listen-filter" class="row">
      <select name="status" aria-label="Stato"><option value="">Tutti gli stati</option>${["new", "in_review", "drafted", "approved", "published", "handled", "ignored", "rejected", "error"].map((s) => `<option ${f.status === s ? "selected" : ""}>${s}</option>`).join("")}</select>
      <select name="category" aria-label="Categoria"><option value="">Tutte le categorie</option>${["technical", "compatibility", "price", "commercial", "demo_course", "problem", "complaint", "misinformation", "sensitive", "spam", "other"].map((s) => `<option ${f.category === s ? "selected" : ""}>${s}</option>`).join("")}</select>
      <select name="platform" aria-label="Piattaforma"><option value="">Tutte</option>${["facebook", "instagram", "manual"].map((s) => `<option ${f.platform === s ? "selected" : ""}>${s}</option>`).join("")}</select>
      <button class="btn">Filtra</button></form>${await itemsView(Object.fromEntries(Object.entries(f).filter(([, v]) => v)))}`),
  ].join("");
};

async function metaView(platform) {
  const [st, sources, accounts] = await Promise.all([api("GET", "/api/social/meta/status"), api("GET", "/api/social/sources"), api("GET", "/api/social/accounts")]);
  const caps = st.capabilities[platform];
  const mine = sources.filter((s) => s.platform === platform), accs = accounts.filter((a) => a.platform === platform);
  return [
    !st.configured ? `<div class="notice bad"><b>Collegamento Meta non configurato.</b> Variabili mancanti: ${esc(st.missing.join(", "))}. Segui docs/META_SETUP.md. Nessun collegamento viene simulato.</div>` : "",
    panel("Cosa è possibile su " + (platform === "facebook" ? "Facebook" : "Instagram"), `<dl class="kv">
      <dt>Leggere post</dt><dd>${badge(caps.read_posts ? "sì" : "no", caps.read_posts ? "good" : "")}</dd>
      <dt>Leggere commenti</dt><dd>${badge(caps.read_comments ? "sì" : "no", caps.read_comments ? "good" : "")}</dd>
      <dt>Rispondere ai commenti</dt><dd>${badge(caps.reply_comment ? "sì, con permesso" : "no", caps.reply_comment ? "good" : "")}</dd>
      <dt>Messaggi privati automatici</dt><dd>${badge("no", "")} <span class="muted">non inviati senza richiesta e consenso</span></dd>
      <dt>Webhook</dt><dd>${badge(caps.webhooks ? (st.webhook_verify_token_set ? "configurabile" : "manca verify token") : "no", caps.webhooks && st.webhook_verify_token_set ? "good" : "warn")}</dd></dl>
      <ul>${caps.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul><p class="muted">Permessi richiesti: <span class="mono">${esc(st.requested_scopes.join(", "))}</span></p>`,
      st.configured && can("social.connect") ? `<button class="btn gold" data-act="meta-connect">Collega con Meta</button>` : ""),
    panel("Account collegati", table([["Account", (r) => esc(r.name)], ["ID", (r) => `<span class="mono">${esc(r.external_id)}</span>`], ["Stato", (r) => badge(r.status)],
      ["Scadenza token", (r) => fmtDate(r.token_expires_at)], ["Permessi concessi", (r) => esc(r.scopes.join(", ")), "wrap"], ["Errore", (r) => esc(r.last_error || ""), "wrap"],
      ["", (r) => (can("social.connect") ? `<div class="actions"><button class="btn small" data-act="acc-check" data-id="${r.id}">Verifica autorizzazioni</button><button class="btn small danger" data-act="acc-disconnect" data-id="${r.id}">Scollega</button></div>` : "")]],
      accs, "Nessun account collegato")),
    panel("Fonti monitorate", table([["Nome", (r) => esc(r.name)], ["Tipo", (r) => esc(r.kind)], ["Attiva", (r) => (can("social.connect") ? `<label class="check"><input type="checkbox" data-act="ss-toggle" data-id="${r.id}" ${r.active ? "checked" : ""}> sì</label>` : badge(r.active ? "sì" : "no"))],
      ["Ogni (min)", (r) => esc(r.poll_interval_minutes)], ["Ultimo controllo riuscito", (r) => fmtDate(r.last_success_at)], ["Ultimo errore", (r) => esc(r.last_error || ""), "wrap"],
      ["Limiti", (r) => esc(r.limits_note || ""), "wrap"], ["", (r) => (r.active && can("social.connect") ? `<button class="btn small" data-act="ss-poll" data-id="${r.id}">Controlla ora</button>` : "")]],
      mine, "Le fonti compaiono dopo il collegamento OAuth")),
  ].join("");
}
R.facebook = () => metaView("facebook");
R.instagram = () => metaView("instagram");

R.queue = async () => {
  const status = state.queueStatus || "pending";
  const rows = await api("GET", `/api/drafts?status=${status}`);
  const tabs = ["pending", "approved", "published", "rejected", "failed"].map((s) => `<button class="btn small ${s === status ? "primary" : ""}" data-act="queue-tab" data-s="${s}">${s}</button>`).join("");
  const cards = rows.map((d) => `<article class="card prio-${esc(d.priority)}">
    <div class="meta"><span>${badge(d.platform)}</span><span>${badge(d.category || "—", "gold")}</span><span>${esc(d.intent || "")}</span><span>priorità ${badge(d.priority)}</span>
      <span>${esc(d.author_name || "autore non disponibile")}</span>${d.permalink ? `<span>${link(d.permalink, "Apri originale")}</span>` : ""}</div>
    <p class="quote">${esc(d.item_text)}</p>
    <label for="draft-${d.id}">Risposta (${esc(d.generated_by)}) — confidenza ${esc((d.confidence ?? 0).toFixed(2))}, copertura fonti ${esc((d.evidence_score ?? 0).toFixed(2))}</label>
    <textarea id="draft-${d.id}" ${d.status === "pending" || d.status === "approved" ? "" : "readonly"}>${esc(d.text)}</textarea>
    ${d.validation_errors.length ? `<div class="notice bad">${d.validation_errors.map(esc).join("<br>")}</div>` : ""}
    ${d.risk_flags.length ? `<div class="meta">Rischi: ${d.risk_flags.map((f) => badge(f, "bad")).join(" ")}</div>` : ""}
    <details><summary>Motivazione e fonti</summary><ul>${d.decision_reason.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      ${d.citations.length ? d.citations.map((c) => link(c.url, c.title)).join("<br>") : '<span class="muted">nessuna fonte citata</span>'}</details>
    <div class="row">
      ${d.status === "pending" && can("drafts.edit") ? `<button class="btn small" data-act="draft-save" data-id="${d.id}">Salva modifica</button>` : ""}
      ${d.status === "pending" && can("drafts.approve") ? `<button class="btn small primary" data-act="draft-approve" data-id="${d.id}">Approva</button><button class="btn small danger" data-act="draft-reject" data-id="${d.id}">Rifiuta</button>` : ""}
      ${d.status === "approved" && can("drafts.publish") && d.can_publish_via_api ? `<button class="btn small gold" data-act="draft-publish" data-id="${d.id}">Pubblica</button>` : ""}
      ${d.status === "approved" && !d.can_publish_via_api ? `<span class="muted">Canale senza pubblicazione via API: copia e pubblica a mano, poi segna come gestito.</span>` : ""}
      <button class="btn small" data-act="draft-copy" data-id="${d.id}">Copia</button>
      ${["pending", "approved"].includes(d.status) && can("drafts.edit") ? `<button class="btn small" data-act="item-handled" data-id="${d.social_item_id}">Segna gestito</button>` : ""}
    </div></article>`).join("");
  return panel("Coda risposte", rows.length ? `<div class="list">${cards}</div>` : empty("Nessuna bozza in questo stato"), tabs);
};

R.leads = async () => {
  const meta = await api("GET", "/api/leads/meta");
  const f = state.leadFilter || {};
  const rows = await api("GET", `/api/leads?${new URLSearchParams(Object.fromEntries(Object.entries(f).filter(([, v]) => v)))}`);
  return panel("Lead", `<form id="lead-filter" class="row"><select name="stage" aria-label="Stato"><option value="">Tutti gli stati</option>${meta.stages.map((s) => `<option ${f.stage === s ? "selected" : ""}>${s}</option>`).join("")}</select>
    <select name="category" aria-label="Categoria"><option value="">Tutte le categorie</option>${meta.categories.map((s) => `<option ${f.category === s ? "selected" : ""}>${s}</option>`).join("")}</select>
    <input name="q" placeholder="Cerca" value="${esc(f.q || "")}" aria-label="Cerca"><button class="btn">Filtra</button></form>` +
    table([["Punteggio", (r) => `<b class="num">${esc(r.score)}</b>`], ["Persona", (r) => esc(r.display_name || "—")], ["Canale", (r) => esc(r.platform || "—")],
      ["Categoria", (r) => badge(r.category, "gold")], ["Stato", (r) => badge(r.stage)], ["Messaggio", (r) => `<p class="quote">${esc((r.source_text || "").slice(0, 220))}</p>`, "wrap"],
      ["Creato", (r) => fmtDate(r.created_at)], ["", (r) => `<button class="btn small" data-act="lead-open" data-id="${r.id}">Apri</button>`]], rows,
      "Nessun lead. I lead nascono dai messaggi pertinenti analizzati dall'agente."), "",
    "Contatti generati da conversazioni pertinenti. Nessun messaggio automatico: contatta solo chi lo ha chiesto o ha dato consenso.");
};
async function leadModal(id) {
  const [l, meta] = await Promise.all([api("GET", `/api/leads/${id}`), api("GET", "/api/leads/meta")]);
  const next = meta.transitions[l.stage] || [];
  openModal(`<header class="row"><h2>${esc(l.display_name || "Lead")} ${badge(l.stage)}</h2><button class="btn small ghost" data-act="modal-close">Chiudi</button></header>
    <dl class="kv"><dt>Categoria</dt><dd>${esc(l.category)}</dd><dt>Punteggio</dt><dd>${esc(l.score)} — ${l.score_explanation.map((e) => `${esc(e.signal)} +${esc(e.points)}`).join(", ")}</dd>
    <dt>Macchina desiderata</dt><dd>${esc(l.desired_machine || "—")}</dd><dt>Materiali</dt><dd>${esc(l.materials.join(", ") || "—")}</dd>
    <dt>Recapiti</dt><dd>${l.contact_email || l.contact_phone ? esc([l.contact_email, l.contact_phone].filter(Boolean).join(" · ")) : '<span class="muted">nessuno (servono consenso e richiesta della persona)</span>'}</dd>
    <dt>Retention fino a</dt><dd>${fmtDate(l.retention_until)}</dd></dl>
    ${can("leads.edit") ? `<form id="lead-stage" data-id="${l.id}" class="row"><select name="stage" aria-label="Nuovo stato">${next.map((s) => `<option>${s}</option>`).join("")}</select><input name="note" placeholder="Nota (facoltativa)" aria-label="Nota"><button class="btn primary" ${next.length ? "" : "disabled"}>Cambia stato</button></form>
    <form id="lead-event" data-id="${l.id}" class="row"><select name="kind" aria-label="Tipo attività">${["note", "follow_up", "demo_request", "course_request", "quote_request"].map((k) => `<option>${k}</option>`).join("")}</select><input name="detail" placeholder="Dettaglio" required aria-label="Dettaglio"><input name="due_at" type="date" aria-label="Scadenza"><button class="btn">Aggiungi attività</button></form>
    <details><summary>Registra consenso</summary><form id="lead-consent" data-id="${l.id}"><div class="form-grid">${field("purpose", "Finalità", { options: ["contact", "demo", "marketing"] })}${field("legal_basis", "Base giuridica", { options: ["consent", "contract", "legitimate_interest"] })}
      ${field("channel", "Canale")}${field("evidence", "Prova del consenso (es. messaggio del…)")}${field("email", "Email (solo con consenso al contatto)", { type: "email" })}${field("phone", "Telefono")}</div>
      <label class="check"><input type="checkbox" name="granted" checked> Consenso concesso</label><button class="btn">Salva consenso</button></form></details>` : ""}
    <h3>Attività</h3>${table([["Quando", (e) => fmtDate(e.at)], ["Tipo", (e) => esc(e.kind)], ["Dettaglio", (e) => esc(e.detail), "wrap"], ["Scadenza", (e) => fmtDate(e.due_at)]], l.events)}
    ${can("leads.delete") ? `<div class="row"><button class="btn small" data-act="lead-export" data-id="${l.id}">Esporta dati (accesso GDPR)</button><button class="btn small danger" data-act="lead-delete" data-id="${l.id}">Cancella definitivamente</button></div>` : ""}`);
}

R.requests = async () => {
  const r = await api("GET", "/api/leads/requests");
  return [
    panel("Richieste di demo, corsi e preventivi", table([["Persona", (x) => esc(x.display_name || "—")], ["Tipo", (x) => badge(x.category, "gold")], ["Stato", (x) => badge(x.stage)],
      ["Punteggio", (x) => esc(x.score)], ["Creato", (x) => fmtDate(x.created_at)], ["", (x) => `<button class="btn small" data-act="lead-open" data-id="${x.id}">Apri</button>`]], r.leads, "Nessuna richiesta")),
    panel("Attività pianificate", table([["Scadenza", (x) => fmtDate(x.due_at || x.at)], ["Persona", (x) => esc(x.display_name || "—")], ["Tipo", (x) => esc(x.kind)], ["Dettaglio", (x) => esc(x.detail), "wrap"]], r.events, "Nessuna attività")),
  ].join("");
};

R.analytics = async () => {
  const a = await api("GET", "/api/analytics?days=30");
  return `<div class="grid">${panel("Contenuti per giorno", bars(a.items_by_day, "day", "n"), "", "ultimi 30 giorni")}
    ${panel("Contenuti per categoria", bars(a.items_by_category, "category", "n"))}
    ${panel("Contenuti per piattaforma", bars(a.items_by_platform, "platform", "n"))}
    ${panel("Bozze per stato", bars(a.drafts_by_status, "status", "n"))}
    ${panel("Lead per fase", bars(a.leads_by_stage, "stage", "n", "Nessun lead"))}
    ${panel("Lead per categoria", bars(a.leads_by_category, "category", "n", "Nessun lead"))}</div>`;
};

R.eval = async () => {
  const [cases, runs] = await Promise.all([api("GET", "/api/eval/cases"), api("GET", "/api/eval/runs")]);
  return [
    panel("Esecuzioni", table([["Data", (r) => fmtDate(r.started_at)], ["Provider", (r) => esc(r.provider)], ["Casi", (r) => esc(r.summary.cases)],
      ["Categoria", (r) => esc(r.summary.category_accuracy)], ["Decisione", (r) => esc(r.summary.decision_accuracy)], ["Non supportate", (r) => esc(r.summary.unsupported_rate)],
      ["Termini vietati", (r) => esc(r.summary.forbidden_term_violations)], ["Falsi positivi comm.", (r) => esc(r.summary.commercial_false_positives)]], runs, "Nessuna valutazione eseguita"),
      can("eval.run") ? `<button class="btn primary" data-act="eval-run">Esegui valutazione</button>` : "",
      "Metriche deterministiche (classificazione, decisione, termini vietati, errori del validatore). Non usano il giudizio del modello."),
    `<div id="eval-out"></div>`,
    panel("Casi di test", table([["Chiave", (r) => `<span class="mono">${esc(r.key)}</span>`], ["Messaggio", (r) => esc(r.input_text), "wrap"], ["Categoria attesa", (r) => badge(r.expected_category, "gold")], ["Decisione attesa", (r) => badge(r.expected_decision)]], cases)),
  ].join("");
};

R.automation = async () => {
  const a = await api("GET", "/api/automation/rules");
  const editable = can("automation.edit");
  return [
    panel("Kill switch", `<div class="row"><label class="check"><input type="checkbox" data-act="kill" ${a.kill_switch ? "checked" : ""} ${editable ? "" : "disabled"}> <b>Blocca tutte le azioni automatiche</b></label>
      ${Object.keys(a.channel_kill || {}).map((ch) => `<label class="check"><input type="checkbox" data-act="kill-ch" data-ch="${esc(ch)}" ${a.channel_kill[ch] ? "checked" : ""} ${editable ? "" : "disabled"}> blocca ${esc(ch)}</label>`).join("")}</div>
      <p class="muted">Attivare il kill switch interrompe subito ogni pubblicazione automatica: è il rollback operativo.</p>`),
    panel("Regole per categoria", table([["Categoria", (r) => `<b>${esc(r.category)}</b>`], ["Canale", (r) => esc(r.channel)],
      ["Modalità", (r) => (editable ? `<select data-act="rule-mode" data-cat="${esc(r.category)}" data-ch="${esc(r.channel)}" aria-label="Modalità">${a.modes.filter((m) => m !== "AUTO_SAFE" || !a.never_auto.includes(r.category)).map((m) => `<option ${m === r.mode ? "selected" : ""}>${m}</option>`).join("")}</select>` : badge(r.mode))],
      ["Confidenza min", (r) => (editable ? `<input type="number" min="0" max="1" step="0.05" data-act="rule-num" data-k="min_confidence" data-cat="${esc(r.category)}" data-ch="${esc(r.channel)}" value="${esc(r.min_confidence)}" aria-label="Confidenza minima">` : esc(r.min_confidence))],
      ["Copertura fonti min", (r) => (editable ? `<input type="number" min="0" max="1" step="0.05" data-act="rule-num" data-k="min_evidence" data-cat="${esc(r.category)}" data-ch="${esc(r.channel)}" value="${esc(r.min_evidence)}" aria-label="Copertura minima">` : esc(r.min_evidence))],
      ["Max/ora", (r) => (editable ? `<input type="number" min="0" data-act="rule-num" data-k="max_per_hour" data-cat="${esc(r.category)}" data-ch="${esc(r.channel)}" value="${esc(r.max_per_hour)}" aria-label="Massimo per ora">` : esc(r.max_per_hour))],
      ["Max/giorno", (r) => (editable ? `<input type="number" min="0" data-act="rule-num" data-k="max_per_day" data-cat="${esc(r.category)}" data-ch="${esc(r.channel)}" value="${esc(r.max_per_day)}" aria-label="Massimo per giorno">` : esc(r.max_per_day))],
      ["Invito INGLY", (r) => (editable ? `<input type="checkbox" data-act="rule-cta" data-cat="${esc(r.category)}" data-ch="${esc(r.channel)}" ${r.include_cta ? "checked" : ""} aria-label="Includi invito">` : (r.include_cta ? "sì" : "no"))]], a.rules), "",
      `OFF: nulla · MONITOR: solo classificazione · DRAFT: bozze · APPROVAL: serve approvazione · AUTO_SAFE: pubblica solo se tutte le condizioni sono soddisfatte. Le categorie ${esc(a.never_auto.join(", "))} richiedono sempre una persona.`),
  ].join("");
};

R.users = async () => {
  const u = await api("GET", "/api/users");
  const roles = Object.keys(u.roles);
  return [
    panel("Utenti", table([["Email", (r) => esc(r.email)], ["Ruolo", (r) => `<select data-act="user-role" data-id="${r.id}" aria-label="Ruolo">${roles.map((x) => `<option ${x === r.role ? "selected" : ""}>${x}</option>`).join("")}</select>`],
      ["Attivo", (r) => `<input type="checkbox" data-act="user-active" data-id="${r.id}" ${r.active ? "checked" : ""} aria-label="Attivo">`], ["Ultimo accesso", (r) => fmtDate(r.last_login_at)]], u.users)),
    `<div class="grid">${panel("Nuovo utente", `<form id="user-form">${field("email", "Email", { type: "email", required: true })}${field("password", "Password (min 12 caratteri)", { type: "password", required: true })}${field("role", "Ruolo", { options: roles })}<button class="btn primary">Crea</button></form>`)}
    ${panel("Ruoli e permessi", `<dl class="kv">${roles.map((r) => `<dt>${esc(r)}</dt><dd class="mono">${esc(u.roles[r].join(", "))}</dd>`).join("")}</dl>`)}</div>`,
  ].join("");
};

R.security = async () => {
  const [logs, jobs] = await Promise.all([can("audit.view") ? api("GET", "/api/audit?limit=300") : [], api("GET", "/api/jobs")]);
  return [
    panel("Job pianificati e dead-letter", table([["Job", (r) => `<span class="mono">${esc(r.name)}</span>`], ["Ogni (min)", (r) => esc(r.interval_minutes)], ["Attivo", (r) => badge(r.enabled ? "sì" : "no", r.enabled ? "good" : "")], ["Ultimo accodamento", (r) => fmtDate(r.last_enqueued_at)]], jobs.schedules, "Nessuna pianificazione") +
      `<h3>Job falliti definitivamente</h3>` + table([["ID", (r) => esc(r.id)], ["Job", (r) => esc(r.name)], ["Errore", (r) => esc(r.last_error), "wrap"], ["Quando", (r) => fmtDate(r.updated_at)],
      ["", (r) => (can("automation.edit") ? `<button class="btn small" data-act="job-requeue" data-id="${r.id}">Riprova</button>` : "")]], jobs.stats.dead, "Nessun job in dead-letter")),
    can("audit.view") ? panel("Audit log", table([["Quando", (r) => fmtDate(r.at)], ["Attore", (r) => esc(r.actor)], ["Azione", (r) => `<span class="mono">${esc(r.action)}</span>`],
      ["Oggetto", (r) => esc(`${r.target_type || ""} ${r.target_id || ""}`)], ["Dettaglio", (r) => `<span class="mono">${esc((r.detail || "").slice(0, 300))}</span>`, "wrap"]], logs), "",
      "I dettagli sono registrati già redatti: niente token, email o numeri di telefono in chiaro.") : "",
  ].join("");
};

R.settings = async () => {
  const s = await api("GET", "/api/settings");
  const v = s.settings, editable = can("settings.edit");
  const keys = [["agent.enabled", "Agente attivo", "bool"], ["brand.name", "Nome del brand"], ["brand.signature", "Firma (facoltativa)"], ["brand.disclosure", "Dichiarazione di trasparenza"],
    ["cta.contact_url", "URL modulo contatti", "url"], ["cta.demo_url", "URL prenotazione demo", "url"], ["cta.course_url", "URL corsi", "url"], ["cta.quote_url", "URL preventivi", "url"],
    ["ai.monthly_budget_eur", "Budget AI mensile (€)", "num"], ["ai.price_per_mtok_in_eur", "Prezzo input per milione di token (€)", "num"], ["ai.price_per_mtok_out_eur", "Prezzo output per milione di token (€)", "num"],
    ["ai.languages", "Lingue (virgola)", "list"], ["monitoring.default_interval_minutes", "Frequenza monitoraggio (min)", "int"], ["automation.global_max_per_hour", "Pubblicazioni max/ora (globale)", "int"],
    ["automation.global_max_per_day", "Pubblicazioni max/giorno (globale)", "int"], ["crm.retention_days", "Retention dati lead (giorni)", "int"], ["crm.auto_create_leads", "Crea lead automaticamente", "bool"],
    ["escalation.categories", "Categorie in escalation (virgola)", "list"], ["response.allowed_link_domains", "Domini linkabili nelle risposte (virgola)", "list"]];
  return [
    s.env.meta_missing.length ? `<div class="notice">Configurazione d'ambiente mancante per Meta: ${esc(s.env.meta_missing.join(", "))}.</div>` : "",
    panel("Impostazioni", `<div class="form-grid">${keys.map(([k, label, t]) => {
      const id = `set-${k.replace(/\W/g, "-")}`;
      const val = v[k];
      const input = t === "bool" ? `<input id="${id}" type="checkbox" data-set="${k}" data-t="bool" ${val ? "checked" : ""} ${editable ? "" : "disabled"}>`
        : `<input id="${id}" data-set="${k}" data-t="${t || "str"}" value="${esc(Array.isArray(val) ? val.join(", ") : val)}" ${t === "url" ? 'type="url" placeholder="https://… (vuoto = nessun invito)"' : ""} ${editable ? "" : "disabled"}>`;
      return `<div><label for="${id}">${esc(label)}</label>${input}</div>`;
    }).join("")}</div>${editable ? `<button class="btn primary" data-act="settings-save">Salva impostazioni</button>` : ""}`, "",
      "Gli URL di conversione restano vuoti finché non li inserisci: l'agente non inventa link."),
  ].join("");
};

R.usage = async () => {
  const u = await api("GET", "/api/usage");
  return [
    `<div class="tiles">${tile("Costo del mese", `${u.month_cost_eur} €`)}${tile("Budget mensile", `${u.budget_eur} €`)}</div>`,
    `<div class="grid">${panel("Chiamate per giorno", bars(u.by_day.map((d) => ({ day: d.day, calls: d.calls })).reverse(), "day", "calls", "Nessuna chiamata AI registrata"))}
    ${panel("Per funzione", table([["Funzione", (r) => esc(r.purpose)], ["Chiamate", (r) => esc(r.calls)], ["Latenza media", (r) => `${esc(r.avg_ms ?? "—")} ms`], ["Errori", (r) => esc(r.errors)]], u.by_purpose))}</div>`,
    panel("Dettaglio giornaliero", table([["Giorno", (r) => esc(r.day)], ["Chiamate", (r) => esc(r.calls)], ["Token in", (r) => esc(r.tokens_in)], ["Token out", (r) => esc(r.tokens_out)], ["Costo €", (r) => esc(r.cost_eur)], ["Errori", (r) => esc(r.errors)]], u.by_day)),
    panel("Ultimi errori AI", table([["Quando", (r) => fmtDate(r.at)], ["Funzione", (r) => esc(r.purpose)], ["Errore", (r) => esc(r.error), "wrap"]], u.recent_errors, "Nessun errore")),
  ].join("");
};

// ---------- router ----------
async function render() {
  const sec = (location.hash.slice(1).split("?")[0] || "overview");
  state.section = R[sec] ? sec : "overview";
  const title = SECTIONS.find((s) => s[0] === state.section)[1];
  $("#page-title").textContent = title;
  document.title = `${title} · INGLY`;
  document.querySelectorAll("#nav a").forEach((a) => a.setAttribute("aria-current", a.dataset.s === state.section ? "page" : "false"));
  $("#sidebar").classList.remove("open");
  const main = $("#main");
  main.innerHTML = `<p class="muted">Caricamento…</p>`;
  try {
    main.innerHTML = await R[state.section]();
    applyBarWidths(main);
    const oauth = new URLSearchParams(location.hash.split("?")[1] || "").get("oauth");
    if (oauth) toast(oauth === "ok" ? "Account collegati" : "Collegamento non completato", oauth !== "ok");
  } catch (e) {
    main.innerHTML = `<div class="notice bad">${esc(e.message)}</div>`;
  }
  refreshState();
}
async function refreshState() {
  try {
    const o = await api("GET", "/api/settings");
    $("#agent-state").innerHTML = (o.settings["agent.enabled"] ? badge("agente attivo", "good") : badge("agente in pausa", "warn")) +
      (o.settings["automation.kill_switch"] ? badge("kill switch", "bad") : "") + badge(o.ai.available ? `AI ${o.ai.provider}` : "AI non configurata", o.ai.available ? "gold" : "warn");
  } catch { /* già gestito */ }
}

// ---------- eventi ----------
document.addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-act]");
  if (!b || b.tagName === "INPUT" || b.tagName === "SELECT") return;
  const id = b.dataset.id, a = b.dataset.act;
  const run = async (fn, msg, rerender = true) => { b.disabled = true; const r = await act(fn, msg); b.disabled = false; if (r && rerender) render(); return r; };
  switch (a) {
    case "modal-close": $("#modal").close(); break;
    case "prompt-view": { const ps = await api("GET", "/api/prompts"); const p = ps.find((x) => String(x.id) === id); openModal(`<button class="btn small ghost" data-act="modal-close">Chiudi</button><pre class="json">${esc(p.text)}</pre>`); break; }
    case "prompt-activate": await run(() => api("POST", `/api/prompts/${id}/activate`), "Prompt attivato"); break;
    case "kb-ack": await run(() => api("POST", `/api/kb/updates/${id}/ack`)); break;
    case "doc-view": { const d = await act(() => api("GET", `/api/kb/documents/${id}`)); if (d) openModal(`<button class="btn small ghost" data-act="modal-close">Chiudi</button><h2>${esc(d.title)}</h2><p>${link(d.url)}</p>
      ${table([["Versione", (v) => esc(v.version)], ["Data", (v) => fmtDate(v.fetched_at)], ["Caratteri", (v) => esc(v.chars)], ["Hash", (v) => `<span class="mono">${esc(v.content_hash.slice(0, 12))}</span>`]], d.versions)}<pre class="json">${esc(d.text.slice(0, 6000))}</pre>`); break; }
    case "product-view": { const p = await act(() => api("GET", `/api/products/${encodeURIComponent(b.dataset.key)}`)); if (p) openModal(`<button class="btn small ghost" data-act="modal-close">Chiudi</button><h2>${esc(p.official_name)}</h2>
      <h3>Specifiche</h3>${table([["Nome", (s) => esc(s.name)], ["Valore", (s) => esc(`${s.value} ${s.unit || ""}`)], ["Stato", (s) => badge(s.status)], ["Fonte", (s) => link(s.source_url, "fonte")]], p.specs, "Nessuna specifica registrata")}
      <h3>Compatibilità</h3>${table([["Accessorio", (s) => esc(s.official_name)], ["Relazione", (s) => badge(s.relation)], ["Stato", (s) => badge(s.status)], ["Fonte", (s) => link(s.source_url, "fonte")]], p.compatibility, "Nessuna compatibilità registrata")}
      ${can("kb.edit") ? `<h3>Aggiungi specifica</h3><form id="spec-form" data-key="${esc(p.key)}"><div class="form-grid">${field("name", "Nome", { required: true })}${field("value", "Valore", { required: true })}${field("unit", "Unità")}${field("source_url", "URL fonte", { type: "url", required: true })}${field("verified_at", "Data verifica", { type: "date" })}${field("status", "Stato", { options: ["to_verify", "verified"] })}</div><button class="btn primary">Aggiungi</button></form>` : ""}`); break; }
    case "import-yaml": await run(() => api("POST", "/api/catalog/import-yaml"), "Import completato"); break;
    case "src-crawl": await run(() => api("POST", `/api/sources/${id}/crawl`), "Scansione accodata: la esegue il worker", false); break;
    case "item-process": await run(() => api("POST", `/api/social/items/${id}/process`), "Elaborato"); break;
    case "item-handled": await run(() => api("POST", `/api/social/items/${id}/handled`, { reason: "gestito manualmente" }), "Segnato come gestito"); break;
    case "meta-connect": { const r = await act(() => api("GET", "/api/social/meta/login")); if (r) location.href = r.url; break; }
    case "acc-check": await run(() => api("POST", `/api/social/accounts/${id}/check`), "Verifica completata"); break;
    case "acc-disconnect": if (b.dataset.confirm === "1") await run(() => api("POST", `/api/social/accounts/${id}/disconnect`), "Account scollegato"); else { b.dataset.confirm = "1"; b.textContent = "Conferma scollegamento"; } break;
    case "ss-poll": await run(() => api("POST", `/api/social/sources/${id}/poll`), "Controllo accodato", false); break;
    case "queue-tab": state.queueStatus = b.dataset.s; render(); break;
    case "draft-save": { const r = await run(() => api("PUT", `/api/drafts/${id}`, { text: $(`#draft-${id}`).value }), null); if (r) toast(r.validation_errors.length ? `Salvata con avvisi: ${r.validation_errors.join("; ")}` : "Bozza salvata", !!r.validation_errors.length); break; }
    case "draft-approve": await run(() => api("POST", `/api/drafts/${id}/approve`), "Approvata"); break;
    case "draft-reject": await run(() => api("POST", `/api/drafts/${id}/reject`, { reason: "rifiutata in revisione" }), "Rifiutata"); break;
    case "draft-publish": await run(() => api("POST", `/api/drafts/${id}/publish`), "Pubblicata"); break;
    case "draft-copy": { const t = $(`#draft-${id}`); try { await navigator.clipboard.writeText(t.value); toast("Copiata"); } catch { t.select(); toast("Testo selezionato: copialo con Ctrl+C"); } break; }
    case "lead-open": $("#modal").open && $("#modal").close(); leadModal(id); break;
    case "lead-export": { const d = await act(() => api("GET", `/api/leads/${id}/export`)); if (d) openModal(`<button class="btn small ghost" data-act="modal-close">Chiudi</button><pre class="json">${esc(JSON.stringify(d, null, 2))}</pre>`); break; }
    case "lead-delete": if (b.dataset.confirm === "1") { const r = await act(() => api("DELETE", `/api/leads/${id}`), "Lead cancellato"); if (r) { $("#modal").close(); render(); } } else { b.dataset.confirm = "1"; b.textContent = "Conferma cancellazione definitiva"; } break;
    case "eval-run": { const r = await run(() => api("POST", "/api/eval/run"), "Valutazione completata", false); if (r) { $("#eval-out").innerHTML = panel("Risultato", `<pre class="json">${esc(JSON.stringify(r.summary, null, 2))}</pre>` + table([["Caso", (x) => esc(x.key)], ["Categoria", (x) => `${badge(x.category, x.category_ok ? "good" : "bad")}`], ["Decisione", (x) => badge(x.decision, x.decision_ok ? "good" : "bad")], ["Termini vietati", (x) => esc(x.forbidden_found.join(", "))], ["Bozza", (x) => esc(x.draft.slice(0, 200)), "wrap"]], r.results)); } break; }
    case "job-requeue": await run(() => api("POST", `/api/jobs/${id}/requeue`), "Job riaccodato"); break;
    case "settings-save": {
      const errs = [];
      for (const el of document.querySelectorAll("[data-set]")) {
        const t = el.dataset.t; let val = el.value;
        if (t === "bool") val = el.checked; else if (t === "num") val = Number(val); else if (t === "int") val = parseInt(val, 10);
        else if (t === "list") val = val.split(",").map((s) => s.trim()).filter(Boolean);
        try { await api("PUT", "/api/settings", { key: el.dataset.set, value: val }); } catch (e) { errs.push(`${el.dataset.set}: ${e.message}`); }
      }
      toast(errs.length ? errs.join(" · ") : "Impostazioni salvate", !!errs.length); render(); break;
    }
  }
});

document.addEventListener("change", async (ev) => {
  const el = ev.target, a = el.dataset.act;
  if (!a) return;
  const ruleBody = () => ({ category: el.dataset.cat, channel: el.dataset.ch });
  const map = {
    "src-toggle": () => api("PATCH", `/api/sources/${el.dataset.id}`, { crawl_enabled: el.checked }),
    "src-interval": () => api("PATCH", `/api/sources/${el.dataset.id}`, { crawl_interval_hours: Number(el.value) }),
    "ss-toggle": () => api("PATCH", `/api/social/sources/${el.dataset.id}`, { active: el.checked }),
    "kill": () => api("POST", "/api/automation/kill", { active: el.checked }),
    "kill-ch": () => api("POST", "/api/automation/kill", { active: el.checked, channel: el.dataset.ch }),
    "rule-mode": () => api("PUT", "/api/automation/rules", { ...ruleBody(), mode: el.value }),
    "rule-num": () => api("PUT", "/api/automation/rules", { ...ruleBody(), mode: el.closest("tr").querySelector("[data-act=rule-mode]").value, [el.dataset.k]: Number(el.value) }),
    "rule-cta": () => api("PUT", "/api/automation/rules", { ...ruleBody(), mode: el.closest("tr").querySelector("[data-act=rule-mode]").value, include_cta: el.checked }),
    "user-role": () => api("PATCH", `/api/users/${el.dataset.id}`, { role: el.value }),
    "user-active": () => api("PATCH", `/api/users/${el.dataset.id}`, { active: el.checked }),
  };
  if (!map[a]) return;
  const ok = await act(map[a], "Salvato");
  if (!ok) render(); else if (["kill", "kill-ch", "src-toggle"].includes(a)) render();
});

document.addEventListener("submit", async (ev) => {
  const f = ev.target;
  ev.preventDefault();
  const d = formData(f);
  const done = (msg, rerender = true) => (r) => { if (r) { toast(msg); if (rerender) render(); } return r; };
  switch (f.id) {
    case "login-form": return doLogin();
    case "agent-test": { const out = $("#agent-test-out"); out.innerHTML = '<p class="muted">Analisi in corso…</p>'; const r = await act(() => api("POST", "/api/agent/test", { text: d.text })); out.innerHTML = r ? renderTestResult(r) : ""; return; }
    case "prompt-new": return act(() => api("POST", "/api/prompts", { name: "responder", text: d.text })).then(done("Nuova versione salvata (non ancora attiva)"));
    case "kb-search": { const r = await act(() => api("GET", `/api/kb/search?q=${encodeURIComponent(d.q)}`)); if (r) $("#kb-results").innerHTML = `<p class="muted">Copertura fonti: ${esc(r.evidence)}</p>` + table([["Fonte", (h) => link(h.url, h.title), "wrap"], ["Sezione", (h) => esc(h.heading || "")], ["Estratto", (h) => esc(h.text), "wrap"], ["Tipo", (h) => badge(h.kind, h.kind.startsWith("official") ? "gold" : "")], ["Verificato", (h) => fmtDate(h.checked_at)]], r.hits, "Nessun risultato: la knowledge base non contiene ancora informazioni su questo tema"); return; }
    case "kb-import": { const fd = new FormData(f); if (!fd.get("url")) fd.delete("url"); return act(() => api("POST", "/api/kb/import", fd, true)).then((r) => r && (toast(`Import: ${r.outcome}`), render())); }
    case "product-form": return act(() => api("POST", "/api/products", d)).then(done("Prodotto salvato"));
    case "spec-form": return act(() => api("POST", `/api/products/${encodeURIComponent(f.dataset.key)}/specs`, d)).then((r) => r && (toast("Specifica aggiunta"), $("#modal").close(), render()));
    case "accessory-form": return act(() => api("POST", "/api/accessories", d)).then(done("Accessorio salvato"));
    case "compat-form": return act(() => api("POST", "/api/compatibility", d)).then(done("Compatibilità registrata"));
    case "compat-check": { const r = await act(() => api("GET", `/api/compatibility?product=${encodeURIComponent(d.product)}&accessory=${encodeURIComponent(d.accessory)}`)); if (r) $("#compat-out").innerHTML = `<p>${badge(r.answer, { compatible: "good", incompatible: "bad", conflict: "bad", unknown: "warn" }[r.answer])} ${esc(r.reason || "")}</p>` + table([["Relazione", (x) => esc(x.relation)], ["Stato", (x) => badge(x.status)], ["Fonte", (x) => link(x.source_url, "fonte")]], r.rules, ""); return; }
    case "material-form": return act(() => api("POST", "/api/materials", d)).then(done("Materiale salvato"));
    case "manual-import": { const r = await act(() => api("POST", "/api/social/manual-import", { source_id: Number(d.source_id), content: d.content, format: d.format, process_now: true })); if (r) { toast(`${r.new} nuovi, ${r.duplicates} duplicati`); render(); } return; }
    case "listen-filter": state.listenFilter = d; return render();
    case "lead-filter": state.leadFilter = d; return render();
    case "lead-stage": return act(() => api("POST", `/api/leads/${f.dataset.id}/stage`, d)).then((r) => r && (toast("Stato aggiornato"), leadModal(f.dataset.id)));
    case "lead-event": return act(() => api("POST", `/api/leads/${f.dataset.id}/events`, d)).then((r) => r && (toast("Attività aggiunta"), leadModal(f.dataset.id)));
    case "lead-consent": return act(() => api("POST", `/api/leads/${f.dataset.id}/consent`, d)).then((r) => r && (toast("Consenso registrato"), leadModal(f.dataset.id)));
    case "user-form": return act(() => api("POST", "/api/users", d)).then(done("Utente creato"));
  }
});

// ---------- avvio ----------
function showLogin() { $("#shell").hidden = true; $("#login").hidden = false; $("#login-email").focus(); }
async function doLogin() {
  $("#login-error").textContent = "";
  try {
    const r = await api("POST", "/api/auth/login", { email: $("#login-email").value, password: $("#login-password").value });
    state.csrf = r.csrf; state.me = r; $("#login-password").value = ""; start();
  } catch (e) { $("#login-error").textContent = e.message; }
}
function start() {
  $("#login").hidden = true; $("#shell").hidden = false;
  $("#user-email").textContent = `${state.me.email} · ${state.me.role}`;
  $("#nav").innerHTML = SECTIONS.map(([k, t], i) => `<a href="#${k}" data-s="${k}"><span class="n">${i + 1}</span>${esc(t)}</a>`).join("");
  render();
}
function applyTheme(t) { if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; }
(async function init() {
  try { applyTheme(localStorage.getItem("ingly-theme")); } catch { /* storage non disponibile */ }
  $("#theme-toggle").addEventListener("click", () => {
    const cur = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const nt = cur === "dark" ? "light" : "dark"; applyTheme(nt); try { localStorage.setItem("ingly-theme", nt); } catch { /* */ }
  });
  $("#logout").addEventListener("click", async () => { await act(() => api("POST", "/api/auth/logout")); state.csrf = null; showLogin(); });
  $("#menu-toggle").addEventListener("click", () => { const s = $("#sidebar"); s.classList.toggle("open"); $("#menu-toggle").setAttribute("aria-expanded", s.classList.contains("open")); });
  window.addEventListener("hashchange", () => state.me && render());
  try { const me = await api("GET", "/api/me"); state.csrf = me.csrf; state.me = me; start(); } catch { showLogin(); }
})();
