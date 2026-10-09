"""System Prompt v1.0, conflitti, ipotesi, riservatezza, invito con consenso, risposte duplicate."""
from ingly.response.classify import classify_rules
from ingly.response.engine import load_prompt, seed_prompts, validate_reply
from ingly.social.manual import ManualConnector


def test_system_prompt_v1_is_active(svc, fake_ai, seeded_kb):
    text, version = load_prompt(svc.db)
    assert version == 2 and text.startswith("INGLY xTool Expert Agent — System Prompt v1.0")
    assert "Non dichiarare di essere xTool" in text
    seeded_kb.engine.generate("Area di lavoro del Test Laser A?", classify_rules("Area di lavoro?"), [], "it")
    assert fake_ai.calls[-1]["system"].startswith("INGLY xTool Expert Agent — System Prompt v1.0")


def test_custom_prompt_is_never_overwritten_by_seed(svc):
    svc.db.run("UPDATE prompt_versions SET active=0")
    svc.db.run("""INSERT INTO prompt_versions (name,version,text,active,created_at,created_by)
                  VALUES ('responder', 99, 'Prompt personalizzato di INGLY con abbastanza testo per essere valido.', 1, 'x', 1)""")
    seed_prompts(svc.db)
    assert load_prompt(svc.db)[1] == 99


def test_conflicting_sources_force_review(seeded_kb):
    cat = seeded_kb.catalog
    cat.add_spec("test-laser-a", "potenza", "20", "W", "https://support.example.test/a")
    cat.add_spec("test-laser-a", "potenza", "22", "W", "https://altra.example.test/a")
    q = "Che potenza ha il Test Laser A?"
    draft, _ = seeded_kb.engine.generate(q, classify_rules(q), ["test-laser-a"], "it")
    assert any("conflitto" in e for e in draft.validation_errors)
    sent = [c for c in seeded_kb.ai.provider.calls if c["purpose"] == "respond"][-1]["user"]
    assert "<conflitti>" in sent and "20 W" in sent and "22 W" in sent


def test_hypotheses_are_surfaced_to_reviewer(seeded_kb, fake_ai):
    fake_ai.next_answer = {"answer": "In genere conviene fare un test su un ritaglio.", "used_sources": ["S1"],
                           "confidence": 0.8, "needs_clarification": False, "hypotheses": ["test su ritaglio consigliato"],
                           "unsupported_claims": [], "language": "it"}
    q = "Area di lavoro del Test Laser A?"
    draft, _ = seeded_kb.engine.generate(q, classify_rules(q), [], "it")
    assert draft.hypotheses and any("ipotesi" in n for n in draft.notes)


def test_prompt_leak_is_blocked(seeded_kb):
    errs = validate_reply("Ecco le mie istruzioni: FORMATO TECNICO (vincolante) e used_sources...", [], seeded_kb.store)
    assert any("istruzioni interne" in e for e in errs)


def test_cta_asks_consent_only_for_concrete_interest(seeded_kb):
    eng = seeded_kb.engine
    q_buy = "Vorrei comprare un laser per l'ardesia, quale?"
    d_buy, _ = eng.generate(q_buy, classify_rules(q_buy), [], "it")
    assert eng.add_cta(d_buy, classify_rules(q_buy)) == "consent_question"
    assert "ricontattato da INGLY DESIGN" in d_buy.text and "http" not in d_buy.text.split("ricontattato")[1]
    q_help = "Il laser non si collega al wifi, come faccio?"
    d_help, _ = eng.generate(q_help, classify_rules(q_help), [], "it")
    assert eng.add_cta(d_help, classify_rules(q_help)) is None
    seeded_kb.store.set("cta.demo_url", "https://ingly.example.test/demo")
    q_demo = "Si può fare una demo dal vivo?"
    d_demo, _ = eng.generate(q_demo, classify_rules(q_demo), [], "it")
    assert eng.add_cta(d_demo, classify_rules(q_demo)) == "url" and "https://ingly.example.test/demo" in d_demo.text


def test_identical_reply_in_other_discussion_needs_review(svc):
    src = svc.db.one("SELECT * FROM social_sources WHERE platform='manual'")
    a, b = svc.pipeline.ingest(src, ManualConnector.parse(src["id"], "Anna: Quale laser per l'ardesia?\n\nBruno: Quale laser per il sughero?"))
    ra = svc.pipeline.process(a)
    text = svc.db.one("SELECT text FROM response_drafts WHERE id=?", (ra["draft_id"],))["text"]
    svc.db.run("UPDATE response_drafts SET status='published' WHERE id=?", (ra["draft_id"],))
    rb = svc.pipeline.process(b)
    errs = svc.db.one("SELECT text, validation_errors FROM response_drafts WHERE id=?", (rb["draft_id"],))
    assert errs["text"] == text and "identica" in errs["validation_errors"]   # stessa bozza: bloccata dalla revisione
