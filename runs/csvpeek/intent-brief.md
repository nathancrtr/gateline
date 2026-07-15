# Intent Brief: CSV Peek

<!-- Contract: all four sections required. Author: a human. Consumer: Analyst.
     This is deliberately informal — it captures what you want, not a spec. -->

## Problem
Given an unfamiliar CSV file, there's no quick way from the shell to see what's
in it: how many rows, what the columns are, what type of data each column holds,
and what the common values look like. Today that means opening it in a
spreadsheet or writing a throwaway pandas snippet.

## Motivation
This is the M2 toy run: the first pipeline run driven end-to-end by the v1
orchestrator (machine dispatch, humans only at gates). The feature is chosen to
be genuinely useful but deliberately small, in the same family as wordfreq,
mdtoc, and dupefind. If we don't do this, M2's exit criterion stays unproven.

## Constraints
Python 3, stdlib only (the `csv` module is fine), single-file CLI under
`apps/csvpeek/`, tests with pytest alongside it. Keep the scope small enough
for a handful of work items — this run exists to exercise the pipeline, not to
build a data-profiling suite. Reads a file path argument; no stdin support
needed. Budget for the run is $30 (see state.yaml).

## Out of scope
Anything resembling real data profiling: histograms, correlations, quantiles,
plotting. Delimiter sniffing beyond what `csv.Sniffer` gives for free. Excel or
JSON input. Very large file streaming/performance work. Packaging or PyPI.
