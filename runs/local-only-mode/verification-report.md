# Verification Report: local-only-mode

**Change verified:** `run/local-only-mode` (HEAD `33cb3bb`) against `main`
**Environment:** local, macOS (Darwin 25.5.0), Node v26.3.0, npm 11.16.0, frontend workspace after `npm install`

## Results

| Criterion | Verdict | Evidence |
|-----------|---------|----------|
| AC1.1 | verified | see E1 |
| AC1.2 | verified | see E2 |
| AC1.3 | verified | see E3 |
| AC2.1 | verified | see E4 |
| AC2.2 | verified | see E5 |
| AC2.3 | verified | see E6 |
| AC2.4 | verified | see E7 |
| AC3.1 | verified | see E8 |
| AC3.2 | verified | see E9 |
| AC4.1 | verified | see E10 |
| AC4.2 | verified | see E11 |
| AC5.1 | verified | see E12 |
| AC5.2 | verified | see E13 |
| AC6.1 | verified | see E14 |
| AC6.2 | verified | see E15 |
| AC7.1 | verified | see E16 |
| AC7.2 | verified | see E17 |
| AC8.1 | verified | see E18 |

### E1 — AC1.1
Live probe: a fresh remoteless repo with an adapter manifest, run through `agentic up` with no flags.
```
$ node packages/cli/src/main.ts --repo <remoteless-repo> up --no-open --port 48200
sources: repo
agentic ui listening on http://127.0.0.1:48200 ...
engine watching <repo> (heartbeat 180s, local-only (no origin remote)) — ^C to stop
```
The marker names the mode as `local-only`, not merely `push === false`. Also covered by
`frontend/packages/core/test/config.test.ts:110` (`AC1.1: a remoteless zero-config source
auto-detects local-only`) and `frontend/packages/core/test/divergence.test.ts:225`, both green
in the `npm test` run (E17).

### E2 — AC1.2
Live probe: the same repo, given a live origin, with `--local-only` passed explicitly.
```
$ git -C <repo> remote add origin <bare>.git && git -C <repo> push -q origin main
$ node packages/cli/src/main.ts --repo <repo> up --local-only --no-open --port 48203
engine watching <repo> (heartbeat 180s, local-only (--local-only)) — ^C to stop
```
Compare to the same repo with no flags (auto-detect resolves push, since origin exists):
```
$ node packages/cli/src/main.ts --repo <repo> up --no-open --port 48202
engine watching <repo> (heartbeat 180s, pushing to origin (origin auto-detected)) — ^C to stop
```
`--local-only` overrode auto-detect on a live-origin repo exactly as `--no-push` does today.
Also `config.test.ts:115` (`AC1.2: explicit opts.localOnly on an origin repo forces push off`)
and `divergence.test.ts:235` (decision write leaves origin's tip unchanged under an explicit
`localOnly` designator on a live origin) — both green.

### E3 — AC1.3
`config.test.ts:157` (`AC1.3: a config entry with an origin and no push key stays push:false`)
and `config.test.ts:188` (`AC1.3: existing push precedence is unchanged — explicit push:true
still overrides auto-detect`) are new, but the criterion's actual regression surface is the
existing cases: `divergence.test.ts` lines 61–123 (`aheadOfOrigin`, the three `zero-config
sources push human writes` cases) pass unchanged in the full `npm test` run (E17), with no
reflow of line numbers (task 05's own constraint).

### E4 — AC2.1
`divergence.test.ts:235` (`local-only names the mode... an explicit localOnly designator
overrides auto-detect on a live origin: the decision writes, origin stays untouched`) writes a
decision against a live-origin repo under local-only and asserts `originTip(bare, ref.branch) ===
before`. Green in E17. Live-reproduced under E7 (below) via `GIT_TRACE`, which shows zero `push`
subprocesses across two heartbeats against a live origin.

### E5 — AC2.2
Both call sites exercised live.

Engine first-dispatch (`frontend/packages/orchestrator/test/local-only.test.ts:85`, green in
E17): asserts the engine's draft-PR-ensure log line contains `skipped` and `local-only`, and that
`dispatcher.calls.length` still equals 1 (dispatch itself proceeds).

`agentic arm`, live, reproducing the spec's leak shape (origin exists, branch already pushed
*before* local-only was requested — via a per-source `local_only: true` config entry, since `arm`
has no CLI flag of its own):
```
$ git -C $REPO push -q origin run/verify-arm2   # pushed before local-only requested
$ XDG_CONFIG_HOME=$CFGDIR node packages/cli/src/main.ts arm verify-arm2
staged verify-arm2 → run/verify-arm2 (dd3e24f04e)
Arm verify-arm2 into phase "plan"
→ 28ac80525b state(verify-arm2): armed by Verifier
local-only mode — draft-PR ensure suppressed
```
`ensureDraftPr`'s exec spy also proves zero `gh` invocations in
`frontend/packages/core/test/pr-ensure.test.ts:113` (`local-only mode short-circuits before any
git or gh work, even on the leak-shape repo`) and `frontend/packages/core/test/divergence.test.ts:251`
— both green (E17).

### E6 — AC2.3
Live, same config-tier local-only source with a live origin:
```
$ XDG_CONFIG_HOME=$CFGDIR node packages/cli/src/main.ts sync
local-only: nothing to sync
$ XDG_CONFIG_HOME=$CFGDIR node packages/cli/src/main.ts sync --live
local-only: nothing to sync
```
Provider-spy proof: `frontend/packages/core/test/sync.test.ts:69` (`planSyncForSource returns
'local-only' without ever invoking the provider factory`) and
`divergence.test.ts:272` (same, against a `loadSources`-resolved source) — both green (E17).

### E7 — AC2.4
Live, local-only against a repo with a live, reachable origin, two heartbeats:
```
$ GIT_TRACE=1 node packages/cli/src/main.ts --repo $REPO up --local-only --heartbeat 2 --no-open --port 48204
# (ran ~5s, killed) — grep for fetch|push in the trace output:
$ ... | grep -i "fetch\|push"
(no output)
```
Zero `git fetch`/`git push` subprocesses ran, not merely a caught failure. Unit seam:
`frontend/packages/orchestrator/test/local-only.test.ts:60` (`engine heartbeat sync under
local-only (AC2.4): performs zero git invocations`, spying on `engine.source.git.run`) and
`frontend/packages/core/test/fetch-sync.test.ts:...` (`syncFromRemote under local-only (AC2.4):
returns before any git invocation`) — both green (E17). The server's interval-sync guard
(`server/src/main.ts:86`) is read-verified (skips `syncFromRemote` and logs
`local-only: not syncing <id> from origin` when `s.localOnly`).

### E8 — AC3.1
Live, remoteless repo:
```
$ node packages/cli/src/main.ts --repo <remoteless-repo> sync
local-only: nothing to sync
$ echo $?
0
```
Also `frontend/packages/cli/test/cli.test.ts:347` (`agentic sync — local-only short-circuit
(R3): against a remoteless source... prints the literal line, exits 0, and never throws
(AC3.1)`), green (E17).

### E9 — AC3.2
Live:
```
$ node packages/cli/src/main.ts --repo <remoteless-repo> sync --live
local-only: nothing to sync
$ echo $?
0
```
And config-tier live-origin case above (E6) shows the same under `--live`.
`cli.test.ts:356` (`--live makes zero state writes to any run branch and still exits 0
(AC3.2)`) asserts the run branch's tip is byte-identical before/after — green (E17).

### E10 — AC4.1
Live, CLI tier:
```
$ node packages/cli/src/main.ts --repo <repo> up --local-only --push --no-open --port 48199
source repo: local-only and push are both explicitly requested — they conflict (local-only forces push off); pick one
$ echo $?
1
```
Live, config tier (`local_only: true` + `push: true` on the same source entry):
```
$ XDG_CONFIG_HOME=$CFGDIR node packages/cli/src/main.ts status
source repo: local-only and push are both explicitly requested — they conflict (local-only forces push off); pick one
$ echo $?
1
```
`cli.test.ts:366` additionally proves nothing is listening on the port after the CLI-tier
conflict (a socket connect attempt is refused). `local-only.test.ts:110` proves the same for
`assembleOrchestrator` (the standalone binary's independent check, ADR-5). All green (E17).

### E11 — AC4.2
Three of the five marker paths reproduced live (auto-detect push, auto-detect local-only,
explicit `--local-only` — see E1/E2 above); the remaining two (`--push`, `--no-push`) and all
five are unit-proven directly against `resolveUpMode` in
`frontend/packages/cli/test/cli.test.ts:384` (`resolveUpMode — the five startup markers`), one
`it` per marker string, green (E17).

### E12 — AC5.1
`docs/TOPOLOGY.md:81` no longer claims the phantom guard: "There is no startup guard that
refuses `--push` without a sync provider — 'sync provider' is not a first-class object anywhere
in the `up`/engine startup path". The choice (edit the doc, not build the guard) is recorded as
ADR-6 in `runs/local-only-mode/plan.md`.

### E13 — AC5.2
```
$ grep -rn "refuse.*--push\|refuses.*push.*without\|sync provider" docs/
docs/TOPOLOGY.md:81:single `up` authority (#104). There is no startup guard that refuses `--push`
docs/TOPOLOGY.md:82:without a sync provider — "sync provider" is not a first-class object anywhere
```
The only hit states the guard does not exist, matching actual `up`/engine startup code (no
`assembleOrchestrator`/CLI code path refuses `--push` for lack of a sync provider). One residual,
pre-existing wording gap is noted below (Gaps).

### E14 — AC6.1
`docs/TOPOLOGY.md` §3.6 ("Local-only: a supported, first-class topology", lines 160–231) names
the mode, states the resolution tiers, and lists the four guarantees (no push, no `gh`/GitHub
API calls, no origin fetch, `agentic sync` reports cleanly) verbatim, matching R2/R3.
`docs/ORCHESTRATOR.md:197` cross-references it in the divergence section.

### E15 — AC6.2
`docs/TOPOLOGY.md:228` ("Out of scope: the hosted deployment... Local-only is not an option
there; see DEPLOY.md") and `docs/DEPLOY.md:17` ("This recipe clones from `REPO_URL` and
legitimately requires a remote... it is out of scope for the local-only topology described in
TOPOLOGY.md §3.6") state the boundary in both directions.

### E16 — AC7.1
`frontend/packages/core/test/divergence.test.ts` gained two new `describe` blocks after the
existing cases (lines 222–284): `local-only closes the PR-ensure leak (AC2.2)` (the brief's exact
leak shape — origin exists, branch pushed, then local-only requested) and `local-only closes the
PR-approval sync leak (AC2.3)` (remoteless `loadSources` source, provider factory never invoked).
Both green (E17), and no existing describe/it in that file was reflowed (confirmed by diff:
`git diff main...HEAD -- frontend/packages/core/test/divergence.test.ts` only adds lines after
line 220).

### E17 — AC7.2
```
$ npm test   # in frontend/
...
 Test Files  41 passed | 1 skipped (42)
      Tests  406 passed | 1 skipped (407)
   Duration  144.90s
```
The 1 skipped test is `packages/orchestrator/test/live-smoke.test.ts`, gated on a `live`
env var for real `claude-code` dispatch — pre-existing, unrelated to this run, skipped by
default before this change too. All hosted-push-path suites named in the criterion are present
and green: `divergence.test.ts` (14/14), `pr-ensure.test.ts` (folded into the same file, 7/7),
`sync.test.ts` (5/5). `npm run typecheck` also passes clean (`tsc -p tsconfig.json && tsc -p
packages/web/tsconfig.json`, no output, exit 0).

### E18 — AC8.1
```
$ git diff main...HEAD -- roles/ contracts/ | wc -l
0
```

## Beyond the happy path

Every live probe above ran a real spawned CLI process against real filesystem repos and real
bare-clone origins, not only the implementer's vitest suite, to catch anything those tests didn't
exercise.

- The spec's named leak case — an origin present, the branch already pushed, and local-only
  requested only afterward — was reproduced against the `arm` command specifically. Only `agentic
  up` (the CLI entrypoint, `frontend/packages/cli/src/main.ts`) and the standalone orchestrator
  binary take a local-only flag of their own; `arm`, `sync`, and `status` do not. Forcing the mode
  for those commands required a per-source config-file entry instead, which is the intended second
  explicit tier (ADR-1), not a workaround.
- A trace of two full heartbeat cycles against a live, reachable origin distinguished "no fetch
  attempted" from "fetch attempted and its failure silently tolerated" — the exact distinction the
  spec calls out as today's actual gap.
- The push-plus-local-only conflict was tried at both tiers the spec names, once as CLI flags on
  `up` and once as a config-file entry, confirming both `loadSources` and `assembleOrchestrator`
  independently enforce the same rejection.
- The conflict's exit path was confirmed to never open the listening port at all, not merely to
  exit the process eventually.

## Gaps

One pre-existing, out-of-scope documentation imprecision remains, already disclosed by this run's
own review record. The hosted deploy guide still describes `agentic up` as pushing "by default,"
which is loosely worded — the actual default is origin auto-detection, not an unconditional push —
but is not a genuine contradiction in that recipe's own scenario, where an origin is always
present and auto-detection resolves to push regardless. `runs/local-only-mode/review-06.md`
already named this finding F3 and left it alone as outside this task's cap. It is repeated here
only so it is not lost.

Two verification paths relied on unit coverage rather than an end-to-end process spawn. The
`--push` and `--no-push` startup-marker strings were confirmed through the `resolveUpMode` unit
tests rather than a live spawned process, unlike the auto-detect and explicit-local-only markers,
which were reproduced live. Both marker sets exercise the same pure function, so this is a
completeness note rather than a correctness doubt.

The server's per-source interval-sync skip was confirmed by reading its guard and log line rather
than by spawning the server against a `fetch_interval` source over wall clock time. The same
underlying self-guard is covered live by the engine heartbeat probe above and by unit tests,
leaving only a narrow residual risk of a wiring-only regression in that one file.

FleetView UI treatment was not exercised, matching the spec's own statement that badge rendering
is out of scope for this run.
