"""Word frequency CLI: a word is a maximal run of alphanumeric characters,
optionally containing a single internal apostrophe (e.g. "don't"); hyphens
and all other punctuation/whitespace are delimiters (R2)."""

import re
from collections import Counter
from typing import Iterable

WORD_RE = re.compile(r"[^\W_]+(?:'[^\W_]+)?")


def tokenize(text: str) -> list[str]:
    """All word tokens in `text`, lowercased, in order of appearance.
    A word is a maximal run of alphanumeric characters optionally containing
    ONE internal apostrophe (R2, R3). Returns [] for wordless text (R8)."""
    return [match.lower() for match in WORD_RE.findall(text)]


def top_words(tokens: Iterable[str], n: int) -> list[tuple[str, int]]:
    """At most `n` (word, count) pairs, ordered by count descending, then word
    ascending (R4, R5). Fewer than `n` pairs if fewer distinct words exist.
    Requires n >= 1 (caller validates)."""
    counts = Counter(tokens)
    return sorted(counts.items(), key=lambda pair: (-pair[1], pair[0]))[:n]


def format_lines(pairs: Iterable[tuple[str, int]]) -> str:
    """One 'word\\tcount\\n' line per pair, concatenated, in given order (R6).
    Returns '' for an empty iterable — no trailing or lone newline (R8)."""
    return "".join(f"{word}\t{count}\n" for word, count in pairs)
