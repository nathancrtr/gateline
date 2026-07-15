# Intent Brief: dupefind — duplicate-file finder

## Problem
Directories accumulate byte-identical files under different names — download
copies, photo exports, versioned attachments. Finding them by eye is
impossible; we need a shell tool that reports groups of duplicate files under
a directory tree.

## Motivation
Third full v0 pipeline run toward the M1 shadow bar (N=3, ORCHESTRATOR.md
§10). With the ledger maintained from the first dispatch, this run's budget
pre-flight arithmetic runs against real spend instead of `cost_spent_usd: 0`
(standing item 2, shadow-wordfreq.md).

## Constraints
Python 3 (3.9-compatible), stdlib only, single file under `apps/dupefind/`,
`pytest` for tests. Detection by file size then SHA-256 of contents — no
false positives by construction. Output: one group per duplicate set, paths
sorted, empty files excluded by default.

## Out of scope
Deleting, hardlinking, or otherwise acting on duplicates (report only);
following symlinks; perceptual/fuzzy matching (images that "look the same");
interactive mode; cross-filesystem deduplication semantics; packaging/PyPI.
