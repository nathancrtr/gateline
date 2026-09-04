// Shadow mode (M1): replay a run's history commit by commit, derive the
// engine's action at each point, and compare it with what the human
// orchestrator actually did next. Agreement builds the trust the autonomy
// gate requires; every disagreement is dispositioned as an engine bug or a
// design finding — either way the run was free design review.
import type { RunState } from '@gateline/core/record'
import type { LocalGitSource, RunRef } from '@gateline/core/sources'
import { parseRunState } from '@gateline/core/record'
import { deriveAction, type DerivedAction, type DispatchIntent } from './derive.ts'
import { observeRun, type ObserveConfig } from './observe.ts'
import { loadRegistry } from './registry.ts'

export type ShadowVerdict = 'agree' | 'disagree' | 'note' | 'end'

export interface ShadowStep {
  oid: string
  time: number
  subject: string
  action: DerivedAction
  next: { oid: string; subject: string } | null
  verdict: ShadowVerdict
  note: string
}

export async function shadowReplay(
  source: LocalGitSource,
  slug: string,
  rev: string,
  cfg: Omit<ObserveConfig, 'estimates'> = {},
): Promise<ShadowStep[]> {
  const { runs: runsRoot } = await source.frameworkRoots()
  const runDir = `${runsRoot}/${slug}`
  const commits = (await source.git.log(rev, [runDir])).reverse() // oldest first
  const steps: ShadowStep[] = []

  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i]!
    const ref: RunRef = { source: source.id, slug, ref: commit.oid, kind: 'branch', branch: `run/${slug}` }
    // The registry is read as of the replayed commit, like everything else the
    // engine observes: the question is what the engine would have derived at
    // that state, not what today's estimates make of a historical budget.
    const registry = await loadRegistry(source.git, commit.oid)
    const obs = await observeRun(source, ref, { ...cfg, estimates: registry?.estimates ?? {} })
    const action = deriveAction(obs)

    const next = commits[i + 1] ?? null
    if (!next) {
      steps.push({ oid: commit.oid, time: commit.time, subject: commit.subject, action, next: null, verdict: 'end', note: 'history ends here' })
      continue
    }

    const changedRaw = await source.git.run(['show', '--name-only', '--format=', next.oid])
    const changed = changedRaw.split('\n').filter(Boolean)
    const prevState = obs.state
    const nextStateRaw = await source.git.show(next.oid, `${runDir}/state.yaml`)
    const nextState = nextStateRaw === null ? null : parseRunState(nextStateRaw).state

    const { verdict, note } = matchStep(action, { changed, runDir, runsRoot, prevState, nextState })
    steps.push({
      oid: commit.oid,
      time: commit.time,
      subject: commit.subject,
      action,
      next: { oid: next.oid, subject: next.subject },
      verdict,
      note,
    })
  }
  return steps
}

interface NextFacts {
  changed: string[]
  runDir: string
  runsRoot: string
  prevState: RunState | null
  nextState: RunState | null
}

/** Run-relative artifact paths the next commit touched. */
function artifactsTouched(facts: NextFacts): string[] {
  return facts.changed.filter((p) => p.startsWith(`${facts.runDir}/`)).map((p) => p.slice(facts.runDir.length + 1))
}

function codeTouched(facts: NextFacts): boolean {
  return facts.changed.some((p) => !p.startsWith(`${facts.runsRoot}/`))
}

function gateDecided(facts: NextFacts): boolean {
  if (!facts.prevState || !facts.nextState) return false
  return (['G0', 'G1', 'G2', 'G3'] as const).some(
    (g) => facts.prevState!.gates[g].by === null && facts.nextState!.gates[g].by !== null,
  )
}

function dispatchLanded(d: DispatchIntent, facts: NextFacts): boolean {
  const touched = artifactsTouched(facts)
  switch (d.role) {
    case 'analyst':
      return touched.includes('spec.md')
    case 'architect':
      return touched.includes('plan.md') || touched.some((p) => p.startsWith('tasks/'))
    case 'implementer':
      return codeTouched(facts) || (d.task !== null && touched.some((p) => p.startsWith('tasks/') && p.includes(d.task!)))
    case 'reviewer':
      return touched.some((p) => /^review-\d+/.test(p))
    case 'verifier':
      return touched.includes('verification-report.md')
    case 'ops':
      return touched.includes('release-plan.md')
  }
}

/**
 * The §4.4 commit-then-launch intent: the next commit flips the derived
 * dispatch's task to `dispatched` before any artifact exists. That commit IS
 * the engine's own dispatch protocol, performed by hand (M0 discipline) —
 * refusing to credit it made a disciplined v0 run "disagree" with the engine
 * for doing exactly what the engine would do (mdtoc replay, steps 8/11).
 */
function dispatchIntentCommitted(d: DispatchIntent, facts: NextFacts): boolean {
  if (d.task === null || !facts.prevState || !facts.nextState) return false
  const before = facts.prevState.tasks.find((t) => t.id === d.task)
  const after = facts.nextState.tasks.find((t) => t.id === d.task)
  return before !== undefined && after !== undefined && before.status !== 'dispatched' && after.status === 'dispatched'
}

function matchStep(action: DerivedAction, facts: NextFacts): { verdict: ShadowVerdict; note: string } {
  const { prevState, nextState } = facts
  switch (action.kind) {
    case 'dispatch': {
      const landed = action.dispatches.filter((d) => dispatchLanded(d, facts))
      if (landed.length === action.dispatches.length) return { verdict: 'agree', note: 'every derived dispatch’s artifact landed next' }
      const performed = action.dispatches.filter((d) => dispatchLanded(d, facts) || dispatchIntentCommitted(d, facts))
      if (performed.length === action.dispatches.length)
        return { verdict: 'agree', note: 'dispatch intent committed next (§4.4 commit-then-launch)' }
      if (performed.length > 0)
        return {
          verdict: 'note',
          note: `${performed.length}/${action.dispatches.length} derived dispatches landed next — v0 human serialized what the engine would parallelize`,
        }
      return { verdict: 'disagree', note: 'derived a dispatch but the next commit shows no matching artifact' }
    }
    case 'record': {
      if (!nextState) return { verdict: 'disagree', note: 'derived bookkeeping but the next commit has no readable state' }
      const phaseChanged = prevState && nextState.phase !== prevState.phase
      const statusChanged =
        prevState &&
        nextState.tasks.some((t) => {
          const before = prevState.tasks.find((p) => p.id === t.id)
          return before !== undefined && before.status !== t.status
        })
      // review_rounds updates previously fell through to `disagree` even when
      // the next commit performed exactly that bookkeeping (mdtoc replay,
      // step 15) — the record matcher knew phase and task-status only.
      const roundsChanged =
        prevState &&
        nextState.tasks.some((t) => {
          const before = prevState.tasks.find((p) => p.id === t.id)
          return before !== undefined && before.review_rounds !== t.review_rounds
        })
      if (action.updates.some((u) => u.field === 'phase') && phaseChanged) return { verdict: 'agree', note: 'phase advanced next' }
      if (action.updates.some((u) => u.field === 'task-status') && statusChanged)
        return { verdict: 'agree', note: 'task status recorded next' }
      if (action.updates.some((u) => u.field === 'review-rounds') && roundsChanged)
        return { verdict: 'agree', note: 'review round recorded next' }
      return { verdict: 'disagree', note: 'derived bookkeeping the next commit did not perform' }
    }
    case 'escalate': {
      if (nextState?.phase === 'paused') return { verdict: 'agree', note: 'run paused next' }
      if (prevState && nextState && nextState.escalations.length > prevState.escalations.length)
        return { verdict: 'agree', note: 'escalation appended next' }
      return { verdict: 'disagree', note: 'derived an escalation the v0 human did not record' }
    }
    case 'rest': {
      if (action.rule === 'D10') {
        if (gateDecided(facts)) return { verdict: 'agree', note: 'rested at the gate; a human decided next' }
        return { verdict: 'note', note: 'rested at the gate; next commit was not a gate decision' }
      }
      if (action.rule === 'D12') {
        if (artifactsTouched(facts).length > 0 || codeTouched(facts))
          return { verdict: 'agree', note: 'rested while in flight; work landed next' }
        return { verdict: 'note', note: 'rested in flight; next commit changed nothing observable' }
      }
      return { verdict: 'note', note: `rest (${action.rule}); any human activity is compatible` }
    }
  }
}

export function formatShadowStep(step: ShadowStep, index: number): string {
  const when = new Date(step.time * 1000).toISOString()
  const lines = [
    `#${index} ${step.oid.slice(0, 7)} ${when}  ${step.subject}`,
    `   derived: [${step.action.kind}/${step.action.rule}] ${
      step.action.kind === 'dispatch'
        ? step.action.dispatches.map((d) => `${d.role}${d.task ? `(${d.task})` : ''}`).join(' + ')
        : step.action.kind === 'record'
          ? step.action.updates
              .map((u) =>
                u.field === 'phase'
                  ? `phase→${u.to}`
                  : u.field === 'review-rounds'
                    ? `${u.task} rounds→${u.to}`
                    : u.field === 'seed-tasks'
                      ? `seed tasks [${u.ids.join(', ')}]`
                      : `${u.task}→${u.to}`,
              )
              .join(', ')
          : step.action.why
    }`,
    `   actual:  ${step.next ? `${step.next.oid.slice(0, 7)} ${step.next.subject}` : '(end of history)'}`,
    `   verdict: ${step.verdict}${step.note ? ` — ${step.note}` : ''}`,
  ]
  return lines.join('\n')
}
