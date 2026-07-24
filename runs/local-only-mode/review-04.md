# Review Report: 04-server-orchestrator-wiring

**Verdict:** approve
**Round:** 1 of 3
**Diff reviewed:** eaa6e183359f249c6e4f202886058f1d614898a1

## Findings

### F1 — minor — the binary's dry-run path bypasses the local-only/push conflict check
- **Where:** `frontend/packages/orchestrator/src/main.ts:105-116`
- **Failure scenario:** `agentic-orchestrator tick --dry-run --local-only --push` returns before `buildEngine` is reached, so the conflicting pair prints derived actions and exits 0 — the operator's preview accepts a flag combination that live `tick`, `watch`, and `sweep` all correctly refuse. No engine starts and nothing is dispatched or written, so AC4.1's "no engine or server started" holds; the defect is inconsistent flag validation between preview and live.
- **Requirement:** AC4.1 (spirit: the pair is never silently accepted)

### F2 — minor — the server's interval-skip branch is untested; a mutant deleting it survives with a lying log
- **Where:** `frontend/packages/server/src/main.ts:86-89`
- **Failure scenario:** delete the `if (s.localOnly)` skip — the timer is scheduled, `syncFromRemote` self-guards in core so zero fetches still run (R2 holds), but the startup log prints `syncing <id> from origin every Ns` for a local-only source. No test in this diff or in task 05's coverage commit exercises the branch, so that mutant passes the whole suite. The task scope itself designates the skip "honesty in the log, not the safety mechanism", so severity is minor.
- **Requirement:** AC2.4 (server interval half — evidence), R4's log-honesty intent

## Coverage

I traced the local-only flag end to end through the server serve loop and the orchestrator engine, start assembly, and binary CLI, ran the new tests plus the hosted and push suites, and found the wiring correct with only the two minor gaps above.

- AC2.2 engine ensure site ✓ — `EngineConfig.localOnly` reaches the first-dispatch `ensureDraftPr` opts (engine.ts:465); the new test discriminates, since a mutant dropping the opt would return the core's "no remote.origin.url" skip note, which lacks the asserted `local-only` substring
- AC2.4 engine heartbeat ✓ — the flag is forwarded into the engine's `LocalGitSource` (engine.ts:109); the zero-`git.run` spy test runs over a clone that has an origin, so a mutant dropping the forwarding fetches and fails the test
- AC2.4 server interval ✓ wiring — `ServeOptions.localOnly` reaches `loadSources` (server main.ts:54) and the skip fires before any timer; the safety mechanism is the core self-guard, already spy-tested in the fetch-sync suite (fetch-sync.test.ts:133); only the log branch is untested (F2)
- AC4.1 binary half ✓ — the conflict throws the core's named error before registry, adapter, or engine work (start.ts:69); live `tick`, `watch`, and `sweep` all reach it via `buildEngine`, and the top-level `await program.parseAsync()` turns the rejection into a non-zero exit; only `--dry-run` bypasses (F1)
- AC1.1 auto-detect ✓ — the trigger is the same probe core uses (`remote.origin.url` via `configGet`), short-circuited when either flag is explicit; the remoteless-fixture test kills a defaults-to-push mutant
- Push suppression ✓ — start.ts forces `push=false` under local-only; I checked the residual mutant (`push = opts.push`) is behaviorally equivalent because the conflict check already excludes the only divergent input, and the core source constructor forces push off as belt-and-braces
- Scheduler egress ✓ — its only origin contact is `pushBranch`, gated on the forced-false `push`; no fetch or `gh` calls anywhere in the scheduler
- Config-tier isolation ✓ — `loadSources` applies the CLI-tier `localOnly` opt only to zero-config sources, so `up`'s round-trip of the resolved boolean through `startServer` is idempotent and cannot flip a config entry's own resolution
- Server direct-invocation conflict path ✓ — a config-entry conflict propagates to the existing catch-print-exit-1 handler; the argv parser never grew push flags, matching the task's stated scope
- Tests run ✓ — new file 4/4 green, orchestrator push/hosted/sync suites 14/14 green, typecheck clean; I did not run the full suite in one pass (the implementer's contention timeouts are plausible in this sandbox) and instead spot-checked the suites this diff's `EngineConfig`/server changes could regress — all green

## Boundary check

Inside the surface. The commit touches exactly the five declared files plus the task's own YAML (notes update — the task record, standard practice). No files outside `file_contact_surface`.
