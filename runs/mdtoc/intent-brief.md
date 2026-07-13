# Intent Brief: mdtoc — Markdown table-of-contents generator

## Problem
Long Markdown documents in this repo (DESIGN.md, ORCHESTRATOR.md, FRONTEND.md)
have no tables of contents, and maintaining one by hand goes stale on every
heading edit. We need a quick way to generate an up-to-date TOC for a Markdown
file from the shell.

## Motivation
Second full v0 pipeline run toward the M1 shadow bar (N=3,
ORCHESTRATOR.md §10); the tool itself is small but genuinely useful for this
repo's long design docs. This run additionally exercises decline recovery and
carries a hand-maintained budget ledger from the first dispatch (standing
items 1–2, shadow-wordfreq.md).

## Constraints
Python 3 (3.9-compatible), stdlib only, single file under `apps/mdtoc/`,
`pytest` for tests. ATX headings (`#` … `######`) only. Output is
GitHub-flavored: list items linking to GitHub's auto-generated heading
anchors.

## Out of scope
Setext (underline) headings; writing the TOC back into the source file
(stdout only); multi-file input; packaging/PyPI; non-GitHub anchor dialects.
(Ignoring `#` lines inside fenced code blocks is *in* scope — a TOC that
lists code comments is wrong output, not a smaller feature.)
