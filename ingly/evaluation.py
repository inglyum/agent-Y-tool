"""Valutazione ripetibile del comportamento dell'agente con metriche deterministiche.

Le metriche non usano il giudizio dello stesso modello: confrontano classificazioni e decisioni
attese, controllano termini vietati/obbligatori e contano gli errori del validatore.
"""
from __future__ import annotations

from pathlib import Path

import yaml

from .config import ROOT
from .db import Database, jdump, jload, now_iso
from .response.classify import classify_rules, merge_ai

CASES_FILE = ROOT / "evals" / "cases.yaml"


def seed_cases(db: Database, path: Path = CASES_FILE) -> int:
    if not path.exists():
        return 0
    n = 0
    for c in yaml.safe_load(path.read_text()) or []:
        n += db.run("""INSERT INTO evaluation_cases (key,input_text,language,expected_category,expected_decision,must_include,must_not_include,notes)
                       VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET input_text=excluded.input_text,
                       language=excluded.language, expected_category=excluded.expected_category,
                       expected_decision=excluded.expected_decision, must_include=excluded.must_include,
                       must_not_include=excluded.must_not_include""",
                    (c["key"], c["input_text"], c.get("language", "it"), c.get("expected_category"), c.get("expected_decision"),
                     jdump(c.get("must_include") or []), jdump(c.get("must_not_include") or []), c.get("notes"))) and 1
    return n


def run_evaluation(svc) -> dict:
    cases = svc.db.all("SELECT * FROM evaluation_cases ORDER BY key")
    results = []
    for c in cases:
        cls = merge_ai(classify_rules(c["input_text"]), svc.engine.ai_classify(c["input_text"]))
        pre = svc.policy.pre_decision(cls.category, "facebook")
        draft_text, errors, unsupported, lang_ok, decision = "", [], False, True, pre.action
        if pre.action == "draft":
            draft, _hits = svc.engine.generate(c["input_text"], cls, [], c["language"])
            draft_text = draft.text
            errors = draft.validation_errors
            unsupported = any("non presente nelle fonti" in e or "senza fonte" in e for e in errors)
            lang_ok = draft.language == c["language"]
            decision = svc.policy.decide(category=cls.category, channel="facebook", risk_flags=cls.risk_flags,
                                         confidence=draft.confidence, evidence=draft.evidence,
                                         validation_errors=draft.validation_errors,
                                         needs_clarification=draft.needs_clarification, connector_can_publish=True,
                                         connector_authenticated=True, already_published=False).action
        low = draft_text.lower()
        forbidden = [w for w in jload(c["must_not_include"], []) if w.lower() in low]
        missing = [w for w in jload(c["must_include"], []) if w.lower() not in low]
        commercial_fp = cls.intent in ("purchase", "quote") and c["expected_category"] not in ("commercial", "price")
        results.append({
            "key": c["key"], "category": cls.category, "expected_category": c["expected_category"],
            "category_ok": cls.category == c["expected_category"], "decision": decision,
            "expected_decision": c["expected_decision"], "decision_ok": decision == c["expected_decision"],
            "forbidden_found": forbidden, "missing_required": missing, "unsupported": unsupported,
            "language_ok": lang_ok, "commercial_false_positive": commercial_fp, "risk_flags": cls.risk_flags,
            "draft": draft_text,
        })
    n = len(results) or 1
    summary = {
        "cases": len(results),
        "category_accuracy": round(sum(r["category_ok"] for r in results) / n, 3),
        "decision_accuracy": round(sum(r["decision_ok"] for r in results) / n, 3),
        "unsupported_rate": round(sum(r["unsupported"] for r in results) / n, 3),
        "forbidden_term_violations": sum(bool(r["forbidden_found"]) for r in results),
        "commercial_false_positives": sum(r["commercial_false_positive"] for r in results),
        "language_mismatch": sum(not r["language_ok"] for r in results),
        "provider": svc.ai.label,
    }
    svc.db.run("INSERT INTO evaluation_runs (started_at,provider,results,summary) VALUES (?,?,?,?)",
               (now_iso(), svc.ai.label, jdump(results), jdump(summary)))
    return {"summary": summary, "results": results}
