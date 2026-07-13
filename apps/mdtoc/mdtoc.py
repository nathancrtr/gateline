"""mdtoc: generate a GitHub-style Markdown table of contents for a file.

Heading rule (R2): ATX headings only — a line starting with 1-6 '#'
characters followed by a space or end of line; lines inside fenced code
blocks (``` or ~~~) are never headings (R3).

Anchor rule (R4 as amended by plan ADR-4, G1 decline): lowercase the
heading text, keep only Unicode letters, digits, spaces, hyphens, and
underscores (underscores are PRESERVED, matching live GitHub), then map
each space to a hyphen. Duplicate anchors within a document get -1, -2,
... suffixes in document order (R5).
"""

import argparse
import re
import sys
from typing import Iterable, Optional, Sequence

HEADING_RE = re.compile(r"^(#{1,6})(?: (.*))?$")


def extract_headings(text: str) -> list[tuple[int, str]]:
    """(level, text) per ATX heading in `text`, in document order (R2).
    Heading text is the remainder after the marker, .strip()ped; a bare
    marker line ('#'..'######') yields text ''. Lines inside fenced code
    blocks are never headings (R3, fence rules in ADR-3). Splits lines via
    str.splitlines(). Returns [] when no headings (R8)."""
    headings = []
    fence_char = None
    fence_len = 0
    for line in text.splitlines():
        if fence_char is None:
            lstripped = line.lstrip()
            if lstripped[:3] == "```" or lstripped[:3] == "~~~":
                ch = lstripped[0]
                run_len = len(lstripped) - len(lstripped.lstrip(ch))
                if run_len >= 3:
                    fence_char = ch
                    fence_len = run_len
                    continue
            match = HEADING_RE.match(line)
            if match:
                level = len(match.group(1))
                heading_text = (match.group(2) or "").strip()
                headings.append((level, heading_text))
        else:
            stripped = line.strip()
            run_len = len(stripped) - len(stripped.lstrip(fence_char))
            if stripped and run_len == len(stripped) and run_len >= fence_len:
                fence_char = None
                fence_len = 0
    return headings


def slugify(text: str) -> str:
    """Base GitHub anchor for one heading's text (R4 as amended by ADR-4):
    lowercase, drop every char that is not a Unicode letter, digit, space,
    hyphen, or underscore — underscores are PRESERVED, matching live GitHub
    (G1 decline direction; mechanism in ADR-4) — then map each space to a
    hyphen. No duplicate handling here."""
    lowered = text.lower()
    kept = "".join(ch for ch in lowered if ch.isalpha() or ch.isdigit() or ch in " -_")
    return kept.replace(" ", "-")


def render_toc(headings: Iterable[tuple[int, str]]) -> str:
    """The full TOC: one '<indent>- [<text>](#<anchor>)\\n' line per heading,
    indent = '  ' * (level - 1) from the absolute level (R6, AC6.2). Anchors
    are slugify(text) with duplicates suffixed -1, -2, ... in document order
    (R5, ADR-5). Returns '' for an empty iterable — zero characters (R8)."""
    counts = {}
    lines = []
    for level, text in headings:
        base = slugify(text)
        count = counts.get(base, 0)
        counts[base] = count + 1
        anchor = base if count == 0 else "{}-{}".format(base, count)
        indent = "  " * (level - 1)
        lines.append("{}- [{}](#{})\n".format(indent, text, anchor))
    return "".join(lines)


def main(argv: Optional[Sequence[str]] = None) -> int:
    """Full CLI. argv excludes the program name (None -> sys.argv[1:]).
    Returns the exit code; never raises for anticipated errors (R7)."""
    parser = argparse.ArgumentParser(prog="mdtoc.py")
    parser.add_argument("file")
    args = parser.parse_args(argv)

    try:
        with open(args.file, encoding="utf-8") as f:
            text = f.read()
    except (OSError, UnicodeDecodeError) as exc:
        sys.stderr.write("mdtoc.py: error: {}\n".format(exc))
        return 1

    sys.stdout.write(render_toc(extract_headings(text)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
