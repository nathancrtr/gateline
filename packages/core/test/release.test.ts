// G3's packet (#403): the release plan read for "Ship it?". What is under
// test is the part that could quietly become a verdict — which words are
// lifted out as facts, what marks a step irreversible, and when each half must
// withhold itself instead of reporting an absent field as a clean one.
import { describe, expect, it } from 'vitest'
import { buildReleasePacket, parseReleaseSteps } from '../src/index.ts'

const PLAN = `# Release Plan: run

**Change released:** \`run/g3-pending\` at \`4c1f9a2\` (PR #14, base \`main\`)
**Environment:** the published package on the public registry; no infrastructure changes

## CI health

The pipeline is green on the merge commit. \`npm test\` and \`npm run build\` both
passed on the latest run of the release workflow.

## Release steps

1. Tag the merge commit \`v0.4.0\`.
2. Publish via the existing release workflow. This step is irreversible: a
   published version cannot be unpublished.

## Rollback plan

**Rollback trigger:** the published artifact fails its smoke run.
**Rollback exercised:** yes — re-pointed the tag on a scratch clone.

Re-point the tag at the previous release and re-publish.

## Verification after release

The published version installs and runs.

## Blast radius

Consumers who install the new version while it is broken.
`

describe('buildReleasePacket', () => {
  it('lifts the four fields out verbatim, wherever the contract places them', () => {
    const p = buildReleasePacket({ plan: PLAN })
    expect(p.hasPlan).toBe(true)
    expect(p.changeReleased).toBe('`run/g3-pending` at `4c1f9a2` (PR #14, base `main`)')
    expect(p.environment).toBe('the published package on the public registry; no infrastructure changes')
    expect(p.rollbackTrigger).toBe('the published artifact fails its smoke run.')
    expect(p.rollbackExercised).toBe('yes — re-pointed the tag on a scratch clone.')
    expect(p.fieldsWithheld).toBeNull()
  })

  it("reports the exercised answer as the record's word, and nothing when it is neither yes nor no", () => {
    expect(buildReleasePacket({ plan: PLAN }).exercisedWord).toBe('yes')
    const no = PLAN.replace('**Rollback exercised:** yes —', '**Rollback exercised:** No,')
    expect(buildReleasePacket({ plan: no }).exercisedWord).toBe('no')
    const other = PLAN.replace('**Rollback exercised:** yes —', '**Rollback exercised:** partially —')
    const p = buildReleasePacket({ plan: other })
    expect(p.exercisedWord).toBeNull()
    expect(p.rollbackExercised).toBe('partially — re-pointed the tag on a scratch clone.')
  })

  it('carries the section bodies verbatim, with the field lines lifted out of the rollback prose', () => {
    const p = buildReleasePacket({ plan: PLAN })
    expect(p.ciHealth).toBe(
      'The pipeline is green on the merge commit. `npm test` and `npm run build` both\npassed on the latest run of the release workflow.',
    )
    expect(p.rollbackPlan).toBe('Re-point the tag at the previous release and re-publish.')
    expect(p.verificationAfter).toBe('The published version installs and runs.')
    expect(p.blastRadius).toBe('Consumers who install the new version while it is broken.')
  })

  it('reads the steps in order, joining a continuation line, and marks the one the plan calls irreversible', () => {
    const p = buildReleasePacket({ plan: PLAN })
    expect(p.stepsWithheld).toBeNull()
    expect(p.steps.map((s) => s.n)).toEqual([1, 2])
    expect(p.steps[0]).toEqual({ n: 1, text: 'Tag the merge commit `v0.4.0`.', irreversible: false })
    expect(p.steps[1]!.text).toBe(
      'Publish via the existing release workflow. This step is irreversible: a published version cannot be unpublished.',
    )
    expect(p.steps[1]!.irreversible).toBe(true)
  })

  it('withholds the fields view naming every missing line, and still reads the rest', () => {
    const malformed = `# Release Plan: run

## Release steps

1. Ship it.
`
    const p = buildReleasePacket({ plan: malformed })
    expect(p.hasPlan).toBe(true)
    // The first missing field is the reason (#424); the plan says the rest.
    expect(p.fieldsWithheld).toEqual({
      grammar: 'a bold-label line',
      token: '**Change released:**',
      lookedIn: expect.objectContaining({ kind: 'release-plan', path: 'release-plan.md', contractName: 'release plan' }),
    })
    expect(p.rollbackTrigger).toBeNull()
    expect(p.ciHealth).toBeNull()
    expect(p.ciWithheld).toMatchObject({ grammar: 'a section headed', token: '## CI health', lookedIn: { path: 'release-plan.md' } })
    expect(p.steps).toEqual([{ n: 1, text: 'Ship it.', irreversible: false }])
    expect(p.stepsWithheld).toBeNull()
  })

  it('withholds the steps view when Release steps is prose, not a numbered list', () => {
    const prose = PLAN.replace(
      '1. Tag the merge commit `v0.4.0`.\n2. Publish via the existing release workflow. This step is irreversible: a\n   published version cannot be unpublished.',
      'Tag it, then publish it.',
    )
    const p = buildReleasePacket({ plan: prose })
    expect(p.steps).toEqual([])
    expect(p.stepsWithheld).toMatchObject({ grammar: 'a numbered list under', token: '## Release steps', lookedIn: { kind: 'release-plan' } })
    expect(p.fieldsWithheld).toBeNull()
  })

  it('reads a value that soft-wraps onto the next line, and lifts every line of it out of the prose', () => {
    // The fixture's plan wraps both rollback fields, as markdown prose does;
    // reading one line left "new version reports a missing entrypoint." in
    // the rollback prose as a stray sentence.
    const wrapped = PLAN.replace(
      '**Rollback trigger:** the published artifact fails its smoke run.\n**Rollback exercised:** yes — re-pointed the tag on a scratch clone.',
      '**Rollback trigger:** the published artifact fails its smoke run, or an install of the\nnew version reports a missing entrypoint.\n**Rollback exercised:** yes — re-pointed the tag on a scratch clone and re-published to\nthe local registry mirror.',
    )
    const p = buildReleasePacket({ plan: wrapped })
    expect(p.rollbackTrigger).toBe(
      'the published artifact fails its smoke run, or an install of the new version reports a missing entrypoint.',
    )
    expect(p.rollbackExercised).toBe('yes — re-pointed the tag on a scratch clone and re-published to the local registry mirror.')
    expect(p.rollbackPlan).toBe('Re-point the tag at the previous release and re-publish.')
  })

  it('keeps the first value when a field is stated twice', () => {
    const twice = PLAN.replace('## CI health', '**Environment:** somewhere else\n\n## CI health')
    expect(buildReleasePacket({ plan: twice }).environment).toBe(
      'the published package on the public registry; no infrastructure changes',
    )
  })

  it('is empty, not withheld, when there is no plan', () => {
    const p = buildReleasePacket({ plan: null })
    expect(p.hasPlan).toBe(false)
    expect(p.steps).toEqual([])
    expect(p.fieldsWithheld).toBeNull()
    expect(p.stepsWithheld).toBeNull()
    expect(p.ciWithheld).toBeNull()
  })

  it('does not read a field or a heading from inside a fence', () => {
    const fenced = PLAN.replace(
      '## Verification after release',
      '```\n**Rollback exercised:** no\n## Not a section\n```\n\n## Verification after release',
    )
    const p = buildReleasePacket({ plan: fenced })
    expect(p.exercisedWord).toBe('yes')
    expect(p.blastRadius).toBe('Consumers who install the new version while it is broken.')
  })
})

describe('parseReleaseSteps', () => {
  it('accepts a closing parenthesis as well as a period, and keeps the written numbers', () => {
    const { steps } = parseReleaseSteps('3) third\n1) first')
    expect(steps.map((s) => [s.n, s.text])).toEqual([
      [3, 'third'],
      [1, 'first'],
    ])
  })

  it('marks irreversible only on the word itself, case-insensitively', () => {
    const { steps } = parseReleaseSteps('1. Drop the column (IRREVERSIBLE).\n2. Reversible flag flip.')
    expect(steps.map((s) => s.irreversible)).toEqual([true, false])
  })
})
