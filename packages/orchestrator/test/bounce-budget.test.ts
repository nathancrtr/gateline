// #348: the bounce budget is per dispute, not per run.
//
// D7 bounces a malformed artifact twice and D8 calls the third occurrence a
// contract dispute. Counting bounces over the whole branch history made that a
// one-shot: once two bounces stood in the log, every later malformed version of
// that artifact escalated on sight — including one a human had already
// repaired by hand, resolved the dispute over, and let the producer regenerate
// after a decline. The human got no bounces at all the second time, and a
// reason quoting bounces from a week earlier.
//
// Resolving the D8 escalation for an artifact is what resets its count. These
// tests drive `observeRun` over real commits, because the count is read from
// the commit grammar and the reset from `state.yaml` — both facts on the
// branch, neither reachable from a hand-built observation.
import { describe, expect, it } from 'vitest'
import { LocalGitSource } from '@gateline/core'
import { deriveAction } from '../src/derive.ts'
import { observeRun } from '../src/observe.ts'
import { makeToyRepo, toyRef, HUMAN } from './engine.helper.ts'

const BOT = { name: 'gateline-orchestrator', email: 'orchestrator@gateline.invalid' }

/** Two orchestrator bounce commits over spec.md, exactly as `bounceMessage` writes them. */
async function bounceTwice(dir: string): Promise<void> {
  const bot = new LocalGitSource('orchestrator', dir, { identity: BOT })
  for (const n of [1, 2]) {
    const write = await bot.writeState(
      toyRef(dir),
      (doc) => doc.setIn(['budget', 'cost_spent_usd'], n),
      'state(toy): bounced spec.md — re-dispatching analyst (missing: Requirements)',
    )
    expect(write.ok).toBe(true)
  }
}

/** Append a resolved D8 escalation over spec.md, resolved `secondsAhead` from now. */
async function resolveDispute(dir: string, secondsAhead: number): Promise<void> {
  const human = new LocalGitSource('human', dir, { identity: HUMAN })
  const write = await human.writeState(
    toyRef(dir),
    (doc) =>
      doc.setIn(
        ['escalations'],
        [
          {
            at: new Date(Date.now() - 60_000).toISOString(),
            from_role: 'orchestrator',
            reason: 'spec.md bounced 2× and is still malformed — contract dispute, a human should look',
            resolved: true,
            resolved_by: HUMAN.name,
            resolved_at: new Date(Date.now() + secondsAhead * 1000).toISOString(),
            resolution: 'fixed the spec by hand',
          },
        ],
      ),
    'state(toy): escalation 1 resolved by Toy Operator',
  )
  expect(write.ok).toBe(true)
}

const observe = async (dir: string) => observeRun(new LocalGitSource('check', dir), toyRef(dir), { estimates: { analyst: 2 } })

describe('the bounce budget resets with the dispute (#348)', () => {
  it('counts every bounce while no dispute over the artifact has been resolved', async () => {
    const { dir } = makeToyRepo()
    await bounceTwice(dir)
    expect((await observe(dir)).bounceCounts['spec.md']).toBe(2)
  })

  it('drops bounces older than the resolved contract dispute naming that artifact', async () => {
    const { dir } = makeToyRepo()
    await bounceTwice(dir)
    // Resolved a minute from now, so both bounce commits are older than it —
    // the shape of a human who resolved the dispute after the second bounce.
    await resolveDispute(dir, 60)
    expect((await observe(dir)).bounceCounts['spec.md']).toBeUndefined()
  })

  it('counts bounces that land after the resolution, so the next dispute still escalates', async () => {
    const { dir } = makeToyRepo()
    await bounceTwice(dir)
    // Resolved a minute *ago*: the same two bounces now postdate it, which is
    // what a fresh round of bounces after a repair looks like.
    await resolveDispute(dir, -60)
    expect((await observe(dir)).bounceCounts['spec.md']).toBe(2)
  })

  it('leaves another artifact’s budget alone — the reset is named, not global', async () => {
    const { dir } = makeToyRepo()
    const bot = new LocalGitSource('orchestrator', dir, { identity: BOT })
    const write = await bot.writeState(
      toyRef(dir),
      (doc) => doc.setIn(['budget', 'cost_spent_usd'], 1),
      'state(toy): bounced plan.md — re-dispatching architect (missing: Approach)',
    )
    expect(write.ok).toBe(true)
    await bounceTwice(dir)
    await resolveDispute(dir, 60)
    const obs = await observe(dir)
    expect(obs.bounceCounts['spec.md']).toBeUndefined()
    expect(obs.bounceCounts['plan.md']).toBe(1)
  })

  it('D8 gives the repaired artifact its two bounces back rather than escalating on sight', async () => {
    const { dir } = makeToyRepo()
    await bounceTwice(dir)
    await resolveDispute(dir, 60)
    const obs = await observe(dir)
    // The producer regenerated spec.md and it is malformed again. Before the
    // reset this derived D8 immediately, quoting the old bounces; now it is
    // the first bounce of a new dispute.
    const malformed = {
      ...obs,
      artifacts: [...obs.artifacts, 'spec.md'],
      validations: { ...obs.validations, 'spec.md': { contract: 'spec.md', ok: false, missing: ['Requirements'], notes: [] } },
    }
    const action = deriveAction(malformed)
    expect(action).toMatchObject({ kind: 'dispatch', rule: 'D7' })
  })
})
