# Report dei test

Data: 2026-10-09 · Python 3.11 · SQLite 3.45 (FTS5) · PostgreSQL 16 + pgvector 0.6

## Suite automatica

| Database | Comando | Risultato |
|---|---|---|
| SQLite | `python -m pytest -q` | **88 passati, 0 falliti** |
| PostgreSQL 16 + pgvector | `INGLY_TEST_DATABASE_URL=postgresql://… python -m pytest -q` | **88 passati, 0 falliti** (un database nuovo per ogni test) |

### Copertura dei requisiti

| Requisito | Test principali |
|---|---|
| Migrazioni e integrità database | `test_migrations_idempotent_and_complete`, `test_constraints_enforced`, `test_cascade_delete_removes_personal_data` |
| Recupero delle citazioni | `test_draft_cites_retrieved_sources`, `test_citation_contains_section_page_and_dates` |
| Correttezza e provenienza dei dati | `test_validator_flags_unsupported_numbers_prices_and_links`, `test_missing_fields_and_verified_requires_source`, `test_conflicting_specs_detected`, `test_conflicting_sources_force_review` |
| Compatibilità sconosciute | `test_compatibility_requires_verified_source`, `test_compatibility_needs_source` |
| Prompt injection | `test_prompt_injection_detected_and_isolated`, `test_retrieved_documents_are_escaped`, `test_prompt_leak_is_blocked` |
| Permessi e autorizzazioni | `test_api_permissions_and_csrf`, `test_every_api_route_requires_authentication`, `test_login_lockout_and_rate_limit` |
| Token scaduti | `test_expired_token_marks_account`, `test_oauth_flow_stores_encrypted_tokens` |
| Errori API e retry | `test_meta_rate_limit_retries_later`, `test_graph_error_mapping`, `test_job_retry_backoff_and_dead_letter`, `test_job_retry_later_and_timeout` |
| Idempotenza | `test_auto_safe_publishes_once_with_idempotency`, `test_process_is_idempotent`, `test_job_dedupe_lock_and_lease_recovery` |
| Kill switch | `test_kill_switch_blocks_everything` |
| Approvazione prima della pubblicazione | `test_approval_mode_requires_explicit_approval`, `test_publish_refused_in_non_publishing_modes`, `test_edited_text_is_revalidated_at_publish`, `test_auto_safe_locked_until_enabled`, `test_auto_safe_unlock_requires_passing_recent_evaluation` |
| Privacy e cancellazione dei dati | `test_lead_deletion_and_retention`, `test_pipeline_transitions_and_consent`, `test_community_participation_is_not_a_marketing_contact`, `test_redaction` |
| Limiti di costo AI | `test_ai_budget_stops_calls_and_pipeline_degrades` |
| SSRF e acquisizione URL | `test_netguard_blocks_non_public_targets` (10 casi), `test_redirect_to_private_address_is_blocked`, `test_fetch_url_only_for_registered_sources` |
| Knowledge base | import HTML/PDF, metadati, deduplica, versioni, crawler con robots/sitemap, rimozione, fonti obsolete, ricerca ibrida con refusi |
| Risposte | System Prompt v1.0 attivo, prompt personalizzati preservati, ipotesi segnalate, invito solo per interesse concreto con richiesta di consenso, risposte identiche bloccate, italiano/inglese |

**Simulazione separata dall'integrazione reale.** Solo nei test: provider AI finto (`FakeProvider`), siti web e
Graph API Meta simulati con `httpx.MockTransport`, risolutore DNS di test (`PUBLIC_GUARD`) che fa risultare
pubblici i domini `*.example.test`. Il codice di produzione usa il risolutore di sistema e le API reali; le
pagine di prova descrivono una macchina fittizia ("Test Laser A") e non entrano mai nel database applicativo.

<details><summary>Elenco completo (SQLite)</summary>

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
tests/test_crm_jobs_security.py::test_community_participation_is_not_a_marketing_contact ✔
tests/test_crm_jobs_security.py::test_workspace_seeded_and_users_bound ✔
tests/test_integrity.py::test_migrations_idempotent_and_complete ✔
tests/test_integrity.py::test_constraints_enforced ✔
tests/test_integrity.py::test_cascade_delete_removes_personal_data ✔
tests/test_integrity.py::test_every_api_route_requires_authentication ✔
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
tests/test_knowledge_v2.py::test_netguard_blocks_non_public_targets[http://127.0.0.1/admin] ✔
tests/test_knowledge_v2.py::test_netguard_blocks_non_public_targets[http://localhost/] ✔
tests/test_knowledge_v2.py::test_netguard_blocks_non_public_targets[http://169.254.169.254/latest/meta-data/] ✔
tests/test_knowledge_v2.py::test_netguard_blocks_non_public_targets[http://10.0.0.5/] ✔
tests/test_knowledge_v2.py::test_netguard_blocks_non_public_targets[http://[::1]/] ✔
tests/test_knowledge_v2.py::test_netguard_blocks_non_public_targets[file:///etc/passwd] ✔
tests/test_knowledge_v2.py::test_netguard_blocks_non_public_targets[ftp://support.example.test/x] ✔
tests/test_knowledge_v2.py::test_netguard_blocks_non_public_targets[https://support.example.test:8443/] ✔
tests/test_knowledge_v2.py::test_netguard_blocks_non_public_targets[https://user:pw@support.example.test/] ✔
tests/test_knowledge_v2.py::test_netguard_blocks_non_public_targets[http://intranet.local/] ✔
tests/test_knowledge_v2.py::test_netguard_allows_public ✔
tests/test_knowledge_v2.py::test_redirect_to_private_address_is_blocked ✔
tests/test_knowledge_v2.py::test_fetch_url_only_for_registered_sources ✔
tests/test_knowledge_v2.py::test_document_removal_excludes_from_search ✔
tests/test_knowledge_v2.py::test_stale_documents_reported ✔
tests/test_knowledge_v2.py::test_hybrid_search_tolerates_typos ✔
tests/test_knowledge_v2.py::test_citation_contains_section_page_and_dates ✔
tests/test_knowledge_v2.py::test_api_ingest_and_remove ✔
tests/test_policy.py::test_defaults_are_draft_and_monitor ✔
tests/test_policy.py::test_publish_refused_in_non_publishing_modes[OFF] ✔
tests/test_policy.py::test_publish_refused_in_non_publishing_modes[MONITOR] ✔
tests/test_policy.py::test_publish_refused_in_non_publishing_modes[DRAFT] ✔
tests/test_policy.py::test_approval_mode_requires_explicit_approval ✔
tests/test_policy.py::test_auto_safe_locked_until_enabled ✔
tests/test_policy.py::test_auto_safe_unlock_requires_passing_recent_evaluation ✔
tests/test_policy.py::test_manual_publish_respects_quota_and_policy ✔
tests/test_policy.py::test_edited_text_is_revalidated_at_publish ✔
tests/test_policy.py::test_ai_budget_stops_calls_and_pipeline_degrades ✔
tests/test_response.py::test_draft_cites_retrieved_sources ✔
tests/test_response.py::test_validator_flags_unsupported_numbers_prices_and_links ✔
tests/test_response.py::test_model_reported_unsupported_claims_block ✔
tests/test_response.py::test_no_ai_fallback_asks_clarification ✔
tests/test_response.py::test_language_italian_and_english ✔
tests/test_response.py::test_commercial_detection ✔
tests/test_response.py::test_complaints_and_risky_content ✔
tests/test_response.py::test_prompt_injection_detected_and_isolated ✔
tests/test_response.py::test_retrieved_documents_are_escaped ✔
tests/test_response_v2.py::test_system_prompt_v1_is_active ✔
tests/test_response_v2.py::test_custom_prompt_is_never_overwritten_by_seed ✔
tests/test_response_v2.py::test_conflicting_sources_force_review ✔
tests/test_response_v2.py::test_hypotheses_are_surfaced_to_reviewer ✔
tests/test_response_v2.py::test_prompt_leak_is_blocked ✔
tests/test_response_v2.py::test_cta_asks_consent_only_for_concrete_interest ✔
tests/test_response_v2.py::test_identical_reply_in_other_discussion_needs_review ✔
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
```
</details>

## Valutazione dell'agente (`python -m ingly eval`, senza provider AI)

| Metrica | Valore |
|---|---|
| Casi | 16 |
| Accuratezza categoria | 1.00 |
| Accuratezza decisione (regole predefinite DRAFT/MONITOR) | 1.00 |
| Risposte con affermazioni non supportate | 0.00 |
| Termini vietati | 0 |
| Falsi positivi commerciali | 0 |

Questi casi sono stati scritti insieme alle regole: il risultato dimostra coerenza, non qualità su messaggi reali.
Con il provider di test la valutazione scende a 0.94 (un post vetrina classificato come domanda), sopra le soglie
di sblocco di AUTO_SAFE. Per una misura credibile servono casi reali con risposte di riferimento di INGLY.

## Verifiche manuali
- Server avviato su PostgreSQL: login, import manuale di 3 messaggi (1 sola opportunità creata: quella con interesse
  d'acquisto), acquisizione di `http://169.254.169.254/latest` rifiutata, stato AUTO_SAFE "bloccato" con i motivi.
- Dashboard: tutte le sezioni a 1366 px (chiaro) e 390 px (scuro) senza errori JavaScript né scroll orizzontale.
- `tsc --checkJs` sul frontend: 37 segnalazioni, tutte di tipizzazione DOM generica (nessun difetto funzionale).
