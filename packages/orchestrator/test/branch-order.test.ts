// #346, on real commits: "after" is the run branch's own order, and the
// clocks that stamped the facts are allowed to contradict it.
//
// The derive rows in `derive.test.ts` prove the rules with hand-built
// observations. These prove the whole read path — `observeRun` walking a real
// repository, and Gatehouse's readiness reading the same branch — because the
// bug being fixed lived in the gap between them: the human's `resolved_at`
// came from one machine, the artifact's commit date from another, and every
// rule subtracted the two. Each case here back-dates the resolution's commit
// so its clock says the opposite of what the branch says.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { deriveReadiness, LocalGitSource } from '@gateline/core'
import { deriveAction, roundCapReason } from '../src/derive.ts'
import { observeRun } from '../src/observe.ts'
import { makeToyRepo, REVIEW, SPEC, toyRef } from './engine.helper.ts'

const cleanups: string[] = []
afterEach(() => {
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const git = (dir: string, args: string[], date?: string) =>
  execFileSync('git', ['-C', dir, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
      ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}),
    },
  })

const iso = (secondsFromNow: number) => new Date(Date.now() + secondsFromNow * 1000).toISOString()

/** Land files on `run/toy` with a chosen committer date, then return to main. */
function land(dir: string, files: Record<string, string>, date: string, message: string): void {
  git(dir, ['checkout', '-q', 'run/toy'])
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, content)
  }
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-q', '--allow-empty', '-m', message], date)
  git(dir, ['checkout', '-q', 'main'])
}

interface StateOpts {
  phase: string
  tasks: string
  escalations: string
  ledger?: string
  /** Override G0's entry — a decline is `approved: false` with a `by`. */
  g0?: string
}

/** A `state.yaml` written by hand, so a test can put a clock where it likes. */
const stateYaml = (o: StateOpts): string => `run: toy
branch: run/toy
phase: ${o.phase}
paused_reason: null

budget:
  cost_limit_usd: 50
  cost_spent_usd: 0
${o.ledger ?? ''}
gates:
  G0: ${o.g0 ?? '{approved: false, by: null, at: null, notes: null}'}
  G1: {approved: false, by: null, at: null, notes: null}
  G2: {approved: false, by: null, at: null, notes: null}
  G3: {approved: false, by: null, at: null, notes: null}

tasks:
${o.tasks}
escalations:
${o.escalations}
`

const resolvedEscalation = (reason: string, at: string, disposition: string | null = null) => `  - at: null
    from_role: orchestrator
    reason: "${reason}"
    resolved: true
    resolved_by: Toy Operator
    resolved_at: "${at}"
    resolution: looked; carry on
${disposition ? `    disposition: ${disposition}\n` : ''}`

function toyRepo() {
  const made = makeToyRepo()
  cleanups.push(made.dir)
  return made
}

const observe = (dir: string) => {
  const source = new LocalGitSource('engine', dir)
  return observeRun(source, toyRef(dir), { isAncestor: (a, b) => source.git.isAncestor(a, b) })
}

describe('the engine reads recency off the branch, not off the clocks (#346)', () => {
  it('D17 dispatches the re-review when the resolution commit follows the verdict, though its clock reads an hour earlier', async () => {
    const { dir } = toyRepo()
    land(dir, { 'runs/toy/spec.md': SPEC, 'runs/toy/review-01.md': REVIEW('01-a', 'escalate', 1) }, iso(0), 'toy: review escalates')
    // The human's machine is an hour behind the committer that landed the
    // review — the DEPLOY.md topology, exaggerated. The resolution still
    // lands second on the branch, which is the fact that decides.
    land(
      dir,
      {
        'runs/toy/state.yaml': stateYaml({
          phase: 'implement',
          tasks: '  - {id: 01-a, status: in-review, review_rounds: 1}\n',
          escalations: resolvedEscalation('reviewer escalated task 01-a — see review-01.md', iso(-3600), 're-review'),
        }),
      },
      iso(-3600),
      'state(toy): escalation #0 resolved by Toy Operator [disposition: re-review]',
    )
    const action = deriveAction(await observe(dir))
    expect(action.kind).toBe('dispatch')
    expect(action.kind === 'dispatch' && action.dispatches[0]).toMatchObject({ role: 'reviewer', task: '01-a', round: 2 })
  })

  it('D17 keeps escalating when the resolution commit precedes the verdict, though its clock reads an hour later', async () => {
    const { dir } = toyRepo()
    // The same two commits, the other way round: the human resolved something
    // the reviewer has since escalated again, and a clock ahead of the
    // committer must not route a round nobody has looked at.
    land(
      dir,
      {
        'runs/toy/spec.md': SPEC,
        'runs/toy/state.yaml': stateYaml({
          phase: 'implement',
          tasks: '  - {id: 01-a, status: in-review, review_rounds: 1}\n',
          escalations: resolvedEscalation('reviewer escalated task 01-a — see review-01.md', iso(3600), 're-review'),
        }),
      },
      iso(0),
      'state(toy): escalation #0 resolved by Toy Operator [disposition: re-review]',
    )
    land(dir, { 'runs/toy/review-01.md': REVIEW('01-a', 'escalate', 1) }, iso(0), 'toy: review escalates')
    expect(deriveAction(await observe(dir))).toMatchObject({ kind: 'escalate', rule: 'D17', pause: 'escalation' })
  })

  it('the round-cap grant and its inbox card agree: D4 stands down and the card goes (#342)', async () => {
    const { dir } = toyRepo()
    land(dir, { 'runs/toy/spec.md': SPEC, 'runs/toy/review-01.md': REVIEW('01-a', 'request-changes', 3) }, iso(0), 'toy: round 3')
    land(
      dir,
      {
        'runs/toy/state.yaml': stateYaml({
          phase: 'implement',
          tasks: '  - {id: 01-a, status: in-review, review_rounds: 3}\n',
          escalations: resolvedEscalation(roundCapReason('01-a', 3), iso(-3600)),
        }),
      },
      iso(-3600),
      'state(toy): escalation #0 resolved by Toy Operator',
    )
    const action = deriveAction(await observe(dir))
    expect(action).not.toMatchObject({ rule: 'D4' })
    expect(action.kind === 'dispatch' && action.dispatches[0]).toMatchObject({ role: 'implementer', task: '01-a', round: 4 })
    // The two surfaces must never disagree about this: a card asking for a
    // decision already made, on a loop that is already moving.
    const { items } = await deriveReadiness(new LocalGitSource('human', dir), toyRef(dir))
    expect(items.filter((i) => i.kind === 'round-cap')).toHaveLength(0)
  })

  it('the round-cap card stays when the grant predates the verdict it would answer', async () => {
    const { dir } = toyRepo()
    land(
      dir,
      {
        'runs/toy/spec.md': SPEC,
        'runs/toy/state.yaml': stateYaml({
          phase: 'implement',
          tasks: '  - {id: 01-a, status: in-review, review_rounds: 3}\n',
          escalations: resolvedEscalation(roundCapReason('01-a', 3), iso(3600)),
        }),
      },
      iso(0),
      'state(toy): escalation #0 resolved by Toy Operator',
    )
    land(dir, { 'runs/toy/review-01.md': REVIEW('01-a', 'request-changes', 4) }, iso(0), 'toy: another round')
    expect(deriveAction(await observe(dir))).toMatchObject({ kind: 'escalate', rule: 'D4', pause: 'round-cap' })
    const { items } = await deriveReadiness(new LocalGitSource('human', dir), toyRef(dir))
    expect(items.filter((i) => i.kind === 'round-cap')).toHaveLength(1)
  })

  it('the landing cap counts dispatches the branch places after the artifact, whatever the ledger\u2019s clock says (#343)', async () => {
    const { dir } = toyRepo()
    const declined = '{approved: false, by: Toy Operator, at: null, notes: tighten R1}'
    land(dir, { 'runs/toy/spec.md': SPEC }, iso(0), 'toy: spec')
    land(dir, { 'runs/toy/state.yaml': stateYaml({ phase: 'spec', tasks: '  []\n', escalations: '  []\n', g0: declined }) }, iso(0), 'state(toy): G0 declined by Toy Operator')
    // G0 is declined and the run resumed, so rule D9 wants the analyst back.
    // Two earlier dispatches returned ok and committed nothing; their ledger
    // `at` reads *older* than spec.md's commit \u2014 the engine host runs behind
    // the committer \u2014 but their intent commit is the branch's newer fact,
    // which is what the cap counts.
    land(
      dir,
      {
        'runs/toy/state.yaml': stateYaml({
          phase: 'spec',
          tasks: '  []\n',
          escalations: '  []\n',
          ledger: `  ledger:
    - {at: "${iso(-3600)}", role: analyst, task: null, round: null, adapter: fake, model: null, tokens_in: null, tokens_out: null, cost_usd: 2, failed: false, refused: false}
    - {at: "${iso(-3500)}", role: analyst, task: null, round: null, adapter: fake, model: null, tokens_in: null, tokens_out: null, cost_usd: 2, failed: false, refused: false}
`,
        }),
      },
      iso(-3400),
      'state(toy): metered analyst',
    )
    const obs = await observe(dir)
    expect(obs.idleDispatches.get('analyst|')).toBe(2)
    expect(deriveAction(obs)).toMatchObject({ kind: 'escalate', rule: 'DL', pause: 'escalation' })
  })
})
