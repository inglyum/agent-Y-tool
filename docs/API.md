# API

Generato da `scripts/gen_api_docs.py`. Schema OpenAPI completo: `/api/openapi.json`.

- Autenticazione: cookie di sessione da `POST /api/auth/login` (HttpOnly, SameSite=Lax, Secure in produzione).
- Ogni richiesta che modifica dati richiede l'header `X-CSRF-Token` (restituito da login e da `GET /api/me`).
- Permessi verificati lato server su ogni rotta (colonna Permesso); ruoli in `ingly/security.py`.
- Errori: JSON `{"error": "messaggio"}` — 400 input/azione non valida, 401 accesso richiesto, 403 permesso o CSRF,
  404 non trovato, 413 file troppo grande, 423 bloccato da policy/kill switch, 429 troppi tentativi, 502 errore piattaforma esterna.

| Metodo | Percorso | Permesso | Note |
|---|---|---|---|
| GET | `/api/accessories` | `dashboard.view` |  |
| POST | `/api/accessories` | `kb.edit` |  |
| POST | `/api/agent/test` | `drafts.edit` |  |
| GET | `/api/analytics` | `dashboard.view` |  |
| GET | `/api/audit` | `audit.view` |  |
| POST | `/api/auth/login` | pubblica |  |
| POST | `/api/auth/logout` | sessione |  |
| GET | `/api/automation/auto-safe` | `dashboard.view` |  |
| POST | `/api/automation/auto-safe` | `automation.edit` |  |
| POST | `/api/automation/kill` | `automation.edit` |  |
| GET | `/api/automation/rules` | `dashboard.view` |  |
| PUT | `/api/automation/rules` | `automation.edit` |  |
| POST | `/api/catalog/import-yaml` | `kb.edit` |  |
| GET | `/api/compatibility` | `dashboard.view` |  |
| POST | `/api/compatibility` | `kb.edit` |  |
| GET | `/api/crawl/jobs` | `dashboard.view` |  |
| GET | `/api/crawl/jobs/{jid}/results` | `dashboard.view` |  |
| GET | `/api/drafts` | `social.view` |  |
| PUT | `/api/drafts/{did}` | `drafts.edit` |  |
| POST | `/api/drafts/{did}/approve` | `drafts.approve` |  |
| POST | `/api/drafts/{did}/publish` | `drafts.publish` |  |
| POST | `/api/drafts/{did}/reject` | `drafts.approve` |  |
| GET | `/api/eval/cases` | `dashboard.view` |  |
| POST | `/api/eval/run` | `eval.run` |  |
| GET | `/api/eval/runs` | `dashboard.view` |  |
| GET | `/api/health` | pubblica |  |
| GET | `/api/jobs` | `dashboard.view` |  |
| POST | `/api/jobs/{jid}/requeue` | `automation.edit` |  |
| GET | `/api/kb/conflicts` | `dashboard.view` |  |
| GET | `/api/kb/documents` | `dashboard.view` |  |
| DELETE | `/api/kb/documents/{doc_id}` | `kb.edit` |  |
| GET | `/api/kb/documents/{doc_id}` | `dashboard.view` |  |
| GET | `/api/kb/export` | `kb.edit` | Esporta catalogo strutturato e metadati (non il testo integrale delle pagine di terzi). |
| POST | `/api/kb/import` | `kb.crawl` |  |
| POST | `/api/kb/ingest-url` | `kb.crawl` |  |
| POST | `/api/kb/reindex` | `kb.edit` |  |
| GET | `/api/kb/search` | `dashboard.view` |  |
| GET | `/api/kb/stale` | `dashboard.view` |  |
| GET | `/api/kb/updates` | `dashboard.view` |  |
| POST | `/api/kb/updates/{uid}/ack` | `kb.edit` |  |
| GET | `/api/leads` | `leads.view` |  |
| GET | `/api/leads/meta` | `leads.view` |  |
| GET | `/api/leads/requests` | `leads.view` |  |
| DELETE | `/api/leads/{lid}` | `leads.delete` |  |
| GET | `/api/leads/{lid}` | `leads.view` |  |
| PATCH | `/api/leads/{lid}` | `leads.edit` |  |
| POST | `/api/leads/{lid}/consent` | `leads.edit` |  |
| POST | `/api/leads/{lid}/events` | `leads.edit` |  |
| GET | `/api/leads/{lid}/export` | `leads.delete` |  |
| POST | `/api/leads/{lid}/stage` | `leads.edit` |  |
| GET | `/api/materials` | `dashboard.view` |  |
| POST | `/api/materials` | `kb.edit` |  |
| GET | `/api/me` | sessione |  |
| GET | `/api/openapi.json` | pubblica |  |
| GET | `/api/overview` | `dashboard.view` |  |
| GET | `/api/products` | `dashboard.view` |  |
| POST | `/api/products` | `kb.edit` |  |
| GET | `/api/products/{key}` | `dashboard.view` |  |
| POST | `/api/products/{key}/specs` | `kb.edit` |  |
| GET | `/api/prompts` | `settings.edit` |  |
| POST | `/api/prompts` | `settings.edit` |  |
| POST | `/api/prompts/{pid}/activate` | `settings.edit` |  |
| GET | `/api/settings` | `dashboard.view` |  |
| PUT | `/api/settings` | `settings.edit` |  |
| GET | `/api/social/accounts` | `social.view` |  |
| POST | `/api/social/accounts/{aid}/check` | `social.connect` |  |
| POST | `/api/social/accounts/{aid}/disconnect` | `social.connect` |  |
| GET | `/api/social/items` | `social.view` |  |
| POST | `/api/social/items/{iid}/handled` | `drafts.edit` |  |
| POST | `/api/social/items/{iid}/lead` | `leads.edit` |  |
| POST | `/api/social/items/{iid}/process` | `drafts.edit` |  |
| POST | `/api/social/manual-import` | `drafts.edit` |  |
| GET | `/api/social/meta/callback` | `social.connect` |  |
| GET | `/api/social/meta/login` | `social.connect` |  |
| GET | `/api/social/meta/status` | `social.view` |  |
| GET | `/api/social/sources` | `social.view` |  |
| PATCH | `/api/social/sources/{sid}` | `social.connect` |  |
| POST | `/api/social/sources/{sid}/poll` | `social.connect` |  |
| GET | `/api/sources` | `dashboard.view` |  |
| PATCH | `/api/sources/{sid}` | `kb.crawl` |  |
| POST | `/api/sources/{sid}/crawl` | `kb.crawl` |  |
| GET | `/api/usage` | `dashboard.view` |  |
| GET | `/api/users` | `users.manage` |  |
| POST | `/api/users` | `users.manage` |  |
| PATCH | `/api/users/{uid}` | `users.manage` |  |
| GET | `/webhooks/meta` | firma HMAC Meta / verify token |  |
| POST | `/webhooks/meta` | firma HMAC Meta / verify token |  |
