"""Word frequency CLI: a word is a maximal run of alphanumeric characters,
optionally containing a single internal apostrophe (e.g. "don't"); hyphens
and all other punctuation/whitespace are delimiters (R2)."""

import argparse
import re
import sys
from collections import Counter
from typing import Iterable, Optional, Sequence

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


def positive_int(value: str) -> int:
    """argparse type= converter; raises argparse.ArgumentTypeError for < 1."""
    n = int(value)
    if n < 1:
        raise argparse.ArgumentTypeError(f"{value!r} is not a positive integer")
    return n


def main(argv: Optional[Sequence[str]] = None) -> int:
    """Full CLI. argv excludes the program name (None → sys.argv[1:]).
    Returns the process exit code; never raises for anticipated errors (R7)."""
    parser = argparse.ArgumentParser(prog="wordfreq.py")
    parser.add_argument("file", help="path to the text file to analyze")
    parser.add_argument(
        "-n",
        "--top",
        dest="n",
        type=positive_int,
        default=10,
        help="number of top words to report (default: 10)",
    )
    args = parser.parse_args(argv)

    try:
        with open(args.file, encoding="utf-8") as f:
            text = f.read()
    except (OSError, UnicodeDecodeError) as exc:
        print(f"wordfreq.py: error: {exc}", file=sys.stderr)
        return 1

    sys.stdout.write(format_lines(top_words(tokenize(text), args.n)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
