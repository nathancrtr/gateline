// Shadow mode against this repository's real history (M1 exit criterion,
// run 2 of 3): replay the mdtoc run and hold the engine to what the human
// orchestrator actually did. Every disagreement must belong to a
// dispositioned class — see shadow-mdtoc.md for the disposition table.
//
// What this run pins that wordfreq's replay could not: decline recovery
// (D9) from a genuine G1 decline, §4.4 intent commits scored as agreement,
// review_rounds records matching, and DB pre-flight against a real ledger.
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LocalGitSource } from '@agentic/core'
import { shadowReplay, type ShadowStep } from '../src/shadow.ts'

const repoRoot = resolve(fileURLToPath(import.meta.url), '../../../..')
const source = new LocalGitSource('sandbox', repoRoot)

// One replay serves every test — it walks every commit of the run and is
// the expensive part.
let cached: Promise<ShadowStep[]> | null = null
function replay(): Promise<ShadowStep[]> {
  cached ??= (async () => {
    const runs = await source.listRuns()
    const mdtoc = runs.find((r) => r.slug === 'mdtoc')
    expect(mdtoc).toBeDefined()
    return shadowReplay(source, 'mdtoc', mdtoc!.ref)
  })()
  return cached
}

describe('mdtoc shadow replay', { timeout: 120_000 }, () => {
  it('agrees with the human orchestrator at every bookkeeping-synced state', async () => {
    const steps = await replay()
    expect(steps.length).toBeGreaterThanOrEqual(22)

    // The spine: dispatch analyst at the brief; rest at G0; dispatch
    // architect on approval.
    expect(steps[0]!.action).toMatchObject({ kind: 'dispatch', rule: 'D6' })
    expect(steps[0]!.verdict).toBe('agree')
    expect(steps[1]!.action).toMatchObject({ kind: 'rest', rule: 'D10' })
    expect(steps[1]!.verdict).toBe('agree')
    expect(steps[2]!.action).toMatchObject({ kind: 'dispatch', rule: 'D6' })
    expect(steps[2]!.verdict).toBe('agree')

    // §4.4 intent commits are agreement, not disagreement (engine bug found
    // and fixed by this run — shadow-mdtoc.md, "Engine bugs").
    const intentSteps = steps.filter((s) => s.note.includes('commit-then-launch'))
    expect(intentSteps.length).toBeGreaterThanOrEqual(2)
    for (const s of intentSteps) expect(s.verdict).toBe('agree')

    // A derived review_rounds sync matches the commit that performs it
    // (second matcher fix from this run).
    const roundsStep = steps.find((s) => s.note.includes('review round recorded'))
    expect(roundsStep).toBeDefined()
    expect(roundsStep!.verdict).toBe('agree')

    // With the G2 packet complete, the engine rests at the gate and the
    // human decides next — the autonomy boundary holding where P4 puts it.
    const g2Ready = steps.find((s) => s.subject.includes('ready for G2'))
    expect(g2Ready).toBeDefined()
    expect(g2Ready!.action).toMatchObject({ kind: 'rest', rule: 'D10' })
    expect(g2Ready!.verdict).toBe('agree')
  })

  it('replays decline recovery (D9) end to end from a genuine G1 decline', async () => {
    const steps = await replay()

    // Declined → the engine rests: resume is a human decision (D2).
    const declined = steps.find((s) => s.subject.includes('G1 declined'))
    expect(declined).toBeDefined()
    expect(declined!.action).toMatchObject({ kind: 'rest', rule: 'D2' })

    // Resumed → the engine derives the producer re-dispatch with the
    // decline notes (D9); it re-derives D9 until plan.md is redone.
    const resumed = steps.find((s) => s.subject.includes('resumed by'))
    expect(resumed).toBeDefined()
    expect(resumed!.action).toMatchObject({ kind: 'dispatch', rule: 'D9' })

    // Redone plan lands → the engine rests at the re-opened gate; the
    // human's round-2 approval decides next.
    const amended = steps.find((s) => s.subject.includes('plan amendment ADR-4'))
    expect(amended).toBeDefined()
    expect(amended!.action).toMatchObject({ kind: 'rest', rule: 'D10' })
    expect(amended!.verdict).toBe('agree')
  })

  it('every disagreement belongs to a dispositioned class (shadow-mdtoc.md)', async () => {
    const steps = await replay()
    const disagreements = steps.filter((s) => s.verdict === 'disagree')

    for (const step of disagreements) {
      // Class 1 — decline ripple: after the resume, the human dispatched the
      // analyst (spec amendment) before D9's producer re-dispatch, because
      // the decline notes invalidated the upstream artifact too.
      const declineRipple = step.subject.includes('resumed by') && step.action.kind === 'dispatch' && step.action.rule === 'D9'
      // Class 2 — parallel landing skew: with siblings in flight, the next
      // linearized commit is another task's landing, not the derived
      // reviewer dispatch; the engine converges one step later.
      const parallelSkew =
        step.action.kind === 'dispatch' &&
        step.action.rule === 'D13' &&
        step.next !== null &&
        step.next.subject.includes('task 03')
      expect(
        declineRipple || parallelSkew,
        `undispositioned disagreement at ${step.oid.slice(0, 7)} (${step.subject}): ${step.note}`,
      ).toBe(true)
    }

    // The dispositioned classes are bounded: this run's table has exactly
    // one of each. More of the same class is tolerable drift (post-merge
    // commits can extend history); a new class is not.
    expect(disagreements.length).toBeLessThanOrEqual(3)
  })
})
