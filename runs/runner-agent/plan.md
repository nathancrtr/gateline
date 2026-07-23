# Technical Plan: Runner agent (subscription-billed dispatch off the control-plane machine)

## Approach

A new `RemoteDispatcher` sits alongside `HeadlessDispatcher` as a peer `Dispatcher`
implementation. Where `HeadlessDispatcher` spawns a child process on the same
machine, `RemoteDispatcher` delegates execution to a workstation agent that polls
the control plane, executes work in a disposable workspace, and reports back —
exactly the CI-runner shape TOPOLOGY.md §3.3 names.

The control plane exposes three new authenticated API endpoints the workstation
agent uses: list open intents, claim one, and report the outcome. The server and
`RemoteDispatcher` share an in-memory callback map: when the server receives a
workstation report, it resolves the dispatcher's pending Promise, and the engine's
existing `closeDispatch` path meters and commits — the workstation never touches
`state.yaml`, run branches, or git refs.

The workstation agent is a standalone Node.js process in a new frontend package.
It clones the repository from the control plane's remote URL, checks out the run
branch, executes the adapter's headless command as declared by its manifest, and
discards the workspace on completion. The agent is adapter-generic: it reads the
manifest's `headless.command` and runs it, with zero role or vendor branching.

The engine selects between `HeadlessDispatcher` and `RemoteDispatcher` through
configuration — an opt-in that leaves the existing API-key path untouched.

## Interface contracts

### DispatchRequest extension (seam.ts)
```ts
export interface DispatchRequest {
  cwd: string
  role: string
  body: string
  timeoutMs: number
  /** Run slug the dispatch is for — the workstation clones from origin, not from cwd. */
  slug?: string
  /** Run branch name — the workstation checks this out in its disposable workspace. */
  branch?: string
}
```

### RemoteDispatcher callback surface (runner-dispatcher.ts)
```ts
export interface RunnerCallback {
  /** Resolve a pending dispatch by key = `${slug}|${role}|${task}|${round}`. */
  resolve(key: string, outcome: DispatchOutcome): boolean
  /** List intents with open ledger entries across active runs. */
  pendingIntents(): PendingIntent[]
}

export interface PendingIntent {
  key: string        // slug|role|task|round
  slug: string
  branch: string
  role: string
  task: string | null
  round: number | null
  adapter: string    // the adapter that should execute this intent
}
```

### Runner API endpoints (server)

`GET /api/runner/intents`
- Auth: `Authorization: Bearer <token>` header
- Response: `{ intents: PendingIntent[] }`
- Config-gated: route does not exist when `RUNNER_TOKEN` is unset

`POST /api/runner/claim`
- Auth: `Authorization: Bearer <token>` header
- Body: `{ key: string }` — the intent key from GET /api/runner/intents
- Response: `{ ok: true }` or `{ ok: false, reason: "already-claimed" | "unknown" }`

`POST /api/runner/report`
- Auth: `Authorization: Bearer <token>` header
- Body: `{ key: string, outcome: DispatchOutcome }`
- Response: `{ ok: true }` or `{ ok: false, reason: "unknown" | "already-resolved" }`

### Workstation agent CLI

```
node packages/runner-agent/src/main.ts \
  --control-plane https://control.example.com \
  --token <RUNNER_TOKEN> \
  --work-dir /tmp/agentic-runner \
  --poll-interval 5
```

## Decisions (ADRs)

### ADR-1: Polling transport — the workstation reaches out; no inbound port

- **Choice:** The workstation agent polls `GET /api/runner/intents` on a
  configurable interval. The control plane never initiates a connection to the
  workstation. No listening port exists on the workstation.
- **Rejected:** A push/webhook transport from control plane to workstation — would
  require the workstation to have a reachable address and an open port, violating
  R3's "no inbound connection is ever accepted on the workstation" constraint and
  adding deployment complexity (firewall rules, dynamic IPs) the CI-runner analogy
  deliberately avoids. A WebSocket connection initiated by the workstation was also
  rejected: it adds connection-state management for negligible latency benefit when
  polling at a 5–30 second interval against dispatch wall clocks measured in
  minutes.
- **Consequences:** The agent is trivially deployable behind any NAT or firewall
  — same posture as a GitHub Actions self-hosted runner. The trade-off is a
  polling interval of latency before the agent notices a new intent. The engine's
  `staleMs` window (default 5 minutes) must comfortably exceed the poll interval
  so the agent has time to claim before aging.

### ADR-2: In-memory callback map bridges RemoteDispatcher and the server

- **Choice:** `RemoteDispatcher` exposes a `RunnerCallback` interface (a
  `Map<string, {resolve, reject}>` for pending dispatches, plus a list of pending
  intents). The server's runner API handler holds a reference to this callback and
  calls `resolve(key, outcome)` when a workstation reports. No disk, no polling
  from the dispatcher side.
- **Rejected:** Polling from the dispatcher side (the dispatcher repeatedly calls
  the server until the outcome arrives) — doubles the polling surface and adds
  latency. A committed queue (writing claimed intents to a file or the ledger
  itself) was rejected because it would make the engine's crash-recovery
  (sweepStale) indistinguishable from a genuinely lost workstation, requiring the
  lease-timestamp extension R7 says to avoid unless necessary.
- **Consequences:** The server and orchestrator must be co-located (they share
  this map). This is already the blessed topology (TOPOLOGY.md §3.1). If the
  server restarts, pending callbacks are lost — but the engine's `sweepStale` ages
  out open ledger entries with no live job, and the workstation's late report
  (POST /api/runner/report) receives `already-resolved` and moves on.

### ADR-3: Bearer-token auth — static shared secret, not HMAC

- **Choice:** The runner API endpoints authenticate with an `Authorization: Bearer
  <token>` header. The token is set via the `RUNNER_TOKEN` environment variable on
  the server. When `RUNNER_TOKEN` is unset, the routes do not exist (404) —
  mirroring `buildWebhook`'s `secret` gate.
- **Rejected:** HMAC-over-body (the webhook's pattern) — a polling request has no
  event body to sign, and signing the HTTP method + path + timestamp adds
  complexity without benefit for a simple request/response exchange. mTLS was
  rejected as over-engineered for a single-workstation deployment behind an
  identity-aware proxy.
- **Consequences:** The token is a simple shared secret. Rotation means updating
  the environment variable on both sides. The token travels over TLS (the control
  plane is behind an identity-aware proxy per DEPLOY.md). An attacker who steals
  the token can claim and report intents — but cannot write state, approve gates,
  or push commits (the server never grants those powers through this route).

### ADR-4: Optional fields on DispatchRequest — not a separate interface

- **Choice:** `DispatchRequest` gains optional `slug` and `branch` fields.
  `HeadlessDispatcher` ignores them. `RemoteDispatcher` requires them and throws
  if they are unset. The engine's `launch()` always passes them (it already has
  `ref.slug` and `ref.branch`).
- **Rejected:** A separate `RemoteDispatchRequest` interface or a union type —
  would require the engine to branch on dispatcher type before constructing the
  request, violating R9's "not a code fork of the engine's dispatch call site."
  A wrapper object (dispatch request carrying a nested transport-specific payload)
  was rejected as adding indirection for a two-field extension.
- **Consequences:** `DispatchRequest` grows by two optional fields. Every
  `Dispatcher` implementation must tolerate them being present; `HeadlessDispatcher`
  already does (it only reads `cwd`, `role`, `body`, `timeoutMs`). The contract
  is documented: `slug` and `branch` are required for remote dispatch, ignored for
  local.

### ADR-5: Disposable workspace via shallow clone + checkout + rm

- **Choice:** The workstation agent clones the repository (shallow, single-branch)
  from the control plane's remote URL into a temp directory, checks out the run
  branch, executes, and removes the directory. Each dispatch gets a fresh clone.
- **Rejected:** Reusing a persistent clone with `git fetch` + `git checkout`
  between dispatches — would violate R4's "never one checkout left
  mounted/reused/updated in place" requirement and risks cross-dispatch
  contamination (stale node_modules, leftover build artifacts). Git worktrees from
  a single bare clone were rejected because they share object state and a
  corrupted or mid-maintenance clone would affect all dispatches; a fresh clone is
  self-contained and trivially verifiable.
- **Consequences:** Each dispatch pays the cost of a network clone. For a typical
  repository (<100MB), this is seconds on a broadband connection — negligible
  compared to dispatch wall clocks measured in minutes. The `--work-dir` flag
  controls where temp directories are created.

### ADR-6: Intent claim via server-side in-memory set

- **Choice:** The server maintains a `Set<string>` of claimed intent keys
  (in-memory, same lifetime as the server process). `POST /api/runner/claim` does
  an atomic add: if the key is already in the set, it returns `already-claimed`;
  otherwise it adds the key and returns `ok`. The set is cleared when a report
  resolves the intent. This is purely for mutual exclusion — the engine's
  `this.jobs` map is the authoritative liveness signal.
- **Rejected:** Claiming by writing to the ledger entry — the workstation must
  never touch `state.yaml` (R5). A timestamp in the ledger placed by the engine
  was rejected because the engine writes the ledger entry before `dispatch()` is
  called, and adding a second write for the claim would break the
  commit-then-launch sequencing.
- **Consequences:** The claim set is server-process-local — a server restart loses
  it. This is safe because the engine's `sweepStale` already handles the "entry
  aged out, re-dispatched" path. After a server restart, a polling workstation
  might claim and execute an intent whose dispatcher-side Promise was lost, then
  report to a server that has no matching callback — the server returns
  `already-resolved`, the workstation moves on, and the engine's stale-aging
  cleans up the orphan ledger entry.

## Requirement → task mapping

| Requirement | Task(s) |
|-------------|---------|
| R1 | 02-remote-dispatcher, 05-wiring |
| R2 | 01-seam-extend |
| R3 | 04-workstation-agent |
| R4 | 04-workstation-agent |
| R5 | 02-remote-dispatcher, 03-runner-api, 04-workstation-agent |
| R6 | 03-runner-api |
| R7 | 02-remote-dispatcher, 05-wiring |
| R8 | 04-workstation-agent |
| R9 | 05-wiring |
| R10 | 06-live-smoke |

## Risks

1. **The harness CLI on the workstation is not logged in.** The spec declares
   harness CLI authentication out of scope. If the workstation's harness CLI
   (opencode, claude) has no active subscription session, every dispatch will fail
   at execution time. **Early signal:** the live-smoke test (task 06) runs a real
   dispatch end-to-end and will fail immediately if the harness is unauthenticated.

2. **Shallow clone may not include the run branch.** If the run branch was pushed
   very recently and the control plane's remote URL is a mirror with replication
   lag, `git clone --branch run/<slug>` may fail. **Early signal:** the workstation
   agent's first real dispatch after a run is armed.

3. **The `RUNNER_TOKEN` and the webhook secret share the same bypass policy.** If
   the identity-aware proxy's bypass rule for `/api/webhooks/github` is not
   extended to cover `/api/runner/*`, the workstation's requests will hit the proxy
   login page instead of the server. **Early signal:** the workstation agent logs
   a non-200 response from the intents endpoint on startup.

4. **Engine restart race with workstation mid-dispatch.** If the engine restarts
   while the workstation is executing, `sweepStale` ages out the open ledger entry
   and re-dispatches. The workstation's late report hits a server with no matching
   callback. Meanwhile the re-dispatched intent may also be claimed. This converges
   (the workstation reports `already-resolved`, the engine's new dispatch proceeds)
   but wastes the first execution's work. **Early signal:** ledger shows a failed
   entry followed by a successful one for the same role/task with a stale-aging
   error message.
