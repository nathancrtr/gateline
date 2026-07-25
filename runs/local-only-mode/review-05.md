# Review Report: 05-remoteless-test-coverage

**Verdict:** approve
**Round:** 1 of 3
**Diff reviewed:** commit 63417ab (branch `run/local-only-mode`)

## Findings

### F1 — minor — import-block growth shifts the spec's pinned line ranges by +9
- **Where:** `frontend/packages/core/test/divergence.test.ts:8-19`
- **Failure scenario:** a verifier following the spec's line pins (AC1.3/AC7.2 cite 72-114 and 134-211) lands nine lines early — e.g. line 90 is now inside the `aheadOfOrigin (#149)` describe, not the push:false ceiling case (now at 99-111). Cases are textually unmodified and recognizable by name; traceability by line number alone is broken. Disclosed in the implementer's notes; unavoidable given the four new imports, but flagged so AC1.3 verification greps by describe name, not line.
- **Requirement:** AC1.3/AC7.2 traceability (plan Risks, last bullet)

## Coverage

The four new tests cover every behavior the task claims, and I confirmed each one is discriminating by mutating the code under test and watching the right test fail.

- AC1.1 auto-detect ✓ — remoteless→`localOnly` true, origin added→false; mutating `resolveMode`'s auto-detect rule to constant `false` fails this test.
- AC1.2/AC2.1 explicit designator ✓ — `localOnly: true` over a live origin, decision writes, origin tip unchanged; mutating `resolveMode` to ignore `explicitLocalOnly` fails it. The named-flag assertion for the explicit tier lives in the config suite (`config.test.ts:119`), so the mutant "explicit flag suppresses push but never names the mode" is killed at suite level.
- AC2.2 PR-ensure leak ✓ — the brief's exact leak shape (origin present, remote-tracking ref planted); deleting the guard (`pr-ensure.ts:41`) fails it; the exec spy proves zero `gh` calls, not merely a skipped status.
- AC2.3 sync leak ✓ — factory-never-invoked proven via `vi.fn`; deleting the guard (`sync.ts:66`) fails it; the pass-through mutant (always return `'local-only'`) is killed by the delegation case in the sync suite (`sync.test.ts:81`).
- AC7.1 ✓ — both closed leaks now have cases in the required file.
- AC7.2 ✓ with an environment caveat — the divergence file passes 14/14 in isolation, as do `pr-ensure.test.ts`, `sync.test.ts`, and `config.test.ts` (25/25). Two full `npm test` passes in this sandbox each hit 14-21 failures, all 30-120s timeouts with a nondeterministic failing set including files a test-only diff cannot affect — the same contention task 04's notes document. The implementer's "393 passed, 0 failed" claim is credible on an unloaded machine; no real regression is reproducible.
- Append-only constraint ✓ — existing describes byte-identical (diff touches only the import block and appends after line 220); mutation-tested code restored, working tree clean after review.
- Existing hosted-push cases (spec's pinned describes) ✓ green in the isolated run.

## Boundary check

The commit touches exactly two files: `frontend/packages/core/test/divergence.test.ts` (the sole declared surface) and the task's own file `runs/local-only-mode/tasks/05-remoteless-test-coverage.yaml` (notes appended — the pipeline's standard reporting channel, not a surface breach). No source file, no other test file, no `roles/` or `contracts/` content (R8 clean for this diff).
