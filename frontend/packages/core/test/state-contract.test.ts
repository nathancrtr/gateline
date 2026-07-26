// The parse boundary (R3, R4): classifying a target repo's state contract,
// parsing a state.yaml under a generic contract, and resolving
// validateArtifact's required keys from the repo's own template — all
// without disturbing the SDLC default path a single existing test depends on.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  deriveStateContract,
  parseRunState,
  resolveStateContract,
  SDLC_STATE_CONTRACT,
  validateArtifact,
  type ContractTemplates,
  type StateContract,
} from '../src/index.ts'

const repoRoot = resolve(fileURLToPath(import.meta.url), '../../../../..')

// The fixture contract from plan.md "Interface contracts" — a core instance
// with no SDLC markers (no branch/budget/tasks).
const CORE_ONLY_TEMPLATE = `run: example
phase: intake
paused_reason: null
gates:
  intake: {approved: false, by: null, at: null, notes: null}
  publish: {approved: false, by: null, at: null, notes: null}
escalations: []
`

const GENERIC_CONTRACT: StateContract = {
  kind: 'generic',
  gateIds: ['intake', 'publish'],
  requiredKeys: ['run', 'phase', 'paused_reason', 'gates', 'escalations'],
  branchRequired: false,
}

describe('deriveStateContract — classification table', () => {
  it("this repository's post-split contracts/state.yaml classifies as sdlc", async () => {
    const stateTemplate = await readFile(resolve(repoRoot, 'contracts/state.yaml'), 'utf8')
    expect(deriveStateContract(stateTemplate, null)).toEqual(SDLC_STATE_CONTRACT)
  })

  it('a core-only template (no branch/budget/tasks) classifies as generic, derived from its own keys', () => {
    const contract = deriveStateContract(CORE_ONLY_TEMPLATE, null)
    expect(contract).toEqual(GENERIC_CONTRACT)
  })

  it('state.yaml absent falls back to state-core.yaml, same derivation', () => {
    const contract = deriveStateContract(null, CORE_ONLY_TEMPLATE)
    expect(contract).toEqual(GENERIC_CONTRACT)
  })

  it('both absent classifies as sdlc — bare fixture repos keep today’s behavior', () => {
    expect(deriveStateContract(null, null)).toEqual(SDLC_STATE_CONTRACT)
  })

  it('unparseable state.yaml classifies as sdlc, even when a core template exists', () => {
    expect(deriveStateContract('not: [valid', CORE_ONLY_TEMPLATE)).toEqual(SDLC_STATE_CONTRACT)
  })

  it('a state.yaml that parses to a non-object (garbage) classifies as sdlc', () => {
    expect(deriveStateContract('- a\n- b\n', null)).toEqual(SDLC_STATE_CONTRACT)
  })
})

describe('resolveStateContract', () => {
  it("reads this repository's own templates and resolves to sdlc", async () => {
    const templates: ContractTemplates = {
      read: async (name) => readFile(resolve(repoRoot, 'contracts', name), 'utf8').catch(() => null),
    }
    expect(await resolveStateContract(templates)).toEqual(SDLC_STATE_CONTRACT)
  })

  it('resolves to generic when only a core-only template is offered', async () => {
    const templates: ContractTemplates = {
      read: async (name) => (name === 'state-core.yaml' ? CORE_ONLY_TEMPLATE : null),
    }
    expect(await resolveStateContract(templates)).toEqual(GENERIC_CONTRACT)
  })
})

describe('parseRunState under a generic contract', () => {
  it('accepts a state file using the declared gates and no branch', () => {
    const text = `run: example
phase: intake
paused_reason: null
gates:
  intake: {approved: false, by: null, at: null, notes: null}
  publish: {approved: false, by: null, at: null, notes: null}
escalations: []
`
    const { state, error, generic } = parseRunState(text, GENERIC_CONTRACT)
    expect(error).toBeNull()
    expect(state).toBeNull()
    expect(generic).not.toBeNull()
    expect(generic!.run).toBe('example')
    expect(generic!.phase).toBe('intake')
    expect(generic!.gateOrder).toEqual(['intake', 'publish'])
    expect(Object.keys(generic!.gates)).toEqual(['intake', 'publish'])
    expect(generic!.escalations).toEqual([])
  })

  it('carries declared gate ids first, then any undeclared ids present in the file', () => {
    const text = `run: example
gates:
  intake: {approved: true, by: Someone}
  publish: {approved: false, by: null}
  extra: {approved: false, by: null}
`
    const { generic, error } = parseRunState(text, GENERIC_CONTRACT)
    expect(error).toBeNull()
    expect(generic!.gateOrder).toEqual(['intake', 'publish', 'extra'])
  })

  it('rejects a file missing `run`', () => {
    const text = `gates:
  intake: {approved: false, by: null}
  publish: {approved: false, by: null}
`
    const { state, error, generic } = parseRunState(text, GENERIC_CONTRACT)
    expect(state).toBeNull()
    expect(generic).toBeNull()
    expect(error).toMatch(/run/)
  })

  it('rejects a file with a non-mapping gates', () => {
    const text = `run: example
gates: [not, a, mapping]
`
    const { state, error, generic } = parseRunState(text, GENERIC_CONTRACT)
    expect(state).toBeNull()
    expect(generic).toBeNull()
    expect(error).toMatch(/gates/)
  })

  it('requires branch only when the contract declares it', () => {
    const branchRequired: StateContract = { ...GENERIC_CONTRACT, branchRequired: true }
    const withoutBranch = `run: example
gates:
  intake: {approved: false, by: null}
  publish: {approved: false, by: null}
`
    const { error } = parseRunState(withoutBranch, branchRequired)
    expect(error).toMatch(/branch/)

    const withBranch = `run: example
branch: run/example
gates:
  intake: {approved: false, by: null}
  publish: {approved: false, by: null}
`
    expect(parseRunState(withBranch, branchRequired).error).toBeNull()
  })
})

describe('parseRunState default path (SDLC) — unchanged', () => {
  it('parses a full SDLC document exactly as before', () => {
    const text = `run: toy
branch: run/toy
phase: plan
paused_reason: null
budget: {cost_limit_usd: 25, cost_spent_usd: 0}
gates:
  G0: {approved: false, by: null}
  G1: {approved: false, by: null}
  G2: {approved: false, by: null}
  G3: {approved: false, by: null}
tasks: []
escalations: []
`
    const { state, error, generic } = parseRunState(text)
    expect(error).toBeNull()
    expect(generic).toBeUndefined()
    expect(state!.run).toBe('toy')
    expect(state!.branch).toBe('run/toy')
    expect(state!.profile).toBe('full')
  })
})

describe('validateArtifact(state.yaml) resolves required keys from the target repo template', () => {
  const repoTemplates: ContractTemplates = {
    read: async (name) => readFile(resolve(repoRoot, 'contracts', name), 'utf8').catch(() => null),
  }

  it("uses this repository's own contracts/state.yaml keys as required, not a compiled-in list", async () => {
    const v = await validateArtifact('state.yaml', 'run: x\n', repoTemplates)
    expect(v.contract).toBe('state.yaml')
    expect(v.ok).toBe(false)
    expect(v.missing).toEqual(expect.arrayContaining(['branch', 'phase', 'paused_reason', 'budget', 'gates', 'tasks', 'escalations']))
  })

  it('sweep: every runs/*/state.yaml in this repository validates ok against the repo template', async () => {
    const { readdir } = await import('node:fs/promises')
    const slugs = await readdir(resolve(repoRoot, 'runs'))
    let checked = 0
    for (const slug of slugs) {
      const path = resolve(repoRoot, 'runs', slug, 'state.yaml')
      const content = await readFile(path, 'utf8').catch(() => null)
      if (content === null) continue
      checked++
      const v = await validateArtifact('state.yaml', content, repoTemplates)
      expect({ slug, ...v }).toMatchObject({ slug, ok: true, missing: [] })
    }
    expect(checked).toBeGreaterThan(0)
  })
})
