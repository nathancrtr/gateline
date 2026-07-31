// G1's packet (#255): the mapping-table parse, and the two checks composed
// over it. What is under test is the part that could quietly become a verdict —
// what counts as covered, what counts as an overlap, and when each half must
// withhold itself instead of reporting an empty record as a clean one.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildG1Packet, buildLexicon, entriesOverlap, parseRequirementMapping, surfaceOverlaps, parseWorkItem } from '../src/index.ts'

const SPEC = `# Specification: limiter

## Requirements

### R1 — Core behavior
The tool emits the documented output.
**Acceptance criteria:**
- [ ] AC1.1 — it works

### R2 — Error handling
**Acceptance criteria:**
- [ ] AC2.1 — malformed input exits non-zero

### R3 — Rate accounting
**Acceptance criteria:**
- [ ] AC3.1 — refusals are counted
`

const PLAN = `# Technical Plan: limiter

## Approach
One module.

## Decisions (ADRs)

### ADR-1: Pure core
- **Choice:** keep logic pure.

## Requirement → task mapping
| Requirement | Task(s) |
|-------------|---------|
| R1 | 01-core, 03-cli |
| R2 | \`02-errors\` |

## Risks
None.
`

const task = (id: string, requirements: string, surface: string[], dependsOn: string[] = []) => ({
  path: `tasks/${id}.yaml`,
  content: `id: ${id}
title: ${id}
requirements: [${requirements}]
scope: |
  x
file_contact_surface:
${surface.map((s) => `  - ${s}`).join('\n')}
acceptance_tests:
  - AC1.1
depends_on: [${dependsOn.join(', ')}]
status: pending
notes: |
`,
})

const TASKS = [
  task('01-core', 'R1', ['src/core.py', 'src/shared.py']),
  task('02-errors', 'R2', ['src/errors.py', 'src/shared.py']),
  task('03-cli', 'R1', ['src/cli.py', 'src/core.py'], ['01-core']),
]

const packet = (over: Partial<Parameters<typeof buildG1Packet>[0]> = {}) =>
  buildG1Packet({ lexicon: buildLexicon({ spec: SPEC }), plan: PLAN, tasks: TASKS, ...over })

const row = (id: string) => packet().coverage.find((r) => r.id === id)!

describe('the mapping table', () => {
  it('reads one row per requirement, verbatim', () => {
    const mapping = parseRequirementMapping(PLAN)
    expect(mapping.withheld).toBeNull()
    expect(mapping.rows.map((r) => r.requirements)).toEqual([['R1'], ['R2']])
    expect(mapping.rows[0]!.tasks).toEqual(['01-core', '03-cli'])
    expect(mapping.rows[0]!.text).toBe('| R1 | 01-core, 03-cli |')
  })

  it('strips the code spans an author wrapped a task id in', () => {
    expect(parseRequirementMapping(PLAN).rows[1]!.tasks).toEqual(['02-errors'])
  })

  it('stops at the next section, so a later table is not read as mapping', () => {
    const withTrailer = PLAN.replace('## Risks\nNone.\n', '## Risks\n| Risk | Signal |\n|---|---|\n| R9 drift | AC1.1 fails |\n')
    expect(parseRequirementMapping(withTrailer).rows.map((r) => r.requirements)).toEqual([['R1'], ['R2']])
  })

  it('ignores a table inside a fenced block', () => {
    const fenced = PLAN.replace('| R1 | 01-core, 03-cli |', '```\n| R1 | 01-core |\n```\n| R1 | 01-core, 03-cli |')
    expect(parseRequirementMapping(fenced).rows).toHaveLength(2)
  })

  it('withholds, naming the grammar, when the plan has no mapping section', () => {
    const forked = '# Technical Plan: x\n\n## Approach\nx\n\n## Coverage\n| Req | Task |\n|---|---|\n| R1 | 01 |\n'
    const mapping = parseRequirementMapping(forked)
    expect(mapping.rows).toEqual([])
    expect(mapping.withheld).toContain('Requirement → task mapping')
  })

  it('withholds when the section exists but names no requirement', () => {
    const empty = '# Plan\n\n## Requirement → task mapping\n| Requirement | Task(s) |\n|---|---|\n\n## Risks\nx\n'
    expect(parseRequirementMapping(empty).withheld).toContain('no table row')
  })

  it('withholds when there is no plan at all', () => {
    expect(parseRequirementMapping(null).withheld).toContain('no `plan.md`')
  })

  it('reads the heading through a fork’s punctuation', () => {
    const forked = PLAN.replace('## Requirement → task mapping', '## Requirements to task mapping')
    expect(parseRequirementMapping(forked).rows).toHaveLength(2)
  })
})

describe('coverage joins the spec, the table, and the work items', () => {
  it('lists every requirement the spec defines, in the spec’s order', () => {
    expect(packet().coverage.map((r) => r.id)).toEqual(['R1', 'R2', 'R3'])
  })

  it('a requirement no row names is covered by no task — stated, not scored', () => {
    expect(row('R3')).toMatchObject({ defined: true, mapped: [], row: null })
  })

  it('carries the tasks a row names, verbatim, and the row itself', () => {
    expect(row('R1')).toMatchObject({ mapped: ['01-core', '03-cli'], row: '| R1 | 01-core, 03-cli |' })
  })

  it('flags a mapped task id that no work item declares', () => {
    const missing = buildG1Packet({ lexicon: buildLexicon({ spec: SPEC }), plan: PLAN, tasks: [TASKS[0]!] })
    expect(missing.coverage.find((r) => r.id === 'R1')!.unknownTasks).toEqual(['03-cli'])
  })

  it('keeps a requirement the mapping names but the spec never defined', () => {
    const invented = PLAN.replace('| R2 | `02-errors` |', '| R2 | `02-errors` |\n| R9 | 04-extra |')
    const p = buildG1Packet({ lexicon: buildLexicon({ spec: SPEC }), plan: invented, tasks: TASKS })
    expect(p.coverage.find((r) => r.id === 'R9')).toMatchObject({ defined: false, mapped: ['04-extra'] })
  })

  it('records what each work item claims, independently of the table', () => {
    expect(row('R1').claimedBy).toEqual(['01-core', '03-cli'])
  })

  it('names work items no mapping row mentions', () => {
    const p = buildG1Packet({ lexicon: buildLexicon({ spec: SPEC }), plan: PLAN.replace(', 03-cli', ''), tasks: TASKS })
    expect(p.unmappedTasks).toEqual(['03-cli'])
  })

  it('withholds coverage rather than reporting an empty mapping as full coverage', () => {
    const p = buildG1Packet({ lexicon: buildLexicon({ spec: SPEC }), plan: null, tasks: TASKS })
    expect(p.mappingWithheld).toContain('no `plan.md`')
    expect(p.coverage.every((r) => r.mapped.length === 0)).toBe(true)
  })
})

describe('parallel safety', () => {
  it('flags two independent tasks declaring the same path', () => {
    const overlap = packet().overlaps.find((o) => o.a === '01-core' && o.b === '02-errors')!
    expect(overlap.ordered).toBe(false)
    expect(overlap.entries).toEqual([{ a: 'src/shared.py', b: 'src/shared.py' }])
  })

  it('a depends_on between them clears the flag, and the overlap still shows', () => {
    const overlap = packet().overlaps.find((o) => o.a === '01-core' && o.b === '03-cli')!
    expect(overlap.ordered).toBe(true)
    expect(overlap.entries).toEqual([{ a: 'src/core.py', b: 'src/core.py' }])
  })

  it('orders unordered overlaps first — they are the ones nothing resolves', () => {
    expect(packet().overlaps[0]!.ordered).toBe(false)
  })

  it('follows depends_on transitively', () => {
    const chain = [
      task('01-a', 'R1', ['src/x.py']),
      task('02-b', 'R1', ['src/b.py'], ['01-a']),
      task('03-c', 'R1', ['src/x.py'], ['02-b']),
    ]
    const pair = surfaceOverlaps(chain.map((t) => parseWorkItem(t.path, t.content))).find((o) => o.a === '01-a' && o.b === '03-c')!
    expect(pair.ordered).toBe(true)
  })

  it('reports no overlap between tasks that share nothing', () => {
    const apart = [task('01-a', 'R1', ['src/a.py']), task('02-b', 'R2', ['src/b.py'])]
    expect(surfaceOverlaps(apart.map((t) => parseWorkItem(t.path, t.content)))).toEqual([])
  })

  it('a directory entry meets a file under it, and nothing else is inferred', () => {
    expect(entriesOverlap('src/', 'src/core.py')).toBe(true)
    expect(entriesOverlap('src/core.py', 'src/')).toBe(true)
    expect(entriesOverlap('src/core.py', 'src/core.py')).toBe(true)
    // No globbing, no normalization: a fact about the record, not a guess.
    expect(entriesOverlap('src/*.py', 'src/core.py')).toBe(false)
    expect(entriesOverlap('./src/core.py', 'src/core.py')).toBe(false)
  })

  it('an unreadable work item speaks for nothing, and says so', () => {
    const forked = { path: 'tasks/04-forked.yaml', content: 'id: 04-forked\ntitle: t\nstatus: pending\n' }
    const p = buildG1Packet({ lexicon: buildLexicon({ spec: SPEC }), plan: PLAN, tasks: [...TASKS, forked] })
    expect(p.tasks.find((t) => t.path === forked.path)!.withheld).toContain('work-item.yaml')
    expect(p.overlaps.some((o) => o.a === '04-forked' || o.b === '04-forked')).toBe(false)
  })

  it('withholds the whole view when no work item is readable', () => {
    const p = buildG1Packet({ lexicon: buildLexicon({ spec: SPEC }), plan: PLAN, tasks: [] })
    expect(p.tasksWithheld).toContain('no `tasks/*.yaml`')
    expect(p.overlaps).toEqual([])
  })
})

describe('browser-safe leaf', () => {
  it('plan.ts imports nothing, so a client can parse the mapping itself', () => {
    const src = readFileSync(fileURLToPath(new URL('../src/view-model/plan.ts', import.meta.url)), 'utf8')
    expect(/^\s*import\b/m.test(src)).toBe(false)
  })
})

describe('this repository’s own plans parse', () => {
  it('reads the mapping table out of a real run’s plan.md', () => {
    // A guard the synthetic cases cannot give: the grammar this reads is the
    // one architects have actually been writing.
    const real = readFileSync(join(import.meta.dirname, '../../../runs/wordfreq/plan.md'), 'utf8')
    const mapping = parseRequirementMapping(real)
    expect(mapping.withheld).toBeNull()
    expect(mapping.rows.length).toBeGreaterThan(0)
    expect(mapping.rows.every((r) => r.tasks.length > 0)).toBe(true)
  })
})
