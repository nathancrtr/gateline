// Arranging the surface-scoped diff (#270). Core decides which item declared
// which file; this decides what the approver reads first and what each group is
// called. The rules under test are the ones that could quietly become verdicts:
// undeclared files lead, nothing is dropped, and a withheld scoping arranges
// nothing rather than arranging from nothing.
import { describe, expect, it } from 'vitest'
import type { DiffFile, SurfaceScopedDiff } from '../src/api.ts'
import { arrangeDiff, boundaryLine, fileLabel, totals } from '../src/surface.ts'

const file = (path: string, over: Partial<DiffFile> = {}): DiffFile => ({
  oldPath: path,
  newPath: path,
  status: 'modified',
  hunks: [],
  additions: 3,
  deletions: 1,
  ...over,
})

const item = (id: string, surface: string[]) => ({
  id,
  title: `the ${id} slice`,
  path: `tasks/${id}.yaml`,
  status: 'pending' as const,
  statusText: 'pending',
  surface,
})

const FILES = [file('src/core.py'), file('src/errors.py'), file('src/config.py')]

const SURFACE: SurfaceScopedDiff = {
  items: [item('01-core', ['src/core.py']), item('02-errors', ['src/errors.py'])],
  declaredBy: [['01-core'], ['02-errors'], []],
  withheld: null,
}

describe('arrangeDiff', () => {
  it('AC1 — groups files under the item that declared them, in task-set order', () => {
    const { groups } = arrangeDiff(FILES, SURFACE)
    expect(groups.map((g) => g.item.id)).toEqual(['01-core', '02-errors'])
    expect(groups[0]!.files.map((f) => f.newPath)).toEqual(['src/core.py'])
    expect(groups[1]!.files.map((f) => f.newPath)).toEqual(['src/errors.py'])
  })

  it('AC2 — separates the files no item declared', () => {
    expect(arrangeDiff(FILES, SURFACE).undeclared.map((f) => f.newPath)).toEqual(['src/config.py'])
  })

  it('AC3 — every file is somewhere: scoping never drops one', () => {
    const { groups, undeclared } = arrangeDiff(FILES, SURFACE)
    const shown = new Set([...undeclared, ...groups.flatMap((g) => g.files)].map((f) => f.newPath))
    expect([...shown].sort()).toEqual(FILES.map((f) => f.newPath).sort())
  })

  it('shows a doubly-declared file under both items rather than picking an owner', () => {
    const both: SurfaceScopedDiff = {
      items: [item('01-core', ['src/core.py']), item('02-also', ['src/core.py'])],
      declaredBy: [['01-core', '02-also'], [], []],
      withheld: null,
    }
    const { groups, undeclared } = arrangeDiff(FILES, both)
    expect(groups.map((g) => g.files.map((f) => f.newPath))).toEqual([['src/core.py'], ['src/core.py']])
    // The groups and the undeclared list therefore need not partition the diff.
    expect(undeclared.map((f) => f.newPath)).toEqual(['src/errors.py', 'src/config.py'])
  })

  it('drops an item no changed file falls under, rather than showing an empty group', () => {
    const idle: SurfaceScopedDiff = { ...SURFACE, items: [...SURFACE.items, item('03-idle', ['src/idle.py'])] }
    expect(arrangeDiff(FILES, idle).groups.map((g) => g.item.id)).toEqual(['01-core', '02-errors'])
  })

  it('AC5 — a withheld scoping arranges nothing, so the caller renders the plain diff', () => {
    const withheld: SurfaceScopedDiff = { items: [], declaredBy: [], withheld: { grammar: 'a work item', lookedIn: null } }
    expect(arrangeDiff(FILES, withheld)).toEqual({ undeclared: [], groups: [], scoped: false })
    expect(arrangeDiff(FILES, undefined)).toEqual({ undeclared: [], groups: [], scoped: false })
  })

  it('treats a short label list as unlabelled rather than throwing', () => {
    // Defensive: a payload whose labels do not line up with its files must not
    // take the page down, and must not invent a group either.
    const ragged: SurfaceScopedDiff = { items: SURFACE.items, declaredBy: [['01-core']], withheld: null }
    const { groups, undeclared } = arrangeDiff(FILES, ragged)
    expect(groups.map((g) => g.item.id)).toEqual(['01-core'])
    expect(undeclared.map((f) => f.newPath)).toEqual(['src/errors.py', 'src/config.py'])
  })
})

describe('totals and labels', () => {
  it('sums what is on the table', () => {
    expect(totals(FILES)).toEqual({ files: 3, additions: 9, deletions: 3 })
    expect(totals([])).toEqual({ files: 0, additions: 0, deletions: 0 })
  })

  it('names a rename by both of its paths', () => {
    expect(fileLabel(file('x', { oldPath: 'src/old.py', newPath: 'src/new.py', status: 'renamed' }))).toBe('src/old.py → src/new.py')
    expect(fileLabel(file('src/core.py'))).toBe('src/core.py')
    expect(fileLabel(file('x', { newPath: '', oldPath: 'src/gone.py', status: 'deleted' }))).toBe('src/gone.py')
  })
})

describe('boundaryLine', () => {
  it('reports the count and the undeclared files, and judges neither', () => {
    expect(boundaryLine(FILES, SURFACE)).toEqual({ changed: 3, undeclared: [FILES[2]] })
  })

  it('is clean when every changed file was declared', () => {
    const clean: SurfaceScopedDiff = { ...SURFACE, declaredBy: [['01-core'], ['02-errors'], ['01-core']] }
    expect(boundaryLine(FILES, clean)).toEqual({ changed: 3, undeclared: [] })
  })

  it('says nothing when the scoping withheld, rather than implying a clean check', () => {
    expect(boundaryLine(FILES, { items: [], declaredBy: [], withheld: { grammar: 'a work item', lookedIn: null } })).toBeNull()
    expect(boundaryLine(FILES, undefined)).toBeNull()
  })
})
