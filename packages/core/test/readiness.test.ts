// One test per row of the plan §2.3 readiness table, against the fixture repo.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildPortfolio, deriveReadiness, parseRunState, pausedInstruction, ROUND_CAP, type RunRef, type RunState } from '../src/index.ts'
import { dropFixture, type FixtureContext, makeFixture } from './fixture.helper.ts'

/** The sentence a pause with nothing specific to say still gets. */
const GENERIC_PAUSE = 'Resume the run, or close it with a disposition saying why it ends here'

let ctx: FixtureContext
let refs: Map<string, RunRef>

// Staged and other-reason paused runs are added directly to the fixture repo
// (not the shared @gateline/fixtures generator — plan ADR-8 keeps that
// count-sensitive for server/e2e assertions); this mirrors divergence.test.ts's
// idiom of extending `ctx.repo.dir` with git commands from the test itself.
function addPausedRun(dir: string, slug: string, pausedReason: string | null): void {
  const git = (args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' })
  git(['checkout', '-q', '-b', `run/${slug}`, 'main'])
  const runDir = join(dir, 'runs', slug)
  mkdirSync(runDir, { recursive: true })
  writeFileSync(
    join(runDir, 'intent-brief.md'),
    '# Intent Brief: paused fixture\n\n## Problem\n\n## Motivation\n\n## Constraints\n\n## Out of scope\n',
    'utf8',
  )
  writeFileSync(
    join(runDir, 'state.yaml'),
    `run: ${slug}
branch: run/${slug}
phase: paused
profile: patch
paused_reason: ${pausedReason ?? 'null'}

budget:
  cost_limit_usd: 25
  cost_spent_usd: 0
  ledger: []

gates:
  G1: {approved: false, by: null, at: null, notes: null}
  G2: {approved: false, by: null, at: null, notes: null}

tasks:
  []

escalations:
  []
`,
    'utf8',
  )
  git(['add', '-A'])
  git(['commit', '-q', '-m', `state(${slug}): artifacts`])
  git(['checkout', '-q', 'main'])
}

/**
 * A run whose task is past the cap but whose round-cap escalation a human has
 * already resolved (#342). The rule under test is exactly "which came second",
 * so the record has to be able to say it: the review lands in one commit and
 * the resolution in the next, which is how the real flow writes them — the
 * engine escalates and pauses in its own commit, and the human resolves in
 * another. Since #346 that commit order is what decides, with the timestamps
 * (backdated review, a recent resolution) agreeing rather than deciding.
 */
function addGrantedRoundCapRun(dir: string, slug: string): void {
  const git = (args: string[], date?: string) =>
    execFileSync('git', ['-C', dir, ...args], {
      encoding: 'utf8',
      env: date ? { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : process.env,
    })
  const landed = new Date(Date.now() - 60 * MIN).toISOString()
  const resolvedAt = new Date(Date.now() - 5 * MIN).toISOString()
  git(['checkout', '-q', '-b', `run/${slug}`, 'main'])
  const runDir = join(dir, 'runs', slug)
  mkdirSync(runDir, { recursive: true })
  writeFileSync(
    join(runDir, 'intent-brief.md'),
    '# Intent Brief: granted round\n\n## Problem\n\n## Motivation\n\n## Constraints\n\n## Out of scope\n',
    'utf8',
  )
  writeFileSync(join(runDir, 'review-01.md'), '# Review Report: 01-core\n\n**Verdict:** request-changes\n', 'utf8')
  const stateFor = (resolved: boolean) => `run: ${slug}
branch: run/${slug}
phase: implement
profile: patch
paused_reason: null

budget:
  cost_limit_usd: 25
  cost_spent_usd: 0
  ledger: []

gates:
  G1: {approved: true, by: Nathan Carter, at: "${landed}", notes: null}
  G2: {approved: false, by: null, at: null, notes: null}

tasks:
  - {id: 01-core, status: in-review, review_rounds: 3}

escalations:
  - at: "${landed}"
    from_role: orchestrator
    reason: "task 01-core: 3 review rounds without convergence — usually a spec ambiguity"
    resolved: ${resolved}
    resolved_by: ${resolved ? 'Nathan Carter' : 'null'}
    resolved_at: ${resolved ? `"${resolvedAt}"` : 'null'}
    resolution: ${resolved ? '"spec ambiguity clarified; take another round"' : 'null'}
`
  writeFileSync(join(runDir, 'state.yaml'), stateFor(false), 'utf8')
  git(['add', '-A'])
  git(['commit', '-q', '-m', `state(${slug}): artifacts`], landed)
  // The human's resolution, in its own commit — the fact the card stands down on.
  writeFileSync(join(runDir, 'state.yaml'), stateFor(true), 'utf8')
  git(['add', '-A'])
  git(['commit', '-q', '-m', `state(${slug}): escalation #0 resolved by Nathan Carter`], resolvedAt)
  git(['checkout', '-q', 'main'])
}

const MIN = 60_000

/**
 * A G0-pending run whose ledger says whatever the row under test needs (#159).
 *
 * The generator cannot express these: `stateYaml`'s ledger lines always carry a
 * `cost_usd`, and an *open* entry — the whole subject here — is one with none.
 * The packet is the g0-pending run's own spec and brief, read off its branch
 * rather than retyped, so these runs stay well-formed for free when the spec
 * contract changes. Commit and dispatch times are backdated around the clock the
 * derivation reads, since the rule under test is exactly "which is newer".
 */
function addLedgerRun(dir: string, slug: string, o: { packetAgoMin: number; ledger: string[] }): void {
  const now = Date.now()
  const at = new Date(now - o.packetAgoMin * MIN).toISOString()
  const git = (args: string[], date?: string) =>
    execFileSync('git', ['-C', dir, ...args], {
      encoding: 'utf8',
      env: date ? { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : process.env,
    })
  const spec = git(['show', 'run/g0-pending:runs/g0-pending/spec.md'])
  const brief = git(['show', 'run/g0-pending:runs/g0-pending/intent-brief.md'])
  git(['checkout', '-q', '-b', `run/${slug}`, 'main'])
  const runDir = join(dir, 'runs', slug)
  mkdirSync(runDir, { recursive: true })
  writeFileSync(join(runDir, 'intent-brief.md'), brief, 'utf8')
  writeFileSync(join(runDir, 'spec.md'), spec, 'utf8')
  writeFileSync(
    join(runDir, 'state.yaml'),
    `run: ${slug}
branch: run/${slug}
phase: spec
profile: full
paused_reason: null

budget:
  cost_limit_usd: 25
  cost_spent_usd: 0
  ledger:${o.ledger.length ? `\n${o.ledger.map((l) => `  - {${l}}`).join('\n')}` : ' []'}

gates:
  G0: {approved: false, by: null, at: null, notes: null}
  G1: {approved: false, by: null, at: null, notes: null}
  G2: {approved: false, by: null, at: null, notes: null}
  G3: {approved: false, by: null, at: null, notes: null}

tasks:
  []

escalations:
  []
`,
    'utf8',
  )
  git(['add', '-A'])
  git(['commit', '-q', '-m', `state(${slug}): artifacts`], at)
  git(['checkout', '-q', 'main'])
}

/** One ledger line, ISO-timestamped `agoMin` minutes before now. */
const entry = (role: string, agoMin: number, closed: boolean): string =>
  `at: "${new Date(Date.now() - agoMin * MIN).toISOString()}", role: ${role}, task: null, round: null, ` +
  `adapter: claude-code, model: m, tokens_in: null, tokens_out: null, cost_usd: ${closed ? '0.42' : 'null'}`

beforeAll(async () => {
  ctx = await makeFixture()
  addPausedRun(ctx.repo.dir, 'staged-run', 'staged')
  addPausedRun(ctx.repo.dir, 'paused-declined', 'gate-declined')
  addPausedRun(ctx.repo.dir, 'paused-other-reason', 'round-cap')
  addPausedRun(ctx.repo.dir, 'paused-landed', 'slug-landed')
  addGrantedRoundCapRun(ctx.repo.dir, 'round-cap-granted')
  // #159, one run per row: the producer out and fresh; out and aged past the
  // role timeout; landed (closed) and therefore quiet; a different role out;
  // and an open entry that predates the packet it produced.
  addLedgerRun(ctx.repo.dir, 'g0-redispatched', { packetAgoMin: 60, ledger: [entry('analyst', 5, false)] })
  addLedgerRun(ctx.repo.dir, 'g0-lost-dispatch', { packetAgoMin: 180, ledger: [entry('analyst', 90, false)] })
  addLedgerRun(ctx.repo.dir, 'g0-producer-landed', { packetAgoMin: 60, ledger: [entry('analyst', 5, true)] })
  addLedgerRun(ctx.repo.dir, 'g0-other-role', { packetAgoMin: 60, ledger: [entry('architect', 5, false)] })
  addLedgerRun(ctx.repo.dir, 'g0-open-before-packet', { packetAgoMin: 60, ledger: [entry('analyst', 120, false)] })
  refs = new Map((await ctx.source.listRuns()).map((r) => [r.slug, r]))
})
afterAll(() => dropFixture(ctx))

describe('run discovery', () => {
  it('finds every fixture run, branch-backed and merged', () => {
    const slugs = [...refs.keys()].sort()
    expect(slugs).toEqual([
      'bad-state',
      'closed-delivered',
      'done-merged',
      'escalated',
      'forked-contract',
      'g0-lost-dispatch',
      'g0-open-before-packet',
      'g0-other-role',
      'g0-pending',
      'g0-producer-landed',
      'g0-redispatched',
      'g1-pending',
      'g2-pending',
      'g3-pending',
      'malformed-release',
      'malformed-spec',
      'patch-g1-pending',
      'patch-g2-pending',
      'paused-budget',
      'paused-declined',
      'paused-landed',
      'paused-other-reason',
      'round-cap',
      'round-cap-granted',
      'staged-run',
    ])
    expect(refs.get('done-merged')!.kind).toBe('default')
    expect(refs.get('g0-pending')!.kind).toBe('branch')
  })
})

describe('readiness derivation (§2.3, one row per test)', () => {
  const gateItem = async (slug: string) => {
    const { items } = await deriveReadiness(ctx.source, refs.get(slug)!)
    return items
  }

  it('G0 ready: phase=spec ∧ spec present ∧ well-formed ∧ ¬G0', async () => {
    const items = await gateItem('g0-pending')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'gate', gate: 'G0', reviewable: true })
    expect(items[0]!.packet).toEqual(['intent-brief.md', 'spec.md'])
    expect(items[0]!.since).toBeGreaterThan(0)
  })

  it('G1 ready: phase=plan ∧ plan + tasks present ∧ ¬G1', async () => {
    const items = await gateItem('g1-pending')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'gate', gate: 'G1', reviewable: true })
    expect(items[0]!.packet).toContain('plan.md')
    expect(items[0]!.packet).toContain('tasks/01-core.yaml')
  })

  it('G2 ready: all tasks complete ∧ reviews + verification present ∧ ¬G2', async () => {
    const items = await gateItem('g2-pending')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'gate', gate: 'G2', reviewable: true })
    expect(items[0]!.packet).toContain('verification-report.md')
    expect(items[0]!.packet).toContain('review-01.md')
  })

  it('G3 ready: phase=release ∧ release-plan present ∧ ¬G3', async () => {
    const items = await gateItem('g3-pending')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'gate', gate: 'G3', reviewable: true })
  })

  it('G3 bounces a release plan missing its contract’s sections (#260)', async () => {
    // Rule R3 at the last gate. Until release-plan.md had a contract this run
    // was reviewable: the file existed, so the gate was ready.
    const items = await gateItem('malformed-release')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'gate', gate: 'G3', reviewable: false })
    expect(items[0]!.problems.join(' ')).toContain('release-plan.md: missing required sections')
    expect(items[0]!.problems.join(' ')).toContain('Rollback plan')
  })

  it('patch G1 ready: no plan.md — the brief + work item are the packet, G0 absorbed into the question', async () => {
    const items = await gateItem('patch-g1-pending')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'gate', gate: 'G1', reviewable: true })
    expect(items[0]!.packet).toEqual(['intent-brief.md', 'tasks/01-hotfix.yaml'])
    expect(items[0]!.title).toContain('Is this the change we want, scoped this way?')
  })

  it('patch G2 ready: reviews alone are the packet — no verification-report required', async () => {
    const items = await gateItem('patch-g2-pending')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'gate', gate: 'G2', reviewable: true })
    expect(items[0]!.packet).toEqual(['review-01.md'])
  })

  it('escalation: unresolved escalations[] entry surfaces with age', async () => {
    const items = await gateItem('escalated')
    const esc = items.find((i) => i.kind === 'escalation')
    expect(esc).toBeDefined()
    expect(esc!.escalationIndex).toBe(0)
    expect(esc!.detail).toMatch(/unverifiable/)
    expect(esc!.since).toBeGreaterThan(0)
  })

  it('round-cap: review_rounds ≥ ROUND_CAP on an unfinished task', async () => {
    const items = await gateItem('round-cap')
    const cap = items.find((i) => i.kind === 'round-cap')
    expect(cap).toBeDefined()
    expect(cap!.title).toContain('01-core')
    expect(cap!.packet).toContain('review-03.md')
  })

  it('round-cap: a resolution newer than the latest review grants another round, so the card stands down (#342)', async () => {
    // The engine's rule D4 reads exactly this fact and dispatches round n+1;
    // a card asking the human to unblock a loop that is already moving asks
    // for a decision they have made. The next verdict past the cap is newer
    // than the resolution again, and both surfaces raise it afresh.
    const items = await gateItem('round-cap-granted')
    expect(items.find((i) => i.kind === 'round-cap')).toBeUndefined()
    expect(items).toHaveLength(0)
  })

  it('the summary carries the cap the round-cap item was judged against, so no surface retypes it (#314)', async () => {
    const { runs } = await buildPortfolio([ctx.source])
    const row = runs.find((r) => r.slug === 'round-cap')!
    expect(row.tasks.roundCap).toBe(ROUND_CAP)
    expect(row.tasks.maxRounds).toBeGreaterThanOrEqual(row.tasks.roundCap)
    const fresh = runs.find((r) => r.slug === 'g1-pending')!
    expect(fresh.tasks).toMatchObject({ maxRounds: 0, roundCap: ROUND_CAP })
  })

  it('paused: phase=paused surfaces resume/kill decision', async () => {
    const items = await gateItem('paused-budget')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'paused' })
    expect(items[0]!.title).toContain('budget-exhausted')
  })

  // #96: the card's instruction is the reason's. A budget pause is a condition
  // the engine recomputes, so "resume" alone re-pauses; the card has to say
  // what actually clears it and carry what the affordance needs to ask for it.
  it('paused budget-exhausted: the card says raise the limit, and carries the current one', async () => {
    const items = await gateItem('paused-budget')
    expect(items[0]).toMatchObject({ kind: 'paused', pausedReason: 'budget-exhausted' })
    expect(items[0]!.costLimitUsd).toBeTypeOf('number')
    expect(items[0]!.detail).toContain(`cost_limit_usd $${items[0]!.costLimitUsd}`)
    expect(items[0]!.detail).toContain('higher limit')
    expect(items[0]!.detail).toContain('re-pauses')
  })

  it('paused slug-landed: the card says close and use a fresh slug — nothing to raise (#213)', async () => {
    const items = await gateItem('paused-landed')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'paused', pausedReason: 'slug-landed' })
    expect(items[0]!.detail).toContain('runs/paused-landed/')
    expect(items[0]!.detail).toContain('fresh slug')
    expect(items[0]!.detail).toContain('already-delivered')
  })

  it('paused for a human reason keeps the generic instruction', async () => {
    const items = await gateItem('paused-other-reason')
    expect(items[0]!.detail).toBe(GENERIC_PAUSE)
  })

  it('staged: paused_reason=staged yields exactly one staged item, never a paused one (AC6.1, ADR-4)', async () => {
    const items = await gateItem('staged-run')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      kind: 'staged',
      gate: null,
      title: 'Run staged: awaiting arm',
      detail: 'Arm to start the run — dispatch begins and the budget starts metering',
      reviewable: true,
      problems: [],
      escalationIndex: null,
    })
    expect(items[0]!.packet).toEqual(['state.yaml', 'intent-brief.md'])
    expect(items[0]!.since).toBeGreaterThan(0)
    expect(items.some((i) => i.kind === 'paused')).toBe(false)
    // A staged run, like a paused one, surfaces no gate item.
    expect(items.some((i) => i.kind === 'gate')).toBe(false)
  })

  it('paused with another reason still yields a paused item, not staged (mid-flight pauses unchanged)', async () => {
    const items = await gateItem('paused-other-reason')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'paused' })
    expect(items[0]!.title).toContain('round-cap')
    expect(items.some((i) => i.kind === 'staged')).toBe(false)
  })

  it('declined: paused_reason=gate-declined needs nothing — the human already answered (#200)', async () => {
    // The card this used to show said "Resume, or decline the pending gate to
    // end the run" to someone who had just declined the gate.
    expect(await gateItem('paused-declined')).toEqual([])
  })

  it('declined runs stay in the portfolio and off the inbox — decided is not deleted (#200)', async () => {
    const { runs, inbox } = await buildPortfolio([ctx.source])
    const row = runs.find((r) => r.slug === 'paused-declined')
    expect(row).toMatchObject({ phase: 'paused', pausedReason: 'gate-declined', needsHuman: 0 })
    expect(inbox.some((i) => i.slug === 'paused-declined')).toBe(false)
  })

  it('closed: phase=closed needs nothing, even with an unresolved escalation on the run (#200)', async () => {
    // The fixture carries an open escalation and a failed task. Both would
    // raise items on any other run; a closure answers them wholesale, so the
    // rule short-circuits ahead of every other row rather than after them.
    expect(await gateItem('closed-delivered')).toEqual([])
  })

  it('closed runs keep their disposition on the portfolio row and stay off the inbox (#200)', async () => {
    const { runs, inbox } = await buildPortfolio([ctx.source])
    const row = runs.find((r) => r.slug === 'closed-delivered')
    expect(row).toMatchObject({ phase: 'closed', needsHuman: 0 })
    // The disposition rides on the summary: every surface that renders
    // "closed" needs to say why in the same breath.
    expect(row!.closure).toMatchObject({ as: 'already-delivered', by: 'operator' })
    expect(row!.closure!.reason).toMatch(/landed by another path/)
    expect(inbox.some((i) => i.slug === 'closed-delivered')).toBe(false)
  })

  it('the paused card offers closing rather than telling the human to decline a gate (#200)', async () => {
    for (const slug of ['paused-budget', 'paused-landed', 'paused-other-reason']) {
      const items = await gateItem(slug)
      expect(items[0]!.detail.toLowerCase()).toContain('close')
      expect(items[0]!.detail.toLowerCase()).not.toContain('decline')
    }
  })

  it('a run paused FOR an escalation shows the escalation, not a second card restating it', async () => {
    const items = await gateItem('escalated')
    expect(items.filter((i) => i.kind === 'escalation')).toHaveLength(1)
    expect(items.some((i) => i.kind === 'paused')).toBe(false)
  })

  it('R3: malformed spec yields a NON-reviewable gate item (bounce)', async () => {
    const items = await gateItem('malformed-spec')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'gate', gate: 'G0', reviewable: false })
    expect(items[0]!.problems.join(' ')).toMatch(/Requirements/)
    expect(items[0]!.problems.join(' ')).toMatch(/Assumptions/)
  })

  it('in flight: an open producer entry newer than the packet makes the gate non-reviewable (#159)', async () => {
    const items = await gateItem('g0-redispatched')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'gate', gate: 'G0', reviewable: false })
    expect(items[0]!.inflight).toMatchObject({ role: 'analyst' })
    // Empty problems is what tells this apart from the R3 bounce view: nothing
    // is malformed here, the artifact is simply being replaced.
    expect(items[0]!.problems).toEqual([])
    expect(items[0]!.detail).toContain('analyst')
    expect(items[0]!.detail).toContain('superseded')
    expect(items[0]!.inflight!.since).toBeGreaterThan(items[0]!.since!)
  })

  it('in flight ages out: an open entry older than the role timeout stays reviewable, with the wait said (#159)', async () => {
    // Suppressing a gate on the word of an engine that is no longer running is
    // the worse failure, so the card comes back — carrying why it was late.
    const items = await gateItem('g0-lost-dispatch')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'gate', gate: 'G0', reviewable: true, inflight: null })
    expect(items[0]!.detail).toContain('analyst was re-dispatched')
    expect(items[0]!.detail).toContain('ages out a lost dispatch')
  })

  it('a closed producer entry is not in flight — the artifact landed and the gate is ordinary (#159)', async () => {
    const items = await gateItem('g0-producer-landed')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'gate', gate: 'G0', reviewable: true, inflight: null })
    expect(items[0]!.detail).toBe('g0-producer-landed is waiting on G0')
  })

  it('an open entry for another role leaves G0 alone — only the gate’s own producer supersedes it (#159)', async () => {
    const items = await gateItem('g0-other-role')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'gate', gate: 'G0', reviewable: true, inflight: null })
  })

  it('an open entry older than the packet is the dispatch that produced it, not a re-dispatch (#159)', async () => {
    // The engine's own metering can leave the opening entry unclosed; without
    // the newer-than-the-packet clause that would suppress every fresh gate.
    const items = await gateItem('g0-open-before-packet')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'gate', gate: 'G0', reviewable: true, inflight: null })
  })

  it('malformed state.yaml surfaces as a malformed-run item, never guessed around', async () => {
    const items = await gateItem('bad-state')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'malformed', reviewable: false })
  })

  it('done run needs nothing', async () => {
    const items = await gateItem('done-merged')
    expect(items).toHaveLength(0)
  })
})

/**
 * #348. `escalation` is the one pause reason that says nothing about its own
 * exit: it means a human is owed, and the engine writes it for conditions as
 * different as a contract dispute and a phase outside the profile. Some of
 * those clear themselves once the named edit lands; these do not clear at all
 * without a hand edit, and resolving alone re-pauses within a tick. So the
 * card reads the last resolved escalation's own words. The reasons are
 * composed in `orchestrator/src/derive.ts` (rules D8, D21, D4) and quoted here
 * verbatim: this is the test that catches a reword on either side.
 */
describe('pausedInstruction reads the resolved escalation (#348)', () => {
  const pausedOn = (...escalations: { reason: string; resolvedAt: string }[]): RunState => {
    const { state, error } = parseRunState(
      `run: toy
branch: run/toy
phase: paused
profile: full
paused_reason: escalation

budget: {cost_limit_usd: 25, cost_spent_usd: 0, ledger: []}

gates:
  G0: {approved: false, by: null, at: null, notes: null}
  G1: {approved: false, by: null, at: null, notes: null}
  G2: {approved: false, by: null, at: null, notes: null}
  G3: {approved: false, by: null, at: null, notes: null}

tasks: []

escalations:
${escalations
  .map(
    (e) => `  - at: "2026-09-01T09:00:00Z"
    from_role: orchestrator
    reason: ${JSON.stringify(e.reason)}
    resolved: true
    resolved_by: Toy Operator
    resolved_at: "${e.resolvedAt}"
    resolution: seen`,
  )
  .join('\n')}
`,
    )
    expect(error).toBeNull()
    return state!
  }

  const at = (hour: string) => `2026-09-01T${hour}:00:00Z`

  it('D8 contract dispute: name the artifact, and say a resolution alone re-pauses', () => {
    const detail = pausedInstruction(pausedOn({ reason: 'plan.md bounced 2× and is still malformed — contract dispute, a human should look', resolvedAt: at('11') }))
    expect(detail).toContain('plan.md')
    expect(detail).toContain('by hand')
    expect(detail).toContain('contract')
    expect(detail).toContain('re-pauses')
  })

  it('D21 profile violation: say edit profile: heavier, and that profiles never downgrade', () => {
    const detail = pausedInstruction(pausedOn({ reason: 'phase "release" does not exist in profile standard', resolvedAt: at('11') }))
    expect(detail).toContain('profile:')
    expect(detail).toContain('never downgrade')
    expect(detail).toContain('re-pauses')
    // The gate half of D21 is the same edit and gets the same sentence.
    expect(
      pausedInstruction(pausedOn({ reason: 'gate G3 is decided but does not exist in profile patch — profiles upgrade mid-run, never downgrade', resolvedAt: at('11') })),
    ).toBe(detail)
  })

  it('D4 no task files: say which files have to land, and where', () => {
    const detail = pausedInstruction(pausedOn({ reason: 'phase is implement but the run has no task files — the G1 packet did not carry into state', resolvedAt: at('11') }))
    expect(detail).toContain('tasks/*.yaml')
    expect(detail).toContain('runs/toy/')
    expect(detail).toContain('re-pauses')
  })

  it('D4 unknown status: quote the status and list the ones the table knows', () => {
    const detail = pausedInstruction(pausedOn({ reason: 'task 01-core has status "wedged" the derivation table has no rule for', resolvedAt: at('11') }))
    expect(detail).toContain('01-core')
    expect(detail).toContain('"wedged"')
    expect(detail).toContain('in-review')
  })

  it('any other escalation keeps the generic sentence — the match is deliberately narrow', () => {
    expect(pausedInstruction(pausedOn({ reason: 'reviewer escalated task 01-core — see runs/toy/review-01.md', resolvedAt: at('11') }))).toBe(GENERIC_PAUSE)
    expect(pausedInstruction(pausedOn())).toBe(GENERIC_PAUSE) // paused for an escalation nobody recorded
  })

  it('the most recently resolved escalation governs, not the first one recorded', () => {
    const detail = pausedInstruction(
      pausedOn(
        { reason: 'spec.md bounced 2× and is still malformed — contract dispute, a human should look', resolvedAt: at('11') },
        { reason: 'phase "release" does not exist in profile standard', resolvedAt: at('14') },
      ),
    )
    expect(detail).toContain('profile:')
    expect(detail).not.toContain('spec.md')
  })
})

describe('inbox ordering', () => {
  it('ranks oldest first: the 7-day-old escalation leads the queue', async () => {
    const { inbox, runs } = await buildPortfolio([ctx.source])
    expect(inbox.length).toBeGreaterThanOrEqual(8)
    expect(inbox[0]!.slug).toBe('escalated')
    expect(inbox[0]!.kind).toBe('escalation')
    const done = runs.find((r) => r.slug === 'done-merged')!
    expect(done.needsHuman).toBe(0)
    expect(done.gates.G3.approved).toBe(true)
  })
})
