// Shadow mode against this repository's real history (M1 exit criterion,
// run 3 of 3 — the bar-closing run): replay the dupefind run and hold the
// engine to what the human orchestrator actually did. Every disagreement
// must belong to a dispositioned class — see shadow-dupefind.md.
//
// What this run pins that the earlier replays could not: a G0 assumption
// veto absorbed as a compatible rest, DB pre-flight against a real ledger
// for a second run, and the response-visibility contract gap (class A) that
// this run discovered and roles/implementer.md now closes.

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LocalGitSource } from '@gateline/core'
import { describe, expect, it } from 'vitest'
import { type ShadowStep, shadowReplay } from '../src/shadow.ts'

const repoRoot = resolve(fileURLToPath(import.meta.url), '../../../..')
const source = new LocalGitSource('sandbox', repoRoot)

let cached: Promise<ShadowStep[]> | null = null
function replay(): Promise<ShadowStep[]> {
  cached ??= (async () => {
    const runs = await source.listRuns()
    const dupefind = runs.find((r) => r.slug === 'dupefind')
    expect(dupefind).toBeDefined()
    return shadowReplay(source, 'dupefind', dupefind!.ref)
  })()
  return cached
}

describe('dupefind shadow replay', { timeout: 120_000 }, () => {
  it('agrees with the human orchestrator at every bookkeeping-synced state', async () => {
    const steps = await replay()
    expect(steps.length).toBeGreaterThanOrEqual(23)

    // The spine: dispatch analyst at the brief.
    expect(steps[0]!.action).toMatchObject({ kind: 'dispatch', rule: 'D6' })
    expect(steps[0]!.verdict).toBe('agree')

    // The G0 assumption veto: the engine rests at the gate while the
    // analyst's veto amendment lands — compatible, not a disagreement.
    const vetoStep = steps.find((s) => s.next?.subject.includes('G0 veto') ?? false)
    expect(vetoStep).toBeDefined()
    expect(vetoStep!.action).toMatchObject({ kind: 'rest', rule: 'D10' })
    expect(vetoStep!.verdict).toBe('note')

    // §4.4 intent commits keep scoring as agreement (mdtoc's matcher fix).
    const intentSteps = steps.filter((s) => s.note.includes('commit-then-launch'))
    expect(intentSteps.length).toBeGreaterThanOrEqual(2)
    for (const s of intentSteps) expect(s.verdict).toBe('agree')

    // With the G2 packet complete, the engine rests; the human decides.
    const g2Ready = steps.find((s) => s.subject.includes('ready for G2'))
    expect(g2Ready).toBeDefined()
    expect(g2Ready!.action).toMatchObject({ kind: 'rest', rule: 'D10' })
    expect(g2Ready!.verdict).toBe('agree')
  })

  it('every disagreement belongs to a dispositioned class (shadow-dupefind.md)', async () => {
    const steps = await replay()
    const disagreements = steps.filter((s) => s.verdict === 'disagree')

    for (const step of disagreements) {
      // Class A — response visibility: a round-2 response landed without a
      // task-file note, so the engine re-derives the implementer dispatch
      // while the human's next commit is review activity. Closed by the
      // roles/implementer.md response-note mandate in this change.
      const responseVisibility =
        step.action.kind === 'dispatch' &&
        step.action.dispatches.some((d) => d.role === 'implementer') &&
        step.next !== null &&
        /review-0\d/.test(step.next.subject)
      // Class B — parallel landing skew (mdtoc's class 2): the next
      // linearized commit is a sibling task's landing, not the derived
      // reviewer dispatch.
      const parallelSkew =
        step.action.kind === 'dispatch' &&
        step.action.dispatches.some((d) => d.role === 'reviewer') &&
        step.next !== null &&
        /task 0\d/.test(step.next.subject)
      expect(
        responseVisibility || parallelSkew,
        `undispositioned disagreement at ${step.oid.slice(0, 7)} (${step.subject}): ${step.note}`,
      ).toBe(true)
    }

    // Bounded drift: this run's table has three class-A steps and one
    // class-B. More of a known class is tolerable (post-merge history can
    // extend); a new class is not.
    expect(disagreements.length).toBeLessThanOrEqual(5)
  })
})
