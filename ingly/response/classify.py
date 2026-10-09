"""Classificazione deterministica di post/commenti (it/en).

Le regole girano sempre: definiscono i segnali di rischio anche quando c'è un modello AI,
così la sicurezza non dipende dal giudizio del modello.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

CATEGORIES = ["technical", "compatibility", "price", "commercial", "demo_course", "problem", "complaint",
              "misinformation", "sensitive", "spam", "other"]
INTENTS = ["purchase", "research", "support", "course", "demo", "quote", "complaint", "other"]

PATTERNS: dict[str, list[str]] = {
    "price": [r"\bprezz", r"quanto cost", r"\bcost[ao]\b", r"\bsconto", r"\bpromo", r"\bofferta", r"€", r"\beur[o]?\b",
              r"\bprice\b", r"how much", r"\bdiscount", r"\bcoupon", r"black friday"],
    "purchase": [r"vorrei (comprare|acquistare|prendere)", r"voglio (comprare|acquistare|prendere)", r"devo (comprare|acquistare)",
                 r"sto per (comprare|acquistare|ordinare)", r"\bacquist", r"\bcomprare\b", r"\bordinare\b", r"dove (lo )?compro",
                 r"want to buy", r"\bbuy(ing)?\b", r"\bpurchas", r"\border(ing)?\b"],
    "research": [r"\bcerco\b", r"sto cercando", r"consigli", r"quale (macchina|laser|modello)", r"meglio (il|la|lo)?",
                 r"\bdifferenz", r"\bconfronto\b", r"\bvs\.?\b", r"per (iniziare|cominciare)", r"principiante", r"primo laser",
                 r"\brecommend", r"which (one|machine|laser)", r"\bbeginner", r"\bcompare\b", r"difference between"],
    "compatibility": [r"compatibil", r"funziona (con|su)", r"si (può|puo) (montare|usare|collegare)", r"va bene (con|per|su)",
                      r"\bcompatible\b", r"work(s)? with", r"fit(s)? (on|the)"],
    "problem": [r"non funziona", r"\bproblem", r"\berror", r"non (taglia|incide|si accende|si collega|parte|legge)",
                r"\bbloccat", r"\bguast", r"\brotto\b", r"\bfirmware\b", r"calibraz", r"messa a fuoco", r"\bdisconnect",
                r"not working", r"doesn'?t (work|cut|engrave|connect)", r"\bbroken\b", r"\bissue\b", r"\bfail"],
    "support_help": [r"\baiuto\b", r"\bhelp\b", r"come (si fa|faccio|posso)", r"\bparametr", r"impostazion", r"\bsettings?\b",
                     r"how (do|can) i", r"\bxcs\b", r"creative space", r"lightburn"],
    "course": [r"\bcors[oi]\b", r"\bformazione\b", r"\blezion", r"\btutorial\b", r"\bimparare\b", r"\bworkshop\b",
               r"\bcourse\b", r"\btraining\b", r"\blearn\b"],
    "demo": [r"\bdemo\b", r"\bprova(rla|re)?\b dal vivo", r"vedere (la macchina|dal vivo)", r"\bshowroom\b", r"test (su|del) material",
             r"\bin person\b"],
    "quote": [r"\bpreventiv", r"\bquotazion", r"\bquote\b", r"\bfattur", r"partita iva", r"\binvoice\b"],
    "complaint": [r"\bvergogn", r"\btruffa", r"\bschifo", r"\bpessim", r"\bdeluso", r"\brimborso", r"\breclamo",
                  r"non (rispondono|risponde) (mai|nessuno)", r"assistenza (inesistente|pessima)", r"\bscam\b", r"\brefund",
                  r"\bterrible\b", r"\bdisappointed", r"\bworst\b"],
    "b2b": [r"\bazienda\b", r"\bproduzione\b", r"\bnegozio\b", r"\blaboratorio\b", r"\bin serie\b", r"\bgrandi quantit",
            r"\bpartita iva\b", r"\bbusiness\b", r"\bcompany\b", r"\bproduction\b", r"\bwholesale"],
    "budget": [r"\bbudget\b", r"\d+\s?(€|euro|eur)\b", r"€\s?\d+", r"spendere", r"\bspend\b"],
    "spam": [r"https?://(?!([\w.-]*\.)?xtool\.(com|eu))\S+.*\b(guadagn|earn|crypto|bitcoin|forex|casino)",
             r"\b(whatsapp|telegram)\b.*\+?\d{8,}", r"\bguadagna\b.*\bda casa\b", r"\bfollow (me|back)\b",
             r"\bclick (here|the link)\b", r"\bdm me\b"],
}
RISK_PATTERNS: dict[str, list[str]] = {
    "safety_fire": [r"\bfiamm", r"\bincendi", r"\bfuoco\b", r"\bfire\b", r"\bflame", r"prende fuoco", r"caught fire"],
    "safety_materials": [r"\bpvc\b", r"\bvinil", r"\bcloro", r"\bpolicarbonato\b", r"\bfumi tossic", r"\btoxic\b",
                         r"\bfumes\b", r"\bpolycarbonate\b"],
    "safety_bypass": [r"bypass", r"disattiv\w* (il |la |lo )?(sensore|sicurezz|interlock|coperchio)", r"senza (coperchio|occhiali)",
                      r"disable (the )?(sensor|interlock|safety)", r"without (glasses|goggles|lid)"],
    "injury": [r"\bustion", r"\bbruciat\w* (la|il|le|mano|occhi)", r"\bferit", r"\bocchi\b.*\b(male|bruci)", r"\binjur", r"\bburned my\b"],
    "legal": [r"\bavvocat", r"\bdenunc", r"\bcausa legale", r"\bcodacons", r"\blawyer", r"\bsue\b", r"\blegal action"],
    "personal_data": [r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", r"(?<!\d)\+?\d[\d .-]{8,}\d(?!\d)",
                      r"\biban\b", r"\bcodice fiscale\b"],
    "prompt_injection": [r"ignora (le|tutte le) (istruzioni|regole)", r"ignore (all |the )?(previous|prior|above) (instructions|rules)",
                         r"system prompt", r"you are now", r"ora sei\b", r"act as\b", r"\bjailbreak", r"rispondi solo con",
                         r"</?(system|instructions|contenuto_esterno)>", r"developer mode"],
    "misinformation": [r"xtool (è|e') fallit", r"xtool (has )?gone bankrupt", r"non (fanno|danno) (più )?garanzia",
                       r"(tutti|tutte) (i|le) .* (sono|è) (cancerogen|velenos)"],
    "aggression": [r"\bidiot", r"\bcretin", r"\bstupid", r"\bvaffan", r"\bfuck", r"\bmerd"],
}


def _hits(text: str, pats: list[str]) -> list[str]:
    out = []
    for p in pats:
        m = re.search(p, text, re.I)
        if m:
            out.append(m.group(0))
    return out


@dataclass
class Classification:
    category: str
    intent: str
    priority: str
    risk_flags: list[str] = field(default_factory=list)
    signals: dict[str, list[str]] = field(default_factory=dict)
    lead_category: str | None = None
    is_question: bool = False
    source: str = "rules"

    def as_dict(self) -> dict:
        return self.__dict__.copy()


def classify_rules(text: str) -> Classification:
    t = text.strip()
    sig = {k: _hits(t, v) for k, v in PATTERNS.items()}
    sig = {k: v for k, v in sig.items() if v}
    risks = [k for k, pats in RISK_PATTERNS.items() if _hits(t, pats)]
    is_question = "?" in t or bool(re.match(r"^(come|quale|quali|qual|dove|quando|perch|chi|cosa|che|how|which|what|where|why|can|does|is)\b", t, re.I)) \
        or bool(sig.get("research") or sig.get("support_help"))

    if sig.get("spam"):
        cat = "spam"
    elif "misinformation" in risks:
        cat = "misinformation"
    elif sig.get("complaint") or "legal" in risks:
        cat = "complaint"
    elif {"safety_fire", "safety_bypass", "injury"} & set(risks):
        cat = "sensitive"
    elif sig.get("problem"):
        cat = "problem"
    elif sig.get("compatibility"):
        cat = "compatibility"
    elif sig.get("demo") or sig.get("course"):
        cat = "demo_course"
    elif sig.get("price") and not sig.get("research"):
        cat = "price"
    elif sig.get("purchase") or sig.get("quote") or (sig.get("price") and sig.get("research")):
        cat = "commercial"
    elif sig.get("research") or sig.get("support_help") or is_question:
        cat = "technical"
    else:
        cat = "other"

    if cat == "spam":
        intent = "other"
    elif sig.get("quote"):
        intent = "quote"
    elif sig.get("demo"):
        intent = "demo"
    elif sig.get("course"):
        intent = "course"
    elif cat == "complaint":
        intent = "complaint"
    elif sig.get("purchase") or sig.get("price"):
        intent = "purchase"
    elif sig.get("research"):
        intent = "research"
    elif cat in ("problem", "technical", "compatibility", "sensitive"):
        intent = "support"
    else:
        intent = "other"

    if cat in ("complaint", "sensitive", "misinformation") or intent in ("quote", "purchase", "demo"):
        priority = "high"
    elif cat in ("spam", "other"):
        priority = "low"
    else:
        priority = "medium"

    return Classification(cat, intent, priority, risks, sig, lead_category_for(cat, intent, sig), is_question)


def lead_category_for(category: str, intent: str, sig: dict) -> str | None:
    if category in ("spam", "complaint", "misinformation") or intent == "other" and category == "other":
        return None
    if sig.get("b2b") and intent in ("purchase", "quote", "research"):
        return "b2b"
    return {"quote": "quote", "demo": "demo", "course": "course", "purchase": "machine",
            "research": "machine", "support": "support"}.get(intent, "curious")


# Categorie con segnali espliciti nel testo: l'AI non le sovrascrive.
RULE_DOMINANT = {"commercial", "price", "demo_course", "compatibility", "problem", "complaint", "sensitive",
                 "misinformation", "spam"}
EXPLICIT_INTENTS = {"quote", "purchase", "demo", "course", "complaint"}


def merge_ai(cls: Classification, ai: dict | None) -> Classification:
    """L'AI affina i casi ambigui (technical/other) ma non annulla segnali espliciti né i rischi."""
    if not ai or ai.get("category") not in CATEGORIES:
        return cls
    cls.source = "rules+ai"
    if cls.category in RULE_DOMINANT:
        return cls
    cls.category = ai["category"]
    if cls.intent not in EXPLICIT_INTENTS and ai.get("intent") in INTENTS:
        cls.intent = ai["intent"]
    if cls.category in ("complaint", "sensitive", "misinformation"):
        cls.priority = "high"
    cls.lead_category = lead_category_for(cls.category, cls.intent, cls.signals)
    return cls
