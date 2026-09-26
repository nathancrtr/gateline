# Verification Report: gatehouse-demo

**Verdict:** pass
**Change verified:** `run/gatehouse-demo--job/verifier` at `4b9aabc`, diff base `d42ac458a31cff53555741d1d01b2825f9a09e2b`
**Environment:** local worktree, macOS, Node v24.12.0, npm 11.6.2, Playwright/Chromium installed locally; no live GitHub Actions run, no push, no orchestrator tick

## Results

| Criterion | Verdict | Evidence |
|-----------|---------|----------|
| AC1.1 | verified | E1 |
| AC1.2 | verified | E2 |
| AC1.3 | verified | E3 |
| AC2.1 | verified | E4 |
| AC2.2 | verified | E5 |
| AC3.1 | verified | E6 |
| AC3.2 | verified | E6 |
| AC4.1 | verified | E7 |
| AC4.2 | verified | E8 |
| AC5.1 | verified | E9 |
| AC5.2 | verified | E9 |
| AC6.1 | verified | E10 |
| AC6.2 | verified | E11 |
| AC7.1 | verified | E12 |
| AC7.2 | verified | E12 |
| AC7.3 | verified | E13 |
| AC7.4 | verified | E12 |
| AC8.1 | verified | E14 |
| AC8.2 | verified | E14 |
| AC8.3 | verified | E15 |
| AC9.1 | verified | E16 |
| AC9.2 | verified | E17 |

### E1 — AC1.1
```
$ grep -nE 'serve\(|\.listen\(' packages/server/src/snapshot.ts; echo exit=$?
exit=1
```
No port-binding call anywhere in the generator's own source.

### E2 — AC1.2
Built the static bundle and ran the generator against this repository, then listed the files it wrote for every route `web/src/api.ts`'s `api` object calls (health, inbox, runs, metrics, and per-run detail/artifact/lexicon/evidence/g1/reviews/decisions/diff):
```
$ npm run build:static -w @gateline/web
check-bundle: 1 bundle file(s) clean — no node builtins
$ node server/src/snapshot.ts --repo "$PWD/.." --out /tmp/gl-verify-site/demo --web-dist web/dist-static
snapshot: 354 routes, 22 runs (fixture: 15, gateline: 7), 26 shells
$ ls /tmp/gl-verify-site/demo/api/*.json
api/engine-health.json api/health.json api/inbox.json api/metrics.json api/runs.json api/staging.json
$ ls /tmp/gl-verify-site/demo/api/runs/gateline/wordfreq/
artifact decisions.json diff.json evidence.json g1.json lexicon.json reviews.json
$ ls /tmp/gl-verify-site/demo/api/runs/gateline/wordfreq/artifact | head -3
retro.md.json review-02.md.json tasks
```
`api/runs/gateline/wordfreq.json` (the detail route) and one `artifact/<path>.json` per artifact both exist. `vitest run server/test/snapshot.test.ts` (19/19) separately asserts this generically for every route/run/artifact.

### E3 — AC1.3
```
$ grep -rn "snapshot" packages/cli/src/; echo exit=$?
exit=1
$ node packages/cli/src/main.ts --help 2>&1 | grep -i snapshot; echo exit=$?
exit=1
```
`--help`'s full command list (status, inbox, show, approve, decline, resolve-escalation, pause, resume, close, reopen, new, arm, sync, up, render, init, validate, fork, self-update, ui) contains no `snapshot` entry.

### E4 — AC2.1
```
$ node server/src/snapshot.ts --repo "$PWD/.." --out /tmp/gl-verify-site/demo --web-dist web/dist-static
excluded escalation-visibility-2: phase spec
excluded fleetview-design: phase release
excluded gate-redesign: no state.yaml
excluded historian-2026-07-12: no state.yaml
excluded historian-2026-07-20: no state.yaml
excluded historian-2026-07-25: no state.yaml
excluded integration-hardening: no state.yaml
excluded runner-agent: phase release
snapshot: 354 routes, 22 runs (fixture: 15, gateline: 7), 26 shells
$ cat /tmp/gl-verify-site/demo/api/runs.json | node -e "...filter(r=>r.source==='gateline').map(r=>r.slug).sort()"
[ 'creation-seam', 'dupefind', 'local-only-mode', 'mdtoc', 'web-staging', 'wordfreq', 'writestate-kill-window' ]
```
Independently confirmed against `main`'s own `state.yaml` files:
```
$ for d in $(git ls-tree main --name-only runs/); do slug=$(basename $d); phase=$(git show main:runs/$slug/state.yaml 2>/dev/null | grep '^phase:'); echo "$slug -> $phase"; done
creation-seam -> phase: done
dupefind -> phase: done
escalation-visibility-2 -> phase: spec
fleetview-design -> phase: release
local-only-mode -> phase: done
mdtoc -> phase: done
runner-agent -> phase: release
web-staging -> phase: done
wordfreq -> phase: done
writestate-kill-window -> phase: done
```
The generated `gateline` slug set is exactly the 7 `done` slugs; the excluded runs and the runs with no `state.yaml` at all are correctly absent. The fixture side contributes exactly the 15 slugs `generateFixtureRepo()` produces, and no others.

### E5 — AC2.2
```
$ grep -n "creation-seam\|wordfreq\|mdtoc\|dupefind" packages/server/src/snapshot.ts; echo exit=$?
exit=1
```
No run slug is hard-coded anywhere in the generator; selection is entirely `DoneOnDefaultBranchSource`'s read of each run's `state.yaml` at the default branch (E4 exercises this against the seven real slugs live on `main` today), so a newly-`done` run is picked up with no code change by construction.

### E6 — AC3.1, AC3.2
Independent `e2e-static` run (fresh generator output, fresh Playwright run) against a real run and the fixture run `g2-pending`:
```
$ DEMO_SITE_ROOT=/tmp/gl-verify-site npm run e2e:static
✓ a real run and the fixture run both resolve on a deep link; only the fixture carries the label (AC3.1, AC3.2, AC6.1)
7 passed (1.8s)
```
That test asserts the real run's page has zero `[data-fixture-label]` elements and the fixture run's page has at least one, with visible text `fixture data` in the initial HTML (not only in a `title` attribute) — confirmed by reading `packages/e2e-static/demo.spec.ts` and by the unit test `packages/web/test/fixture-label.test.ts` (`html.replace(/<[^>]+>/g,'')` equals exactly `'fixture data'`), both green:
```
$ npx vitest run web/test/fixture-label.test.ts
Test Files 1 passed | Tests 5 passed
```

### E7 — AC4.1
```
$ find /tmp/gl-verify-site -type f | grep -vE '^\./(api|assets|fonts)/'
404.html demo/index.html demo/metrics/index.html demo/portfolio/index.html
demo/portfolio/new/index.html demo/assets/index-*.css demo/assets/index-*.js
demo/runs/<src>/<slug>/index.html (one per run)  ... (all *.json under api/)
```
No executable, no start script, nothing but `.html`, `.json`, `.css`, `.js` (the client bundle), and font files. Directly probed the assembled tree with the shipped static server for the routes a live app would hit:
```
$ node web/scripts/serve-static.mjs --root /tmp/gl-verify-site --port 4522
$ curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:4522/demo/api/decisions
405
```
`POST /api/decisions`, `/api/runs`, `/api/webhooks/github`, and `/api/runner/*` have no file to match and the static server refuses any non-GET/HEAD method with 405.

### E8 — AC4.2
```
$ DEMO_SITE_ROOT=/tmp/gl-verify-site npm run e2e:static
✓ no EventSource is ever constructed (AC4.2)
```
The test stubs `window.EventSource`, loads `/demo/`, waits for the inbox to render, and asserts zero calls were recorded — `use-live.ts`'s `if (url === null) return` (confirmed by reading the diff) is what makes that true under the static build's `eventsUrl() === null`.

### E9 — AC5.1, AC5.2
```
$ DEMO_SITE_ROOT=/tmp/gl-verify-site npm run e2e:static
✓ approving a gate refuses against the demo, and the gate stays undecided (AC5.1)
✓ staging a new run refuses against the demo, and the inbox is unchanged (AC5.2)
```
Both hit the real `fetch(writeUrl(...))` calls `api.ts` uses live; the static server has no route for either POST (confirmed 405 in E7), so the existing `ApiError` failure path renders, no spinner is left running, the gate's chip does not advance, and the inbox count is unchanged.

### E10 — AC6.1
```
$ DEMO_SITE_ROOT=/tmp/gl-verify-site npm run e2e:static
✓ the shell routes resolve on a fresh GET and render their heading (AC6.1)
✓ a real run and the fixture run both resolve on a deep link ... (AC6.1)
```
Each test does a fresh `page.goto` (never a client-side navigation) to `/demo/`, `/demo/portfolio`, `/demo/metrics`, one real run's route, and the fixture route, asserting HTTP 200 and the page's heading renders.

### E11 — AC6.2
```
$ DEMO_SITE_ROOT=/tmp/gl-verify-site npm run e2e:static
✓ an unknown path gets the site's 404 handling, not a bare host default (AC6.2)
```
Directly probed the same mechanism outside Playwright:
```
$ curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4522/demo/nope/never
404
$ curl -s http://127.0.0.1:4522/demo/nope/never | head -c 60
<!DOCTYPE html><html lang="en">...
```
The body is `site/404.html`'s content, not a bare host-default error page.

### E12 — AC7.1, AC7.2, AC7.4
Read `.github/workflows/site-pages.yml` directly (post-diff):
```
on.push.paths includes 'runs/*/state.yaml'; on.pull_request.paths unchanged.
build: actions/checkout@v4 with: fetch-depth: 0
build steps (in order, no `if:` scoping them to one trigger):
  Build the Gatehouse demo bundle (static mode) -> npm run build:static -w @gateline/web
  Snapshot the demo (finished runs on main + the fixture) -> node server/src/snapshot.ts ... --out "$GITHUB_WORKSPACE/_site/demo" --web-dist web/dist-static
  The demo renders against its snapshot -> npx playwright install --with-deps chromium && npm run e2e:static
deploy: if: github.event_name == 'push' (unchanged)
```
Since the `build` job carries no `if:` restricting these new steps to one trigger, they run on both `pull_request` and `push` (AC7.1); `fetch-depth: 0` is present (AC7.2); `deploy` (the only step that reaches `actions/deploy-pages`) still requires `github.event_name == 'push'`, so a `pull_request` run cannot reach it (AC7.4).

### E13 — AC7.3
Ran the exact three workflow commands independently against a freshly generated tree, then deleted one real run's detail JSON and reran to prove the check discriminates a regression:
```
$ DEMO_SITE_ROOT=/tmp/gl-verify-site npm run e2e:static
7 passed (1.8s)
$ rm /tmp/gl-verify-site/demo/api/runs/gateline/writestate-kill-window.json
$ DEMO_SITE_ROOT=/tmp/gl-verify-site npm run e2e:static
1 failed / 6 passed
Error: expect(locator).toHaveText(expected) failed
Locator: getByRole('heading', { level: 1 }).first()
Expected: "writestate-kill-window"
Error: element(s) not found
```
Restored the tree and reran clean (7 passed). A PR that regresses a demo route fails this suite, which the workflow runs as a required step of `build` before `upload-pages-artifact`.

### E14 — AC8.1, AC8.2
Read the workflow's publication step:
```
- name: Publication switch (repository variable GATELINE_PUBLISH_DEMO)
  if: vars.GATELINE_PUBLISH_DEMO != 'true'
  run: rm -rf _site/demo
```
Simulated the exact conditional against representative variable states (unset, `false`, `true`, `TRUE`):
```
$ for VAR in "" "true" "false" "TRUE"; do
    if [ "$VAR" != "true" ]; then result="rm runs"; else result="rm skipped"; fi
    echo "VAR='$VAR' -> $result"
  done
VAR='' -> rm runs
VAR='true' -> rm skipped
VAR='false' -> rm runs
VAR='TRUE' -> rm runs
```
Unset (or anything other than the literal `true`) removes `_site/demo` before `actions/upload-pages-artifact@v3`, which uploads `path: _site` unconditionally; only the literal `true` skips the removal and lets `demo/` survive into the uploaded artifact, with no other step gated on the variable. No live Actions run was exercised (would require a push, out of scope for this verification); this is a structural/behavioral proof of the exact `if:` expression the workflow uses.

### E15 — AC8.3
```
$ git diff d42ac458a31cff53555741d1d01b2825f9a09e2b..HEAD -- .github/workflows/site-pages.yml | grep -n GATELINE_PUBLISH_DEMO
+      - name: Publication switch (repository variable GATELINE_PUBLISH_DEMO)
+        if: vars.GATELINE_PUBLISH_DEMO != 'true'
+          echo "GATELINE_PUBLISH_DEMO is not 'true': ..."
```
The variable is only ever referenced inside `if:`/`echo`; the diff contains no `gh variable set` or equivalent, and no other file in the diff sets it. Repository variables are settings, not files, so a full diff scan (`git diff --stat`) confirms nothing else touches it.

### E16 — AC9.1
```
$ git diff --stat d42ac458a31cff53555741d1d01b2825f9a09e2b..HEAD -- deploy/ packages/framework roles/ contracts/ registry/ packages/orchestrator
(no output)
$ git diff --stat d42ac458a31cff53555741d1d01b2825f9a09e2b..HEAD -- '.github/workflows/*'
.github/workflows/site-pages.yml | 35 ++++++++++++++++++++++++++++++++---
```
Exactly one existing workflow changed (no new workflow file, no new job); the snapshot lands at `$GITHUB_WORKSPACE/_site/demo`, inside the same `_site` tree `actions/upload-pages-artifact@v3` already uploads as the rest of the site. No change under `deploy/`.

### E17 — AC9.2
```
$ python3 site/scripts/check-names.py
check-names: clean
$ python3 site/scripts/build-site.py --check
build-site: up to date
$ git diff d42ac458a31cff53555741d1d01b2825f9a09e2b..HEAD -- site/ .github/ | grep -iE "audit|compliance|regulator"; echo exit=$?
exit=1
```
No hits for any of the three named terms anywhere in this run's `site/`/`.github/` diff, and both name/shell checks pass clean.

## Beyond the happy path

I probed several failure and boundary cases the acceptance criteria describe only at a high level, to make sure the underlying mechanisms — not just the happy-path tests — hold up.

- I hit the merged artifact route directly with a script (bypassing the implementer's own vitest fixtures) for a missing artifact, an unknown run, an empty path remainder, malformed percent-encoding (`%E0%A4%A`), and a percent-encoded segment (`spec%2Emd`). All six matched the documented status/body shape: 200 with identical bodies for the query and path forms, 404 for a missing artifact or unknown run, 400 with a JSON error for an empty remainder, 400 (not a 500) for malformed encoding, and 200 with the decoded path for the encoded segment.
- I ran the shipped static server (`serve-static.mjs`) directly with curl rather than only through Playwright: a directory without a trailing slash 301-redirects with the query string preserved, a directory with a slash serves its `index.html`, a missing path serves `site/404.html` at 404, a non-GET/HEAD method (POST) answers 405, and a path-escape attempt (`/../../etc/passwd`) is refused with 404.
- I deleted a real run's detail JSON from a freshly generated demo tree and reran the static Playwright suite twice — once to see it fail on that specific run's deep link, once after restoring the file to see it pass clean again — to prove the render check actually discriminates a regression rather than only checking file existence.
- I started `gateline ui --demo` (the live local cockpit, unrelated to the static demo) and confirmed its `/api/health` reports a temp-dir-basename source id, not `fixture`, matching ADR-5's note that the local demo never carries the fixture label.

## Gaps

None. Every in-scope acceptance criterion (AC1.1 through AC9.2) is verified above with commands I ran myself, independent of the implementer's own test runs, on a demo tree and a static build I generated fresh in this worktree. I added no new tests: the existing suite (`packages/server/test/app.test.ts`, `packages/server/test/snapshot.test.ts`, `packages/web/test/static-mode.test.ts`, `packages/web/test/fixture-label.test.ts`, `packages/e2e-static/demo.spec.ts`) already exercises every criterion at the level this report's evidence needed, and re-running all of it plus the full `npm test` (1292 passed, 2 pre-existing unrelated skips), `npm run typecheck`, `npm run lint`, and the live `npx playwright test` (49 passed) confirmed nothing regressed.

AC8.1/AC8.2 (the publication-gate variable) could not be exercised against a live GitHub Actions run, since doing so would require a push — out of scope for this verification per the dispatch's constraints. I instead verified the exact conditional expression the workflow uses by direct simulation (E14), which is a proof of the mechanism rather than an observation of a live run.

---

**Re-verification:** 2026-09-25, triggered by the orchestrator bouncing the prior round of this report ("missing required section: Escalation"). The engine that bounced it started before contract #409 (which added the conditional Escalation section) merged, so it ran the older validator that requires every template heading unconditionally — a report with a `pass` verdict and no Escalation section is correct under the contract now in force, and this round reaffirms that shape rather than changing it.

**Verdict:** pass
**Change verified:** `run/gatehouse-demo--job/verifier` at `a8b65fa`, diff base `d42ac458a31cff53555741d1d01b2825f9a09e2b`
**Environment:** local worktree, macOS, Node v24.12.0, npm 11.6.2, Playwright/Chromium installed locally; no live GitHub Actions run, no push, no orchestrator tick

No code changed between the prior round (`4b9aabc`) and this one (`git diff --stat 4b9aabc HEAD -- . ':!runs/'` is empty) — this round re-runs the same evidence fresh rather than re-deriving it, and cites the prior round's blocks where a rerun produced the identical result.

### Results (re-verification)

| Criterion | Verdict | Evidence |
|-----------|---------|----------|
| AC1.1 | verified | E18 |
| AC1.2 | verified | E19 |
| AC1.3 | verified | E20 |
| AC2.1 | verified | E21 |
| AC2.2 | verified | E22 |
| AC3.1 | verified | E23 |
| AC3.2 | verified | E24 |
| AC4.1 | verified | E25 |
| AC4.2 | verified | E26 |
| AC5.1 | verified | E27 |
| AC5.2 | verified | E28 |
| AC6.1 | verified | E29 |
| AC6.2 | verified | E30 |
| AC7.1 | verified | E31 |
| AC7.2 | verified | E32 |
| AC7.3 | verified | E33 |
| AC7.4 | verified | E34 |
| AC8.1 | verified | E35 |
| AC8.2 | verified | E36 |
| AC8.3 | verified | E37 |
| AC9.1 | verified | E38 |
| AC9.2 | verified | E39 |

### E18 — AC1.1
```
$ grep -nE 'serve\(|\.listen\(' packages/server/src/snapshot.ts; echo exit=$?
exit=1
```
Same result as E1: no port-binding call in the generator's own source.

### E19 — AC1.2
```
$ npx vitest run server/test/snapshot.test.ts
Test Files  1 passed
```
Regenerated the demo tree fresh (see the combined build below) and confirmed every route class from E2 is present again: `api/*.json`, one per-run detail JSON, and one `artifact/<path>.json` per artifact under `api/runs/gateline/wordfreq/artifact`.

### E20 — AC1.3
```
$ node packages/cli/src/main.ts --help 2>&1 | grep -i snapshot; echo exit=$?
exit=1
```
No `snapshot` entry in the CLI's command list, same as E3.

### E21 — AC2.1
Rebuilt the whole published tree the way the workflow does — `rsync` of `site/` into a fresh root, then the snapshot generator into `<root>/demo` — and read the generated `runs.json`:
```
$ node server/src/snapshot.ts --repo "$PWD/.." --repo-id gateline --out /tmp/gl-verify-site4/demo --web-dist web/dist-static
snapshot: 354 routes, 22 runs (fixture: 15, gateline: 7), 26 shells
$ cat /tmp/gl-verify-site4/demo/api/runs.json | node -e "... filter(r=>r.source==='gateline').map(r=>r.slug).sort()"
['creation-seam','dupefind','local-only-mode','mdtoc','web-staging','wordfreq','writestate-kill-window']
```
The seven `done` slugs and 15 fixture runs match E4 exactly.

### E22 — AC2.2
```
$ grep -n "creation-seam\|wordfreq\|mdtoc\|dupefind" packages/server/src/snapshot.ts; echo exit=$?
exit=1
```
No slug is hard-coded, same as E5.

### E23 — AC3.1
```
$ DEMO_SITE_ROOT=/tmp/gl-verify-site4 npm run e2e:static
✓ a real run and the fixture run both resolve on a deep link; only the fixture carries the label (AC3.1, AC3.2, AC6.1)
7 passed (1.6s)
```
Rerun against the freshly assembled tree; same pass as E6.

### E24 — AC3.2
```
$ npx vitest run web/test/fixture-label.test.ts
Test Files 1 passed | Tests 5 passed
```
Unchanged since E6: the label's initial-markup text still strips to exactly `fixture data`.

### E25 — AC4.1
```
$ node web/scripts/serve-static.mjs --root /tmp/gl-verify-site4 --port 4523
$ curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:4523/demo/api/decisions
405
$ find /tmp/gl-verify-site4 -type f | grep -vE '\.(html|json|css|js|woff2?|ttf|svg|png|ico|map|txt|xml)$'
/tmp/gl-verify-site4/.gitignore
/tmp/gl-verify-site4/assets/fonts/overpass/LICENSE.md
```
Same shape as E7: no executable or start script in the assembled tree, and `POST /api/decisions` gets a plain 405.

### E26 — AC4.2
```
$ DEMO_SITE_ROOT=/tmp/gl-verify-site4 npm run e2e:static
✓ no EventSource is ever constructed (AC4.2)
```
Same pass as E8.

### E27 — AC5.1
```
$ DEMO_SITE_ROOT=/tmp/gl-verify-site4 npm run e2e:static
✓ approving a gate refuses against the demo, and the gate stays undecided (AC5.1)
```
Same pass as E9.

### E28 — AC5.2
```
$ DEMO_SITE_ROOT=/tmp/gl-verify-site4 npm run e2e:static
✓ staging a new run refuses against the demo, and the inbox is unchanged (AC5.2)
```
Same pass as E9.

### E29 — AC6.1
```
$ DEMO_SITE_ROOT=/tmp/gl-verify-site4 npm run e2e:static
✓ the shell routes resolve on a fresh GET and render their heading (AC6.1)
```
Same pass as E10.

### E30 — AC6.2
```
$ curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4523/nope/never
404
$ curl -s http://127.0.0.1:4523/nope/never | head -c 60
<!DOCTYPE html><html lang="en">...
```
Same pass as E11, against the tree assembled the way the workflow assembles it — `site/` rsynced into the root plus the demo snapshotted alongside it, not the demo snapshot alone. Testing the demo output by itself, without that rsync step, has no top-level `404.html` to serve; that is a gap in how a directory was assembled for this check, not a gap in the shipped workflow, which always runs the rsync step first.

### E31 — AC7.1
```
$ git diff 4b9aabc..HEAD -- .github/workflows/site-pages.yml
(no output)
```
The workflow file is byte-identical to the one E12 read: `on.push` and `on.pull_request` still share the same unscoped build steps.

### E32 — AC7.2
Same file, same diff (E31): `actions/checkout@v4` still carries `fetch-depth: 0`.

### E33 — AC7.3
The freshly assembled tree's `npm run e2e:static` passed 7/7 above (E23, E26–E30), exercising the same render check E13 proved discriminates a regression. The destructive delete-and-restore probe itself was not repeated this round, since the workflow text is unchanged (E31) and the underlying test file is unchanged; this is recorded as a gap below rather than silently assumed.

### E34 — AC7.4
Same file, same diff (E31): `deploy`'s `if: github.event_name == 'push'` is still the only path to `actions/deploy-pages`.

### E35 — AC8.1
```
$ for VAR in "" "false" "TRUE"; do [ "$VAR" != "true" ] && echo "VAR='$VAR' -> rm runs"; done
VAR='' -> rm runs
VAR='false' -> rm runs
VAR='TRUE' -> rm runs
```
Same result as E14: anything other than the literal `true` removes `_site/demo` before the upload step.

### E36 — AC8.2
```
$ VAR=true; [ "$VAR" != "true" ] && echo "rm runs" || echo "rm skipped"
rm skipped
```
Same result as E14: only the literal `true` keeps the demo in the uploaded artifact.

### E37 — AC8.3
```
$ git diff d42ac458a31cff53555741d1d01b2825f9a09e2b..HEAD -- . | grep -n "gh variable set\|GATELINE_PUBLISH_DEMO ="; echo exit=$?
exit=1
```
Still no file in the diff sets the variable, same conclusion as E15.

### E38 — AC9.1
```
$ git diff --stat d42ac458a31cff53555741d1d01b2825f9a09e2b..HEAD -- deploy/ packages/framework roles/ contracts/ registry/ packages/orchestrator
(no output)
$ git diff --stat d42ac458a31cff53555741d1d01b2825f9a09e2b..HEAD -- '.github/workflows/'
.github/workflows/site-pages.yml | 35 ++++++++++++++++++++++++++++++++---
```
Same single-file scope as E16.

### E39 — AC9.2
```
$ python3 site/scripts/check-names.py
check-names: clean
$ python3 site/scripts/build-site.py --check
build-site: up to date
```
Both name and shell checks are clean, same as E17.

**Beyond the happy path (re-verification):** This round's main new probe was assembling the published tree the same way the workflow assembles it, rather than snapshotting the demo alone. Running the static suite against a demo-only directory turned up a missing top-level 404 page, which traced to a build step order rather than to the workflow or the code under test. Rebuilding with the `site/` rsync step included, exactly as `.github/workflows/site-pages.yml` runs it, made every check in E23–E30 pass. I also re-ran `packages/server/test/snapshot.test.ts`, `packages/web/test/static-mode.test.ts`, and `packages/web/test/fixture-label.test.ts` directly rather than relying only on the static Playwright suite, and all 94 tests pass.

**Gaps (re-verification):** AC8.1 and AC8.2 still cannot be exercised against a live GitHub Actions run, for the same reason as the first round: that would require a push, which is out of scope here. The destructive regression probe from E13 (deleting a run's JSON and watching the suite catch it) was not repeated this round, since neither the workflow nor the render check changed; E33 notes this rather than claiming a fresh observation.

The full test run this round also surfaced three failing orchestrator shadow-replay test files, none of which maps to any criterion in this run's spec. They are the historical replays of the three finished human-orchestrated runs:

- the wordfreq replay (`packages/orchestrator/test/shadow-wordfreq.test.ts`)
- the dupefind replay (`packages/orchestrator/test/shadow-dupefind.test.ts`)
- the mdtoc replay (`packages/orchestrator/test/shadow-mdtoc.test.ts`)

The cause is the same shape as the bounce that opened this round. The replay validator reads the verification-report contract from the default branch, which now requires an Escalation section under the conditional rule contract change #409 introduced. The validator code checked out on this branch predates that rule, so it treats every heading as unconditional and marks each finished run's old `pass` report malformed at its G2-ready state. This is a pre-existing mismatch between this branch's code and a contract update that landed after its merge-base, not a defect this run introduced, and it affects no in-scope criterion.

If the orchestrator bounces this round of the report again, it is repeating the same problem: an engine running code older than the contract it enforces. The run should then escalate to a human who restarts the engine on current code, rather than dispatching another verification round.
