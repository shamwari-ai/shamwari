"""
Does a question need the user's OWN information? (shamwari-ai/shamwari#81)

The server decides this, never the user. This is the first version of that decision: a short
list of deterministic rules, no model, deliberately conservative (when in doubt, yes).

It is an honesty control, not the privacy control. When it says yes and the answer can only be
given from community and platform knowledge, the response says so. A wrong answer in either
direction cannot send personal-layer content to a provider: Cloud holds none, and Core
refuses a personal-scope request bound for Cloud before any call (main.resolve_scope).

The same rules, word for word, are in gateway/src/personal.ts. core/scope_cases.json holds the
cases both suites run, so the two cannot drift apart without a test failing. Core's answer is
authoritative: the gateway may add the notice, it can never remove one Core asked for.
"""

from __future__ import annotations

import re
import unicodedata

# \w is Unicode-aware for str patterns: letters, digits and underscore, as in the TypeScript copy.
_BOUND = r"(?<!\w)(?:{})(?!\w)"

_RULES = [
    re.compile(_BOUND.format(body))
    for body in (
        # English: possessives and first-person contractions.
        r"my|mine|myself|our|ours|ourselves|i'm|i've|i'll|i'd|im|ive",
        # English: "I" followed by something about the speaker's own situation. A bare "I" is
        # not enough ("Can I vote?" is a general question).
        r"i (?:am|was|own|owe|earn|paid|pay|receive|received|lost|bought|sold|saved|spent|uploaded)",
        r"(?:about|for|to|on|with|from) me",
        # English: things only the person holds.
        r"payslips?|bank statements?|medical records?",
        # Shona: possessive -ngu and "ini".
        r"(?:w|y|dz|ch|zv|r|v|kw|p|rw|tw|bw|sw)angu|ini",
        # Shona: first-person verbs.
        r"ndiri|ndine|nda[ck]a\w*|ndichi\w*|ndino\w*|ndiku\w*",
        # Ndebele: possessive -mi and "mina".
        r"(?:w|y|l|z|s|b|kw)ami|mina",
        # Ndebele: first-person verbs.
        r"ngine|ngikhokhile|ngisebenza|ngihlala|ngiyakhokha",
    )
]

_ZERO_WIDTH = re.compile("[​-‍⁠﻿]")
_APOSTROPHES = re.compile("[‘’ʼ`]")
_SPACE = re.compile(r"\s+")


def normalise(text: str) -> str:
    """Fold the cheap evasions: width and case, curly apostrophes, zero-width characters."""
    t = unicodedata.normalize("NFKC", text)
    t = _ZERO_WIDTH.sub("", t)
    t = _APOSTROPHES.sub("'", t)
    return _SPACE.sub(" ", t.lower())


def needs_own_information(text: str) -> bool:
    t = normalise(text)
    return any(r.search(t) for r in _RULES)
