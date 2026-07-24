# Review Report: 03-runner-api

**Verdict:** request-changes
**Round:** 1 of 3
**Diff reviewed:** commit cca6612 (c68b716..cca6612, run/runner-agent)

## Findings

### F1 — blocking — the claim `Set` never expires, so a claim with no subsequent report poisons its key and livelocks every re-dispatch of that task
- **Where:** `frontend/packages/server/src/runner-api.ts:123-127` (claim adds), `:128-133` (report is the only deletion path)
- **Failure scenario:** worker claims `wordfreq|implementer|01-core|1`, crashes before reporting → no report ever arrives → `RemoteDispatcher` times out, entry closes failed → engine re-dispatches the same task at the same round (no artifact landed, so the key is byte-identical) → the new intent is listed but `claim()` returns already-claimed forever → the restarted worker skips it every poll → every retry times out until a server restart clears the in-memory set. Task 05's scope item 5 ("killed workstation … aged out, re-dispatched, next tick handles it") and AC7.2 cannot pass, and no remaining task's surface owns `runner-api.ts` (task 05 owns only server `main.ts`), so the fix must land here. Note: pruning keys absent from `pendingIntents()` is insufficient (a re-dispatch re-adds the key before a poll can prune); a TTL keyed to the intent's `timeoutMs` works in-surface.
- **Requirement:** spec R7/AC7.2; task 05 scope item 5 (consumer contract)

### F2 — blocking — no test pins auth on the report route; the mutant that drops its guard passes the suite, allowing unauthenticated outcome injection
- **Where:** `frontend/packages/server/test/runner-api.test.ts` (no unauthenticated `/api/runner/report` request anywhere); guard at `frontend/packages/server/src/app.ts:111`
- **Failure scenario:** each route repeats its own `authorized(c)` check, so deleting the one at app.ts:111 leaves intents/claim tests green and all three report tests green (all use `authed()`) — yet anyone reaching the port could then POST fabricated `ok: true` outcomes that resolve pending dispatches and close ledger entries. AC6.2 names the report surface explicitly; the invalid-token case for it is untested.
- **Requirement:** R6/AC6.2 ("automated test … covers both cases" for the poll/report surface)

### F3 — blocking — no test discriminates the base-OID augmentation; the ADR-7 obligation this task exists to carry ships unverified
- **Where:** `frontend/packages/server/test/runner-api.test.ts:65-78` (sole augmentation test: bogus `repoDir`, asserts only no-throw); `frontend/packages/server/src/runner-api.ts:112-121`
- **Failure scenario:** the mutant that deletes the `repoDir` branch in `listIntents` (always `return intents`) passes all 13 tests; so does one resolving the wrong ref (e.g. `rev-parse` of `slug`), since a null resolution silently degrades to an unaugmented intent. This augmentation is precisely what ADR-7 moved into this task after review-02.md F3 — a temp-git fixture (init, commit, branch `run/wordfreq`, assert `baseOid` equals the created OID) pins it cheaply.
- **Requirement:** task scope (ADR-7 paragraph); plan ADR-7/ADR-2

### F4 — minor, PLAUSIBLE — bearer-token comparison is not constant-time, diverging from the webhook's own standard
- **Where:** `frontend/packages/server/src/app.ts:88` (`presented === runner.token`) vs `frontend/packages/server/src/webhook.ts:15-21` (`timingSafeEqual`)
- **Failure scenario:** an attacker who can reach the port behind the Access bypass measures response-time deltas across token prefixes to recover `RUNNER_TOKEN` incrementally; network jitter makes this marginal in practice — PLAUSIBLE, but the sibling route already sets the constant-time convention.
- **Requirement:** R6 ("mirroring the webhook-bypass shape")

### F5 — minor, PLAUSIBLE — `baseOid` is the branch tip at poll time, not the armed commit's pin
- **Where:** `frontend/packages/server/src/runner-api.ts:112-121` (`resolveOid(repoDir, intent.branch)` evaluated per poll)
- **Failure scenario:** the engine commits closing bookkeeping for a sibling dispatch on the same branch between arm and poll → the intent carries a later OID than the armed commit; worse, an OID committed locally but not yet pushed → the worker's clone from origin cannot fetch it and the checkout fails until a post-push retry. The true pin exists only in the engine at dispatch time — capture belongs to task 05's wiring, or the best-effort semantics should be documented as such rather than labeled "the armed commit".
- **Requirement:** ADR-2; ADR-7 ("base OID of the armed commit")

### F6 — minor — the intents response omits the repository remote URL task 04 expects the server to provide
- **Where:** `frontend/packages/server/src/runner-api.ts:112-121` (response shape) vs `runs/runner-agent/tasks/04-workstation-agent.yaml:15-16` and its notes (server "includes the origin URL")
- **Failure scenario:** task 04's agent must always be configured with `--repo-url`; the "server provides it" path can never be added later because no remaining task's surface includes `runner-api.ts`. Degrades to the documented fallback rather than breaking — minor, but it should be a deliberate choice, not an omission.
- **Requirement:** task 04 scope 5a (cross-task contract)

## Coverage

I checked the full diff against the task scope, spec requirements R5 and R6, and the ADR-7-amended plan, ran the server tests and typecheck on this checkout, and everything outside the six findings came back clean.

- R6/AC6.1 ✓ — unset token (and unset callback) → builder returns undefined → routes unmounted, 404; tested at both builder and app level
- R6/AC6.2 partial ✓ — missing and invalid token → 401 on intents; claim's auth pinned; valid token → 200 with intents; report route's negative case is F2
- R5/AC5.1 ✓ — the module's only side effect is a read-only `git rev-parse`; no write to `state.yaml`, `gates.*`, or any ref anywhere in the diff
- Structural mirrors ✓ — `PendingIntent` and `DispatchOutcome` match task 02's shapes field-for-field; the zero-arg `RunnerCallback` divergence is safe because TypeScript rejects passing `RemoteDispatcher` directly (a parameter-requiring function is not assignable to a zero-arg signature), forcing task 05 to write the adapter closure the notes describe
- Claim atomicity ✓ — no await between the `has` check and `add`; single-threaded event-loop access only
- Error paths ✓ — malformed JSON → 400 on both POST routes; missing key/outcome → 400; unknown-key report → 200 `{resolved:false}`, logged, no throw; unresolvable ref → intent served without `baseOid`, route never crashes
- main.ts wiring ✓ — `RUNNER_TOKEN` read from env; `repoDir` chosen as the first source with a local dir, matching the webhook/engine-health convention; routes gated on both token and callback
- Verification reproduced ✓ — targeted server suite 48/48; `npm run typecheck` clean on this checkout
- Existing surfaces ✓ — the app.ts delta is an additive block plus a type import; webhook and run routes behaviorally untouched

## Boundary check

Code changes touch exactly the four declared surface files (`runner-api.ts` and `runner-api.test.ts` new; `app.ts`, `main.ts` edited). The fifth changed file, `runs/runner-agent/tasks/03-runner-api.yaml`, is the implementer's append-only notes entry — the contract's report-back channel, not a breach. The flagged deviation (`AppDeps.runnerApi` instead of `AppDeps.runnerCallback`, with `ServeOptions` carrying the literal `runnerCallback` field) stays inside the same files and is functionally equivalent layering, correctly disclosed in the notes. No breach.

---

# Round 2

**Verdict:** approve
**Round:** 2 of 3
**Diff reviewed:** commit c791b43 (cca6612..c791b43, run/runner-agent)

## Prior findings

- **F1 — resolved, mutant-verified.** The claim store is now a TTL Map sized to the matching intent's `timeoutMs` (`frontend/packages/server/src/runner-api.ts:187-194`), with an injectable clock and immediate release on report (`:196`). I re-applied the round-1 mutant (claims never expire — drop the `expiresAt > now()` arm) and both TTL tests fail (`runner-api.test.ts:159`, `:177`); a mutant that ignores `timeoutMs` in favor of the 10-minute default is killed by the 1001ms re-claim assertion (`:173-174`). The crashed-worker → re-dispatch → livelock scenario now self-heals without a server restart.
- **F2 — resolved, mutant-verified.** Two new unauthenticated/invalid-token report tests (`runner-api.test.ts:248`, `:264`) assert 401 **and** `resolveOutcome` never called. I deleted the report route's `authorized(c)` guard (app.ts:123) and exactly those two tests fail; restored, 22/22 pass. AC6.2's both-cases obligation now covers all three routes.
- **F3 — resolved, mutant-verified.** The augmentation test now builds a real throwaway repo (`makeRepo`, `runner-api.test.ts:24-36`) and asserts the served `baseOid` equals the branch's actual `rev-parse` OID (`:105`). Both round-1 mutants re-applied and killed: deleting the `repoDir` branch in `listIntents` fails the test, and resolving `intent.slug` instead of `intent.branch` fails it too. The graceful-degradation case is kept as its own test (`:108`) plus a no-`repoDir` case (`:122`).
- **F4 — resolved.** `authorized()` now length-checks then `timingSafeEqual`s buffers (app.ts:89-96), byte-for-byte the `verifySignature` convention in webhook.ts.
- **F5 — resolved by documentation** (the accepted alternative in the round-1 finding). The `baseOid` doc comment (`runner-api.ts:35-44`) now states plainly it is the branch tip at poll time, names both failure modes (sibling-commit drift, unpushed-OID unfetchable from origin), and assigns arm-time capture to task 05, which is also recorded in the task notes for the planner. Cosmetic residue only: the comment's opening line and the test name at `runner-api.test.ts:94` still say "armed commit" — not worth a round.
- **F6 — resolved.** `RunnerApi.repoUrl()` resolves `git remote get-url origin` (memoized, null-tolerant, `runner-api.ts:179-186`) and rides the intents response as a top-level `repoUrl` (app.ts:105-106), matching task 04's "server includes the origin URL" expectation. Tested: real-remote resolution at app level (`runner-api.test.ts:129`), null with no `repoDir` and with no `origin` remote (`:139`).

## Findings

### F7 — minor, PLAUSIBLE — a transient failure of the first `repoUrl` resolution memoizes `null` for the process lifetime
- **Where:** `frontend/packages/server/src/runner-api.ts:184` (failed promise's `null` cached forever) vs `:174` (per-poll `baseOid` retries every request)
- **Failure scenario:** the first authenticated poll lands while `execFile('git', … 'remote', 'get-url', 'origin')` fails transiently (e.g. fork EAGAIN under load) → `null` is memoized → every subsequent poll serves `repoUrl: null` until a server restart, forcing all workstations onto the `--repo-url` fallback despite a configured origin. Marginal because the documented fallback exists and the common failure (no origin remote) genuinely is permanent — retrying only on `null` would close it in one line if ever revisited.
- **Requirement:** task 04 scope 5a (best-effort quality, not a contract breach)

## Coverage

I re-verified all six round-1 findings against the actual code — running the suite and hand-applied mutants for the three blocking ones — and adversarially re-read the whole round-2 delta; everything outside the one minor finding above came back clean.

- F1–F6 resolution ✓ — per-finding status above; four mutants applied, all killed, working tree restored after each
- Verification reproduced ✓ — targeted server suite 57/57 (22 in runner-api.test.ts) and `npm run typecheck` clean on this checkout, matching the implementer's claims
- Claim-TTL semantics ✓ — TTL starts at claim time while the dispatcher's timeout runs from dispatch time, so after a timeout-driven re-dispatch of an identical key the stale claim can outlive the new intent by roughly one poll latency; that is a bounded claim delay that self-heals, not a livelock, so it stays out of the findings
- Claim-map growth ✓ — expired entries linger until re-claim or report, but growth is bounded by distinct keys presented by an already-authenticated caller; acceptable
- Auth compare ✓ — empty-token and empty-header paths return false before `timingSafeEqual`; length short-circuit leaks only length, same as webhook.ts
- Route error paths ✓ — `Promise.all` in the intents route composes two internally throw-tolerant resolvers; 400/401 paths on claim/report behaviorally unchanged from round 1
- Test hygiene ✓ — `makeRepo` isolates `GIT_CONFIG_GLOBAL`/`SYSTEM`, temp dirs cleaned in `afterEach`; no wall-clock sleeps anywhere (injected clock)
- main.ts ✓ — untouched this round, and its `buildRunnerApi` call site needs no change for the new optional `now`/derived `repoUrl` surfaces

## Boundary check

The round-2 commit touches `runner-api.ts`, `app.ts`, `runner-api.test.ts` (all in the declared surface) plus the task file's append-only notes entry — the report-back channel, as in round 1. `main.ts` untouched. No breach.
