// Run profiles (DESIGN.md §4.1): parsing strictness scaled to the profile,
// profile-aware phase advance, resume derivation, and decision legality.
import { describe, expect, it } from 'vitest'
import {
  DecisionError,
  deriveResumePhase,
  PROFILE_GATES,
  parseRunState,
  phaseAfterGate,
  planDecision,
  type RunState,
} from '../src/index.ts'

const who = { name: 'Operator', email: 'op@example.test' }

const yaml = (over: { profile?: string; phase?: string; gates?: string }) => `run: toy
branch: run/toy
phase: ${over.phase ?? 'plan'}
${over.profile ? `profile: ${over.profile}\n` : ''}paused_reason: null
budget: {cost_limit_usd: 25, cost_spent_usd: 0}
gates:
${over.gates ?? '  G0: {approved: false, by: null}\n  G1: {approved: false, by: null}\n  G2: {approved: false, by: null}\n  G3: {approved: false, by: null}'}
tasks: []
escalations: []
`

describe('profile parsing (strictness scaled to the profile)', () => {
  it('absent profile parses as full — every pre-profile run record keeps its meaning', () => {
    const { state, error } = parseRunState(yaml({}))
    expect(error).toBeNull()
    expect(state!.profile).toBe('full')
  })

  it('a patch run needs only G1 and G2; absent gates parse as undecided, never approved', () => {
    const { state, error } = parseRunState(
      yaml({ profile: 'patch', gates: '  G1: {approved: false, by: null}\n  G2: {approved: false, by: null}' }),
    )
    expect(error).toBeNull()
    expect(state!.profile).toBe('patch')
    expect(state!.gates.G0).toMatchObject({ approved: false, by: null })
    expect(state!.gates.G3).toMatchObject({ approved: false, by: null })
  })

  it('a gate the profile declares must be present: standard without G0 is malformed', () => {
    const { state, error } = parseRunState(
      yaml({ profile: 'standard', gates: '  G1: {approved: false, by: null}\n  G2: {approved: false, by: null}' }),
    )
    expect(state).toBeNull()
    expect(error).toMatch(/G0/)
  })

  it('a full run without G3 stays malformed — the tolerance is per-profile, not global', () => {
    const { state, error } = parseRunState(
      yaml({ gates: '  G0: {approved: false, by: null}\n  G1: {approved: false, by: null}\n  G2: {approved: false, by: null}' }),
    )
    expect(state).toBeNull()
    expect(error).toMatch(/G3/)
  })

  it('an unknown profile value is malformed, never guessed around', () => {
    const { state, error } = parseRunState(yaml({ profile: 'enterprise' }))
    expect(state).toBeNull()
    expect(error).toMatch(/profile/)
  })
})

describe('profile-aware phase advance and resume', () => {
  it('G2 advances to done in reduced profiles — the merge is the release', () => {
    expect(phaseAfterGate('G2', 'full')).toBe('release')
    expect(phaseAfterGate('G2', 'standard')).toBe('done')
    expect(phaseAfterGate('G2', 'patch')).toBe('done')
    expect(phaseAfterGate('G1', 'patch')).toBe('implement')
  })

  it('resume walks only the profile gates: an undecided G1 resumes a patch run at plan', () => {
    const { state } = parseRunState(
      yaml({ profile: 'patch', phase: 'paused', gates: '  G1: {approved: false, by: null}\n  G2: {approved: false, by: null}' }),
    )
    expect(deriveResumePhase(state!)).toBe('plan')
  })

  it('resume for a patch run with G1 approved lands at implement; both approved is done', () => {
    const approved = '  G1: {approved: true, by: Operator}\n  G2: {approved: false, by: null}'
    const { state } = parseRunState(yaml({ profile: 'patch', phase: 'paused', gates: approved }))
    expect(deriveResumePhase(state!)).toBe('implement')
    const both = '  G1: {approved: true, by: Operator}\n  G2: {approved: true, by: Operator}'
    expect(deriveResumePhase(parseRunState(yaml({ profile: 'patch', phase: 'paused', gates: both })).state!)).toBe('done')
  })
})

describe('decision legality under profiles', () => {
  const patchState = (): RunState =>
    parseRunState(yaml({ profile: 'patch', gates: '  G1: {approved: false, by: null}\n  G2: {approved: false, by: null}' })).state!

  it('a gate outside the profile cannot be decided', () => {
    expect(() => planDecision(patchState(), { action: 'approve', gate: 'G0', burden: 'confirmation' }, who)).toThrow(DecisionError)
    expect(() => planDecision(patchState(), { action: 'decline', gate: 'G3', notes: 'no' }, who)).toThrow(/does not exist in profile/)
  })

  it('approving patch G1 advances to implement; approving G2 ends the run at done', () => {
    const g1 = planDecision(patchState(), { action: 'approve', gate: 'G1', burden: 'confirmation' }, who)
    expect(g1.summary).toContain('phase "implement"')
    const s = patchState()
    s.gates.G1 = { ...s.gates.G1, approved: true, by: 'Operator' }
    const g2 = planDecision(s, { action: 'approve', gate: 'G2', burden: 'confirmation' }, who)
    expect(g2.summary).toContain('phase "done"')
  })

  it('resume cannot target a phase outside the profile', () => {
    const s = parseRunState(
      yaml({ profile: 'patch', phase: 'paused', gates: '  G1: {approved: false, by: null}\n  G2: {approved: false, by: null}' }),
    ).state!
    expect(() => planDecision(s, { action: 'resume', resumePhase: 'spec' }, who)).toThrow(/does not exist in profile/)
  })

  it('PROFILE_GATES sets are strictly nested — every upgrade only adds gates', () => {
    expect(PROFILE_GATES.standard).toEqual(expect.arrayContaining(PROFILE_GATES.patch))
    expect(PROFILE_GATES.full).toEqual(expect.arrayContaining(PROFILE_GATES.standard))
  })
})
