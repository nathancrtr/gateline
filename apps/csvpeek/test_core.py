"""Unit tests for csvpeek's pure core functions (parse_csv, detect_delimiter,
column_values, infer_type, count_missing, top_values, format_report). Imports
the module directly — no subprocess, no CLI (that is test_cli.py's job). Run
with `pytest` from apps/csvpeek/."""

import csvpeek


# --- row_count (R2) ----------------------------------------------------------

def test_row_count_header_and_five_rows():
    """AC2.1 — a header line plus 5 data rows yields len(rows) == 5; the
    header row is not counted as data."""
    text = "name,age\na,1\nb,2\nc,3\nd,4\ne,5\n"
    header, rows = csvpeek.parse_csv(text)
    assert header == ["name", "age"]
    assert len(rows) == 5


def test_row_count_header_only_is_zero_rows():
    """AC2.2 — a header line with no data rows reports rows == []."""
    header, rows = csvpeek.parse_csv("name,age\n")
    assert header == ["name", "age"]
    assert rows == []


def test_row_count_empty_text_yields_no_header_no_rows():
    """AC10.1 — parse_csv('') -> ([], [])."""
    assert csvpeek.parse_csv("") == ([], [])


# --- columns (R3) -------------------------------------------------------------

def test_columns_are_listed_in_header_order():
    """AC3.1 — header 'name,age,city' -> ['name', 'age', 'city'] in order."""
    header, _ = csvpeek.parse_csv("name,age,city\na,1,x\n")
    assert header == ["name", "age", "city"]


# --- delimiter (R4) -----------------------------------------------------------

def test_delimiter_detects_semicolon_and_parses_three_columns():
    """AC4.1 — a semicolon-delimited sample is detected as ';' and parse_csv
    yields 3 columns, not one column of literal semicolons."""
    text = "name;age;city\na;1;x\n"
    assert csvpeek.detect_delimiter(text) == ";"
    header, rows = csvpeek.parse_csv(text)
    assert header == ["name", "age", "city"]
    assert rows == [["a", "1", "x"]]


def test_delimiter_comma_baseline_still_works():
    """AC4.2 — a standard comma-delimited file is still parsed correctly."""
    text = "name,age,city\na,1,x\n"
    assert csvpeek.detect_delimiter(text) == ","
    header, rows = csvpeek.parse_csv(text)
    assert header == ["name", "age", "city"]
    assert rows == [["a", "1", "x"]]


def test_delimiter_empty_text_falls_back_to_comma():
    """spec Assumptions — empty text falls back to ',' rather than erroring."""
    assert csvpeek.detect_delimiter("") == ","


def test_delimiter_pathological_quote_input_never_raises():
    """ADR-11 — Sniffer can return a delimiter (e.g. '"', which collides with
    csv's default quotechar) that csv.reader refuses to construct with on
    some interpreters. detect_delimiter's amended guarantee: the returned
    delimiter is always accepted by csv.reader construction on the running
    interpreter, and neither detect_delimiter nor parse_csv ever raises —
    interpreter-portable, so this must not hardcode the returned character.
    Deleting the ADR-11 probe/fallback step (or restoring the pre-amendment
    'follows Sniffer as-is' behavior) makes this raise ValueError on
    interpreters (e.g. 3.14.6) that reject delimiter == quotechar."""
    import csv

    for text in ('"', '"""'):
        delimiter = csvpeek.detect_delimiter(text)
        csv.reader([], delimiter=delimiter)  # the guarantee itself
        csvpeek.parse_csv(text)  # must not raise ValueError either


# --- type (R5) -----------------------------------------------------------------

def test_type_all_integer_values_reports_integer():
    """AC5.1 — every non-blank value is a base-10 integer literal."""
    assert csvpeek.infer_type(["1", "2", "-3"]) == "integer"


def test_type_mixed_int_and_float_reports_float():
    """AC5.2 — at least one non-integer numeric value, the rest
    integer-parseable, reports 'float'."""
    assert csvpeek.infer_type(["1.5", "2", "3"]) == "float"


def test_type_non_numeric_values_report_string():
    """AC5.3 — a column of non-numeric values reports 'string'."""
    assert csvpeek.infer_type(["a", "b", "c"]) == "string"


def test_type_mixed_numeric_and_non_numeric_reports_string():
    """AC5.3 — a mixed set of one non-numeric and numeric values reports
    'string' (any unparseable value forces string)."""
    assert csvpeek.infer_type(["1", "a", "3"]) == "string"


def test_type_whitespace_only_value_is_not_blank_and_forces_string():
    """spec Assumption — blank means exactly '', not whitespace-only, so a
    whitespace-only value is judged as a real (non-numeric) value, not
    excluded from the type check like a blank would be. infer_type(["1", " "])
    forces 'string' because ' ' fails int()/float() parsing. A single-space-
    only input (e.g. infer_type([" "])) can't discriminate the exact-blank
    rule from a strip()-based one — both empty-non-blank-set paths return
    'string' — so a non-blank numeric value must be paired with it, per
    review-03.md F4."""
    assert csvpeek.infer_type(["1", " "]) == "string"


def test_type_blank_values_excluded_still_reports_integer():
    """AC6.2 — a blank value does not, by itself, force a column's type down
    to 'string'; type is judged over non-blank values only."""
    assert csvpeek.infer_type(["1", "", "3"]) == "integer"


def test_type_no_non_blank_values_reports_string():
    """AC10.2 support — a column with no non-blank values (e.g. an empty
    column, or all-blank) reports 'string', not an error."""
    assert csvpeek.infer_type([]) == "string"
    assert csvpeek.infer_type(["", "", ""]) == "string"


# --- missing (R6) ---------------------------------------------------------------

def test_missing_counts_blank_entries():
    """AC6.1 — count_missing(['1', '', '3']) == 1."""
    assert csvpeek.count_missing(["1", "", "3"]) == 1


def test_missing_all_blank_counts_every_entry():
    """AC6.1 — an all-blank column counts every entry as missing."""
    assert csvpeek.count_missing(["", "", ""]) == 3


def test_missing_no_blank_entries_counts_zero():
    """AC6.1 — a column with no blank entries reports 0 missing."""
    assert csvpeek.count_missing(["1", "2", "3"]) == 0


def test_missing_whitespace_only_value_is_not_blank():
    """spec Assumption — blank means exactly '', not whitespace-only (no
    .strip()); a single space is not counted as missing."""
    assert csvpeek.count_missing([" "]) == 0
    assert csvpeek.count_missing([" ", "", "1"]) == 1


# --- common (R7) ------------------------------------------------------------------

def test_common_ranks_by_descending_count():
    """AC7.1 — 10 occurrences of 'x', 5 of 'y', 1 of 'z' ranks 'x' first with
    count 10, ahead of 'y' and 'z'."""
    values = ["x"] * 10 + ["y"] * 5 + ["z"]
    result = csvpeek.top_values(values)
    assert result[0] == ("x", 10)
    assert result == [("x", 10), ("y", 5), ("z", 1)]


def test_common_bounded_to_at_most_five_of_seven_distinct():
    """AC7.2 — more than 5 distinct values lists at most 5 pairs (bounded
    top-N, not a full histogram). Pinned to the exact expected 5-pair list
    (not just its length) so a truncation-bound mutant (e.g. TOP_N=4) is
    caught: all seven values tie at count 1, so the surviving five are the
    five lexicographically-smallest ('a'..'e'), in ascending order."""
    values = ["a", "b", "c", "d", "e", "f", "g"]
    result = csvpeek.top_values(values)
    assert result == [("a", 1), ("b", 1), ("c", 1), ("d", 1), ("e", 1)]


def test_common_ties_order_ascending_by_value_and_are_reproducible():
    """spec tie-break assumption — equal counts order by ascending value
    (lexicographic), and the result is identical across two calls
    (deterministic)."""
    values = ["zebra", "apple", "zebra", "apple"]
    expected = [("apple", 2), ("zebra", 2)]
    assert csvpeek.top_values(values) == expected
    assert csvpeek.top_values(values) == expected


def test_common_ties_order_lexicographically_even_for_numeric_looking_values():
    """plan top_values contract / ADR-6 — the tie-break is lexicographic on
    the string, even when the values look numeric: '10' sorts before '2'
    because '1' < '2' as a character, not because 10 < 2 numerically. A
    numeric-aware tie key would instead order '2' before '10'."""
    values = ["10", "2", "10", "2"]
    assert csvpeek.top_values(values) == [("10", 2), ("2", 2)]


def test_common_whitespace_only_value_is_not_treated_as_blank():
    """spec Assumption — blank means exactly '', not whitespace-only,
    everywhere the blank rule applies, including top_values: a single space
    is ranked as its own value rather than silently excluded as blank."""
    result = csvpeek.top_values([" ", " ", "x"])
    assert result == [(" ", 2), ("x", 1)]


# --- ragged (R8) -------------------------------------------------------------------

def test_ragged_short_row_kept_and_included_in_parse_csv_row_count():
    """AC8.1 — parse_csv keeps a ragged row (fewer fields than the header)
    as its own row rather than dropping it, so that row is included in the
    row count; padding to the header length is column_values' job, not
    parse_csv's (plan parse_csv contract: 'kept exactly as csv.reader
    yields them')."""
    header, rows = csvpeek.parse_csv("a,b,c\nx,y\n")
    assert header == ["a", "b", "c"]
    assert len(rows) == 1
    assert rows == [["x", "y"]]


def test_ragged_short_row_padded_with_blank():
    """AC8.1 semantics — a row with fewer fields than the header is padded
    with '' for the missing trailing column(s)."""
    header = ["name", "age", "city"]
    rows = [["a", "1"]]
    columns = csvpeek.column_values(header, rows)
    assert columns == [["a"], ["1"], [""]]


def test_ragged_extra_fields_beyond_header_are_ignored():
    """AC8.1 semantics — a row with more fields than the header has the
    extra fields ignored for column reporting."""
    header = ["name", "age"]
    rows = [["a", "1", "extra"]]
    columns = csvpeek.column_values(header, rows)
    assert columns == [["a"], ["1"]]


# --- format (R10 exact report) ------------------------------------------------------

def test_format_report_empty_is_exact_two_lines():
    """AC10.1 — format_report([], []) == 'Rows: 0\\nColumns: 0\\n' exactly."""
    assert csvpeek.format_report([], []) == "Rows: 0\nColumns: 0\n"


def test_format_report_header_only_lists_columns_with_string_type_no_common():
    """AC10.2 — header with no data rows lists both columns, reports Rows: 0,
    type 'string' for each, and 'Common: (none)', without raising."""
    result = csvpeek.format_report(["a", "b"], [])
    assert "Rows: 0" in result
    assert "Columns: 2" in result
    assert "Column: a" in result
    assert "Column: b" in result
    assert result.count("Type: string") == 2
    assert result.count("Common: (none)") == 2


def test_format_report_populated_fixture_is_byte_exact():
    """One small populated fixture asserted byte-exactly against plan.md
    'Report format'."""
    header = ["name", "age"]
    rows = [["x", "1"], ["y", "1"], ["z", ""]]
    expected = (
        "Rows: 3\n"
        "Columns: 2\n"
        "\n"
        "Column: name\n"
        "  Type: string\n"
        "  Missing: 0\n"
        "  Common: x (1), y (1), z (1)\n"
        "\n"
        "Column: age\n"
        "  Type: integer\n"
        "  Missing: 1\n"
        "  Common: 1 (2)\n"
    )
    assert csvpeek.format_report(header, rows) == expected
