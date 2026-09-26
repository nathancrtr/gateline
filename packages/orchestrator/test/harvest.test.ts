// #182: a shell-less role (analyst, architect) writes its artifact into the
// dispatch checkout but has no shell to commit it with — left uncommitted,
// the next tick's D6 sees no artifact at the branch tip and redispatches
// forever, and the dispatch worktree is force-removed when the job settles,
// destroying the work. The harvest-commit is the fix: the fold scoops up
// exactly this role's own outputs (`harvestPathspecs`) and commits them
// under the bot identity before the worktree is torn down (#406 moved the
// harvest from a shared run checkout into the fold of each job's private
// worktree; what it takes, and what it leaves, is unchanged).
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LocalGitSource } from '@gateline/core'
import { describe, expect, it } from 'vitest'
import { Engine } from '../src/engine.ts'
import { parseLedger } from '../src/observe.ts'
import { removeRunCheckout } from '../src/workspace.ts'
import { agentCommit, FakeDispatcher, log, makeToyRepo, reconcile, SPEC, TEST_REGISTRY, toyRef } from './engine.helper.ts'

const BOT = { name: 'gateline-orchestrator', email: 'orchestrator@gateline.invalid' }

function makeEngine(dir: string, dispatcher: FakeDispatcher): Engine {
  return new Engine({ repoDir: dir, identity: BOT, dispatcher, registry: TEST_REGISTRY, staleMs: 10 * 60 * 1000 })
}

/** Frontmatter matching a real roles/analyst.md: no `shell` capability. */
function markAnalystShellLess(dir: string): void {
  mkdirSync(join(dir, 'roles'), { recursive: true })
  writeFileSync(
    join(dir, 'roles', 'analyst.md'),
    '---\nrole: analyst\ndispatch: toy\ncapability_profile: balanced\ncapabilities: [read, search, write-artifacts]\ninputs: []\noutputs: [spec.md]\nwrites_code: false\ngate: G0\n---\n\n# Analyst\n',
  )
}

describe('engine harvest-commit (#182)', () => {
  it('harvests a shell-less analyst dispatch that left spec.md uncommitted', async () => {
    const { dir } = makeToyRepo()
    markAnalystShellLess(dir)
    const dispatcher = new FakeDispatcher((req) => {
      expect(req.body).toContain('the orchestrator commits them for you')
      expect(req.body).not.toContain('git add')
      writeFileSync(join(req.cwd, 'runs/toy/spec.md'), SPEC)
      return {}
    })
    const engine = makeEngine(dir, dispatcher)
    const source = new LocalGitSource('check', dir)
    const ref = toyRef(dir)
    try {
      await reconcile(engine)

      const spec = await source.readArtifact(ref, 'spec.md')
      expect(spec).toBe(SPEC)

      const harvestCommits = log(dir).filter((l) => /\|state\(toy\): harvested analyst/.test(l))
      expect(harvestCommits).toHaveLength(1)
      expect(harvestCommits[0]!.startsWith(`${BOT.name}|`)).toBe(true)

      // D6 (producer artifact absent) must not fire again — the artifact is
      // on the branch now, so the next tick rests on G0 (D10), not D6.
      const [outcome] = await engine.tick()
      expect(outcome!.action.kind).toBe('rest')
      expect(outcome!.action.rule).toBe('D10')
    } finally {
      await removeRunCheckout(dir, 'run/toy')
    }
  })

  it('no-ops when the role already committed its own work (shell-ful, defense-in-depth)', async () => {
    const { dir, clock } = makeToyRepo()
    const dispatcher = new FakeDispatcher((req) => {
      agentCommit(req.cwd, clock, { 'runs/toy/spec.md': SPEC }, 'toy: spec')
      return {}
    })
    const engine = makeEngine(dir, dispatcher)
    try {
      await reconcile(engine)
      expect(log(dir).some((l) => l.includes('harvested'))).toBe(false)
    } finally {
      await removeRunCheckout(dir, 'run/toy')
    }
  })

  it('scopes the harvest to the role\'s own artifact, leaving a stray file behind', async () => {
    const { dir } = makeToyRepo()
    markAnalystShellLess(dir)
    const dispatcher = new FakeDispatcher((req) => {
      writeFileSync(join(req.cwd, 'runs/toy/spec.md'), SPEC)
      // A stray file the analyst produced outside its own artifact list —
      // the harvest must never sweep it in.
      writeFileSync(join(req.cwd, 'runs/toy/review-01.md'), '# stray\n')
      return {}
    })
    const engine = makeEngine(dir, dispatcher)
    const source = new LocalGitSource('check', dir)
    const ref = toyRef(dir)
    try {
      await reconcile(engine)
      const spec = await source.readArtifact(ref, 'spec.md')
      expect(spec).toBe(SPEC)
      const stray = await source.readArtifact(ref, 'review-01.md')
      expect(stray).toBeNull() // never committed — out of the analyst's harvest scope
    } finally {
      await removeRunCheckout(dir, 'run/toy')
    }
  })

  it('harvests nothing on a failed dispatch — the uncommitted file never reaches the branch', async () => {
    const { dir } = makeToyRepo()
    markAnalystShellLess(dir)
    const dispatcher = new FakeDispatcher((req) => {
      writeFileSync(join(req.cwd, 'runs/toy/spec.md'), SPEC)
      return { ok: false, costUsd: null, tokensIn: null, tokensOut: null, error: 'model outage' }
    })
    const engine = makeEngine(dir, dispatcher)
    const source = new LocalGitSource('check', dir)
    const ref = toyRef(dir)
    try {
      await reconcile(engine)
      const spec = await source.readArtifact(ref, 'spec.md')
      expect(spec).toBeNull()
      expect(log(dir).some((l) => l.includes('harvested'))).toBe(false)
      const { state } = await source.readState(ref)
      const failures = parseLedger(state).filter((e) => e.role === 'analyst' && e.failed)
      expect(failures).toHaveLength(2) // original + one retry, both failed dispatch — never harvested
    } finally {
      await removeRunCheckout(dir, 'run/toy')
    }
  })
})
