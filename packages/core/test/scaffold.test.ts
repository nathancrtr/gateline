// The pure half of the run-creation seam (record/scaffold.ts): planRunScaffold
// emits state.yaml/intent-brief.md (+ a patch task stub) with no I/O, and the
// staged rest state (ADR-1) rides the existing paused/arm decision path.
import { parse as parseYaml, parseDocument } from 'yaml'
import { describe, expect, it } from 'vitest'
import {
  BUILTIN_WORK_ITEM_KEYS,
  DecisionError,
  parseRunState,
  planDecision,
  planRunScaffold,
  PROFILE_GATES,
  readIntake,
  ScaffoldError,
  STAGED_REASON,
  type Profile,
  type RunScaffoldInput,
} from '../src/index.ts'

const who = { name: 'Operator', email: 'op@example.test' }

const baseInput = (profile: Profile, over: Partial<RunScaffoldInput> = {}): RunScaffoldInput => ({
  slug: 'toy-run',
  title: 'A toy run',
  profile,
  briefMarkdown: '## Problem\nsomething\n',
  costLimitUsd: 25,
  intake: { source: null, ref: null, url: null, clientKey: null },
  stagedBy: 'Operator',
  ...over,
})

describe('planRunScaffold — per-profile fixtures', () => {
  const profiles: Profile[] = ['patch', 'standard', 'full']

  for (const profile of profiles) {
    it(`${profile}: emitted state.yaml round-trips through parseRunState with zero errors`, () => {
      const scaffold = planRunScaffold(baseInput(profile))
      const { state, error } = parseRunState(scaffold.files['state.yaml']!)
      expect(error).toBeNull()
      expect(state).not.toBeNull()
      expect(state!.phase).toBe('paused')
      expect(state!.paused_reason).toBe(STAGED_REASON)
      expect(state!.profile).toBe(profile)
    })

    it(`${profile}: gates contain exactly PROFILE_GATES[${profile}] keys in the raw YAML`, () => {
      const scaffold = planRunScaffold(baseInput(profile))
      const raw = parseYaml(scaffold.files['state.yaml']!) as { gates: Record<string, unknown> }
      expect(Object.keys(raw.gates).sort()).toEqual([...PROFILE_GATES[profile]].sort())
    })
  }

  it('patch additionally emits a work-item stub carrying every contract key', () => {
    const scaffold = planRunScaffold(baseInput('patch'))
    const stub = scaffold.files['tasks/01-toy-run.yaml']
    expect(stub).toBeDefined()
    const parsed = parseYaml(stub!) as Record<string, unknown>
    for (const key of BUILTIN_WORK_ITEM_KEYS) expect(parsed).toHaveProperty(key)
    expect(parsed.id).toBe('01-toy-run')
    expect(parsed.status).toBe('pending')
  })

  it('patch stub survives a colon- or comment-marker-bearing title (YAML-quoted, not interpolated raw)', () => {
    for (const title of ['Fix: the parser bug', '#123 needs attention', '[bracketed] title', '- dash-led title', '& anchor-looking title']) {
      const scaffold = planRunScaffold(baseInput('patch', { title }))
      const stub = scaffold.files['tasks/01-toy-run.yaml']!
      const parsed = parseYaml(stub) as Record<string, unknown>
      expect(parsed.title).toBe(title)
    }
  })

  it('standard and full do not emit a task stub', () => {
    expect(planRunScaffold(baseInput('standard')).files['tasks/01-toy-run.yaml']).toBeUndefined()
    expect(planRunScaffold(baseInput('full')).files['tasks/01-toy-run.yaml']).toBeUndefined()
  })

  it('intent-brief.md is emitted verbatim from briefMarkdown', () => {
    const brief = '## Problem\nverbatim content, never invented\n'
    const scaffold = planRunScaffold(baseInput('full', { briefMarkdown: brief }))
    expect(scaffold.files['intent-brief.md']).toBe(brief)
  })

  it('commit message grammar: plain staged-by, with client-key suffix when present', () => {
    const plain = planRunScaffold(baseInput('full'))
    expect(plain.message).toBe('state(toy-run): staged by Operator')

    const keyed = planRunScaffold(baseInput('full', { intake: { source: null, ref: null, url: null, clientKey: 'abc-123' } }))
    expect(keyed.message).toBe('state(toy-run): staged by Operator [client-key: abc-123]')
    expect(keyed.clientKey).toBe('abc-123')
  })

  it('branch is run/<slug>', () => {
    expect(planRunScaffold(baseInput('full')).branch).toBe('run/toy-run')
  })

  it('costLimitUsd null omits a numeric ceiling — budget.cost_limit_usd parses as null', () => {
    const scaffold = planRunScaffold(baseInput('full', { costLimitUsd: null }))
    const { state, error } = parseRunState(scaffold.files['state.yaml']!)
    expect(error).toBeNull()
    expect(state!.budget!.cost_limit_usd).toBeNull()
  })

  it('a stagedBy name with a colon (`user.name` echo) still parses and round-trips', () => {
    const scaffold = planRunScaffold(baseInput('full', { stagedBy: 'Eve\nphase: done' }))
    const { state, error } = parseRunState(scaffold.files['state.yaml']!)
    expect(error).toBeNull()
    expect(state!.phase).toBe('paused') // the injected "phase: done" line must not land as a real key
    expect(readIntake(state!)!.staged_by).toBe('Eve\nphase: done')
  })

  it('an intake.ref beginning with `#` round-trips instead of truncating into a YAML comment', () => {
    const scaffold = planRunScaffold(baseInput('full', { intake: { source: null, ref: '#123', url: null, clientKey: null } }))
    const { state, error } = parseRunState(scaffold.files['state.yaml']!)
    expect(error).toBeNull()
    expect(readIntake(state!)!.ref).toBe('#123')
  })

})

describe('planRunScaffold — ScaffoldError cases', () => {
  it('rejects an invalid slug', () => {
    expect(() => planRunScaffold(baseInput('full', { slug: 'Not_A_Slug' }))).toThrow(ScaffoldError)
    expect(() => planRunScaffold(baseInput('full', { slug: '-leading-dash' }))).toThrow(ScaffoldError)
  })

  it('rejects an empty title', () => {
    expect(() => planRunScaffold(baseInput('full', { title: '   ' }))).toThrow(ScaffoldError)
  })

  it('rejects a non-finite costLimitUsd rather than emitting an unparseable NaN scalar', () => {
    expect(() => planRunScaffold(baseInput('full', { costLimitUsd: NaN }))).toThrow(ScaffoldError)
    expect(() => planRunScaffold(baseInput('full', { costLimitUsd: Infinity }))).toThrow(ScaffoldError)
  })

  it('rejects an empty brief', () => {
    expect(() => planRunScaffold(baseInput('full', { briefMarkdown: '   \n  ' }))).toThrow(ScaffoldError)
  })
})

describe('readIntake', () => {
  it('round-trips the intake block a scaffolded state carries', () => {
    const scaffold = planRunScaffold(
      baseInput('full', { intake: { source: null, ref: null, url: null, clientKey: 'replay-key' }, stagedBy: 'Ada Lovelace' }),
    )
    const { state, error } = parseRunState(scaffold.files['state.yaml']!)
    expect(error).toBeNull()
    expect(readIntake(state!)).toEqual({
      source: null,
      ref: null,
      url: null,
      client_key: 'replay-key',
      staged_by: 'Ada Lovelace',
    })
  })

  it('returns null when a state has no intake block', () => {
    const { state } = parseRunState(`run: bare
branch: run/bare
phase: plan
profile: patch
paused_reason: null
budget: {cost_limit_usd: 10, cost_spent_usd: 0}
gates:
  G1: {approved: false, by: null}
  G2: {approved: false, by: null}
tasks: []
escalations: []
`)
    expect(readIntake(state!)).toBeNull()
  })
})

describe('arm: planDecision from the staged rest state', () => {
  const stagedState = (profile: Profile) => {
    const scaffold = planRunScaffold(baseInput(profile))
    return parseRunState(scaffold.files['state.yaml']!).state!
  }
  // Same shape as scaffold.files['state.yaml'] for the given profile, but as
  // the yaml Document that PlannedDecision.mutate actually operates on — lets
  // these tests apply the mutation for real, the way sources/local-source.ts's
  // writeState does, and catch a no-op or wrong-target mutate.
  const stagedDoc = (profile: Profile) => parseDocument(planRunScaffold(baseInput(profile)).files['state.yaml']!)

  it('full/standard target spec; patch targets plan (deriveResumePhase over an all-undecided ledger)', () => {
    expect(planDecision(stagedState('full'), { action: 'arm' }, who).summary).toContain('phase "spec"')
    expect(planDecision(stagedState('standard'), { action: 'arm' }, who).summary).toContain('phase "spec"')
    expect(planDecision(stagedState('patch'), { action: 'arm' }, who).summary).toContain('phase "plan"')
  })

  it.each([
    ['full', 'spec'],
    ['standard', 'spec'],
    ['patch', 'plan'],
  ] as const)('applying the %s arm mutation actually sets phase to %s and clears paused_reason', (profile, target) => {
    const doc = stagedDoc(profile)
    const decision = planDecision(stagedState(profile), { action: 'arm' }, who)
    expect(decision.message).toBe('state(toy-run): armed by Operator')
    decision.mutate(doc)
    const { state, error } = parseRunState(doc.toString())
    expect(error).toBeNull()
    expect(state!.phase).toBe(target)
    expect(state!.paused_reason).toBeNull()
  })

  it('refuses to arm a run already armed (phase no longer paused)', () => {
    const state = stagedState('full')
    const armed = { ...state, phase: 'spec' as const, paused_reason: null }
    expect(() => planDecision(armed, { action: 'arm' }, who)).toThrow(DecisionError)
    expect(() => planDecision(armed, { action: 'arm' }, who)).toThrow(/not staged/)
  })

  it('refuses to arm a paused run that is not staged, naming the actual paused_reason', () => {
    const state = stagedState('full')
    const midflight = { ...state, paused_reason: 'budget-exhausted' as const }
    expect(() => planDecision(midflight, { action: 'arm' }, who)).toThrow(/not staged/)
    expect(() => planDecision(midflight, { action: 'arm' }, who)).toThrow(/budget-exhausted/)
  })
})

describe('resume/pause refusals around the staged rest state', () => {
  const stagedState = (profile: Profile) => {
    const scaffold = planRunScaffold(baseInput(profile))
    return parseRunState(scaffold.files['state.yaml']!).state!
  }

  it('resume refuses a staged run, pointing at `gateline arm`', () => {
    const state = stagedState('full')
    expect(() => planDecision(state, { action: 'resume' }, who)).toThrow(DecisionError)
    expect(() => planDecision(state, { action: 'resume' }, who)).toThrow(/gateline arm/)
  })

  it('pause refuses a `staged` pauseReason — staging is a birth state, not a pause reason', () => {
    const state = { ...stagedState('full'), phase: 'implement' as const, paused_reason: null }
    expect(() => planDecision(state, { action: 'pause', pauseReason: STAGED_REASON }, who)).toThrow(DecisionError)
    expect(() => planDecision(state, { action: 'pause', pauseReason: STAGED_REASON }, who)).toThrow(/birth state/)
  })

  it('pause refuses a `staged` pauseReason padded with whitespace — the check compares the trimmed reason', () => {
    const state = { ...stagedState('full'), phase: 'implement' as const, paused_reason: null }
    expect(() => planDecision(state, { action: 'pause', pauseReason: ' staged ' }, who)).toThrow(/birth state/)
  })
})
