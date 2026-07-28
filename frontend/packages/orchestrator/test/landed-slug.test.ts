// #213: a slug is used once. When `runs/<slug>/` is already on the default
// branch the run has shipped, and anything the branch does afterwards is a
// second life for a record that has one — the shape that cost `fleetview-design`
// $152.78 of dispatch on already-live content before Ops noticed at G3.
//
// Two defenses, tested here as a pair because either alone leaves the hole
// open: the source retires the clean case (an identical record is history,
// however it was merged), and the engine refuses the diverged case (rule LR)
// rather than deriving past a merge.
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LocalGitSource, planRunScaffold } from '@agentic/core'
import { Engine } from '../src/engine.ts'
import { FakeDispatcher, makeToyRepo, TEST_REGISTRY, type Clock } from './engine.helper.ts'

const BOT = { name: 'agentic-orchestrator', email: 'orchestrator@agentic.invalid' }

const cleanups: string[] = []
afterEach(() => {
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function toyRepo() {
  const made = makeToyRepo()
  cleanups.push(made.dir)
  return made
}

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

/** Land `run/toy` on main the way GitHub's "Squash and merge" does: one new commit, branch untouched. */
function squashMerge(dir: string, clock: Clock): void {
  git(dir, ['merge', '--squash', '-q', 'run/toy'])
  git(dir, ['commit', '-q', '-m', 'toy: shipped (#1)'], clock.next())
}

/** A commit on the run branch after the merge — the run carrying on past its own shipping. */
function branchMovesOn(dir: string, clock: Clock): void {
  git(dir, ['checkout', '-q', 'run/toy'])
  const path = join(dir, 'runs/toy/intent-brief.md')
  mkdirSync(join(dir, 'runs/toy'), { recursive: true })
  writeFileSync(path, '# Intent Brief: toy\n\n## Problem\nToy, again.\n\n## Motivation\nTest.\n\n## Constraints\nNone.\n\n## Out of scope\nAll.\n')
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-q', '-m', 'toy: a second life for a shipped slug'], clock.next())
  git(dir, ['checkout', '-q', 'main'])
}

const makeEngine = (dir: string, dispatcher: FakeDispatcher, log?: (l: string) => void) =>
  new Engine({ repoDir: dir, identity: BOT, dispatcher, registry: TEST_REGISTRY, staleMs: 10 * 60 * 1000, log })

describe('a shipped slug is not dispatchable (#213, rule LR)', () => {
  it('refuses to dispatch a run whose record landed and whose branch moved on, and pauses it', async () => {
    const { dir, clock } = toyRepo()
    squashMerge(dir, clock)
    branchMovesOn(dir, clock)
    const dispatcher = new FakeDispatcher(() => ({}))
    const lines: string[] = []
    const engine = makeEngine(dir, dispatcher, (l) => lines.push(l))

    const outcomes = await engine.tick()
    await engine.drain()

    const toy = outcomes.find((o) => o.slug === 'toy')!
    expect(toy.action.kind).toBe('escalate')
    expect(toy.action.rule).toBe('LR')
    expect(dispatcher.calls.length).toBe(0) // no metered work on shipped content

    const source = new LocalGitSource('t', dir)
    const ref = (await source.listRuns()).find((r) => r.slug === 'toy')!
    const { state } = await source.readState(ref)
    expect(state?.phase).toBe('paused')
    expect(state?.paused_reason).toBe('slug-landed')
    expect(state?.escalations?.[0]?.reason).toContain('already on main')
    expect(state?.escalations?.[0]?.reason).toContain('fresh slug')
    expect(state?.escalations?.[0]?.from_role).toBe('orchestrator')
    expect(lines.join('\n')).toContain('landed-slug guard')
  })

  it('stays paused on the next tick instead of escalating again', async () => {
    const { dir, clock } = toyRepo()
    squashMerge(dir, clock)
    branchMovesOn(dir, clock)
    const dispatcher = new FakeDispatcher(() => ({}))
    const engine = makeEngine(dir, dispatcher)

    await engine.tick()
    await engine.drain()
    const second = await engine.tick()
    await engine.drain()

    expect(second.find((o) => o.slug === 'toy')?.action.kind).toBe('rest')
    const source = new LocalGitSource('t', dir)
    const ref = (await source.listRuns()).find((r) => r.slug === 'toy')!
    const { state } = await source.readState(ref)
    expect(state?.escalations?.length).toBe(1)
  })

  it('never reaches the engine at all when the landed record is identical — that run is history', async () => {
    const { dir, clock } = toyRepo()
    squashMerge(dir, clock) // no divergence: main and the branch carry the same record

    const dispatcher = new FakeDispatcher(() => ({}))
    const engine = makeEngine(dir, dispatcher)
    const outcomes = await engine.tick()
    await engine.drain()

    expect(outcomes.find((o) => o.slug === 'toy')).toBeUndefined()
    expect(dispatcher.calls.length).toBe(0)
  })

  it('leaves an ordinary unmerged run dispatching normally', async () => {
    const { dir } = toyRepo()
    const dispatcher = new FakeDispatcher(() => ({}))
    const engine = makeEngine(dir, dispatcher)

    const outcomes = await engine.tick()
    await engine.drain()

    expect(outcomes.find((o) => o.slug === 'toy')?.action.kind).toBe('dispatch')
    expect(dispatcher.calls.map((c) => c.role)).toEqual(['analyst'])
  })
})

describe('a shipped slug cannot be staged again (#213)', () => {
  it('refuses a new run under a slug whose record is on the default branch', async () => {
    const { dir, clock } = toyRepo()
    squashMerge(dir, clock)
    git(dir, ['branch', '-D', 'run/toy']) // merged and tidied away — only the record on main remains

    const source = new LocalGitSource('human', dir)
    const scaffold = planRunScaffold({
      slug: 'toy',
      title: 'Toy, a second time',
      profile: 'standard',
      briefMarkdown: '# Intent Brief: Toy, a second time\n\n## Problem\nToy.\n\n## Motivation\nTest.\n\n## Constraints\nNone.\n\n## Out of scope\nAll.\n',
      costLimitUsd: 50,
      intake: { source: null, ref: null, url: null, clientKey: null },
      stagedBy: 'Toy Operator',
    })
    const outcome = await source.stageRun(scaffold, { name: 'Toy Operator', email: 'op@example.test' })

    expect(outcome.outcome).toBe('refused')
    expect(outcome.outcome === 'refused' && outcome.reason).toBe('slug-taken')
  })
})
