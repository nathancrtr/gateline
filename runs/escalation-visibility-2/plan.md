# Technical Plan: Escalation visibility survives schema-invalid run state

## Approach

The run-state parser gains a conservative second read: when the document fails
schema validation but its escalations list is independently well-formed, the
parse result carries that list alongside the unchanged null state and error.
Every surface that reports escalations today then picks the list up through the
derivation chain it already uses. Nothing new is stored, and nothing new can be
clicked (R4).

The change concentrates in the core package, because both counting surfaces are
pure derivations over one read seam:

- The parser (`parseRunState` in `frontend/packages/core/src/record/schema.ts`)
  returns an optional `bestEffortEscalations` field, present only when recovery
  succeeded (R1). It flows through `readState` untouched — the local source
  spreads the parse result.
- The portfolio summarizer counts open recovered entries into `escalationsOpen`
  in its malformed branch (R2). That one change feeds `GET /api/runs`, the run
  detail summary, `buildPortfolio`, and the web portfolio badge, since all four
  read the same summary.
- The readiness derivation appends one inbox item per open recovered escalation
  after the existing malformed item (R3). Those items reuse the `escalation`
  kind with `reviewable: false` — the frontend's existing bounce semantics — so
  the web inbox, the run page cards, the CLI inbox, and the `needs` count all
  render them with almost no per-surface work.

Three thin edges finish the job. The server's run-detail route adds an optional
`recoveredEscalations` payload field naming `from_role`/`reason`/`at` (AC3.2).
The web `DecidePanel` starts requiring `reviewable` before offering Resolve
(AC4.1). The CLI inbox line appends the reason for non-reviewable escalation
items (AC3.1).

One shared fixture run embodies the AC1.1 shape — an out-of-enum phase plus
well-formed escalations — because the Playwright suite and the demo read only
the shared generator. Three count-sensitive test assertions move with it.

## Interface contracts

### Parser (core, task 01)

```ts
// frontend/packages/core/src/record/schema.ts
export interface StateParseResult {
  state: RunState | null
  error: string | null
  /**
   * R1 best-effort read: present if and only if (a) the YAML parsed to a
   * non-null object, (b) runStateSchema validation failed, and (c) the raw
   * `escalations` key is present and z.array(escalationSchema) accepts it
   * whole. Value = the parsed entries (schema transforms applied), unfiltered.
   * Never present when `state` is non-null, and never present on a YAML
   * parse failure (AC1.2). No partial salvage: one bad entry → absent (AC1.3).
   */
  bestEffortEscalations?: Escalation[]
}
```

`RunSource.readState` keeps its `StateParseResult & { raw: string | null }`
type; the optional field flows through `LocalGitSource.readState`'s existing
`{ raw, ...parseRunState(raw) }` spread with no source change. The
`state.yaml missing` branch never carries the field.

### View-model (core, task 01)

`summarizeRun` malformed branch (`frontend/packages/core/src/view-model/portfolio.ts`):

```ts
escalationsOpen: (bestEffortEscalations ?? []).filter((e) => !e.resolved).length
// needsHuman stays items.length — recovered items arrive via deriveReadiness
```

`deriveReadiness` malformed branch (`frontend/packages/core/src/view-model/readiness.ts`)
returns the existing malformed item first, then, for each recovered entry with
`resolved: false`, in list order:

```ts
{
  kind: 'escalation',
  gate: null,
  source: ref.source,
  slug: ref.slug,
  title: `Escalation from ${esc.from_role ?? 'unknown role'}`,  // valid-path parity
  detail: esc.reason,
  since: esc.at ? Math.floor(Date.parse(esc.at) / 1000) || null : null,
  reviewable: false,        // bounce semantics: content, no control (R4)
  problems: [],             // no BOUNCED suffix — the malformed item already says it
  packet: ['state.yaml'],
  escalationIndex: null,    // resolve is structurally unreachable (ADR-3)
}
```

`InboxItem` itself is unchanged — no new field, no new kind.

### Server (task 03)

`GET /api/runs/:src/:slug` (`frontend/packages/server/src/app.ts`) adds to the
cached payload, spread-conditionally so the key is absent when the parser did
not recover (AC1.2):

```ts
recoveredEscalations?: { at: string | null; from_role: string | null; reason: string }[]
// open entries only, list order; present iff bestEffortEscalations was present
```

`POST /api/decisions` is untouched: its existing malformed-state check
(`if (!state) return 409`) already refuses every action (AC4.2).

### Web (task 04)

`DecidePanel` (`frontend/packages/web/src/components/decide.tsx`):
- keyboard: `else if (item.kind === 'escalation' && item.reviewable) setMode('resolve')`
- idle buttons: the Resolve branch becomes `item.kind === 'escalation' && item.reviewable`
- new idle branch for `item.kind === 'escalation' && !item.reviewable`: a
  static paragraph (no `data-decide` attribute, no button): "Read-only —
  recovered from malformed run state. Fix state.yaml to act on it; no
  resolution is offered here."

No other web change: `itemHref` already skips the `?decide=esc-N` param when
`escalationIndex` is null, `KindChip` already labels the kind, and the run
page already renders every readiness item as a card.

### CLI (task 05)

`printItem` (`frontend/packages/cli/src/main.ts`): for items with
`kind === 'escalation' && !reviewable`, the single printed line becomes
`<kind> <age> <source>/<slug> <title> — <detail>`, so one line names both
`from_role` (in the title) and `reason` (the detail) (AC3.1). Reviewable
escalations and all other kinds print exactly as today.

### Shared fixture (task 02)

New generator run in `frontend/fixtures/src/index.ts`, slug `esc-recovered`,
`age: 1`, with `intent-brief.md`, `spec.md`, and a hand-written `state.yaml`
literal (not the `stateYaml` helper — it can only emit valid phases):
- `phase: verifying` — the one unrelated schema violation (out of enum)
- every other section well-formed (gates G0–G3 entries, `tasks: []`, budget)
- `escalations`: exactly 2 entries with `resolved: false` (`from_role:
  implementer` and `verifier`) and 1 with `resolved: true` — so N = 2
  exercises the open-only filter — with `at` timestamps derived from the
  generator's `now` at `now - 1*DAY` (the `escalated` run's idiom), keeping
  the 7-day-old `escalated` run first in every ordering assertion.

Count-sensitive assertions that move with it (task 02 owns all three):
- `frontend/packages/core/test/readiness.test.ts` — the slug list in "finds
  every fixture run" gains `esc-recovered`
- `frontend/packages/server/test/app.test.ts` — `body.runs` 12 → 13
- `frontend/packages/orchestrator/test/fixture.test.ts` — new assertion
  `esc-recovered → { kind: 'rest', rule: 'D0' }`, pinning that the engine
  still treats the run as malformed rest and never dispatches on recovered
  escalations

## Decisions (ADRs)

### ADR-1: Recovery is an optional field on the existing parse result, not a second parser
- **Choice:** `parseRunState` computes `bestEffortEscalations` in its
  schema-failure branch and omits the key otherwise; consumers read it from
  the one `readState` seam.
- **Rejected:** a separate `recoverEscalations(text)` entry point that
  view-models call on failure — it would parse the same document twice and let
  the two reads drift, which is exactly the divergence the spec's first
  assumption forbids. An always-present nullable field lost too: it would
  change the parse result's serialized shape for the untouched YAML-failure
  case, which AC1.2 pins byte-for-byte.
- **Consequences:** every consumer of `readState` sees the field for free, and
  the absent-key convention becomes part of the parse-result contract that the
  server payload mirrors (ADR-5).

### ADR-2: Well-formed means the ordinary per-entry schema, applied whole-list
- **Choice:** recovery validates the raw `escalations` value with
  `z.array(escalationSchema)` — the same schema ordinary parsing applies — and
  yields nothing unless the key is present and the whole array passes.
- **Rejected:** entry-by-entry salvage that keeps the valid entries and drops
  the bad ones — dropping an entry silently misreports the alarm count, which
  is the repair-by-guessing R1 forbids. A stricter ruleset requiring `at` and
  `from_role` (the brief's field list) lost because two rulesets for one shape
  would make well-formedness depend on the code path (spec assumption 1).
- **Consequences:** AC1.3's one-bad-entry fixture recovers nothing, and an
  absent or null `escalations` key recovers nothing rather than an invented
  empty list. Optional fields stay optional exactly as `escalationSchema`
  declares them.

### ADR-3: Recovered items reuse the escalation kind with reviewable false; DecidePanel learns to check it
- **Choice:** readiness emits recovered escalations as `kind: 'escalation'`,
  `reviewable: false`, `escalationIndex: null`, and `DecidePanel` gates its
  Resolve affordance on `reviewable`.
- **Rejected:** a new `recovered-escalation` inbox kind — every kind-keyed
  switch (the chip label map, `itemHref`, run-page cards, CLI printing) would
  need a new case for what is semantically the existing bounce state, and
  `reviewable: false` is already the frontend's "content without control"
  rule (frontend/README.md R3). Unmodified reuse of the kind lost for the
  reason the spec's Context names: it would render a working Resolve button.
- **Consequences:** the web inbox, run-page cards, portfolio badge, and CLI
  `needs` count light up with no per-surface wiring — recovered escalations
  count toward readiness items the way spec assumption 2 resolves the status
  surface. The null `escalationIndex` makes the resolve mutation structurally
  unreachable even if a control ever rendered, with the server's 409 as the
  final backstop (AC4.2). DecidePanel needs the one-line reviewable check and
  a read-only note.

### ADR-4: One shared fixture run, with the three count-sensitive assertions updated
- **Choice:** add the `esc-recovered` run to the shared `@agentic/fixtures`
  generator and update the three assertions that count or enumerate fixture
  runs.
- **Rejected:** test-local fixture repos only (the `addPausedRun` idiom the
  readiness tests use to keep the generator count-stable) — the Playwright
  suite and `agentic ui --demo` read only the shared generator, and AC4.1
  asserts rendered DOM; the web package has no unit-test harness, so keeping
  the run out of the generator would leave R4's UI criterion untestable in
  the only DOM harness the repo has.
- **Consequences:** task 02 must land the assertion updates atomically with
  the fixture, and the new run is deliberately young (age 1 day, escalation
  timestamps at now − 1 day) so the "escalated ranks first" ordering
  assertions in the CLI, server, and e2e suites keep holding. Core-level
  parser tests still use inline YAML strings and a test-local run so task 01
  does not depend on task 02.

### ADR-5: The run-detail payload names the recovered entries in an optional key
- **Choice:** `GET /api/runs/:src/:slug` adds `recoveredEscalations` — open
  entries only, projected to `{ at, from_role, reason }` — present only when
  the parser recovered a list.
- **Rejected:** relying on the readiness items already in the payload — they
  carry role and reason only as prose in `title`/`detail`, while AC3.2 names
  `from_role`/`reason`/`at` as fields. An always-present null key lost for the
  AC1.2 byte-stability reason in ADR-1.
- **Consequences:** no web consumer is added (the run page renders the items),
  so the field exists for API consumers and the AC3.2 test; the web `api.ts`
  types stay untouched.

## Requirement → task mapping

| Requirement | Task(s) |
|-------------|---------|
| R1 | 01-core-recovery, 02-fixture-run |
| R2 | 01-core-recovery, 03-server-surface |
| R3 | 01-core-recovery, 03-server-surface, 04-web-readonly, 05-cli-inbox |
| R4 | 03-server-surface, 04-web-readonly |

## Risks

- **Ordering assertions are age-sensitive.** Three suites assert the 7-day-old
  `escalated` run leads the inbox (`cli.test.ts` line 81, `app.test.ts` line
  73, `e2e/smoke.spec.ts` line 42). Recovered items take `since` from the
  escalation's `at`, so a fixture timestamp older than 7 days would jump the
  queue. Early signal: any of those three tests failing on task 02 or 03.
  Mitigation is designed in: `at = now − 1*DAY`.
- **The orchestrator must keep resting on the new fixture.** A schema-invalid
  run derives D0 rest today; if the engine ever read recovered escalations it
  could try to act on state it cannot trust. Early signal: the new
  `fixture.test.ts` assertion (task 02) failing.
- **Toolchain not probed by execution.** This plan was written from reads
  only: `frontend/package.json` pins Node ≥ 24, vitest ^3.2, TypeScript ^5.8,
  Playwright ^1.61, and e2e requires `npm run build` first (AGENTS.md). No
  command was executed to confirm the suite runs in the implementers'
  environment. Binding instruction: run `npm install` once in `frontend/` and
  confirm `npx vitest run` passes before claiming any task; if local
  Playwright browsers are missing (`npx playwright install` refused or
  sandboxed), task 04's e2e criterion is verified in `frontend-ci`, and the
  work item's notes must say so. Early signal: `npm test` failing before any
  change.
- **Zod transform reuse.** Recovery reuses `escalationSchema`, so `at`
  normalization (unquoted YAML dates → ISO strings) matches the valid path;
  if a fixture uses an unquoted timestamp the transform must still yield a
  parseable `Date.parse` input. Early signal: AC1.1's `since` assertion
  returning null in task 01's tests.
