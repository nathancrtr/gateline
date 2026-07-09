"""Unit tests for wordfreq's pure core functions (tokenize, top_words,
format_lines, WORD_RE). Imports the module directly — no subprocess, no CLI
(that is test_cli.py's job). Run with `pytest` from apps/wordfreq/."""

import wordfreq


# --- tokenize (R2) ----------------------------------------------------------

def test_tokenize_strips_surrounding_punctuation():
    """AC2.1 — punctuation around words is not part of the word; repeated
    words differing only by trailing punctuation are still counted."""
    assert wordfreq.tokenize("Hello, hello! World.") == ["hello", "hello", "world"]


def test_tokenize_keeps_internal_apostrophe():
    """AC2.2 — a single internal apostrophe is preserved, not split."""
    assert wordfreq.tokenize("don't stop") == ["don't", "stop"]


def test_tokenize_hyphen_splits_words():
    """AC2.3 — a hyphen acts as a delimiter, not part of a word."""
    assert wordfreq.tokenize("co-located items") == ["co", "located", "items"]


# --- case-insensitive counting (R3) -----------------------------------------

def test_case_insensitive_tokenize_and_count():
    """AC3.1 — words differing only by case are lowercased and aggregated
    into a single reported entry."""
    assert wordfreq.tokenize("The the THE") == ["the", "the", "the"]
    assert wordfreq.top_words(wordfreq.tokenize("The the THE"), 10) == [("the", 3)]


# --- top-N ranking (R4) -----------------------------------------------------

def test_top_n_orders_by_descending_count():
    """AC4.2 — results ordered by count descending, exactly n results
    returned when at least n distinct words exist."""
    tokens = wordfreq.tokenize("a a a b b c")
    assert wordfreq.top_words(tokens, 3) == [("a", 3), ("b", 2), ("c", 1)]


def test_top_n_truncates_and_orders_by_count_not_alphabet():
    """AC4.2 — regression for two ways a wrong implementation can slip past
    poorly-chosen inputs: (1) sorting by word alone, ignoring count, is
    indistinguishable from correct ranking when the correct order also
    happens to be alphabetical; (2) omitting the top-n truncation slice is
    undetectable when the distinct-word count equals n. This input has more
    distinct words (3) than n (2), and the highest-count word ('zebra') is
    alphabetically last, so a count-blind sort and a missing truncation
    slice would each produce a different result and fail this assertion."""
    tokens = wordfreq.tokenize("zebra zebra zebra mango mango apple")
    assert wordfreq.top_words(tokens, 2) == [("zebra", 3), ("mango", 2)]


def test_top_n_larger_than_distinct_words_returns_all_no_padding():
    """AC4.3 — n larger than the distinct-word count returns all words,
    no error, no padding."""
    tokens = wordfreq.tokenize("apple apple banana cherry date")
    result = wordfreq.top_words(tokens, 100)
    assert len(result) == 4
    assert result == [("apple", 2), ("banana", 1), ("cherry", 1), ("date", 1)]


# --- deterministic tie-breaking (R5) ----------------------------------------

def test_tie_breaks_alphabetically_and_is_reproducible():
    """AC5.1 — equal counts ordered alphabetically ascending, and the result
    is identical across repeated calls (deterministic)."""
    tokens = wordfreq.tokenize("zebra apple zebra apple")
    expected = [("apple", 2), ("zebra", 2)]
    assert wordfreq.top_words(tokens, 2) == expected
    assert wordfreq.top_words(tokens, 2) == expected


# --- output format (R6) -----------------------------------------------------

def test_format_lines_tab_separated():
    """AC6.1 — one 'word\\tcount\\n' line per pair, most frequent first."""
    assert wordfreq.format_lines([("cat", 2), ("dog", 1)]) == "cat\t2\ndog\t1\n"


# --- empty / wordless input (R8) --------------------------------------------

def test_empty_string_tokenizes_to_no_words():
    """AC8.1 — an empty string yields no tokens."""
    assert wordfreq.tokenize("") == []


def test_empty_punctuation_only_tokenizes_to_no_words():
    """AC8.2 — punctuation/whitespace-only text yields no tokens."""
    assert wordfreq.tokenize("... !!! ,,,") == []


def test_empty_token_list_yields_no_results():
    """AC8.1/AC8.2 — top_words on an empty token list returns no pairs."""
    assert wordfreq.top_words([], 10) == []


def test_empty_pairs_format_to_empty_string():
    """AC8.1/AC8.2 — format_lines on no pairs returns '' (no lone newline)."""
    assert wordfreq.format_lines([]) == ""
