"""Model catalog + classifier for the machines the business ships to Egypt.

The catalog below is the single source of truth. It matches the user's spec
image EXACTLY — do not add "common" variants that aren't listed (e.g. 950G/950H
are intentionally excluded; 950 means only 950 / 950B / 950E).

`classify(title)` takes a full listing title (make + model together) and returns
{'make', 'category', 'model'} when it matches an allowed machine, else None.
Working on the whole title (not a pre-split token) makes it robust to the
different ways each scraper splits make/model.
"""
import re
import hashlib

# category -> make -> { number: [allowed suffixes] }
# An empty-string suffix ('') means the bare number is allowed on its own.
CATALOG = {
    "wheel_loader": {
        "CAT": {
            "980": ["G", "H"],
            "972": ["G", "H"],
            "970": ["F"],
            "966": ["D", "F", "G", "H"],
            "950": ["", "B", "E"],
            "936": ["", "G"],
            "930": [""],
            "926": ["", "E"],
            "920": [""],
            "916": ["", "E"],
            "910": [""],
        },
    },
    "excavator": {
        "CAT": {
            "235": ["", "B", "C", "D"],
            "335": [""],  # rarely, but wanted
        },
        # Doosan excavators are handled separately (numeric range 290-500 + LC/LCV).
    },
    "dump_truck": {
        "CAT": {
            "769": ["", "B", "C", "D"],
        },
    },
}

# Doosan excavators: any 3-digit model 290-500 carrying an LC or LCV suffix.
DOOSAN_MIN, DOOSAN_MAX = 290, 500


def _build_cat_patterns():
    """Compile one anchored regex per (category, make, number) family.

    Anchoring with (?<![A-Z0-9]) / (?![A-Z0-9]) prevents two failure modes:
      - substring hits inside longer numbers (930 inside 9300), and
      - a wrong suffix being accepted as the bare number (950 inside 950G).

    A third failure mode (caught live on Machineryline 2026-07-09): a SPACED
    wrong suffix — "926 M" / "930 G" / "950 GC" are the modern M/G/GC variants,
    not the bare models, but the old pattern matched them as bare. The bare
    branch now refuses a following short suffix-like token (1-2 letters, or
    digits+letter like "14A"), while still accepting real words: "950 WHEEL
    LOADER" stays a bare 950 because WHEEL is not suffix-shaped.
    """
    not_suffix_token = r"(?![\s\-]+(?:[A-Z]{1,2}|\d{1,2}[A-Z])(?![A-Z0-9]))"
    compiled = []
    for category, makes in CATALOG.items():
        for make, families in makes.items():
            for number, suffixes in families.items():
                letters = sorted([s for s in suffixes if s], reverse=True)
                alts = []
                if letters:
                    # allowed suffix, attached or space/dash-separated:
                    # "950B", "950 B", "950-B"
                    alts.append(rf"{number}[\s\-]*(?:{'|'.join(letters)})(?![A-Z0-9])")
                if "" in suffixes:
                    # bare number, NOT followed by a suffix-shaped token
                    alts.append(rf"{number}(?![A-Z0-9]){not_suffix_token}")
                pattern = re.compile(rf"(?<![A-Z0-9])(?:{'|'.join(alts)})")
                compiled.append((category, make, number, pattern))
    return compiled


_CAT_PATTERNS = _build_cat_patterns()

# Doosan: capture a bounded 3-digit number immediately (optional space) before LC/LCV.
_DOOSAN_PATTERN = re.compile(r"(?<!\d)(\d{3})\s*LC(?:V)?(?![A-Z0-9])")


# Terms that indicate the listing is an attachment/part, not a whole machine.
# Deliberately conservative: some (bucket/forks) also appear on real machines, so
# we only reject when NO machine-type word is present (see _looks_like_attachment).
_ATTACHMENT_WORDS = (
    "bucket", "thumb", "coupler", "grapple", "auger", "ripper",
    "quick hitch", "quick coupler", "pallet fork", "forks",
)
_MACHINE_WORDS = ("loader", "excavator", "dozer", "digger", "truck")


def _looks_like_attachment(t_upper):
    """True if the title reads as an attachment/part rather than a machine.

    Heuristic (imperfect by design): an attachment word with no machine-type word.
    "CAT 950 GC BUCKET" -> attachment; "CAT 950 WHEEL LOADER W/ BUCKET" -> machine.
    """
    low = t_upper.lower()
    if any(w in low for w in _ATTACHMENT_WORDS):
        return not any(w in low for w in _MACHINE_WORDS)
    return False


def _canonical(number, matched_text):
    """Return the canonical model token, e.g. '950B', from the matched span."""
    letters = re.sub(r"[^A-Z]", "", matched_text.upper())
    return f"{number}{letters}"


def classify(title):
    """Classify a listing title. Returns {'make','category','model'} or None."""
    if not title:
        return None
    t = title.upper()

    # Reject attachments/parts that merely mention a model number (e.g. a "CAT 950
    # bucket" is not a 950 loader). Only reject when no machine type is named, so a
    # real "950 wheel loader with bucket" still passes.
    if _looks_like_attachment(t):
        return None

    # Word-boundary make detection so "CAT" doesn't false-match inside "LOCATION".
    # \bCAT\d also catches concatenated forms like "CAT950".
    is_cat = bool(re.search(r"\bCAT\b", t) or re.search(r"\bCAT\d", t) or "CATERPILLAR" in t)
    # Doosan must be identified by BRAND (or the Doosan-specific DX### prefix) — never
    # by the bare LC suffix, or we'd mislabel Komatsu/Hyundai/Hitachi ###LC as Doosan.
    is_doosan = ("DOOSAN" in t) or ("DAEWOO" in t) or bool(re.search(r"\bDX\s*\d{3}", t))

    if is_cat:
        for category, make, number, pattern in _CAT_PATTERNS:
            m = pattern.search(t)
            if m:
                return {"make": "CAT", "category": category, "model": _canonical(number, m.group(0))}

    if is_doosan:
        m = _DOOSAN_PATTERN.search(t)
        if m:
            num = int(m.group(1))
            if DOOSAN_MIN <= num <= DOOSAN_MAX:
                model = re.sub(r"\s+", "", m.group(0))  # e.g. "300LC"
                return {"make": "Doosan", "category": "excavator", "model": model}

    return None


def is_allowed_model(make, model=""):
    """Backward-compatible boolean check. Accepts either a full title (in `make`)
    or the legacy (make, model) split — both are concatenated and classified."""
    return classify(f"{make} {model}".strip()) is not None


def stable_id(url, prefix=""):
    """Deterministic listing id derived from the URL.

    Python salts str hashing per process, so the old hash(title+price) produced a
    NEW id every run and re-alerted every listing. A URL-derived digest is stable
    across runs, so dedup and round-robin behave correctly.
    """
    digest = hashlib.sha1((url or "").encode("utf-8")).hexdigest()[:12]
    return f"{prefix}_{digest}" if prefix else digest
