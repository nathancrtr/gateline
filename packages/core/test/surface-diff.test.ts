// The contact-surface-scoped diff (#270). The derivation is a pure join of two
// things the record already holds — the diff and the declared surfaces — so
// these tests are about what it may and may not say: it labels, it never
// filters, and it never judges.
import { describe, expect, it } from 'vitest'
import { scopeDiff, undeclaredIndices } from '../src/view-model/surface-diff.ts'
import { buildTaskSet, type TaskSet } from '../src/view-model/tasks.ts'
import { parseUnifiedDiff } from '../src/view-model/unidiff.ts'

const item = (id: string, surface: string[], status = 'pending') => ({
  path: `tasks/${id}.yaml`,
  content: `id: ${id}
title: the ${id} slice
requirements: [R1]

scope: |
  Build it.

file_contact_surface:
${surface.map((s) => `  - ${s}`).join('\n') || '  []'}

acceptance_tests:
  - AC1.1

depends_on: []

status: ${status}

notes: ""
`,
})

const DIFF = `diff --git a/src/core.py b/src/core.py
index 1111111..2222222 100644
--- a/src/core.py
+++ b/src/core.py
@@ -1,2 +1,3 @@
 def process(text):
-    return text.split()
+    return [w for w in text.split() if w]
diff --git a/src/errors.py b/src/errors.py
new file mode 100644
--- /dev/null
+++ b/src/errors.py
@@ -0,0 +1,2 @@
+class InputError(Exception):
+    pass
diff --git a/src/config.py b/src/config.py
index 3333333..4444444 100644
--- a/src/config.py
+++ b/src/config.py
@@ -1,1 +1,2 @@
 TIMEOUT = 30
+RETRIES = 3
`

const FILES = parseUnifiedDiff(DIFF)
const TASKS = buildTaskSet([item('01-core', ['src/core.py']), item('02-errors', ['src/errors.py'])])

describe('scopeDiff', () => {
  it('AC1 — labels each changed file with the items that declared it', () => {
    const scoped = scopeDiff(FILES, TASKS)
    expect(FILES.map((f) => f.newPath)).toEqual(['src/core.py', 'src/errors.py', 'src/config.py'])
    expect(scoped.declaredBy).toEqual([['01-core'], ['02-errors'], []])
  })

  it('AC2 — a file no item declared is identifiable as exactly that', () => {
    const scoped = scopeDiff(FILES, TASKS)
    expect(undeclaredIndices(scoped).map((i) => FILES[i]!.newPath)).toEqual(['src/config.py'])
  })

  it('AC3 — labels are positional, so the diff is never filtered', () => {
    const scoped = scopeDiff(FILES, TASKS)
    // The one structural guarantee that makes scoping not truncation: there is
    // exactly one label slot per changed file, in the file list's own order.
    expect(scoped.declaredBy).toHaveLength(FILES.length)
  })

  it('AC4 — carries the declared surface it judged against, and no judgement', () => {
    const scoped = scopeDiff(FILES, TASKS)
    expect(scoped.items[0]).toEqual({
      id: '01-core',
      title: 'the 01-core slice',
      path: 'tasks/01-core.yaml',
      status: 'pending',
      statusText: 'pending',
      surface: ['src/core.py'],
    })
    // Nothing in the payload ranks, scores, or flags — the shape is the proof.
    expect(Object.keys(scoped).sort()).toEqual(['declaredBy', 'items', 'withheld'])
  })

  it('names both items when both declared the same file', () => {
    const shared = buildTaskSet([item('01-core', ['src/core.py']), item('02-also', ['src/core.py'])])
    expect(scopeDiff(FILES, shared).declaredBy[0]).toEqual(['01-core', '02-also'])
  })

  it('matches either side of a rename, since a surface may name either', () => {
    const renamed = parseUnifiedDiff(`diff --git a/src/old.py b/src/new.py
similarity index 90%
rename from src/old.py
rename to src/new.py
`)
    expect(scopeDiff(renamed, buildTaskSet([item('01-a', ['src/old.py'])])).declaredBy).toEqual([['01-a']])
    expect(scopeDiff(renamed, buildTaskSet([item('01-a', ['src/new.py'])])).declaredBy).toEqual([['01-a']])
    expect(scopeDiff(renamed, buildTaskSet([item('01-a', ['src/other.py'])])).declaredBy).toEqual([[]])
  })

  it('reads a trailing-slash surface entry as the directory it is', () => {
    const scoped = scopeDiff(FILES, buildTaskSet([item('01-all', ['src/'])]))
    expect(scoped.declaredBy).toEqual([['01-all'], ['01-all'], ['01-all']])
  })

  it('AC5 — an absent task set withholds with a reason, and the diff survives', () => {
    const scoped = scopeDiff(FILES, buildTaskSet([]))
    expect(scoped.withheld).toEqual({ grammar: 'a work item', lookedIn: null })
    expect(scoped.items).toEqual([])
    expect(scoped.declaredBy).toEqual([[], [], []])
  })

  it('AC5 — an unreadable task set withholds rather than labelling from nothing', () => {
    const scoped = scopeDiff(FILES, buildTaskSet([{ path: 'tasks/01-a.yaml', content: '# not a work item\n' }]))
    expect(scoped.withheld).toMatchObject({ grammar: 'a top-level key', token: 'id:', lookedIn: { kind: 'work-item', path: 'tasks/01-a.yaml' } })
    expect(scoped.items).toEqual([])
  })

  it('ignores an item the parser could not read without withholding the rest', () => {
    const mixed = buildTaskSet([item('01-core', ['src/core.py']), { path: 'tasks/02-b.yaml', content: '# unreadable\n' }])
    const scoped = scopeDiff(FILES, mixed)
    expect(scoped.withheld).toBeNull()
    expect(scoped.items.map((i) => i.id)).toEqual(['01-core'])
    expect(scoped.declaredBy).toEqual([['01-core'], [], []])
  })

  it('treats a declared-empty surface as declaring nothing, not as declaring all', () => {
    const scoped = scopeDiff(FILES, buildTaskSet([item('01-stub', [])]))
    expect(scoped.withheld).toBeNull()
    expect(scoped.declaredBy).toEqual([[], [], []])
    expect(scoped.items[0]!.surface).toEqual([])
  })

  it('AC6 — is a pure join, so a local-only run gets the identical view', () => {
    // Nothing here reaches a repository, an origin, or a network: the same two
    // inputs give the same output, which is why a source with no host is not a
    // degraded case (FRONTEND.md §4.1).
    expect(scopeDiff(FILES, TASKS)).toEqual(scopeDiff(FILES, TASKS))
    expect(scopeDiff([], TASKS).declaredBy).toEqual([])
  })

  it('says nothing at all about a surface entry no file touched', () => {
    // The other half of a boundary check is a legitimate view, but it is not
    // this one: declaring work not yet done is not a diff fact, and reading it
    // as one would be the verdict this module refuses to reach.
    const scoped = scopeDiff(FILES, buildTaskSet([item('01-core', ['src/core.py', 'src/never-touched.py'])]))
    expect(scoped.items[0]!.surface).toContain('src/never-touched.py')
    expect(scoped.declaredBy).toEqual([['01-core'], [], []])
  })
})

describe('the record this repository actually carries', () => {
  it('labels a real run’s work items against a diff over their own surfaces', () => {
    // runs/dupefind declares one file per task; a diff over those exact paths
    // must land every file in exactly one group and leave nothing undeclared.
    const set: TaskSet = buildTaskSet([
      item('01-dupefind-cli', ['apps/dupefind/dupefind.py']),
      item('02-unit-tests', ['apps/dupefind/test_core.py']),
      item('03-cli-tests', ['apps/dupefind/test_cli.py']),
    ])
    const files = parseUnifiedDiff(
      ['apps/dupefind/dupefind.py', 'apps/dupefind/test_core.py', 'apps/dupefind/test_cli.py', 'README.md']
        .map((p) => `diff --git a/${p} b/${p}\n@@ -1,1 +1,1 @@\n-a\n+b\n`)
        .join(''),
    )
    const scoped = scopeDiff(files, set)
    expect(scoped.declaredBy).toEqual([['01-dupefind-cli'], ['02-unit-tests'], ['03-cli-tests'], []])
    expect(undeclaredIndices(scoped).map((i) => files[i]!.newPath)).toEqual(['README.md'])
  })
})
