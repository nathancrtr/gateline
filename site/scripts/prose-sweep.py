#!/usr/bin/env python3
"""Prose sweep for the docs site: tic counts per page, and an invariant diff.

Two modes.

  prose-sweep.py report [site-dir]
      Prints a markdown table per page: hard-rule hits (should be zero) and
      soft counts against their targets, over prose only (code, comments,
      SVG, tables and headings excluded).

  prose-sweep.py invariant <before.html> <after.html>
      Compares the multiset of code spans, link targets, headings, numbers and
      lexicon terms between two versions of a page. Exit 1 if anything moved:
      a rewrite that changed a fact, a name, a path or a term of art is
      rejected here before a human reads it.

The house rules behind the counts are in site/.research/research-prose.md
(the marker catalog and pass protocol) and the maintainer's tic catalog.
"""
import html
import re
import statistics
import sys
from collections import Counter
from pathlib import Path

LEXICON = [
    "gate", "gates", "profile", "profiles", "run", "runs", "arm", "armed",
    "closure", "closed", "reconciler", "Gatehouse", "gateline", "orchestrator",
    "Analyst", "Architect", "Implementer", "Reviewer", "Verifier", "Ops",
    "Historian", "Integrator", "escalation", "escalations", "ledger", "sweep",
    "adapter", "adapters", "contract", "contracts", "manifest", "registry",
    "patch", "standard", "full", "burden", "bounce", "bounced", "dispatch",
]

HARD = {
    "vocabulary": re.compile(
        r"\b(?:leverag\w*|seamless\w*|robust\w*|delv\w+|tapestry|landscapes?|"
        r"game[- ]changer|testament to|cutting[- ]edge|world[- ]class|best[- ]in[- ]class|"
        r"passionate about|at the intersection of|serves? as|stands? as|functions? as)\b", re.I),
    "scaffold": re.compile(
        r"\b(?:worth (?:noting|naming|saying|mentioning)|it'?s worth|note that|here'?s the thing|"
        r"let'?s (?:dive|break)|in this (?:article|section|page)|it'?s important to|keep in mind|"
        r"put simply|simply put|in other words)\b", re.I),
    # Summarising closers only count when they open a sentence; "passing output
    # in summary" is a phrase, not a scaffold.
    "closer-opener": re.compile(r"(?:^|[.!?]\s+)(?:In summary|In conclusion|To summarize|Overall|Ultimately),", re.M),
    "enumerated": re.compile(r"\bFirst,[^.]*\.[^.]*\bSecond,", re.I),
    "hedge-stack": re.compile(r"\b(?:may|might|could)\s+(?:potentially|possibly|arguably)\b", re.I),
    "not-only": re.compile(r"\bnot only\b[^.]*\bbut(?: also)?\b", re.I),
}

SOFT = {
    "contrast": re.compile(r"(?:[,;]|\s[—–-])\s*(?:not|never)\s+(?!only\b)(?:merely\s+|just\s+|simply\s+)?[\w“\"]|\b(?:rather than|instead of)\b"),
    "ing-rider": re.compile(r",\s*(?:ensuring|enabling|allowing|highlighting|underscoring|reflecting|showcasing|emphasizing|fostering|contributing to)\b", re.I),
    "intensifier": re.compile(r"\b(?:precisely|exactly|explicitly|genuinely|truly|crucially|deliberately|literally|actually|really)\b", re.I),
}

SENT_END = re.compile(r"(?<=[.!?])[\"”’)]*\s+(?=[A-Z“\"(])")
WORD = re.compile(r"[A-Za-z][A-Za-z'’-]*")


def content_of(raw: str) -> str:
    m = re.search(r"<!-- content:start -->(.*?)<!-- content:end -->", raw, re.S)
    return m.group(1) if m else raw


def prose_blocks(body: str):
    """Return (paragraph texts, heading texts) with markup, code and comments removed."""
    body = re.sub(r"<!--.*?-->", " ", body, flags=re.S)
    body = re.sub(r"<(pre|svg|script|style|table)\b.*?</\1>", " ", body, flags=re.S | re.I)
    heads = [clean(h) for h in re.findall(r"<h[1-6][^>]*>(.*?)</h[1-6]>", body, flags=re.S | re.I)]
    body = re.sub(r"<h[1-6][^>]*>.*?</h[1-6]>", " ", body, flags=re.S | re.I)
    body = re.sub(r"<code\b[^>]*>.*?</code>", " CODE ", body, flags=re.S | re.I)
    paras = [clean(p) for p in re.findall(r"<(?:p|li|dd|figcaption)\b[^>]*>(.*?)</(?:p|li|dd|figcaption)>", body, flags=re.S | re.I)]
    return [p for p in paras if p], heads


def clean(fragment: str) -> str:
    text = html.unescape(re.sub(r"<[^>]+>", " ", fragment))
    return re.sub(r"\s+", " ", text).strip()


def report(root: Path) -> int:
    pages = sorted(p for p in root.rglob("*.html") if not {"api", "node_modules"} & set(p.relative_to(root).parts))
    rows = []
    hard_total = 0
    for page in pages:
        paras, heads = prose_blocks(content_of(page.read_text(encoding="utf-8")))
        text = " ".join(paras)
        words = len(WORD.findall(text))
        if words < 80:
            continue
        k = words / 1000
        sents = [s for s in SENT_END.split(text) if s.strip()]
        lens = [len(WORD.findall(s)) for s in sents] or [0]
        hard_hits = {name: len(rx.findall(text)) for name, rx in HARD.items()}
        # bold-led bullets and heading repeated as first sentence need markup context
        raw = content_of(page.read_text(encoding="utf-8"))
        hard_hits["bold-led-li"] = len(re.findall(r"<li>\s*<strong>[^<]{2,40}</strong>[:.]?\s", raw))
        hard_hits["heading-echo"] = sum(
            1 for h in heads for p in paras[:1] if h and p.lower().startswith(h.lower()[: max(12, len(h) // 2)])
        )
        hard = sum(hard_hits.values())
        hard_total += hard
        dashes = text.count("—") + text.count(" -- ")
        contrast = len(SOFT["contrast"].findall(text))
        semi2 = sum(1 for s in sents if s.count(";") >= 2)
        closers = 0
        for p in paras:
            ps = [s for s in SENT_END.split(p) if s.strip()]
            if len(ps) >= 3:
                a = {w.lower() for w in WORD.findall(ps[0]) if len(w) > 3}
                b = {w.lower() for w in WORD.findall(ps[-1]) if len(w) > 3}
                if a and b and len(a & b) / len(b) >= 0.6:
                    closers += 1
        rows.append([
            str(page.relative_to(root)), words,
            hard, " ".join(f"{k_}:{v}" for k_, v in hard_hits.items() if v),
            round(dashes / k, 1), round(contrast / k, 1), semi2,
            len(SOFT["ing-rider"].findall(text)), len(SOFT["intensifier"].findall(text)), closers,
            round(statistics.mean(lens), 1), round(statistics.pstdev(lens), 1) if len(lens) > 1 else 0,
            sum(1 for p in paras if len(WORD.findall(p)) > 120),
        ])
    hdr = ["page", "words", "hard", "which", "dash/1k (≤3)", "contrast/1k (≤2)", "semi≥2 (0)",
           "-ing riders (0)", "intens.", "closers", "sent μ", "sent σ", "paras>120w"]
    print("| " + " | ".join(hdr) + " |")
    print("|" + "---|" * len(hdr))
    for r in rows:
        print("| " + " | ".join(str(x) for x in r) + " |")
    return 0


def invariants(path: Path) -> dict:
    raw = content_of(path.read_text(encoding="utf-8"))
    no_comments = re.sub(r"<!--.*?-->", " ", raw, flags=re.S)
    code = Counter(clean(c) for c in re.findall(r"<code\b[^>]*>(.*?)</code>", no_comments, flags=re.S | re.I))
    pre = Counter(clean(c) for c in re.findall(r"<pre\b[^>]*>(.*?)</pre>", no_comments, flags=re.S | re.I))
    links = Counter(re.findall(r'href="([^"]+)"', no_comments))
    heads = Counter(h.lower() for h in [clean(h) for h in re.findall(r"<h[1-6][^>]*>(.*?)</h[1-6]>", no_comments, flags=re.S | re.I)])
    paras, _ = prose_blocks(raw)
    text = " ".join(paras)
    numbers = Counter(re.findall(r"(?<![\w.])\$?\d[\d,.]*%?(?![\w.])", text))
    lex = Counter(w for w in WORD.findall(text) if w in LEXICON)
    return {"code spans": code, "pre blocks": pre, "link targets": links, "headings": heads, "numbers": numbers, "lexicon": lex}


def invariant(before: Path, after: Path) -> int:
    a, b = invariants(before), invariants(after)
    moved = 0
    for kind in a:
        gone = a[kind] - b[kind]
        new = b[kind] - a[kind]
        for item, n in gone.items():
            moved += 1
            print(f"{kind}: removed ×{n}: {item[:100]}")
        for item, n in new.items():
            moved += 1
            print(f"{kind}: added   ×{n}: {item[:100]}")
    if moved:
        print(f"\ninvariant diff: {moved} change(s); the rewrite moved a fact, name, path, number or term", file=sys.stderr)
        return 1
    print("invariant diff: empty")
    return 0


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "invariant" and len(sys.argv) == 4:
        sys.exit(invariant(Path(sys.argv[2]), Path(sys.argv[3])))
    if len(sys.argv) >= 2 and sys.argv[1] == "report":
        sys.exit(report(Path(sys.argv[2]) if len(sys.argv) > 2 else Path(__file__).resolve().parent.parent))
    print(__doc__)
    sys.exit(2)
