"""Unit tests for mdtoc's pure core functions: extract_headings, slugify,
render_toc. No subprocess, no file I/O — inputs are inline Python strings.
Run with `pytest test_core.py` from apps/mdtoc/ (see plan.md's test-layout
contract).
"""

import mdtoc


# --- extract_headings: heading detection (R2) -----------------------------


def test_heading_levels_in_document_order():
    # AC2.1
    text = "# Title\n## Section A\n### Sub A1\n"
    assert mdtoc.extract_headings(text) == [
        (1, "Title"),
        (2, "Section A"),
        (3, "Sub A1"),
    ]


def test_heading_requires_space_after_hashes():
    # AC2.2 — no space after '#' is not a heading.
    assert mdtoc.extract_headings("#1234\n") == []


def test_heading_seven_hashes_is_not_a_heading():
    # AC2.3 — more than 6 '#' characters is not a heading.
    assert mdtoc.extract_headings("####### Seven\n") == []


# --- extract_headings: fenced code blocks are excluded (R3) ---------------


def test_fence_backtick_excludes_hash_line():
    # AC3.1
    text = "```\n# not a heading\nregular text\n```\n## Real Heading\n"
    assert mdtoc.extract_headings(text) == [(2, "Real Heading")]


def test_fence_tilde_gives_identical_result():
    # AC3.2 — same fixture, tilde fences, identical result.
    text = "~~~\n# not a heading\nregular text\n~~~\n## Real Heading\n"
    assert mdtoc.extract_headings(text) == [(2, "Real Heading")]


# --- slugify: GitHub anchor generation (R4, as amended by plan ADR-4) -----


def test_slug_hello_world():
    # AC4.1
    assert mdtoc.slugify("Hello World") == "hello-world"


def test_slug_apostrophe_removed():
    # AC4.2 — apostrophe removed, not treated as a word boundary.
    assert mdtoc.slugify("Don't Repeat Yourself") == "dont-repeat-yourself"


def test_slug_em_dash_removed_double_space_collapses_to_double_hyphen():
    # AC4.3 — em dash removed; the double space around it becomes '--'.
    assert (
        mdtoc.slugify("1. What v1 changes — and what it must not")
        == "1-what-v1-changes--and-what-it-must-not"
    )


def test_slug_backticks_removed():
    # AC4.4
    assert mdtoc.slugify("Code " + chr(96) + "example" + chr(96)) == "code-example"


def test_slug_underscore_preserved():
    # Underscore preservation (plan ADR-4 as amended at G1 decline; spec R4/
    # AC4.5 now matches this too) — underscores are KEPT, not stripped,
    # matching live GitHub behavior.
    assert mdtoc.slugify("foo_bar baz") == "foo_bar-baz"
    assert mdtoc.slugify("Use snake_case Names") == "use-snake_case-names"


# --- render_toc: duplicate anchor disambiguation (R5) ----------------------


def test_duplicate_anchors_get_numeric_suffixes_in_document_order():
    # AC5.1 — three 'Overview' headings link to #overview, #overview-1,
    # #overview-2, in document order.
    headings = [(1, "Overview"), (2, "Overview"), (3, "Overview")]
    assert mdtoc.render_toc(headings) == (
        "- [Overview](#overview)\n"
        "  - [Overview](#overview-1)\n"
        "    - [Overview](#overview-2)\n"
    )


# --- render_toc: nested list output (R6) -----------------------------------


def test_render_toc_nested_indentation_exact_bytes():
    # AC6.1 — exact four-line string, trailing newline included.
    headings = [
        (1, "Title"),
        (2, "Section A"),
        (3, "Sub A1"),
        (2, "Section B"),
    ]
    assert mdtoc.render_toc(headings) == (
        "- [Title](#title)\n"
        "  - [Section A](#section-a)\n"
        "    - [Sub A1](#sub-a1)\n"
        "  - [Section B](#section-b)\n"
    )


def test_render_toc_indent_from_absolute_level_not_renumbered():
    # AC6.2 — a lone level-3 heading is indented 4 spaces, not renumbered
    # relative to the shallowest level seen.
    assert mdtoc.render_toc([(3, "Deep Start")]) == "    - [Deep Start](#deep-start)\n"


# --- headingless input is not an error (R8) --------------------------------


def test_extract_headings_empty_string_is_empty():
    # AC8.1/AC8.2 (extract_headings side) — empty input yields no headings.
    assert mdtoc.extract_headings("") == []


def test_extract_headings_body_text_with_no_headings_is_empty():
    # AC8.1 — body text with zero ATX headings yields no headings.
    text = "Just some regular text.\nAnother line, no hashes here.\n"
    assert mdtoc.extract_headings(text) == []


def test_render_toc_empty_iterable_is_empty_string():
    # AC8.1/AC8.2 (render_toc side) — zero headings render to zero
    # characters, no trailing newline.
    assert mdtoc.render_toc([]) == ""
