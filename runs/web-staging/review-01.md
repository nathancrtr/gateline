# Review Report: 01-core-shared-checks

<!-- Contract: produced by Reviewer; consumed by Implementer and gate G2.
     All sections required. Findings ranked most-severe first.
     BUDGET: one line + failure scenario per finding — no narrative. Reference
     the spec and diff (requirement numbers, file:line); never re-quote them. -->

**Verdict:** approve
**Round:** 1 of 3
**Diff reviewed:** commit c9383c5 (run/web-staging)

## Findings

None.

## Coverage

Requirement coverage: R2's single-truth half (AC2.2) is discharged — the shared
check `missingSections` now lives in the core validate module
(`frontend/packages/core/src/record/validate.ts:36`), `SLUG_PATTERN` in the
scaffold module (`frontend/packages/core/src/record/scaffold.ts:41`), and a grep
of `frontend/packages/cli/src/main.ts` confirms zero remaining
`missingBriefSections`/`normalizeSection` definitions and no locally-defined
slug regex literal (the surviving `SLUG_RE` at main.ts:368 is built from the
imported `SLUG_PATTERN`). Both new symbols match the plan's "Core additions"
interface contract signatures exactly, and both reach `@agentic/core` consumers
through the existing `export *` barrels (`record/index.ts` → `src/index.ts`) —
no missing-export gap.

Behavior preservation, checked by static equivalence since the acceptance
commands could not be run (see gap below): the hoisted `missingSections` body is
character-identical to the deleted CLI `missingBriefSections` +
`normalizeSection` pair (same `extractSections`, same
lowercase/collapse-punctuation/trim normalize applied to both sides); the slug
regex source is unchanged (`'^[a-z0-9][a-z0-9-]*$'`), and because
`new RegExp(src).toString()` renders identically to the old regex literal, the
interpolated messages at main.ts:408 and scaffold.ts:56 stay byte-identical.
Refusal wording in `stageNewRun` and `runInteractiveNew` is untouched (the old
local variable `missingSections` was renamed `missing` to clear the import name
— no output change). The CLI's remaining `extractSections` import is still used
(main.ts:496), so no dead import.

Tests as product: all four required cases are present in the core validate test
file and each kills its mutant class — exact match; case+punctuation normalize
(`## Out-of-Scope!!` vs `Out of scope`, which fails if either side skips
normalization); fenced-code-block heading correctly still reported missing; and
empty content returning all required sections in original casing and `required`
order (an alphabetical-sort or set-order mutant would swap
Motivation/Problem and fail). A `SLUG_PATTERN` grammar mutation is covered
transitively by the existing scaffold tests' invalid-slug rejections.

Layering: the diff adds no imports to the record layer — validate.ts still
imports only `yaml`, scaffold.ts's imports are unchanged — so the
node-builtin/sources/view-model ceiling `core/test/layering.test.ts` enforces is
statically satisfied.

Doc/comment rot: no stale reference to the deleted helpers anywhere under
`frontend/` (code, tests, or markdown) or `docs/`; the CLI's replacement comment
accurately describes the new single-truth arrangement.

Gap: `npx vitest run packages/core packages/cli` and `npm run typecheck` were
not executed — `frontend/node_modules` is absent in this checkout (per dispatch
instructions, noted rather than installed). The implementer reports 204 passing
+ clean typecheck; my approval rests on the static equivalence above plus the
unmodified cli suite, whose F6 punctuation-normalize e2e case
(cli/test/cli.test.ts:311) and interactive re-edit case (line 397) directly pin
the preserved semantics. G2 should see a green CI/vitest run before merge.

Concurrency: not assessed — nothing in scope touches concurrent access.

## Boundary check

Clean. `git show --stat c9383c5` lists exactly the four files in the task's
`file_contact_surface` (core validate.ts, core scaffold.ts, core
validate.test.ts, cli main.ts) and nothing else; no cli test file, server file,
or web file is touched, and the commit's parent/successors are orchestrator
state-metadata commits only, so the diff bounds this task's changes alone.
