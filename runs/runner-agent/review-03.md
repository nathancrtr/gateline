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
