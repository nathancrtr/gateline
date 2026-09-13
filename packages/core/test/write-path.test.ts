// The single write path (§3): comment-preserving mutation, plumbing commit,
// CAS refusal on concurrent movement, and the checked-out-branch fallback.
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Closure, DecisionError, type Disposition, Git, parseRunState, planDecision, type RunRef, type RunState } from '../src/index.ts'
import { dropFixture, type FixtureContext, makeFixture } from './fixture.helper.ts'

let ctx: FixtureContext
const who = { name: 'Fixture Operator', email: 'operator@example.test' }

beforeEach(async () => {
  ctx = await makeFixture()
})
afterEach(() => dropFixture(ctx))

async function refFor(slug: string): Promise<RunRef> {
  const refs = await ctx.source.listRuns()
  return refs.find((r) => r.slug === slug)!
}

describe('approve via the write path', () => {
  it('commits a comment-preserving state edit authored by the named human', async () => {
    const ref = await refFor('g0-pending')
    const { state, raw } = await ctx.source.readState(ref)
    expect(raw).toContain('# a gate entry is written ONLY by the named human')

    const planned = planDecision(state!, { action: 'approve', gate: 'G0', burden: 'confirmation', notes: 'spec matches intent' }, who)
    const result = await ctx.source.writeState(ref, planned.mutate, planned.message)
    expect(result.ok).toBe(true)

    const after = await ctx.source.readState(ref)
    expect(after.state!.gates.G0).toMatchObject({ approved: true, by: 'Fixture Operator', burden: 'confirmation' })
    expect(after.state!.phase).toBe('plan') // v0: approval advances the phase
    // Contract commentary survives the round-trip (must not be worse than hand-editing).
    expect(after.raw).toContain('# a gate entry is written ONLY by the named human')
    expect(after.raw).toContain('# exhaustion pauses the run; it never silently degrades')

    const [head] = await ctx.source.git.log(ref.ref, [], { maxCount: 1 })
    expect(head!.author).toBe('Fixture Operator')
    expect(head!.subject).toBe('state(g0-pending): G0 approved by Fixture Operator [burden: confirmation]')
  })

  it('refuses when the branch moved since read (CAS)', async () => {
    const ref = await refFor('g0-pending')
    const { state } = await ctx.source.readState(ref)
    const git = ctx.source.git
    const branchRef = `refs/heads/${ref.branch}`
    const tip = (await git.revParse(branchRef))!

    // Interleave: another actor commits between our read and our write. We
    // simulate by pre-moving the ref and monkey-patching revParse's answer
    // back to the stale tip for the write's first read.
    const blob = await git.hashObject('interloper\n')
    const tree = await git.writeTreeWithBlob(tip, 'runs/g0-pending/note.txt', blob)
    const other = await git.commitTree(tree, tip, 'concurrent agent commit')

    const staleRevParse = git.revParse.bind(git)
    let first = true
    git.revParse = async (rev: string) => {
      if (rev === `${branchRef}^{commit}` || rev === branchRef) {
        if (first) {
          first = false
          await git.run(['update-ref', branchRef, other, tip]) // the race, after our read
          return tip
        }
      }
      return staleRevParse(rev)
    }

    const planned = planDecision(state!, { action: 'approve', gate: 'G0', burden: 'confirmation' }, who)
    const result = await ctx.source.writeState(ref, planned.mutate, planned.message)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('ref-moved')
    // The interloper's commit is still the tip — nothing was clobbered.
    expect(await staleRevParse(branchRef)).toBe(other)
  })

  it('commits through the worktree when the branch is checked out (clean file)', async () => {
    const ref = await refFor('g1-pending')
    const git = new Git(ctx.repo.dir)
    await git.run(['checkout', '-q', 'run/g1-pending'])

    const { state } = await ctx.source.readState(ref)
    const planned = planDecision(state!, { action: 'approve', gate: 'G1', burden: 'light-correction', notes: 'ADRs accepted' }, who)
    const result = await ctx.source.writeState(ref, planned.mutate, planned.message)
    expect(result.ok).toBe(true)

    // The checkout advanced with the ref — not silently diverged.
    const status = await git.run(['status', '--porcelain'])
    expect(status.trim()).toBe('')
    const after = parseRunState(await readFile(join(ctx.repo.dir, 'runs/g1-pending/state.yaml'), 'utf8'))
    expect(after.state!.gates.G1.approved).toBe(true)
  })

  it('refuses when the checked-out state file is dirty (AC2.1: the hand edit is byte-identical on disk afterward)', async () => {
    const ref = await refFor('g1-pending')
    const git = new Git(ctx.repo.dir)
    await git.run(['checkout', '-q', 'run/g1-pending'])
    const statePath = join(ctx.repo.dir, 'runs/g1-pending/state.yaml')
    const dirtied = `${await readFile(statePath, 'utf8')}# local scribble\n`
    await writeFile(statePath, dirtied)

    const { state } = await ctx.source.readState(ref)
    const planned = planDecision(state!, { action: 'approve', gate: 'G1', burden: 'confirmation' }, who)
    const result = await ctx.source.writeState(ref, planned.mutate, planned.message)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('dirty-worktree')
    expect(await readFile(statePath, 'utf8')).toBe(dirtied) // AC2.1: never silently discarded
  })
})

describe('decision legality (planDecision)', () => {
  it('approve without burden is rejected — burden capture is the point', async () => {
    const ref = await refFor('g0-pending')
    const { state } = await ctx.source.readState(ref)
    expect(() => planDecision(state!, { action: 'approve', gate: 'G0' }, who)).toThrow(DecisionError)
  })

  it('decline without a reason is rejected', async () => {
    const ref = await refFor('g0-pending')
    const { state } = await ctx.source.readState(ref)
    expect(() => planDecision(state!, { action: 'decline', gate: 'G0' }, who)).toThrow(/reason/)
  })

  it('approving an already-approved gate is rejected', async () => {
    const ref = await refFor('g1-pending')
    const { state } = await ctx.source.readState(ref)
    expect(() => planDecision(state!, { action: 'approve', gate: 'G0', burden: 'confirmation' }, who)).toThrow(/already approved/)
  })

  it('decline pauses the run with gate-declined', async () => {
    const ref = await refFor('g0-pending')
    const { state } = await ctx.source.readState(ref)
    const planned = planDecision(state!, { action: 'decline', gate: 'G0', notes: 'R2 contradicts the brief' }, who)
    await ctx.source.writeState(ref, planned.mutate, planned.message)
    const after = await ctx.source.readState(ref)
    expect(after.state!.phase).toBe('paused')
    expect(after.state!.paused_reason).toBe('gate-declined')
    expect(after.state!.gates.G0).toMatchObject({ approved: false, by: 'Fixture Operator' })
  })

  it('resolve-escalation records who/when/how', async () => {
    const ref = await refFor('escalated')
    const { state } = await ctx.source.readState(ref)
    const planned = planDecision(
      state!,
      { action: 'resolve-escalation', escalationIndex: 0, notes: 'sample committed as fixtures/sample.txt' },
      who,
    )
    await ctx.source.writeState(ref, planned.mutate, planned.message)
    const after = await ctx.source.readState(ref)
    expect(after.state!.escalations[0]).toMatchObject({
      resolved: true,
      resolved_by: 'Fixture Operator',
      resolution: 'sample committed as fixtures/sample.txt',
      disposition: null,
    })
  })

  it('resolve-escalation with no disposition leaves the field unset — absent means the engine default (#189)', async () => {
    const ref = await refFor('escalated')
    const { state } = await ctx.source.readState(ref)
    const planned = planDecision(state!, { action: 'resolve-escalation', escalationIndex: 0, notes: 'no route named' }, who)
    expect(planned.message).not.toMatch(/disposition/)
    expect(planned.summary).not.toMatch(/disposition/)
  })

  it('resolve-escalation records a disposition, mentions it in the commit message and summary (#189)', async () => {
    const ref = await refFor('escalated')
    const { state } = await ctx.source.readState(ref)
    const planned = planDecision(
      state!,
      { action: 'resolve-escalation', escalationIndex: 0, notes: 'condition addressed on the branch', disposition: 're-review' },
      who,
    )
    expect(planned.message).toContain('[disposition: re-review]')
    expect(planned.summary).toContain('disposition: re-review')
    await ctx.source.writeState(ref, planned.mutate, planned.message)
    const after = await ctx.source.readState(ref)
    expect(after.state!.escalations[0]).toMatchObject({
      resolved: true,
      resolved_by: 'Fixture Operator',
      resolution: 'condition addressed on the branch',
      disposition: 're-review',
    })
  })

  it('resolve-escalation accepts return-to-implement as the other disposition', async () => {
    const ref = await refFor('escalated')
    const { state } = await ctx.source.readState(ref)
    const planned = planDecision(
      state!,
      { action: 'resolve-escalation', escalationIndex: 0, notes: 'send back to the implementer', disposition: 'return-to-implement' },
      who,
    )
    await ctx.source.writeState(ref, planned.mutate, planned.message)
    const after = await ctx.source.readState(ref)
    expect(after.state!.escalations[0]!.disposition).toBe('return-to-implement')
  })

  it('resolve-escalation accepts re-plan as a third disposition (#190)', async () => {
    const ref = await refFor('escalated')
    const { state } = await ctx.source.readState(ref)
    const planned = planDecision(
      state!,
      { action: 'resolve-escalation', escalationIndex: 0, notes: 'decomposition defect — send to the architect', disposition: 're-plan' },
      who,
    )
    expect(planned.message).toContain('[disposition: re-plan]')
    expect(planned.summary).toContain('disposition: re-plan')
    await ctx.source.writeState(ref, planned.mutate, planned.message)
    const after = await ctx.source.readState(ref)
    expect(after.state!.escalations[0]).toMatchObject({
      resolved: true,
      resolved_by: 'Fixture Operator',
      resolution: 'decomposition defect — send to the architect',
      disposition: 're-plan',
    })
  })

  it('resolve-escalation rejects a junk disposition', async () => {
    const ref = await refFor('escalated')
    const { state } = await ctx.source.readState(ref)
    expect(() =>
      planDecision(
        state!,
        { action: 'resolve-escalation', escalationIndex: 0, notes: 'x', disposition: 'do-a-barrel-roll' as Disposition },
        who,
      ),
    ).toThrow(/disposition must be one of/)
  })

  it('approve with hold signs the gate and pauses the run in the same commit', async () => {
    const ref = await refFor('g0-pending')
    const { state } = await ctx.source.readState(ref)
    const planned = planDecision(
      state!,
      { action: 'approve', gate: 'G0', burden: 'confirmation', hold: true, holdReason: 'awaiting design-candidate selection' },
      who,
    )
    const result = await ctx.source.writeState(ref, planned.mutate, planned.message)
    expect(result.ok).toBe(true)

    const after = await ctx.source.readState(ref)
    expect(after.state!.gates.G0).toMatchObject({ approved: true, by: 'Fixture Operator', burden: 'confirmation' })
    expect(after.state!.phase).toBe('paused')
    expect(after.state!.paused_reason).toBe('awaiting design-candidate selection')

    const [head] = await ctx.source.git.log(ref.ref, [], { maxCount: 1 })
    expect(head!.subject).toBe(
      'state(g0-pending): G0 approved by Fixture Operator [burden: confirmation] and held (awaiting design-candidate selection)',
    )
  })

  it('resume after a hold advances past the signed gate without re-opening it', async () => {
    const ref = await refFor('g0-pending')
    const { state } = await ctx.source.readState(ref)
    const held = planDecision(state!, { action: 'approve', gate: 'G0', burden: 'confirmation', hold: true, holdReason: 'selection pending' }, who)
    await ctx.source.writeState(ref, held.mutate, held.message)

    const mid = await ctx.source.readState(ref)
    const resumed = planDecision(mid.state!, { action: 'resume' }, who)
    expect(resumed.summary).toContain('"plan"') // G0 signed → the hold releases into plan
    await ctx.source.writeState(ref, resumed.mutate, resumed.message)

    const after = await ctx.source.readState(ref)
    expect(after.state!.phase).toBe('plan')
    expect(after.state!.paused_reason).toBeNull()
    expect(after.state!.gates.G0.approved).toBe(true) // a hold is not a decline; nothing re-opens
  })

  it('hold without a reason is rejected — the reason is what the inbox shows', async () => {
    const ref = await refFor('g0-pending')
    const { state } = await ctx.source.readState(ref)
    expect(() => planDecision(state!, { action: 'approve', gate: 'G0', burden: 'confirmation', hold: true }, who)).toThrow(/reason/)
  })

  it('hold combined with advancePhase:false is rejected as ambiguous', async () => {
    const ref = await refFor('g0-pending')
    const { state } = await ctx.source.readState(ref)
    expect(() =>
      planDecision(state!, { action: 'approve', gate: 'G0', burden: 'confirmation', hold: true, holdReason: 'x', advancePhase: false }, who),
    ).toThrow(/hold already implies/)
  })

  it('resume derives the correct phase from the gate ledger', async () => {
    const ref = await refFor('paused-budget')
    const { state } = await ctx.source.readState(ref)
    const limit = state!.budget!.cost_limit_usd!
    const planned = planDecision(state!, { action: 'resume', costLimitUsd: limit + 10 }, who)
    expect(planned.summary).toContain('"plan"') // G0 approved, G1 not → plan
    await ctx.source.writeState(ref, planned.mutate, planned.message)
    const after = await ctx.source.readState(ref)
    expect(after.state!.phase).toBe('plan')
    expect(after.state!.paused_reason).toBeNull()
  })

  // #96: a budget pause is a condition the engine recomputes from the ledger
  // and the limit. A resume that changes neither re-pauses on the next tick,
  // so the planner refuses it and the one that sticks writes the new limit in
  // the same commit as the phase restore.
  describe('resume from budget-exhausted carries the budget decision (#96)', () => {
    it('refuses a bare resume, naming the limit and the alternative', async () => {
      const ref = await refFor('paused-budget')
      const { state } = await ctx.source.readState(ref)
      expect(state!.paused_reason).toBe('budget-exhausted')
      expect(() => planDecision(state!, { action: 'resume' }, who)).toThrow(/re-pauses on the next tick/)
      expect(() => planDecision(state!, { action: 'resume' }, who)).toThrow(/close the run/)
    })

    it('refuses a limit that is not higher than the current one', async () => {
      const ref = await refFor('paused-budget')
      const { state } = await ctx.source.readState(ref)
      const limit = state!.budget!.cost_limit_usd!
      expect(() => planDecision(state!, { action: 'resume', costLimitUsd: limit }, who)).toThrow(/has to be higher/)
      expect(() => planDecision(state!, { action: 'resume', costLimitUsd: -1 }, who)).toThrow(/positive number/)
    })

    it('writes the raised limit and the phase in one commit, and the subject says so', async () => {
      const ref = await refFor('paused-budget')
      const { state } = await ctx.source.readState(ref)
      const limit = state!.budget!.cost_limit_usd!
      const planned = planDecision(state!, { action: 'resume', costLimitUsd: limit * 2 }, who)
      expect(planned.message).toContain(`cost_limit_usd $${limit} → $${limit * 2}`)
      await ctx.source.writeState(ref, planned.mutate, planned.message)
      const after = await ctx.source.readState(ref)
      expect(after.state!.phase).not.toBe('paused')
      expect(after.state!.budget!.cost_limit_usd).toBe(limit * 2)
      const [head] = await ctx.source.git.log(ref.ref, [], { maxCount: 1 })
      expect(head!.subject).toMatch(/^state\(paused-budget\): resumed to \w+ by Fixture Operator \(cost_limit_usd/)
    })

    it('a resume from any other reason may raise the limit too, but never lower it', async () => {
      const ref = await refFor('g0-pending')
      const { state } = await ctx.source.readState(ref)
      const held = planDecision(state!, { action: 'approve', gate: 'G0', burden: 'confirmation', hold: true, holdReason: 'x' }, who)
      await ctx.source.writeState(ref, held.mutate, held.message)
      const mid = await ctx.source.readState(ref)
      const limit = mid.state!.budget!.cost_limit_usd!
      expect(() => planDecision(mid.state!, { action: 'resume', costLimitUsd: limit - 1 }, who)).toThrow(/has to be higher/)
      const planned = planDecision(mid.state!, { action: 'resume', costLimitUsd: limit + 1 }, who)
      await ctx.source.writeState(ref, planned.mutate, planned.message)
      const after = await ctx.source.readState(ref)
      expect(after.state!.budget!.cost_limit_usd).toBe(limit + 1)
    })
  })
})

// #344: a gate is decided in its own phase, once every gate before it is
// signed. Gatehouse only ever offered the pending gate, so these are the
// refusals the CLI and the API were missing — the surfaces that write the
// record directly.
describe('gate order (#344)', () => {
  it('refuses to approve a gate whose phase the run has not reached, naming the phase and the pending gate', async () => {
    const ref = await refFor('g0-pending')
    const { state } = await ctx.source.readState(ref)
    expect(state!.phase).toBe('spec')
    expect(() => planDecision(state!, { action: 'approve', gate: 'G2', burden: 'confirmation' }, who)).toThrow(DecisionError)
    expect(() => planDecision(state!, { action: 'approve', gate: 'G2', burden: 'confirmation' }, who)).toThrow(
      /in phase "spec", where G2 is not on the table — G0 is the gate awaiting a decision/,
    )
  })

  it('refuses to decline one either — a decline settles the gate just as much as an approval', async () => {
    const ref = await refFor('g0-pending')
    const { state } = await ctx.source.readState(ref)
    expect(() => planDecision(state!, { action: 'decline', gate: 'G1', notes: 'not this plan' }, who)).toThrow(/G1 is not on the table/)
  })

  it('still approves the gate that is on the table, and still advances the phase', async () => {
    const ref = await refFor('g2-pending')
    const { state } = await ctx.source.readState(ref)
    expect(state!.phase).toBe('implement')
    const planned = planDecision(state!, { action: 'approve', gate: 'G2', burden: 'confirmation' }, who)
    const result = await ctx.source.writeState(ref, planned.mutate, planned.message)
    expect(result.ok).toBe(true)
    const after = await ctx.source.readState(ref)
    expect(after.state!.gates.G2.approved).toBe(true)
    expect(after.state!.phase).toBe('release')
  })

  it('lets a run paused for an escalation decide the gate a resume would put it back on', async () => {
    const ref = await refFor('g0-pending')
    const { state } = await ctx.source.readState(ref)
    const paused = planDecision(state!, { action: 'pause', pauseReason: 'escalation' }, who)
    await ctx.source.writeState(ref, paused.mutate, paused.message)

    const mid = await ctx.source.readState(ref)
    expect(mid.state!.phase).toBe('paused')
    // The run is paused over a question about the spec, and answering that
    // question *is* the G0 decision. Refusing it here would leave the human
    // holding a card with no legal move on it.
    const planned = planDecision(mid.state!, { action: 'approve', gate: 'G0', burden: 'light-correction' }, who)
    expect(planned.summary).toContain('Approve G0')
    const result = await ctx.source.writeState(ref, planned.mutate, planned.message)
    expect(result.ok).toBe(true)
    expect((await ctx.source.readState(ref)).state!.phase).toBe('plan')
  })

  it('judges a phase that lags its own gate ledger by the ledger — a signed gate not yet walked past is mid-transition, not a skip', async () => {
    const ref = await refFor('g0-pending')
    const { state } = await ctx.source.readState(ref)
    const signed = planDecision(state!, { action: 'approve', gate: 'G0', burden: 'confirmation', advancePhase: false }, who)
    await ctx.source.writeState(ref, signed.mutate, signed.message)

    const mid = await ctx.source.readState(ref)
    expect(mid.state!.phase).toBe('spec') // the engine's D5 convergence has not run yet
    expect(mid.state!.gates.G0.approved).toBe(true)
    expect(planDecision(mid.state!, { action: 'approve', gate: 'G1', burden: 'confirmation' }, who).summary).toContain('Approve G1')
  })

  it('refuses any gate decision on a staged run — arming is what starts it', async () => {
    const ref = await refFor('g0-pending')
    const { state } = await ctx.source.readState(ref)
    const staged = { ...state!, phase: 'paused' as const, paused_reason: 'staged' }
    expect(() => planDecision(staged, { action: 'approve', gate: 'G0', burden: 'confirmation' }, who)).toThrow(/staged and not yet armed/)
    expect(() => planDecision(staged, { action: 'decline', gate: 'G0', notes: 'no' }, who)).toThrow(/staged and not yet armed/)
  })
})

// #351: the same refusal Gatehouse has made since #159, for the CLI and the
// API. A ledger entry with no cost is a dispatch believed to be in flight.
describe('the producing role in flight (#351)', () => {
  const withLedger = (state: RunState, ledger: object[]): RunState => ({
    ...state,
    budget: { cost_limit_usd: null, cost_spent_usd: null, ...(state.budget ?? {}), ledger },
  })
  const open = (role: string, agoMs: number) => ({ at: new Date(Date.now() - agoMs).toISOString(), role, cost_usd: null })

  it('refuses an approval while the gate’s producer holds an open dispatch', async () => {
    const ref = await refFor('g0-pending')
    const { state } = await ctx.source.readState(ref)
    const inFlight = withLedger(state!, [open('analyst', 60_000)])
    expect(() => planDecision(inFlight, { action: 'approve', gate: 'G0', burden: 'confirmation' }, who)).toThrow(DecisionError)
    expect(() => planDecision(inFlight, { action: 'approve', gate: 'G0', burden: 'confirmation' }, who)).toThrow(
      /the analyst is in flight for G0 .* about to be superseded/s,
    )
  })

  it('ages the entry out on the same clock the gate card does — a dead engine does not hold a gate shut', async () => {
    const ref = await refFor('g0-pending')
    const { state } = await ctx.source.readState(ref)
    const stale = withLedger(state!, [open('analyst', 90 * 60_000)])
    expect(planDecision(stale, { action: 'approve', gate: 'G0', burden: 'confirmation' }, who).summary).toContain('Approve G0')
  })

  it('ignores an open dispatch of some other role, and a closed one of its own', async () => {
    const ref = await refFor('g0-pending')
    const { state } = await ctx.source.readState(ref)
    const others = withLedger(state!, [open('architect', 60_000), { ...open('analyst', 60_000), cost_usd: 0.42 }])
    expect(planDecision(others, { action: 'approve', gate: 'G0', burden: 'confirmation' }, who).summary).toContain('Approve G0')
  })

  it('still allows the decline — it adds notes for the redo, it does not sign anything', async () => {
    const ref = await refFor('g0-pending')
    const { state } = await ctx.source.readState(ref)
    const inFlight = withLedger(state!, [open('analyst', 60_000)])
    expect(planDecision(inFlight, { action: 'decline', gate: 'G0', notes: 'tighten R1' }, who).summary).toContain('Decline G0')
  })
})

// #200: the terminal state a run reaches by decision rather than by finishing.
describe('close and reopen (the run terminal state, #200)', () => {
  it('closes a paused run with a typed disposition, and the record carries who/when/why', async () => {
    const ref = await refFor('paused-budget')
    const { state } = await ctx.source.readState(ref)
    const planned = planDecision(
      state!,
      { action: 'close', closure: 'already-delivered', notes: 'Work landed via another PR; nothing left to retry.' },
      who,
    )
    expect(planned.message).toBe('state(paused-budget): closed by Fixture Operator [disposition: already-delivered]')
    expect(planned.summary).toBe('Close paused-budget as "already-delivered"')

    const result = await ctx.source.writeState(ref, planned.mutate, planned.message)
    expect(result.ok).toBe(true)
    const after = await ctx.source.readState(ref)
    expect(after.state!.phase).toBe('closed')
    expect(after.state!.paused_reason).toBeNull()
    expect(after.state!.closure).toMatchObject({
      as: 'already-delivered',
      by: 'Fixture Operator',
      reason: 'Work landed via another PR; nothing left to retry.',
    })
    expect(after.state!.closure!.at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    // Comment preservation is the same contract as every other write.
    expect(after.raw).toContain('# a gate entry is written ONLY by the named human')
  })

  it('closes a run that is still mid-flight — closing is not a pause-only affordance', async () => {
    const ref = await refFor('g0-pending')
    const { state } = await ctx.source.readState(ref)
    expect(state!.phase).toBe('spec')
    const planned = planDecision(state!, { action: 'close', closure: 'obsolete', notes: 'the need went away' }, who)
    await ctx.source.writeState(ref, planned.mutate, planned.message)
    const after = await ctx.source.readState(ref)
    expect(after.state!.phase).toBe('closed')
    expect(after.state!.closure!.as).toBe('obsolete')
  })

  it.each(['already-delivered', 'superseded', 'obsolete', 'abandoned'] as const)('accepts %s as a disposition', async (as) => {
    const ref = await refFor('paused-budget')
    const { state } = await ctx.source.readState(ref)
    const planned = planDecision(state!, { action: 'close', closure: as, notes: 'reason' }, who)
    await ctx.source.writeState(ref, planned.mutate, planned.message)
    const after = await ctx.source.readState(ref)
    expect(after.state!.closure!.as).toBe(as)
  })

  it('refuses a closure with no disposition — an untyped terminal state is the thing this prevents', async () => {
    const ref = await refFor('paused-budget')
    const { state } = await ctx.source.readState(ref)
    expect(() => planDecision(state!, { action: 'close', notes: 'just close it' }, who)).toThrow(DecisionError)
    expect(() => planDecision(state!, { action: 'close', notes: 'just close it' }, who)).toThrow(/requires a disposition/)
  })

  it('refuses a junk disposition', async () => {
    const ref = await refFor('paused-budget')
    const { state } = await ctx.source.readState(ref)
    expect(() => planDecision(state!, { action: 'close', closure: 'sure-whatever' as Closure, notes: 'x' }, who)).toThrow(/requires a disposition/)
  })

  it('refuses a closure with no reason', async () => {
    const ref = await refFor('paused-budget')
    const { state } = await ctx.source.readState(ref)
    expect(() => planDecision(state!, { action: 'close', closure: 'abandoned' }, who)).toThrow(/requires a reason/)
  })

  it('refuses to close a done run — a finished run is already its own record', async () => {
    const ref = await refFor('done-merged')
    const { state } = await ctx.source.readState(ref)
    expect(state!.phase).toBe('done')
    expect(() => planDecision(state!, { action: 'close', closure: 'abandoned', notes: 'no' }, who)).toThrow(/already its own record/)
  })

  it('refuses to close an already-closed run, naming the disposition it already carries', async () => {
    const ref = await refFor('closed-delivered')
    const { state } = await ctx.source.readState(ref)
    expect(() => planDecision(state!, { action: 'close', closure: 'abandoned', notes: 'again' }, who)).toThrow(/already closed as "already-delivered"/)
  })

  it('refuses every other decision on a closed run, and names reopen as the way back', async () => {
    const ref = await refFor('closed-delivered')
    const { state } = await ctx.source.readState(ref)
    for (const input of [
      { action: 'resume' as const },
      { action: 'pause' as const, pauseReason: 'escalation' },
      { action: 'arm' as const },
      { action: 'approve' as const, gate: 'G1' as const, burden: 'confirmation' as const },
      { action: 'decline' as const, gate: 'G1' as const, notes: 'no' },
      { action: 'resolve-escalation' as const, escalationIndex: 0, notes: 'x' },
    ]) {
      expect(() => planDecision(state!, input, who)).toThrow(/reopen it before deciding anything else/)
    }
  })

  it('reopen clears the closure and returns the run to the phase its ledger derives', async () => {
    const ref = await refFor('closed-delivered')
    const { state } = await ctx.source.readState(ref)
    const planned = planDecision(state!, { action: 'reopen' }, who)
    expect(planned.message).toBe('state(closed-delivered): reopened to plan by Fixture Operator (was closed as already-delivered)')
    expect(planned.summary).toBe('Reopen closed-delivered at phase "plan"')
    await ctx.source.writeState(ref, planned.mutate, planned.message)
    const after = await ctx.source.readState(ref)
    expect(after.state!.phase).toBe('plan') // G0 approved, G1 not
    expect(after.state!.closure).toBeNull()
    expect(after.state!.paused_reason).toBeNull()
  })

  it('refuses reopen on a run that is not closed', async () => {
    const ref = await refFor('paused-budget')
    const { state } = await ctx.source.readState(ref)
    expect(() => planDecision(state!, { action: 'reopen' }, who)).toThrow(/is not closed/)
  })

  it('a closed run whose closure block is missing is malformed, never silently closed-for-no-reason', () => {
    const raw = 'run: x\nbranch: run/x\nphase: closed\ngates:\n  G0: {approved: false, by: null, at: null, notes: null}\n  G1: {approved: false, by: null, at: null, notes: null}\n  G2: {approved: false, by: null, at: null, notes: null}\n  G3: {approved: false, by: null, at: null, notes: null}\n'
    const { state, error } = parseRunState(raw)
    expect(state).toBeNull()
    expect(error).toMatch(/closure: required when phase is closed/)
  })
})
