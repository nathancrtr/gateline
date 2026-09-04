// The one reading of fences and headings (#217): what a fence is, where a
// section begins, and that the split loses nothing — proven over every
// finished run's spec and review, since those are the artifacts it folds.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FenceTracker, extractSections, h2Headings, splitSections } from '../src/index.ts'

const rejoin = (md: string) => splitSections(md).map((s) => (s.headingLine !== null ? `${s.headingLine}\n${s.body}` : s.body)).join('\n')

describe('FenceTracker', () => {
  it('a prose line beginning with a backtick run whose info string has backticks is not a fence (runs/mdtoc/review-01.md)', () => {
    const t = new FenceTracker()
    expect(t.feed('  ```` ```` ```` line closes a ``` fence, so the next line is prose')).toBe(false)
    expect(t.feed('## Boundary check')).toBe(false)
  })

  it('a closer must match the opener\'s character and be at least as long', () => {
    const t = new FenceTracker()
    expect(t.feed('````')).toBe(true)
    expect(t.feed('```')).toBe(true) // too short: still inside
    expect(t.feed('~~~~')).toBe(true) // wrong character: still inside
    expect(t.feed('`````')).toBe(true) // closes
    expect(t.feed('## After')).toBe(false)
  })

  it('tildes may carry any info string', () => {
    const t = new FenceTracker()
    expect(t.feed('~~~ text with ` backtick')).toBe(true)
    expect(t.feed('~~~')).toBe(true)
    expect(t.feed('x')).toBe(false)
  })
})

describe('splitSections', () => {
  it('an H1 opens its own section, so an appended review round never hides under the previous H2', () => {
    const md = '## Boundary check\nclean.\n\n---\n\n# Round 2\n**Verdict:** approve\n\n## Findings\nnone\n'
    expect(splitSections(md).map((s) => [s.depth, s.heading])).toEqual([
      [2, 'Boundary check'],
      [1, 'Round 2'],
      [2, 'Findings'],
    ])
    expect(rejoin(md)).toBe(md)
  })

  it('ignores headings inside fences and drops an empty preamble', () => {
    const md = '```\n## not a heading\n```\n\n## Real\n'
    expect(splitSections(md).map((s) => s.heading)).toEqual([null, 'Real'])
    expect(splitSections('## Only\nx\n').map((s) => s.heading)).toEqual(['Only'])
  })

  it('re-joins byte-identically over every finished run\'s spec and review, and its H2s agree with extractSections', () => {
    const runs = resolve(import.meta.dirname, '../../../runs')
    const files: string[] = []
    for (const slug of readdirSync(runs)) {
      const dir = join(runs, slug)
      if (!statSync(dir).isDirectory()) continue
      for (const name of readdirSync(dir)) if (name === 'spec.md' || /^review-\d+.*\.md$/.test(name)) files.push(join(dir, name))
    }
    expect(files.length).toBeGreaterThan(20)
    for (const f of files) {
      const md = readFileSync(f, 'utf8')
      expect(rejoin(md), f).toBe(md)
      expect(h2Headings(md), f).toEqual(extractSections(md))
    }
  })

  it('runs/mdtoc/review-01.md keeps Boundary check at the top level', () => {
    const md = readFileSync(resolve(import.meta.dirname, '../../../runs/mdtoc/review-01.md'), 'utf8')
    expect(extractSections(md)).toContain('Boundary check')
  })
})
