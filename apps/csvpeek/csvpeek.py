"""csvpeek: a quick-peek profiler for CSV files.

Reports, per invocation: the total row count and column count, and for each
column (in header order) its inferred type (integer/float/string), its
missing-value count, and its most common non-blank values (up to TOP_N).

Blank rule: a field is blank iff it is exactly '' after CSV parsing (no
whitespace trimming).
"""

import argparse
import csv
import io
import sys
from collections import Counter
from typing import Optional, Sequence

TOP_N = 5


def detect_delimiter(text: str) -> str:
    """Delimiter of the CSV in `text`, via csv.Sniffer().sniff(text).delimiter
    over the whole text, validated against csv.reader. Returns ',' when text
    is empty, when Sniffer raises csv.Error, or when the sniffed delimiter is
    rejected by csv.reader — validation is the probe
    csv.reader([], delimiter=<sniffed>) with TypeError/ValueError treated as
    rejection (ADR-11; R4 + spec fallback assumption). Guarantee: the
    returned delimiter is always accepted by csv.reader construction on the
    running interpreter. Never raises."""
    if not text:
        return ","
    try:
        delimiter = csv.Sniffer().sniff(text).delimiter
    except csv.Error:
        return ","
    try:
        csv.reader([], delimiter=delimiter)
    except (TypeError, ValueError):
        return ","
    return delimiter


def parse_csv(text: str) -> tuple[list[str], list[list[str]]]:
    """(header, data_rows). Records come from csv.reader over
    io.StringIO(text, newline='') with delimiter=detect_delimiter(text).
    The first record is the header; all remaining records are data rows,
    kept exactly as csv.reader yields them (ragged rows NOT normalized
    here — that is column_values' job). '' -> ([], []) (R2, R3, R8, R10)."""
    if not text:
        return [], []
    delimiter = detect_delimiter(text)
    reader = csv.reader(io.StringIO(text, newline=""), delimiter=delimiter)
    records = list(reader)
    if not records:
        return [], []
    header = records[0]
    rows = records[1:]
    return header, rows


def column_values(header: list[str], rows: list[list[str]]) -> list[list[str]]:
    """One list per header column, aligned to the rows: result[i][r] is row
    r's field for column i, or '' when row r has fewer fields (R8 + spec
    ragged assumption); fields beyond len(header) are ignored.
    len(result) == len(header); each inner list has len(rows) entries."""
    result: list[list[str]] = [[] for _ in header]
    for row in rows:
        for i in range(len(header)):
            result[i].append(row[i] if i < len(row) else "")
    return result


def infer_type(values: list[str]) -> str:
    """'integer' | 'float' | 'string', judged over the non-blank values only
    (blank == '' exactly; AC6.2). 'integer' iff every non-blank value parses
    via int(); 'float' iff every non-blank value parses via float() and at
    least one does not parse via int(); otherwise 'string'. A column with no
    non-blank values is 'string' (ADR-5; supports AC10.2)."""
    non_blank = [v for v in values if v != ""]
    if not non_blank:
        return "string"

    def is_int(v: str) -> bool:
        try:
            int(v)
            return True
        except ValueError:
            return False

    def is_float(v: str) -> bool:
        try:
            float(v)
            return True
        except ValueError:
            return False

    if all(is_int(v) for v in non_blank):
        return "integer"
    if all(is_float(v) for v in non_blank) and any(not is_int(v) for v in non_blank):
        return "float"
    return "string"


def count_missing(values: list[str]) -> int:
    """Number of entries exactly equal to '' (R6)."""
    return sum(1 for v in values if v == "")


def top_values(values: list[str], n: int = TOP_N) -> list[tuple[str, int]]:
    """At most `n` (value, count) pairs over the non-blank values, ordered by
    count descending then value ascending (lexicographic on the string, even
    for numeric-looking values) (R7 + spec tie-break assumption). [] when
    there are no non-blank values."""
    non_blank = [v for v in values if v != ""]
    counter = Counter(non_blank)
    return sorted(counter.items(), key=lambda p: (-p[1], p[0]))[:n]


def format_report(header: list[str], rows: list[list[str]]) -> str:
    """The full plain-text report in the exact format below, composing
    column_values/infer_type/count_missing/top_values (R2–R7, R10)."""
    lines = [f"Rows: {len(rows)}", f"Columns: {len(header)}"]
    columns = column_values(header, rows)
    for name, values in zip(header, columns):
        lines.append("")
        lines.append(f"Column: {name}")
        lines.append(f"  Type: {infer_type(values)}")
        lines.append(f"  Missing: {count_missing(values)}")
        common = top_values(values)
        if common:
            common_str = ", ".join(f"{v} ({c})" for v, c in common)
        else:
            common_str = "(none)"
        lines.append(f"  Common: {common_str}")
    return "".join(line + "\n" for line in lines)


def main(argv: Optional[Sequence[str]] = None) -> int:
    """Full CLI. argv excludes the program name (None -> sys.argv[1:]).
    Returns the process exit code; never raises for anticipated errors (R9)."""
    parser = argparse.ArgumentParser(prog="csvpeek.py")
    parser.add_argument("file")
    args = parser.parse_args(argv)

    try:
        with open(args.file, encoding="utf-8", newline="") as f:
            text = f.read()
    except (OSError, UnicodeDecodeError) as e:
        print(f"csvpeek.py: error: {e}", file=sys.stderr)
        return 1

    header, rows = parse_csv(text)
    sys.stdout.write(format_report(header, rows))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
