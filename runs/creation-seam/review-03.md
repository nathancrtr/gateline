# Review Report: 04-pr-ensure

**Verdict:** approve
**Round:** 1 of 3
**Diff reviewed:** commit 75266be (branch run/creation-seam)

## Findings

### F1 — minor (PLAUSIBLE) — `defaultBranch()` can yield a remote-prefixed base, making the create step unreachable in local-branch-less checkouts
- **Where:** `frontend/packages/core/src/sources/pr-ensure.ts:71` (via `git.ts:197,205`)
- **Failure scenario:** a checkout with no local `main`/`master` (e.g. a detached-HEAD engine host with only `refs/remotes/origin/main`) → `defaultBranch()` returns `origin/main` → `gh pr create --base origin/main` fails (no such base branch on the remote) → every ensure degrades to `skipped`, so the AC8.1 "first dispatch opens a draft PR" behavior never fires there. Never-fatal contract still holds and the note names the cause; the plan's own `--base <defaultBranch>` wording is what the code follows, hence PLAUSIBLE, not blocking. One-line hardening: strip a leading `origin/` from the base.
- **Requirement:** R8/AC8.1

### F2 — minor — list-invocation args are never asserted; a `--state all` (or `--head`) drop-mutant survives all five tests
- **Where:** `frontend/packages/core/test/pr-ensure.test.ts:37-42,58-61`
- **Failure scenario:** mutant `ensureDraftPr` omitting `--state`, `all` from the `gh pr list` args → suite passes unchanged (the stub returns its payload regardless of args), but in reality a run whose PR was closed-unmerged lists empty under gh's open-only default → repeat ensure opens a duplicate PR, violating the pinned "any PR (any state) → exists" behavior (task scope; plan.md:178-180). Fix: assert the list call's args contain `['--head','run/toy','--state','all']`.
- **Requirement:** R8/AC8.1 (idempotency across PR states)

### F3 — minor — `expect.arrayContaining` on the create args cannot discriminate a head/base value swap
- **Where:** `frontend/packages/core/test/pr-ensure.test.ts:50-53`
- **Failure scenario:** mutant emitting `--head main --base run/toy` → every element of the expected array is still present somewhere (`run/toy` also appears as `--title`'s value), so the assertion passes while gh would open a backwards PR. Current code is correct (pr-ensure.ts:73); the assertion just can't kill this mutant. Fix: assert exact argument order (or slice-compare the pairs).
- **Requirement:** R8/AC8.1

## Coverage

- **Interface contract (plan.md:169-183):** signature, `EnsurePrResult` shape, and step
  sequence match exactly — `configGet('remote.origin.url')` → skip; `revParse(refs/remotes/origin/<branch>)`
  → skip "branch not pushed"; `gh pr list --head <branch> --state all --limit 1 --json number`
  → any PR → exists; else `gh pr create --draft --head --base --title "run/<slug>" --body <one
  line pointing at runs/<slug>/>` → created. Barrel line added to `sources/index.ts` as
  scoped; the test imports through `../src/index.ts`, proving the re-export. ✓
- **Never-throws (AC8.2):** verified `Git.revParse`/`Git.configGet` return `null` rather
  than throwing (git.ts:71-77, 211-217); each gh call has its own catch → `skipped` with the
  reason in `note`; unparseable list JSON → `skipped`; plus the top-level catch. No path
  throws. `defaultExec` uses the `GhCliProvider` invocation shape (sync.ts:92-96) incl.
  the 16 MiB maxBuffer, rejecting with `stderr || err.message` so ENOENT (missing binary)
  is still descriptive. Argument-vector exec (no shell) → no injection surface from
  branch/slug. ✓
- **AC8.1 unit half:** exists-path test proves list-hit → no create call; skip paths prove
  no gh call at all before the gates pass. Real git (temp repo) exercises the gating; no
  real `gh` is ever invoked (plan Risks, "injectable exec seam is mandatory"). ✓
- **Checks re-run by reviewer:** `npx vitest run packages/core/test/pr-ensure.test.ts` —
  5/5 pass. `npm run typecheck` — clean. `npm test` — 35 files passed, 1 skipped
  (live-smoke), 249 tests passed, exit 0; the previously reported flaky timeouts
  (config.test.ts, engine.test.ts M2) did not reproduce and nothing in this diff's tests
  failed. ✓
- **AC9.1:** `grep -niE "issue|label|assignee|milestone"` over both new files — no matches. ✓
- **AC9.2 baseline note (not a finding against this diff):** the spec's "exactly two"
  zod false positives in `record/schema.ts` is now **three** (lines 131, 166, 170) — all
  pre-existing from merged #156 (commit 70aae4c), brought in by task 01's merge, none from
  this diff. The final verifier should treat three as the confirmed baseline, per the
  spec's own "confirm before trusting" instruction.
- Not assessed: the arm/engine call sites (tasks 05/06 per plan.md:358) and the AC8.1
  integration half — out of this task's scope by the requirement→task mapping.

## Boundary check

Clean. The diff touches exactly the three declared surface files plus the task's own
`runs/creation-seam/tasks/04-pr-ensure.yaml` (implementer notes appended — conventional
run-record bookkeeping, not code). No other files in `git show 75266be --stat`.
