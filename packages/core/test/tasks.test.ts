// Work items (#269). The parser is a browser-safe leaf, so it reads a subset of
// YAML by hand rather than importing one — which makes the `yaml` package the
// natural oracle: this suite parses every `tasks/*.yaml` committed to this
// repository both ways and asserts they agree, field by field. AC1 is not
// "the parser has tests", it is "the record parses", so the corpus is the test.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import {
  buildTaskSet,
  declaredSurface,
  inSurface,
  itemsTouching,
  parseWorkItem,
  WORK_ITEM_STATUSES,
} from '../src/view-model/tasks.ts'

const REPO = resolve(import.meta.dirname, '../../..')
const RUNS = join(REPO, 'runs')

function committedTaskFiles(): { path: string; content: string }[] {
  const out: { path: string; content: string }[] = []
  for (const run of readdirSync(RUNS)) {
    const dir = join(RUNS, run, 'tasks')
    let entries: string[]
    try {
      if (!statSync(dir).isDirectory()) continue
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const name of entries.filter((n) => n.endsWith('.yaml')).sort()) {
      out.push({ path: `runs/${run}/tasks/${name}`, content: readFileSync(join(dir, name), 'utf8') })
    }
  }
  return out
}

const CORPUS = committedTaskFiles()

describe('the committed corpus', () => {
  it('is large enough to be evidence', () => {
    // Guards the guard: an empty glob would make every assertion below vacuous.
    expect(CORPUS.length).toBeGreaterThan(40)
  })

  it('AC1 — every tasks/*.yaml under runs/ parses, with nothing withheld', () => {
    const withheld = CORPUS.map((f) => parseWorkItem(f.path, f.content)).filter((i) => i.withheld !== null)
    expect(withheld.map((i) => i.withheld)).toEqual([])
  })

  it('AC1 — the declared contact surface is recovered verbatim, entry for entry', () => {
    const disagreements: string[] = []
    for (const file of CORPUS) {
      const mine = parseWorkItem(file.path, file.content).fileContactSurface
      const theirs = (parseYaml(file.content) as Record<string, unknown>).file_contact_surface
      const oracle = Array.isArray(theirs) ? theirs.map(String) : []
      if (JSON.stringify(mine) !== JSON.stringify(oracle)) {
        disagreements.push(`${file.path}\n  ours:   ${JSON.stringify(mine)}\n  yaml:   ${JSON.stringify(oracle)}`)
      }
    }
    expect(disagreements).toEqual([])
  })

  it('every surface entry is a byte-identical substring of the file that declared it', () => {
    // Verbatim in the strong sense the epic's standing rule means: the bytes on
    // screen came out of the artifact, not out of a normalizer.
    const strays: string[] = []
    for (const file of CORPUS) {
      for (const entry of parseWorkItem(file.path, file.content).fileContactSurface) {
        if (!file.content.includes(entry)) strays.push(`${file.path}: ${entry}`)
      }
    }
    expect(strays).toEqual([])
  })

  it('agrees with the yaml package on every scalar and list field', () => {
    const disagreements: string[] = []
    for (const file of CORPUS) {
      const mine = parseWorkItem(file.path, file.content)
      const doc = parseYaml(file.content) as Record<string, unknown>
      const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : [])
      const text = (v: unknown) => (v === null || v === undefined ? '' : String(v))
      // Where the oracle resolved an item into a nested mapping, it and this
      // leaf are answering different questions — see the divergence test below.
      const scalarsOnly = (ours: string[], theirs: unknown) =>
        Array.isArray(theirs)
          ? theirs.flatMap((t, k) => (typeof t === 'string' ? [[ours[k], t]] : []))
          : []
      const checks: [string, unknown, unknown][] = [
        ['id', mine.id, text(doc.id)],
        ['title', mine.title, text(doc.title)],
        ['requirements', mine.requirements, list(doc.requirements)],
        ['scope', mine.scope, text(doc.scope)],
        [
          'acceptance_tests',
          scalarsOnly(mine.acceptanceTests, doc.acceptance_tests).map(([a]) => a),
          scalarsOnly(mine.acceptanceTests, doc.acceptance_tests).map(([, b]) => b),
        ],
        ['depends_on', mine.dependsOn, list(doc.depends_on)],
        ['status', mine.statusText, text(doc.status)],
        ['notes', mine.notes, text(doc.notes)],
      ]
      for (const [field, ours, theirs] of checks) {
        if (JSON.stringify(ours) !== JSON.stringify(theirs)) {
          disagreements.push(`${file.path} ${field}\n  ours: ${JSON.stringify(ours)}\n  yaml: ${JSON.stringify(theirs)}`)
        }
      }
    }
    expect(disagreements).toEqual([])
  })

  it('recovers a status the contract names, or says the word is not one', () => {
    for (const file of CORPUS) {
      const item = parseWorkItem(file.path, file.content)
      expect(item.statusText).not.toBe('')
      expect(item.status === null || (WORK_ITEM_STATUSES as readonly string[]).includes(item.status)).toBe(true)
    }
  })

  it('parses the quoted prose entry the record actually carries', () => {
    // runs/creation-seam/tasks/01-merge-main.yaml declares a surface that is a
    // sentence, not a path. The parser recovers it; judging it is not its job.
    const merge = CORPUS.find((f) => f.path.endsWith('creation-seam/tasks/01-merge-main.yaml'))!
    const item = parseWorkItem(merge.path, merge.content)
    expect(item.fileContactSurface).toEqual(['(merge commit only — entire tree, mechanical; no hand-authored hunks)'])
  })

  it('reads flow-sequence punctuation as punctuation', () => {
    const of = (line: string) => parseWorkItem('tasks/01-x.yaml', `id: 01-x\nfile_contact_surface: []\n${line}\n`).requirements
    expect(of('requirements: []')).toEqual([])
    expect(of('requirements: [R1, R2, ]')).toEqual(['R1', 'R2'])
    expect(of('requirements: ["", R2]')).toEqual(['', 'R2'])
    expect(of('requirements: [R1] # covers the seam')).toEqual(['R1'])
  })

  it('reads a block sequence of dependencies as well as a flow one', () => {
    const block = CORPUS.find((f) => f.path.endsWith('fleetview-design/tasks/11-integration-verification.yaml'))!
    const item = parseWorkItem(block.path, block.content)
    expect(item.dependsOn).toContain('02-ledger-foundations')
    expect(item.dependsOn.length).toBeGreaterThan(1)

    const flow = CORPUS.find((f) => f.path.endsWith('creation-seam/tasks/04-pr-ensure.yaml'))!
    expect(parseWorkItem(flow.path, flow.content).dependsOn).toEqual(['01-merge-main'])
  })

  it('keeps a sequence item a general YAML reader would resolve into a mapping', () => {
    // `- AC8.1 (unit half: repeated ensure never creates a second PR)` contains
    // a `: `, so the yaml package reads a nested mapping and the sentence is
    // gone. The contract's sequences are lists of prose; keeping the line the
    // author wrote is the more verbatim reading, and the only renderable one.
    const file = CORPUS.find((f) => f.path.endsWith('creation-seam/tasks/04-pr-ensure.yaml'))!
    const ours = parseWorkItem(file.path, file.content).acceptanceTests[0]!
    expect(ours).toBe('AC8.1 (unit half: repeated ensure never creates a second PR)')
    expect(file.content).toContain(ours)

    const theirs = (parseYaml(file.content) as { acceptance_tests: unknown[] }).acceptance_tests[0]
    expect(typeof theirs).toBe('object')
  })

  it('does not mistake a `#` inside a quoted acceptance test for a comment', () => {
    const dupefind = CORPUS.find((f) => f.path.endsWith('dupefind/tasks/01-dupefind-cli.yaml'))!
    const tests = parseWorkItem(dupefind.path, dupefind.content).acceptanceTests
    const render = tests.find((t) => t.includes('render_groups'))!
    expect(render).toContain('# AC5.1 render formula')
    expect(render).toContain('assert d.render_groups')
  })
})

const WELL_FORMED = `id: 01-example
title: One-line description
requirements: [R1, R2]

scope: |
  Build the thing.

file_contact_surface:
  - src/example/thing.ts
  - test/thing.test.ts

acceptance_tests:
  - AC1.1

depends_on: []

status: pending

notes: ""
`

describe('parseWorkItem', () => {
  it('AC4 — is a pure function of the file: same input, same output, no state', () => {
    const once = parseWorkItem('tasks/01-example.yaml', WELL_FORMED)
    const twice = parseWorkItem('tasks/01-example.yaml', WELL_FORMED)
    expect(twice).toEqual(once)
    expect(once.fileContactSurface).toEqual(['src/example/thing.ts', 'test/thing.test.ts'])
    expect(once.status).toBe('pending')
    expect(once.withheld).toBeNull()
  })

  it('keeps a status the contract does not name, without inventing one', () => {
    const item = parseWorkItem('tasks/01-example.yaml', WELL_FORMED.replace('status: pending', 'status: awaiting-fold'))
    expect(item.statusText).toBe('awaiting-fold')
    expect(item.status).toBeNull()
    expect(item.withheld).toBeNull()
  })

  it('AC3 — withholds and names the key when the contact surface is absent', () => {
    const stripped = WELL_FORMED.replace(/file_contact_surface:\n(  - .*\n)+/, '')
    const item = parseWorkItem('tasks/01-example.yaml', stripped)
    expect(item.withheld).toContain('file_contact_surface')
    expect(item.withheld).toContain('tasks/01-example.yaml')
    expect(item.id).toBe('01-example') // what parsed is still there to render
  })

  it('AC3 — withholds on a file that is not a work item at all', () => {
    const item = parseWorkItem('tasks/notes.yaml', '# just a comment\n')
    expect(item.withheld).toContain('id')
    expect(item.withheld).toContain('file_contact_surface')
  })

  it('AC3 — withholds when a fork writes the surface as a nested block, not a list', () => {
    // The gap this closes: read as "declared nothing", a forked shape would let
    // a diff view state that every changed file is out of surface — a verdict
    // manufactured out of a record the parser had not read.
    const forked = WELL_FORMED.replace(
      /file_contact_surface:\n(  - .*\n)+/,
      'file_contact_surface:\n  paths:\n    - src/example/thing.ts\n  mode: exclusive\n',
    )
    const item = parseWorkItem('tasks/01-example.yaml', forked)
    expect(item.withheld).toContain('nested block')
    expect(item.withheld).toContain('file_contact_surface')
    expect(item.fileContactSurface).toEqual([])
    // The keys after the nested block are still read — the block is skipped,
    // not swallowed.
    expect(item.status).toBe('pending')
    expect(item.acceptanceTests).toEqual(['AC1.1'])
  })

  it('reads a flow sequence written on its own indented line', () => {
    // `file_contact_surface:` then an indented `[]` is a list, not a nested
    // shape — the distinction the withholding above turns on.
    const indented = WELL_FORMED.replace(/file_contact_surface:\n(  - .*\n)+/, 'file_contact_surface:\n  []\n')
    expect(parseWorkItem('tasks/01-x.yaml', indented)).toMatchObject({ withheld: null, fileContactSurface: [] })

    const wrapped = WELL_FORMED.replace(/file_contact_surface:\n(  - .*\n)+/, 'file_contact_surface:\n  [a.ts, b.ts]\n')
    expect(parseWorkItem('tasks/01-x.yaml', wrapped).fileContactSurface).toEqual(['a.ts', 'b.ts'])
  })

  it('distinguishes a declared-empty surface from an absent one', () => {
    // The `patch`-profile stub scaffold writes `file_contact_surface: []`. That
    // is a record saying "nothing declared", not a record this view cannot read.
    const stub = WELL_FORMED.replace(/file_contact_surface:\n(  - .*\n)+/, 'file_contact_surface: []\n')
    const item = parseWorkItem('tasks/01-stub.yaml', stub)
    expect(item.withheld).toBeNull()
    expect(item.fileContactSurface).toEqual([])
  })

  it('reads block scalars the way the yaml package does, chomping included', () => {
    const cases = [
      'scope: |\n  one\n  two\n\nstatus: pending\n',
      'scope: |-\n  one\n  two\n\nstatus: pending\n',
      'scope: |+\n  one\n\n\nstatus: pending\n',
      'scope: >\n  one\n  two\n\n  three\n\nstatus: pending\n',
      'scope: >-\n  folded\n  lines\n\nstatus: pending\n',
    ]
    for (const body of cases) {
      const content = `id: 01-x\nfile_contact_surface: []\n${body}`
      const mine = parseWorkItem('tasks/01-x.yaml', content).scope
      const theirs = String((parseYaml(content) as Record<string, unknown>).scope)
      expect(`${body} -> ${JSON.stringify(mine)}`).toBe(`${body} -> ${JSON.stringify(theirs)}`)
    }
  })

  it('does not let a block scalar swallow the keys that follow it', () => {
    const item = parseWorkItem('tasks/01-x.yaml', WELL_FORMED)
    expect(item.scope).toBe('Build the thing.\n')
    expect(item.notes).toBe('')
    expect(item.acceptanceTests).toEqual(['AC1.1'])
  })
})

describe('buildTaskSet', () => {
  it('AC3 — an absent task set withholds rather than reading as an empty surface', () => {
    const set = buildTaskSet([])
    expect(set.items).toEqual([])
    expect(set.withheld).toContain('no work item declares a file-contact surface')
  })

  it('AC3 — a set no item of which parses withholds with each item’s own reason', () => {
    const set = buildTaskSet([
      { path: 'tasks/01-a.yaml', content: 'tasks:\n  - some: other\n    shape: entirely\n' },
      { path: 'tasks/02-b.yaml', content: '# nothing here\n' },
    ])
    // Naming the files beats counting them: the fork fallback owes the reader
    // which grammar was looked for, and where.
    expect(set.withheld).toContain('tasks/01-a.yaml')
    expect(set.withheld).toContain('tasks/02-b.yaml')
    expect(set.items).toHaveLength(2)
  })

  it('keeps going when one item of several is unreadable', () => {
    const set = buildTaskSet([
      { path: 'tasks/01-a.yaml', content: WELL_FORMED },
      { path: 'tasks/02-b.yaml', content: '# nothing here\n' },
    ])
    expect(set.withheld).toBeNull()
    expect(set.items.map((i) => i.withheld === null)).toEqual([true, false])
  })

  it('builds from the whole committed corpus without withholding', () => {
    const set = buildTaskSet(CORPUS)
    expect(set.withheld).toBeNull()
    expect(set.items).toHaveLength(CORPUS.length)
    expect(declaredSurface(set.items).length).toBeGreaterThan(50)
  })
})

describe('the surface as a predicate', () => {
  const items = [
    parseWorkItem('tasks/01-a.yaml', WELL_FORMED),
    parseWorkItem('tasks/02-b.yaml', WELL_FORMED.replace('- src/example/thing.ts', '- docs/')),
    parseWorkItem('tasks/03-c.yaml', '# unreadable\n'),
  ]

  it('matches an entry exactly', () => {
    expect(inSurface(items[0]!, 'src/example/thing.ts')).toBe(true)
    expect(inSurface(items[0]!, 'src/example/other.ts')).toBe(false)
  })

  it('reads a trailing-slash entry as a directory prefix, and nothing else as one', () => {
    expect(inSurface(items[1]!, 'docs/DESIGN.md')).toBe(true)
    expect(inSurface(items[0]!, 'src/example/thing.ts.bak')).toBe(false)
  })

  it('infers no normalization — an older tree layout simply does not match', () => {
    const legacy = parseWorkItem('tasks/01-x.yaml', WELL_FORMED.replace('- src/example/thing.ts', '- frontend/packages/core/src/a.ts'))
    expect(inSurface(legacy, 'packages/core/src/a.ts')).toBe(false)
    expect(inSurface(legacy, 'frontend/packages/core/src/a.ts')).toBe(true)
  })

  it('names the items touching a file, and never a withheld one', () => {
    expect(itemsTouching(items, 'test/thing.test.ts').map((i) => i.path)).toEqual(['tasks/01-a.yaml', 'tasks/02-b.yaml'])
    expect(itemsTouching(items, 'anything').every((i) => i.withheld === null)).toBe(true)
  })

  it('deduplicates the declared surface and keeps first-declaration order', () => {
    expect(declaredSurface(items)).toEqual(['src/example/thing.ts', 'test/thing.test.ts', 'docs/'])
  })
})

describe('browser-safe leaf', () => {
  it('AC2 — imports nothing, so the web bundle can parse task files itself', () => {
    const src = readFileSync(fileURLToPath(new URL('../src/view-model/tasks.ts', import.meta.url)), 'utf8')
    expect(/^\s*import\b/m.test(src)).toBe(false)
  })
})
