// A criterion's promise and check (#491): the lexicon hands every view the
// two parts apart, beside the unchanged full-text `body`. Grammar per
// contracts/spec.md READABILITY (i) and (m): the check is the continuation
// line labelled `Check:`, running to the end of the list item.
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildLexicon, type LexiconEntry, resolveId } from '../src/view-model/lexicon.ts'

const repoRoot = resolve(fileURLToPath(import.meta.url), '../../../..')
const read = (p: string) => readFileSync(join(repoRoot, p), 'utf8')

/** A spec holding the given criterion lines under one requirement. */
const specWith = (...criterion: string[]) => `### R1 — Sample\n**Acceptance criteria:**\n${criterion.join('\n')}\n`

const criterion = (spec: string, id = 'AC1.1'): LexiconEntry => {
  const entry = resolveId(buildLexicon({ spec }), id)
  expect(entry?.kind).toBe('criterion')
  return entry!
}

// The intent brief's port example.
const PORT = specWith(
  '- [ ] AC1.1 — The snapshot generator never opens a network port.',
  '  Check: its script contains neither port-binding call the server makes.',
)

describe('the port example', () => {
  const ac = criterion(PORT)

  it('AC1.1 — the promise is the first line alone', () => {
    expect(ac.promise).toBe('The snapshot generator never opens a network port.')
  })

  it('AC1.2 — the check is the second line, label kept', () => {
    expect(ac.check).toBe('Check: its script contains neither port-binding call the server makes.')
  })

  it('AC2.1 — the full text still joins both lines with one space', () => {
    expect(ac.body).toBe(
      'The snapshot generator never opens a network port. Check: its script contains neither port-binding call the server makes.',
    )
    expect(ac.body).toBe(`${ac.promise} ${ac.check}`)
  })
})

describe('where a check starts and ends', () => {
  it('AC1.3 — a promise that wraps keeps its second line', () => {
    const ac = criterion(
      specWith(
        '- [ ] AC1.1 — The snapshot generator never opens',
        '  a network port on any interface.',
        '  Check: its script contains no listen call.',
      ),
    )
    expect(ac.promise).toBe('The snapshot generator never opens a network port on any interface.')
    expect(ac.check).toBe('Check: its script contains no listen call.')
  })

  it("AC1.4 — a check that wraps keeps every line (the spec contract's own example)", () => {
    // The example sits in an HTML comment, indented and without a list
    // marker; lift its three lines into a list item as the contract shapes it.
    const lines = read('contracts/spec.md').split('\n')
    const start = lines.findIndex((l) => l.trim().startsWith('AC1.1 — The snapshot generator'))
    expect(start).toBeGreaterThan(-1)
    const [first, ...rest] = lines.slice(start, start + 3).map((l) => l.trim())
    expect(rest[0]).toMatch(/^Check:/)
    const ac = criterion(specWith(`- [ ] ${first}`, ...rest.map((l) => `  ${l}`)))
    expect(ac.promise).toBe('The snapshot generator never opens a network port.')
    expect(ac.check).toMatch(/^Check: /)
    expect(ac.check!.endsWith(rest[1]!)).toBe(true)
    expect(ac.check).toBe(`${rest[0]} ${rest[1]}`)
  })

  it('AC1.5 — `Check:` inside the first line does not start a check', () => {
    const ac = criterion(specWith('- [ ] AC1.1 — The page shows Check: before the result.'))
    expect(ac.promise).toBe('The page shows Check: before the result.')
    expect('check' in ac).toBe(false)
  })

  it('AC1.6 — a second line starting lower-case `check:` stays in the promise', () => {
    const ac = criterion(specWith('- [ ] AC1.1 — The report names each', '  check: it ran, in order.'))
    expect(ac.promise).toBe('The report names each check: it ran, in order.')
    expect(ac.promise!.endsWith('check: it ran, in order.')).toBe(true)
    expect('check' in ac).toBe(false)
  })

  it('a criterion without a check has a promise equal to its body and no check key', () => {
    const ac = criterion(specWith('- [ ] AC1.1 — running the tool', '  produces the documented output'))
    expect(ac.promise).toBe(ac.body)
    expect(Object.hasOwn(ac, 'check')).toBe(false)
  })

  it('requirement and decision entries carry neither key', () => {
    const lex = buildLexicon({
      spec: PORT,
      plan: '## Decisions (ADRs)\n\n### ADR-1: Pure core\n- **Choice:** keep logic pure.\n',
    })
    for (const id of ['R1', 'ADR-1']) {
      const e = resolveId(lex, id)!
      expect(e.kind).not.toBe('criterion')
      expect(Object.hasOwn(e, 'promise')).toBe(false)
      expect(Object.hasOwn(e, 'check')).toBe(false)
    }
  })
})

// Every run finished before this one: none has a check line, so each must
// read exactly as it did before the split existed.
const EARLIER_RUNS = [
  'creation-seam',
  'dupefind',
  'escalation-visibility-2',
  'fleetview-design',
  'local-only-mode',
  'mdtoc',
  'runner-agent',
  'web-staging',
  'wordfreq',
  'writestate-kill-window',
]

describe("the earlier runs' specs", () => {
  const criteriaOf = (slug: string) =>
    buildLexicon({ spec: read(`runs/${slug}/spec.md`) }).entries.filter((e) => e.kind === 'criterion')

  it.each(EARLIER_RUNS)('AC2.2 — %s: each promise equals its full text', (slug) => {
    const criteria = criteriaOf(slug)
    expect(criteria.length).toBeGreaterThan(0)
    for (const ac of criteria) expect(ac.promise, `${slug} ${ac.id}`).toBe(ac.body)
  })

  it.each(EARLIER_RUNS)('AC2.3 — %s: no criterion has a check', (slug) => {
    const criteria = criteriaOf(slug)
    expect(criteria.length).toBeGreaterThan(0)
    for (const ac of criteria) expect(Object.hasOwn(ac, 'check'), `${slug} ${ac.id}`).toBe(false)
  })
})
