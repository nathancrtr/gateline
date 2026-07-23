// #182: a shell-less role must never be told to "git add" (there is no
// shell available to run it) — the live evidence in the issue was models
// burning turns trying to comply with a commit instruction they had no tool
// for. hasShell selects between the two instructions; there is no default,
// so every call site has to decide.
import { describe, expect, it } from 'vitest'
import { promptBody } from '../src/prompts.ts'
import type { DispatchIntent } from '../src/derive.ts'

const intent = (role: DispatchIntent['role'], task: string | null = null, round: number | null = null): DispatchIntent => ({
  role,
  task,
  round,
  bounce: null,
  reason: 'test',
})

describe('promptBody: shell-less roles get the harvest line, never a commit instruction', () => {
  it('analyst, hasShell=false: harvest line, no git add', () => {
    const body = promptBody('toy', intent('analyst'), null, 'runs', 'full', false)
    expect(body).toContain('the orchestrator commits them for you')
    expect(body).not.toContain('git add')
  })

  it('architect, hasShell=false: harvest line, no git add', () => {
    const body = promptBody('toy', intent('architect'), null, 'runs', 'full', false)
    expect(body).toContain('the orchestrator commits them for you')
    expect(body).not.toContain('git add')
  })
})

describe('promptBody: shell-ful roles still get COMMIT_LINE', () => {
  it('analyst, hasShell=true: commit instruction', () => {
    const body = promptBody('toy', intent('analyst'), null, 'runs', 'full', true)
    expect(body).toContain('git add the files you produced or changed')
    expect(body).not.toContain('the orchestrator commits them for you')
  })

  it('reviewer, hasShell=true: commit instruction', () => {
    const body = promptBody('toy', intent('reviewer', '01-core', 1), 'tasks/01-core.yaml', 'runs', 'full', true)
    expect(body).toContain('git add the files you produced or changed')
  })

  it('implementer, hasShell=true: commit instruction', () => {
    const body = promptBody('toy', intent('implementer', '01-core', 1), 'tasks/01-core.yaml', 'runs', 'full', true)
    expect(body).toContain('git add the files you produced or changed')
  })

  it('verifier, hasShell=true: commit instruction', () => {
    const body = promptBody('toy', intent('verifier'), null, 'runs', 'full', true)
    expect(body).toContain('git add the files you produced or changed')
  })

  it('ops, hasShell=true: commit instruction', () => {
    const body = promptBody('toy', intent('ops'), null, 'runs', 'full', true)
    expect(body).toContain('git add the files you produced or changed')
  })
})
