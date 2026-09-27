// G0's packet (#440, #442): the spec's Assumptions leading, its requirement
// roster, its Out of scope, and the brief's Problem, Constraints and Out of
// scope beside them. What is under test is what could quietly stop being the
// record: every quotation is the artifact's bytes from the line it names; no
// word of the Assumptions section falls outside a passage; the roster says so
// when a heading it cannot parse would leave it short; sections are found the
// way the validator finds them; each part withholds itself rather than
// reporting an absent section as an empty one; and nothing is computed across
// the two artifacts.
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildG0Packet, buildLexicon, type G0Packet, type Quotation, type RunRef } from '../src/index.ts'
import { dropFixture, type FixtureContext, makeFixture } from './fixture.helper.ts'

let ctx: FixtureContext
let refs: Map<string, RunRef>

beforeAll(async () => {
  ctx = await makeFixture()
  refs = new Map((await ctx.source.listRuns()).map((r) => [r.slug, r]))
})
afterAll(() => dropFixture(ctx))

async function packetFor(slug: string): Promise<{ packet: G0Packet; spec: string | null; brief: string | null }> {
  const ref = refs.get(slug)!
  const spec = await ctx.source.readArtifact(ref, 'spec.md')
  const brief = await ctx.source.readArtifact(ref, 'intent-brief.md')
  return { packet: buildG0Packet({ spec, brief, audit: { spec: ['Out of scope'] } }), spec, brief }
}

/** A quotation checked against the artifact, not against itself: its lines, from the line it names. */
function expectVerbatim(content: string, q: Quotation) {
  const n = q.text.split('\n').length
  expect(content.split('\n').slice(q.at.line - 1, q.at.line - 1 + n).join('\n')).toBe(q.text)
}

describe('buildG0Packet over the fixtures', () => {
  it('g0-pending: every part present, each quotation the artifact’s bytes at the line it names', async () => {
    const { packet, spec, brief } = await packetFor('g0-pending')
    expect(packet.spec).toMatchObject({ kind: 'spec', path: 'spec.md' })
    expect(packet.brief).toMatchObject({ kind: 'intent-brief', path: 'intent-brief.md' })
    for (const w of ['assumptionsWithheld', 'requirementsWithheld', 'outOfScopeWithheld', 'briefWithheld', 'briefOutOfScopeWithheld'] as const) {
      expect(packet[w], w).toBeNull()
    }

    // The item keeps its marker: its bytes and its list semantics stay together.
    expect(packet.assumptions).toEqual([
      {
        kind: 'item',
        text: '- **ASSUMPTION:** input fits in memory → resolved as yes because samples are <1MB.',
        at: { path: 'spec.md', line: expect.any(Number) },
      },
    ])
    expectVerbatim(spec!, packet.assumptions[0]!)

    // The roster is the heading grammar's: id and short name, as written.
    expect(packet.requirements.map((r) => [r.id, r.name])).toEqual([
      ['R1', 'Core behavior'],
      ['R2', 'Error handling'],
    ])
    for (const r of packet.requirements) expect(spec!.split('\n')[r.at.line - 1]).toBe(`### ${r.id} — ${r.name}`)

    // Out of scope carries the audience the contract's AUDIENCE line gives it.
    expect(packet.outOfScope).toMatchObject({ heading: 'Out of scope', audience: 'audit', body: { text: 'Concurrency; internationalization.' } })
    expect(spec!.split('\n')[packet.outOfScope!.at.line - 1]).toBe('## Out of scope')
    expectVerbatim(spec!, packet.outOfScope!.body!)

    expect(packet.problem?.body?.text).toBe('The CSV importer workflow is manual and error-prone today.')
    expect(packet.constraints?.body?.text).toBe('Must run offline; none otherwise known.')
    // The brief contract names no audit-time section: its Out of scope is decide-time.
    expect(packet.briefOutOfScope).toMatchObject({ audience: 'decide', body: { text: 'Changing the upstream data format.' } })
    for (const s of [packet.problem!, packet.constraints!, packet.briefOutOfScope!]) expectVerbatim(brief!, s.body!)
  })

  it('malformed-spec: the Assumptions view and the roster each withhold, naming the grammar and the spec; the rest stands', async () => {
    const { packet } = await packetFor('malformed-spec')
    expect(packet.assumptions).toEqual([])
    expect(packet.assumptionsWithheld).toMatchObject({ grammar: 'a section headed', token: '## Assumptions', lookedIn: { path: 'spec.md', kind: 'spec' } })
    expect(packet.requirements).toEqual([])
    expect(packet.requirementsWithheld).toMatchObject({ grammar: 'a requirement heading', token: '### R<n> — <short name>', lookedIn: { path: 'spec.md' } })
    expect(packet.outOfScope?.body?.text).toBe('Everything, apparently.')
    expect(packet.briefWithheld).toBeNull()
    expect(packet.problem?.body?.text).toContain('webhook relay')
  })

  it('staged: the brief half, and no spec — its absence stated as presence', async () => {
    const { packet } = await packetFor('staged')
    expect(packet.spec).toBeNull()
    expect(packet.brief).toMatchObject({ kind: 'intent-brief' })
    expect(packet.problem?.body?.text).toBe('The changelog linter workflow is manual and error-prone today.')
    expect(packet.constraints?.body?.text).toBe('Must run offline; none otherwise known.')
    expect(packet.briefWithheld).toBeNull()
    expect(packet.assumptionsWithheld).toEqual({ grammar: 'a spec', lookedIn: null })
    expect(packet.requirements).toEqual([])
  })

  it('a run with no brief withholds the brief half with nothing to open', async () => {
    const { packet } = await packetFor('bad-state')
    expect(packet.brief).toBeNull()
    expect(packet.briefWithheld).toEqual({ grammar: 'an intent brief', lookedIn: null })
    expect(packet.briefOutOfScopeWithheld).toEqual({ grammar: 'an intent brief', lookedIn: null })
    expect(packet.problem).toBeNull()
  })
})

describe('buildG0Packet — every word of the Assumptions section', () => {
  const SPEC = `# Specification: x

## Context
Prose.

## Requirements

### R1 — First thing
**Acceptance criteria:**
- [ ] AC1.1 — it works

### R12 — Twelfth thing, with a — dash
**Acceptance criteria:**
- [ ] AC12.1 — it also works

## Assumptions
<!-- Each ambiguity in the brief, with the resolution you chose.
     G0 can veto a stated choice, never a hidden one. -->
Two readings of the brief, teed up for G0:

- **ASSUMPTION:** the cap is per user → resolved as per user because
  the brief says "each account".
  - verified against the live API: no — derived from the docs.
- **ASSUMPTION:** the export format → two readings:

    CSV or JSON. Resolved as CSV; JSON is out of scope.

- **ASSUMPTION:** a tab-indented continuation

\tstays with its item.

### Verified against the live system

\`\`\`
## Assumptions
- not an item: this is inside a fence
\`\`\`

Trailing prose after the list is still the spec's word.

## Out of scope
Everything else.
`

  it('quotes the lead-in, each item with its marker, the H3, the fence and the trailing prose, in order, each from its line', () => {
    const p = buildG0Packet({ spec: SPEC, brief: null })
    expect(p.assumptions.map((a) => [a.kind, a.text])).toEqual([
      ['prose', 'Two readings of the brief, teed up for G0:'],
      [
        'item',
        '- **ASSUMPTION:** the cap is per user → resolved as per user because\n  the brief says "each account".\n  - verified against the live API: no — derived from the docs.',
      ],
      ['item', '- **ASSUMPTION:** the export format → two readings:\n\n    CSV or JSON. Resolved as CSV; JSON is out of scope.'],
      ['item', '- **ASSUMPTION:** a tab-indented continuation\n\n\tstays with its item.'],
      [
        'prose',
        '### Verified against the live system\n\n```\n## Assumptions\n- not an item: this is inside a fence\n```\n\nTrailing prose after the list is still the spec\'s word.',
      ],
    ])
    for (const a of p.assumptions) expectVerbatim(SPEC, a)
  })

  it('leaves out no word but the template’s comment', () => {
    const p = buildG0Packet({ spec: SPEC, brief: null })
    const quoted = p.assumptions.map((a) => a.text).join('\n')
    const section = SPEC.slice(SPEC.indexOf('## Assumptions\n') + 15, SPEC.indexOf('## Out of scope'))
    const words = section.split('\n').filter((l) => l.trim() !== '' && !l.includes('<!--') && !l.includes('-->'))
    for (const w of words) expect(quoted).toContain(w)
    expect(quoted).not.toContain('G0 can veto a stated choice')
  })

  it('finds a section the way the validator does — case and punctuation aside', () => {
    const p = buildG0Packet({ spec: '# S\n\n## assumptions\n- a\n\n## Out of Scope\nx\n', brief: null, audit: { spec: ['Out of scope'] } })
    expect(p.assumptionsWithheld).toBeNull()
    expect(p.assumptions.map((a) => a.text)).toEqual(['- a'])
    expect(p.outOfScope).toMatchObject({ heading: 'Out of Scope', audience: 'audit', body: { text: 'x', at: { line: 7 } } })
  })

  it('an Assumptions section with no list is quoted whole — the contract’s “none” is the record’s word', () => {
    const p = buildG0Packet({ spec: '# S\n\n## Assumptions\n\nnone\n\n## Out of scope\nx\n', brief: null })
    expect(p.assumptions).toEqual([{ kind: 'prose', text: 'none', at: { path: 'spec.md', line: 5 } }])
  })

  it('a section holding only the template’s comment is present and empty, never withheld', () => {
    const spec = '# S\n\n## Assumptions\n<!-- Each ambiguity in the brief.\n     If none, say "none". -->\n\n## Out of scope\n<!-- Explicit non-goals. -->\n'
    const p = buildG0Packet({ spec, brief: null })
    expect(p.assumptions).toEqual([])
    expect(p.assumptionsWithheld).toBeNull()
    expect(p.outOfScope).toMatchObject({ heading: 'Out of scope', body: null })
    expect(p.outOfScopeWithheld).toBeNull()
  })

  it('a section’s body starts at its first line of words, past the template’s comment', () => {
    const brief = '# B\n\n## Problem\n<!-- What hurts. -->\nIt hurts.\n\n## Constraints\nnone known\n'
    const p = buildG0Packet({ spec: null, brief })
    expect(p.problem?.body).toEqual({ text: 'It hurts.', at: { path: 'intent-brief.md', line: 5 } })
  })
})

describe('buildG0Packet — the roster and the withheld parts', () => {
  it('a heading that names a requirement but misses the grammar withholds the roster rather than leave it short', () => {
    const spec = '# S\n\n## Requirements\n\n### R1 — one\n\n### R3 - three\n\n### R2 — two\n\n## Assumptions\n- a\n\n## Out of scope\nx\n'
    const p = buildG0Packet({ spec, brief: null })
    expect(p.requirements.map((r) => r.id)).toEqual(['R1', 'R2'])
    expect(p.requirementsWithheld).toMatchObject({ grammar: 'a requirement heading', token: '### R<n> — <short name>', lookedIn: { path: 'spec.md' } })
  })

  it('a requirement-shaped heading inside a fence is an example, not a near miss', () => {
    const spec = '# S\n\n### R1 — one\n\n```\n### R9 - example\n```\n\n## Assumptions\n- a\n\n## Out of scope\nx\n'
    expect(buildG0Packet({ spec, brief: null }).requirementsWithheld).toBeNull()
  })

  it('a spec whose items all parse withholds no criteria', () => {
    const p = buildG0Packet({ spec: '# S\n\n### R1 — one\n**Acceptance criteria:**\n- [ ] AC1.1 — One.\n- [x] AC1.2 — Two.\n', brief: null })
    expect(p.criterionNearMisses).toEqual([])
    expect(p.criteriaWithheld).toBeNull()
  })

  it('a spec with no Out of scope says so, never a silent absence', () => {
    const p = buildG0Packet({ spec: '# S\n\n### R1 — one\n\n## Assumptions\n- a\n', brief: null })
    expect(p.outOfScope).toBeNull()
    expect(p.outOfScopeWithheld).toMatchObject({ grammar: 'a section headed', token: '## Out of scope', lookedIn: { path: 'spec.md' } })
  })

  it('a section is decide-time unless the contract’s audience says audit', () => {
    const spec = '# S\n\n## Out of scope\nx\n'
    expect(buildG0Packet({ spec, brief: null }).outOfScope?.audience).toBe('decide')
    expect(buildG0Packet({ spec, brief: null, audit: { spec: ['Out of scope'] } }).outOfScope?.audience).toBe('audit')
  })

  it('a brief missing Constraints withholds that half naming the section, and its Problem still renders', () => {
    const p = buildG0Packet({ spec: null, brief: '# Intent Brief: x\n\n## Problem\nIt hurts.\n\n## Motivation\nNow.\n' })
    expect(p.problem?.body).toEqual({ text: 'It hurts.', at: { path: 'intent-brief.md', line: 4 } })
    expect(p.constraints).toBeNull()
    expect(p.briefWithheld).toMatchObject({ grammar: 'a section headed', token: '## Constraints', lookedIn: { path: 'intent-brief.md' } })
    expect(p.briefOutOfScopeWithheld).toMatchObject({ token: '## Out of scope' })
  })

  it('presence only: the packet carries no field relating the brief to the spec', () => {
    const p = buildG0Packet({ spec: '# S\n', brief: '## Problem\np\n\n## Constraints\nc\n' })
    expect(Object.keys(p).sort()).toEqual(
      [
        'assumptions',
        'assumptionsWithheld',
        'brief',
        'briefOutOfScope',
        'briefOutOfScopeWithheld',
        'briefWithheld',
        'constraints',
        'outOfScope',
        'outOfScopeWithheld',
        'problem',
        'requirements',
        'requirementsWithheld',
        'criterionNearMisses',
        'criteriaWithheld',
        'spec',
      ].sort(),
    )
  })
})

describe('buildG0Packet — a criterion that nearly matches the grammar (#482)', () => {
  const CRITERIA = 'a criterion list item'
  const TOKEN = 'AC<n>.<m> — <criterion>'
  const wrap = (items: string) => `# S\n\n## Requirements\n\n### R1 — one\n**Acceptance criteria:**\n${items}\n\n## Assumptions\n- a\n`

  it('reports each near miss with its line and its words as written, and admits only the grammar’s criterion', () => {
    const spec = wrap('- [ ] AC1.1 — Plain criterion.\n- [ ] AC1.2 (MUST) — Qualified criterion.\n- [ ] AC1.3 - Hyphen instead of a dash.')
    const p = buildG0Packet({ spec, brief: null })
    expect(buildLexicon({ spec }).entries.filter((e) => e.kind === 'criterion').map((e) => e.id)).toEqual(['AC1.1'])
    expect(p.criterionNearMisses).toEqual([
      { text: '- [ ] AC1.2 (MUST) — Qualified criterion.', at: { path: 'spec.md', line: 8 } },
      { text: '- [ ] AC1.3 - Hyphen instead of a dash.', at: { path: 'spec.md', line: 9 } },
    ])
    for (const q of p.criterionNearMisses) expectVerbatim(spec, q)
    expect(p.criteriaWithheld).toMatchObject({ grammar: CRITERIA, token: TOKEN, lookedIn: { path: 'spec.md' } })
    // The requirement roster is a separate question, and it is whole.
    expect(p.requirementsWithheld).toBeNull()
  })

  it('a checked box, or no box at all, is a near miss all the same; a wrapped item is quoted through its last line', () => {
    const spec = wrap('- [x] AC1.2 (MUST) — Checked and qualified,\n  wrapped onto a second line.\n- AC1.3: no box, a colon.')
    const p = buildG0Packet({ spec, brief: null })
    expect(p.criterionNearMisses).toEqual([
      { text: '- [x] AC1.2 (MUST) — Checked and qualified,\n  wrapped onto a second line.', at: { path: 'spec.md', line: 7 } },
      { text: '- AC1.3: no box, a colon.', at: { path: 'spec.md', line: 9 } },
    ])
  })

  it('an id in running prose, or later in an item, is a citation, not a near miss', () => {
    const spec = wrap('- [ ] AC1.1 — One.\n\nAC1.2 (MUST) — a sentence that opens with an id is prose.\nThe check follows AC1.1 (see above).\n- [ ] Covers AC1.3 (MUST) as well.')
    const p = buildG0Packet({ spec, brief: null })
    expect(p.criterionNearMisses).toEqual([])
    expect(p.criteriaWithheld).toBeNull()
  })

  it('a criterion-shaped item inside a fence is an example, not a near miss', () => {
    const p = buildG0Packet({ spec: wrap('- [ ] AC1.1 — One.\n\n```markdown\n- [ ] AC1.2 (MUST) — an example of the wrong shape.\n```'), brief: null })
    expect(p.criterionNearMisses).toEqual([])
    expect(p.criteriaWithheld).toBeNull()
  })

  it('a criterion-shaped item inside an HTML comment is the template’s instruction, not a near miss', () => {
    const spec = wrap('<!-- Write each criterion as:\n- [ ] AC1.2 (MUST) — never like this.\n-->\n- [ ] AC1.1 — One.')
    const p = buildG0Packet({ spec, brief: null })
    expect(p.criterionNearMisses).toEqual([])
    expect(p.criteriaWithheld).toBeNull()
  })

  it('the spec contract’s own template: its commented example is neither a near miss nor a criterion', () => {
    const repoRoot = resolve(fileURLToPath(import.meta.url), '../../../..')
    const template = readFileSync(join(repoRoot, 'contracts/spec.md'), 'utf8')
    // The worked example the template writes inside a comment, with no list marker.
    expect(template).toMatch(/^ +AC1\.1 — /m)
    const p = buildG0Packet({ spec: template, brief: null })
    expect(p.criterionNearMisses).toEqual([])
    expect(p.criteriaWithheld).toBeNull()
    const criteria = buildLexicon({ spec: template }).entries.filter((e) => e.kind === 'criterion')
    expect(criteria.map((e) => e.id)).toEqual(['AC1.1', 'AC2.1'])
    for (const c of criteria) expect(c.definition).toMatch(/^- \[ \] AC\d+\.\d+ — /)
  })

  it('a spec written with qualified criteria throughout names every one (an excerpt of run/fleetview-intake’s spec)', () => {
    // No test reads a run branch with `git show`, so this is an excerpt of
    // `runs/fleetview-intake/spec.md` on `run/fleetview-intake`, lines 38–58,
    // verbatim. The whole spec writes all 26 of its criteria this way; this
    // excerpt holds four.
    const excerpt = `### R2 — A structured, field-level fallback exists alongside free text
Run creation is a repeatable, well-known shape (source ref, title, constraints)
even when the trigger is prose; free text must not be the *only* way in. (ux
REC3/A5; CLI parity via REC4/P5.)
**Acceptance criteria:**
- [ ] AC2.1 (MUST) — The web candidate shows a discoverable path to fill the
  same underlying fields individually, without going through free text.
- [ ] AC2.2 (MUST) — The CLI create command accepts flags equivalent to every
  field the structured web fallback exposes, for fully non-interactive use.

### R3 — First-paint fields are minimal; budget is defaulted, not blank
On first paint, no more than ~5-6 required-looking fields are visible without
scrolling or expanding a section (ux REC2/A2). This tensions with tech REC6,
which lists a budget ceiling among the "minimal optional bindings" at intake —
**resolved**: budget is not a required blank field on first paint, but appears
pre-filled with an inherited default, editable in exactly one interaction.
**Acceptance criteria:**
- [ ] AC3.1 (MUST) — Count of required-looking, un-collapsed fields on first
  paint ≤ 6.
- [ ] AC3.2 (MUST) — The budget/cost-ceiling control shows a pre-filled default
  value and requires one interaction (not typing from blank) to override.
`
    const p = buildG0Packet({ spec: excerpt, brief: null })
    expect(buildLexicon({ spec: excerpt }).entries.filter((e) => e.kind === 'criterion')).toEqual([])
    expect(p.requirements.map((r) => r.id)).toEqual(['R2', 'R3'])
    expect(p.criterionNearMisses.map((q) => q.at.line)).toEqual([6, 8, 18, 20])
    for (const q of p.criterionNearMisses) expectVerbatim(excerpt, q)
    expect(p.criterionNearMisses[3]!.text).toBe(
      '- [ ] AC3.2 (MUST) — The budget/cost-ceiling control shows a pre-filled default\n  value and requires one interaction (not typing from blank) to override.',
    )
    expect(p.criteriaWithheld).toMatchObject({ grammar: CRITERIA, token: TOKEN })
  })
})
