# Report dei test

Data: 2026-10-09 · Python 3.11 · SQLite 3.45 (FTS5)

## Suite automatica: `python -m pytest -q` → **47 passati, 0 falliti**

Copertura dei 20 punti richiesti:

| # | Requisito | Test |
|---|---|---|
| 1 | Importazione di pagine e documenti | `test_import_html_and_pdf`, `test_crawler_respects_robots_sitemap_and_detects_gone` |
| 2 | Estrazione dei metadati | `test_extract_metadata_strips_boilerplate`, `test_extract_pdf_text` |
| 3 | Deduplicazione | `test_dedup_unchanged_changed_duplicate`, `test_manual_import_dedup_and_processing` |
| 4 | Ricerca di una specifica tecnica | `test_search_specification`, `test_search_handles_fts_syntax_safely` |
| 5 | Verifica delle citazioni | `test_draft_cites_retrieved_sources`, `test_validator_flags_unsupported_numbers_prices_and_links` |
| 6 | Compatibilità macchina-accessorio | `test_compatibility_requires_verified_source`, `test_compatibility_needs_source` |
| 7 | Informazioni mancanti | `test_missing_fields_and_verified_requires_source`, `test_no_ai_fallback_asks_clarification` |
| 8 | Conflitto tra fonti | `test_conflicting_specs_detected` |
| 9 | Italiano e inglese | `test_language_italian_and_english` |
| 10 | Richieste commerciali | `test_commercial_detection`, `test_lead_scoring_is_explainable` |
| 11 | Reclami e contenuti rischiosi | `test_complaints_and_risky_content` |
| 12 | Blocco pubblicazione senza autorizzazione | `test_manual_channel_cannot_publish`, `test_manual_import_dedup_and_processing` |
| 13 | Token scaduti | `test_expired_token_marks_account` |
| 14 | Retry e rate limiting | `test_meta_rate_limit_retries_later`, `test_job_retry_backoff_and_dead_letter`, `test_login_lockout_and_rate_limit` |
| 15 | Idempotenza | `test_auto_safe_publishes_once_with_idempotency`, `test_process_is_idempotent`, `test_job_dedupe_lock_and_lease_recovery` |
| 16 | Audit | `test_auto_safe_publishes_once_with_idempotency` (azioni registrate), `test_oauth_flow_stores_encrypted_tokens` (nessun token nei log) |
| 17 | Prompt injection | `test_prompt_injection_detected_and_isolated`, `test_retrieved_documents_are_escaped` |
| 18 | Cancellazione dei dati | `test_lead_deletion_and_retention` |
| 19 | Permessi | `test_api_permissions_and_csrf` |
| 20 | Kill switch globale | `test_kill_switch_blocks_everything` |

Cosa è simulato nei test (e solo lì): il provider AI (`FakeProvider`, deterministico), i siti web
(`httpx.MockTransport`) e la Graph API di Meta. Le pagine HTML di prova in `tests/fixtures/` descrivono
una macchina fittizia "Test Laser A" e non vengono mai caricate nel database reale.

<details><summary>Elenco completo</summary>

```
tests/test_crm_jobs_security.py::test_lead_scoring_is_explainable ✔
tests/test_crm_jobs_security.py::test_pipeline_transitions_and_consent ✔
tests/test_crm_jobs_security.py::test_lead_deletion_and_retention ✔
tests/test_crm_jobs_security.py::test_job_retry_backoff_and_dead_letter ✔
tests/test_crm_jobs_security.py::test_job_dedupe_lock_and_lease_recovery ✔
tests/test_crm_jobs_security.py::test_job_retry_later_and_timeout ✔
tests/test_crm_jobs_security.py::test_schedules_enqueue_once_per_interval ✔
tests/test_crm_jobs_security.py::test_redaction ✔
tests/test_crm_jobs_security.py::test_api_permissions_and_csrf ✔
tests/test_crm_jobs_security.py::test_login_lockout_and_rate_limit ✔
tests/test_crm_jobs_security.py::test_api_end_to_end_manual_flow ✔
tests/test_crm_jobs_security.py::test_webhook_endpoint_rejects_unsigned ✔
tests/test_knowledge.py::test_import_html_and_pdf ✔
tests/test_knowledge.py::test_extract_metadata_strips_boilerplate ✔
tests/test_knowledge.py::test_extract_pdf_text ✔
tests/test_knowledge.py::test_dedup_unchanged_changed_duplicate ✔
tests/test_knowledge.py::test_crawler_respects_robots_sitemap_and_detects_gone ✔
tests/test_knowledge.py::test_crawler_stops_on_403 ✔
tests/test_knowledge.py::test_search_specification ✔
tests/test_knowledge.py::test_search_handles_fts_syntax_safely ✔
tests/test_knowledge.py::test_compatibility_requires_verified_source ✔
tests/test_knowledge.py::test_compatibility_needs_source ✔
tests/test_knowledge.py::test_missing_fields_and_verified_requires_source ✔
tests/test_knowledge.py::test_conflicting_specs_detected ✔
tests/test_knowledge.py::test_yaml_cards_import_skips_empty_templates ✔
tests/test_knowledge.py::test_sources_seeded_from_registry ✔
tests/test_response.py::test_draft_cites_retrieved_sources ✔
tests/test_response.py::test_validator_flags_unsupported_numbers_prices_and_links ✔
tests/test_response.py::test_model_reported_unsupported_claims_block ✔
tests/test_response.py::test_no_ai_fallback_asks_clarification ✔
tests/test_response.py::test_language_italian_and_english ✔
tests/test_response.py::test_commercial_detection ✔
tests/test_response.py::test_complaints_and_risky_content ✔
tests/test_response.py::test_prompt_injection_detected_and_isolated ✔
tests/test_response.py::test_retrieved_documents_are_escaped ✔
tests/test_social.py::test_manual_import_dedup_and_processing ✔
tests/test_social.py::test_process_is_idempotent ✔
tests/test_social.py::test_manual_channel_cannot_publish ✔
tests/test_social.py::test_auto_safe_publishes_once_with_idempotency ✔
tests/test_social.py::test_never_auto_categories_and_quota ✔
tests/test_social.py::test_kill_switch_blocks_everything ✔
tests/test_social.py::test_expired_token_marks_account ✔
tests/test_social.py::test_meta_rate_limit_retries_later ✔
tests/test_social.py::test_graph_error_mapping ✔
tests/test_social.py::test_webhook_verification_and_parsing ✔
tests/test_social.py::test_oauth_flow_stores_encrypted_tokens ✔
tests/test_social.py::test_meta_not_configured_is_reported ✔
============================== 47 passed in 3.75s ==============================
```
</details>

## Valutazione dell'agente: `python -m ingly eval` (senza provider AI)

| Metrica | Valore |
|---|---|
| Casi | 16 |
| Accuratezza categoria | 1.00 |
| Accuratezza decisione | 1.00 |
| Risposte con affermazioni non supportate | 0.00 |
| Termini vietati nelle risposte | 0 |
| Falsi positivi commerciali | 0 |

**Come leggerla:** i 16 casi sono stati scritti insieme alle regole di classificazione, quindi il 100%
dimostra coerenza, non qualità su messaggi reali. Durante lo sviluppo hanno già scoperto due difetti
(intento commerciale assegnato allo spam; classificazione AI che sovrascriveva segnali espliciti),
entrambi corretti. Per una misura credibile servono casi reali con risposte di riferimento scritte da INGLY
e una prova con il provider AI attivo (vedi docs/ROADMAP.md).

## Verifica manuale nel browser
Server avviato in locale, login, visita di tutte le 20 sezioni a 1366 px (tema chiaro) e 390 px (tema scuro):
nessun errore JavaScript, nessuno scroll orizzontale. Flusso provato: import manuale di 3 messaggi →
bozze in coda → lead creati → grafici in Analytics.
