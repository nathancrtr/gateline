#!/usr/bin/env python3
"""Fail if a retired name appears in the site's own prose.

The framework was renamed from its working title to gateline, its tooling moved
from Python scripts to packages/, and its CLI from `agentic` to `gateline`. The
docs must use the current names everywhere except inside text quoted from
finished run records (git log output, commit subjects), which keep the author
and wording that wrote them. Those quotes live in <pre> blocks, so this check
strips <pre>...</pre> and HTML comments before searching.

Usage: python3 site/scripts/check-names.py [site-dir]   (exit 1 on any hit)
"""
import re
import sys
from pathlib import Path

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent)

RETIRED = [
    r"\bagentic\b",
    r"agentic-orchestrator",
    r"agentic-runner-agent",
    r"@agentic/",
    r"\.agentic/",
    r"agentic-sandbox",
    r"refs/agentic/",
    r"frontend/packages",
    r"render-agents\.py",
    r"integrate\.py",
    r"FleetView",
    r"\bADS\b",
    r"Agentic Development System",
]
PATTERN = re.compile("|".join(RETIRED))

hits = 0
for path in sorted(ROOT.rglob("*")):
    if path.suffix not in {".html", ".json", ".md"}:
        continue
    rel = path.relative_to(ROOT)
    if rel.parts[0] in {"api", "node_modules", ".research"}:
        continue
    text = path.read_text(encoding="utf-8")
    if path.suffix == ".html":
        text = re.sub(r"<pre\b.*?</pre>", "", text, flags=re.S | re.I)
        # A sentence that names a retired identity on purpose (a note that a
        # finished run keeps its historical author) opts out with this marker.
        text = text.replace("<!-- historical-name -->", "HISTORICAL_NAME_OK")
        text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    for n, line in enumerate(text.splitlines(), 1):
        if "HISTORICAL_NAME_OK" in line:
            continue
        for m in PATTERN.finditer(line):
            hits += 1
            print(f"{rel}:{n}: {m.group(0)}: {line.strip()[:120]}")

if hits:
    print(f"\n{hits} retired-name occurrence(s) outside quoted run history", file=sys.stderr)
    sys.exit(1)
print("check-names: clean")
