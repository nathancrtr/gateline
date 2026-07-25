# Technical Plan: Local-only as a first-class mode

## Approach

Local-only becomes a named outcome of the existing push resolution, plus an explicit
guard at each of the four seams where origin-directed egress escapes today. No new
resolution mechanism is added (R1). The resolver stays `loadSources`
(`frontend/packages/core/src/view-model/config.ts`): it gains a `localOnly` opt and a
per-source `local_only` config key, resolves both onto the existing `push` chain via
one normative table (below), and rejects the push-conflict case with a named error
(R4). Each `LocalGitSource` then carries a public `localOnly` flag that every
consumer reads — the single source of truth for "is the mode active".

The four egress guards all key off that flag:

- **git push** — already governed by the resolved `push` boolean, which the table
  forces to `false` under local-only (AC2.1).
- **draft-PR ensure** — a `localOnly` option on `ensureDraftPr` short-circuits
  before any git or `gh` work, covering both call sites (AC2.2, ADR-3).
- **PR-approval sync** — a new core helper takes a provider *factory*, so under
  local-only the `gh`-backed provider is never even constructed (AC2.3, ADR-4).
- **origin fetch** — `LocalGitSource.syncFromRemote` returns before fetching when
  the flag is set, covering the engine heartbeat and the server interval sync with
  one guard (AC2.4).

Entry points wire the flag through: `agentic up` resolves the mode once, prints an
unambiguous marker for every resolution path, and feeds the resolved push/local-only
pair to both the server and the engine (AC4.2, ADR-7). `agentic sync` prints the
literal `local-only: nothing to sync` and exits 0 (R3). The standalone
orchestrator binary gains the same flag and auto-detect so its heartbeat honors the
mode too.

Docs name the mode as a supported topology and reconcile the phantom startup guard
claim by editing the sentence, not building the guard (R5, R6, ADR-6). Roles and
contracts are untouched (R8).

## Interface contracts

### Mode resolution table (normative — implemented once, in `loadSources`)

Per source, with `originExists` = `git config remote.origin.url` resolves (the
existing `pushWhenOriginExists` probe, trigger unchanged per AC1.1):

1. Explicit local-only designator `true` AND explicit push `true` → throw
   `LocalOnlyPushConflictError` (both tiers: CLI flags, config keys).
2. `localOnly` :=
   - the explicit designator, if set (`--local-only` / `local_only:`); else
   - `false` when push is explicitly `true`; else
   - `true` when push is explicitly `false` **at the CLI tier only** (`--no-push`,
     ADR-1); else
   - `!originExists` (auto-detect; applies to config-tier sources too, ADR-2); 
3. `push` := `false` when `localOnly`; else the explicit push setting if any; else
   `originExists` for zero-config sources / `false` for config-file entries
   (existing defaults — AC1.3 regression surface).

Config-tier corollary (ADR-2): explicit `push: false` **with** an origin stays
plain no-push — fetch/`gh` remain live (the read-only poller topology,
`fetch_interval`). A `local_only: true` entry with `fetch_interval` gets a warning
that the interval is inert.

### Core (`@agentic/core` — all star-exported, no index edits)

```ts
// view-model/config.ts
export class LocalOnlyPushConflictError extends Error {}   // .name = 'LocalOnlyPushConflictError'
loadSources(opts: { repoOverrides?; configPath?; cwd?; push?: boolean; localOnly?: boolean })
  // throws LocalOnlyPushConflictError; config schema: sources[].local_only?: boolean,
  // sources[].push?: boolean (zod default removed; `?? false` applied by the table)

// sources/local-source.ts
new LocalGitSource(id, dir, { push?, localOnly?, identity?, fetchIntervalSeconds?, frameworkPrefix? })
get localOnly(): boolean          // options.localOnly === true; constructor forces push=false when set
syncFromRemote(): Promise<void>   // first line: if (this.localOnly) return  — zero `fetch` (AC2.4)
// Direct construction WITHOUT the option behaves exactly as today (no source-level auto-detect).

// sources/pr-ensure.ts
ensureDraftPr(dir, branch, slug, opts?: { exec?: ExecLike; localOnly?: boolean })
  // opts.localOnly → { status: 'skipped', note: 'local-only mode — draft-PR ensure suppressed' }
  // returned before any git or gh invocation (AC2.2)

// sources/sync.ts
export async function planSyncForSource(
  source: RunSource, providerFactory: () => PrProvider,
): Promise<SyncPlanEntry[] | 'local-only'>
  // reads (source as { localOnly?: boolean }).localOnly — factory never invoked when true (AC2.3)
```

### CLI (`@agentic/cli`)

```ts
// `up` gains: --local-only, and --push paired with the existing --no-push.
// Explicitness read via cmd.getOptionValueSource('push') === 'cli' (commander ^14).
export function resolveUpMode(
  flags: { pushExplicit: boolean; push: boolean; localOnly: boolean },
  sourceLocalOnly: boolean,
): { enginePush: boolean; localOnly: boolean; marker: string }
// marker (AC4.2), exactly one of:
//   'pushing to origin (--push)' | 'pushing to origin (origin auto-detected)'
//   'local-only (--local-only)' | 'local-only (--no-push)' | 'local-only (no origin remote)'
// `agentic sync` local-only short-circuit prints exactly: 'local-only: nothing to sync'  (AC3.1)
```

### Server / orchestrator

```ts
ServeOptions.localOnly?: boolean            // → loadSources; interval sync skips localOnly sources
OrchestratorOptions.localOnly?: boolean     // assembleOrchestrator throws LocalOnlyPushConflictError
                                            // on localOnly && push; auto-detects (table rule 2) when unset
EngineConfig.localOnly?: boolean            // → LocalGitSource option + ensureDraftPr opts at engine.ts:458
// agentic-orchestrator binary gains --local-only (its --push already exists).
```

## Decisions (ADRs)

### ADR-1: `--local-only` and `local_only:` name the mode, and `--no-push` on `up` becomes an alias for it
- **Choice:** New explicit designators: `--local-only` on `agentic up` and the
  orchestrator binary, `local_only: true` per source in config. At the CLI tier,
  `--no-push` now resolves to full local-only mode, not just a push ceiling.
- **Rejected:** Keeping `--no-push` as a push-only ceiling distinct from the mode —
  it lost because the spec's own gap list names the `--no-push` draft-PR leak as a
  defect to close, and the existing startup marker already calls that state
  "local-only". Two near-identical off switches with different egress guarantees
  would be a trap.
- **Consequences:** Operators using `--no-push` today additionally stop fetching
  origin and calling `gh`, which is the documented intent of the flag. The docs
  task must state the alias explicitly.

### ADR-2: Local-only is not the same state as `push: false` at the config tier
- **Choice:** A config source with an origin and explicit `push: false` keeps
  fetching and syncing — only `local_only: true`, or a missing origin, activates
  the mode there.
- **Rejected:** Defining the mode as resolved `push === false` everywhere — it lost
  because a read-only viewer that polls origin with `fetch_interval` but never
  pushes is a legal, existing topology, and equating the two states would silently
  stop its fetch loop.
- **Consequences:** The resolution table has one CLI-only rule, which the plan
  marks normative. Auto-detect (no origin) still activates the mode for config
  sources, so a remoteless config entry stops throwing in `agentic sync`.

### ADR-3: The draft-PR guard lives inside `ensureDraftPr`, as an option
- **Choice:** A `localOnly` field on the existing opts parameter, checked first;
  both callers (engine first-dispatch, `agentic arm`) pass their resolved flag.
- **Rejected:** Guarding at each caller — it lost because the skip logic and its
  note string would exist twice, and any future third caller would leak by default
  exactly as the current two did.
- **Consequences:** Callers must have the resolved flag in hand, so `EngineConfig`
  gains it and `armRun` reads it off the source. The unit seam stays the injected
  exec spy the existing tests already use.

### ADR-4: The sync guard is a core helper taking a provider factory
- **Choice:** `planSyncForSource(source, () => new GhCliProvider(dir))` in core —
  the factory is only invoked past the local-only check, and the CLI loop calls
  this instead of `planSync` directly.
- **Rejected:** An inline `if` in the CLI's sync loop — it lost because the
  acceptance criterion "provider never constructed" would be unprovable from the
  core test file the spec requires the coverage to live in, and the CLI loop has
  no test seam of its own.
- **Consequences:** `planSync` itself stays untouched for existing consumers. The
  webhook path keeps constructing its provider directly, which is correct — it is
  hosted-topology and out of scope.

### ADR-5: The push-conflict rejection lives in `loadSources` and throws a named error
- **Choice:** `LocalOnlyPushConflictError` thrown from `loadSources` for both the
  CLI-flag pair and config-entry conflicts, with `assembleOrchestrator` performing
  the same check for the standalone binary, which never calls `loadSources`.
- **Rejected:** Per-command validation in each CLI action — it lost because every
  command shares `loadSources` as its one config seam, and per-command checks
  would miss whichever command nobody remembered.
- **Consequences:** `loadSources` can now throw, so its three callers (CLI
  `resolveSources`, `up`, `startServer`) need a catch-print-exit path. `up` must
  resolve before starting anything, satisfying "no engine or server started".

### ADR-6: The TOPOLOGY.md §3.1 guard claim is edited out, not implemented
- **Choice:** Rewrite the sentence claiming the orchestrator refuses `--push`
  without a sync provider, describing actual startup behavior and pointing at the
  new local-only section (AC5.1's documented option).
- **Rejected:** Implementing the claimed guard — it lost because "sync provider"
  is not a first-class object anywhere in the `up` startup path, and inventing one
  is exactly the new remote-abstraction layer the spec rules out of scope.
- **Consequences:** The docs task owns R5 entirely. AC5.2 requires a sweep of
  `docs/` for any other contradicting push claims, not just the one sentence.

### ADR-7: `up` resolves the mode once and feeds the engine the resolved pair
- **Choice:** `agentic up` calls `loadSources` first (which is also the conflict
  gate), derives `{ enginePush, localOnly }`, and passes them to both
  `startServer` and `startOrchestrator`.
- **Rejected:** Keeping the engine's independent `push: flags.push !== false`
  default — it lost because it hard-codes push-mode even on a remoteless clone,
  leaving the heartbeat fetch and PR-ensure criteria unmeetable on the engine
  path.
- **Consequences:** An engine under `up` on a remoteless clone stops attempting
  pushes it could never land — a behavior change, but strictly less failing
  egress. The standalone binary keeps its explicit `--push` default-off semantics.

## Requirement → task mapping

| Requirement | Task(s) |
|-------------|---------|
| R1 | 01 (resolution), 03 (CLI tier), 05 (named-mode tests) |
| R2 | 01 (AC2.1 via push=false, AC2.4 guard), 02 (AC2.2/AC2.3 mechanisms), 03 (arm + sync call sites), 04 (engine + server call sites), 05 (evidence tests) |
| R3 | 02 (guard helper), 03 (sync command), 05 (core-side test) |
| R4 | 01 (conflict in loadSources), 03 (up flags, marker, exit), 04 (binary check) |
| R5 | 06 |
| R6 | 06 |
| R7 | 05 (new coverage), 01–04 (existing suites stay green) |
| R8 | all tasks — constraint: no task's contact surface touches `roles/` or `contracts/` (AC8.1 verified at review) |

## Risks

- **Commander flag-pair explicitness.** Detecting "was `--push`/`--no-push` passed"
  relies on `getOptionValueSource('push')` returning `'cli'` only for real flags
  under commander ^14 with a negated pair. Early signal: task 03's first unit test
  on `resolveUpMode` wiring. Fallback: scan `process.argv` for the two literals.
- **Unknown consumers of `--no-push`'s old semantics (ADR-1).** Someone may rely on
  `up --no-push` still fetching origin. Early signal: `frontend` test suite
  failures in orchestrator push/loop tests at task 03/04 time. Mitigation: the
  poller topology remains expressible at the config tier (ADR-2).
- **Hosted path regression via `ServeOptions`/schema changes.** Removing the zod
  default on `push` or the new opts could shift hosted defaults. Early signal: the
  existing hosted cases in `divergence.test.ts`, `fetch-sync.test.ts`, and
  `orchestrator/test/hosted.test.ts` (AC7.2) — all default-behavior assertions.
- **Runtime probe is static only.** This plan was written from source and
  manifests (Node ≥ 24, vitest, commander ^14 confirmed in `package.json`) without
  executing the suite. Early signal: implementers run `npm test` in `frontend/`
  before touching anything and report a dirty baseline immediately.
- **Spec line-number drift in `divergence.test.ts`.** The spec pins existing cases
  by line range; task 05 appends new describes only and must not reflow the
  existing ones, or AC1.3/AC7.2 traceability is lost.
