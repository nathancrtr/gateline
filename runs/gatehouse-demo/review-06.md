# Review Report: 06-pages-workflow

<!-- AUDIENCE: Coverage=audit; Boundary check=audit -->

**Verdict:** approve
**Round:** 1 of 3
**Diff reviewed:** `run/gatehouse-demo`, commit 6553783 (`git diff 6553783^ 6553783`, task-file `notes:` read as claims, not reviewed as code)

## Findings

### F1 — minor — The README's three-command recipe cannot run as printed: its relative `--out` lands under `packages/`, where nothing serves it and nothing ignores it
- **Where:** `site/README.md:69-72`
- **Failure scenario:** a reader runs the block from `packages/` (the only cwd where `-w @gateline/web` and `server/src/snapshot.ts` both resolve) → `--out _site/demo` writes `packages/_site/demo` (reproduced: 354 routes landed there) → `npm run e2e:static` with no `DEMO_SITE_ROOT` serves `../_site`, which has no `demo/api/health.json`, so Playwright's `webServer` times out and the suite fails → `git status` also shows an untracked `packages/_site/`, because `.gitignore:25`'s `/_site/` is root-anchored (`git check-ignore packages/_site/x` → not ignored). The workflow itself is unaffected (it passes absolute paths); the README says the block *is* the local recipe and defers "the exact sequence" to a task file's notes under `runs/`, a historical record. One of: print the workflow's absolute-path form, or a `--out ../_site/demo` plus `DEMO_SITE_ROOT=../_site` pair with the cwd named.
- **Requirement:** task scope item 5 ("the three commands the workflow runs and the local recipe"); R9 framing

### F2 — minor — GitHub compares expression strings case-insensitively, so `True`/`TRUE` publish while the README and the step comment say only `true` does
- **Where:** `.github/workflows/site-pages.yml:86` (`if: vars.GATELINE_PUBLISH_DEMO != 'true'`); documented at `site/README.md:79-81` and `.github/workflows/site-pages.yml:83`
- **Failure scenario:** a human sets the repository variable to `True` → the expression evaluates equal (GitHub's `==`/`!=` ignore case) → the removal step is skipped → the next `push` uploads `demo/` and deploys it, while the README states "unset (or any value other than `true`) removes `demo/`". The direction of the surprise is benign (someone typing `True` wants it on), and the expression is ADR-8's own; the defect is the documented contract, which should say the comparison is case-insensitive or name the exact accepted spellings.
- **Requirement:** R8 / AC8.2 ("its documented 'on' value")

## Coverage

I read the whole diff against requirements seven through nine and the plan's Pages-workflow section and ADR-7, ADR-8 and ADR-9, parsed the workflow with the vendored YAML library, ran the site's two checks, reproduced the workflow's assemble, build, snapshot and render-check steps in order from a clean tree in this worktree, snapshotted a second clone shaped like an Actions pull-request checkout (detached HEAD, remote-tracking refs only, no local branches, no origin/HEAD) to prove the full-history fetch is what the generator needs, simulated the publication switch in both variable states, and probed the README's recipe from the directory it implies; the workflow is correct on both triggers, and the two findings are documentation defects.

| Requirement | Where | Mechanism checked | Status |
|-------------|-------|-------------------|--------|
| AC7.1 build on both triggers | `.github/workflows/site-pages.yml:67-81` | the three new steps carry no `if:`, so they run on `pull_request` and `push` alike; rsync → `build:static` → snapshot → `e2e:static` reproduced here from a clean `_site`: 354 routes, 22 runs (7 real), `_site/demo/` populated, 7/7 passed | ✓ AC7.1 |
| AC7.2 full history | `.github/workflows/site-pages.yml:38-41` | `fetch-depth: 0` present; a clone with 457 commits, 13 `refs/remotes/origin/run/*`, zero `refs/heads/*` and a detached HEAD snapshots the same 7 finished runs, since `defaultBranch()` falls through to `origin/main` and every reader dereferences `ref.ref`, never a bare `run/<slug>` | ✓ AC7.2 |
| AC7.3 regression fails the job | `packages/server/src/snapshot.ts:314-317` | snapshot exits 1 on any non-2xx route; the render check step has no `continue-on-error`; a regression-free tree passes 7/7 (task 05's suite discrimination stands per review-05 round 2) | ✓ AC7.3 |
| AC7.4 no deploy on PRs | `.github/workflows/site-pages.yml:95` | parsed `deploy.if` is still `github.event_name == 'push'`; `upload-pages-artifact@v3` unchanged | ✓ AC7.4 |
| AC8.1 / AC8.2 switch | `.github/workflows/site-pages.yml:82-89` | step has no `working-directory`, so `rm -rf _site/demo` resolves at the workspace root; bash simulation of the `if:` on a copy of the built tree: unset → no `demo/`, `true` → `demo/` kept; case folding is F2 | ✓ AC8.1, AC8.2 |
| AC8.3 no variable set | whole diff | `GATELINE_PUBLISH_DEMO` appears only in the `if:`, the echo, a comment and the README; no settings change is a file | ✓ AC8.3 |
| AC9.1 path, no deploy/ change | `git diff --stat 6553783^ 6553783` | four files, none under `deploy/`; demo lands at `_site/demo/` beside the site's pages | ✓ AC9.1 |
| AC9.2 names and terms | `site/README.md:57-90` | `check-names.py` clean; `build-site.py --check` up to date; the diff's added lines carry none of audit, compliance, regulator, and no organisation | ✓ AC9.2 |
| ADR-9 trigger | `.github/workflows/site-pages.yml:16-22` | parsed `on.push.paths` gains `runs/*/state.yaml` (Actions' `*` does not cross `/`, so `runs/<slug>/state.yaml` matches); `on.pull_request.paths` byte-identical to main | ✓ |
| add, do not rewrite | `git diff 41cf3da 6553783` | the only removed lines are the three header-comment lines the task asked to reword; the parsed step list is the original eight plus the four new ones in the prescribed order | ✓ |
| `.gitignore` | `.gitignore:25` | `/_site/` ignores the root tree the workflow and recipe build; root-anchored, so it does not cover the path F1 produces | ✓ (F1) |
| README claims vs mechanism | `site/README.md:60-67,74-77` | in-process generation, `phase: done` at the default branch, and the per-page fixture label each match `snapshot.ts` and spec R3 | ✓ |
| checkout comment | `.github/workflows/site-pages.yml:39-40` | history is genuinely required (`stateHistory`/`lastTouched` walk `git log` on the default branch); the "`run/*` branches" clause is the task's own wording and is not what the generator reads, an inaccuracy without a failure | partial — no finding |
| concurrency | `.github/workflows/site-pages.yml:29-31` | pre-existing single group with `cancel-in-progress`, now shared by more pushes; not this diff's change | n/a |
| notes accuracy | task file `notes:` | every verification claim (YAML parse, both site checks, 354/22/26, 7 passed, switch simulation, clean status) reproduced here | ✓ |

## Boundary check

Inside the surface. 6553783 touches exactly `.github/workflows/site-pages.yml`, `.gitignore`, `site/README.md` and the task file's `notes:` block. No new Action is introduced, and nothing under `deploy/`, `packages/framework`, `roles/`, `contracts/` or `registry/` moved. Operational note, not a finding: `packages/node_modules` again lacked the web workspace's dependencies, so I ran `npm ci --no-audit --no-fund` (gitignored). Scratch output: the worktree's `_site/` and the probe's `packages/_site/` were removed, `web/dist-static/` and `test-results/` are gitignored, and the mimic clone `/tmp/gl-ci-r6` with its site tree and the two switch-simulation copies under `/tmp` were deleted; `git status --short` at the end shows only this report.
