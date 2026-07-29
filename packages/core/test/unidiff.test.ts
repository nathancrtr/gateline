import { describe, expect, it } from 'vitest'
import { parseUnifiedDiff } from '../src/index.ts'

const sample = `diff --git a/src/core.py b/src/core.py
index 111..222 100644
--- a/src/core.py
+++ b/src/core.py
@@ -1,3 +1,4 @@
 def process(text):
-    return text.split()
+    words = text.split()
+    return words
 # end
diff --git a/src/new.py b/src/new.py
new file mode 100644
index 000..333
--- /dev/null
+++ b/src/new.py
@@ -0,0 +1,2 @@
+x = 1
+y = 2
`

describe('parseUnifiedDiff', () => {
  it('parses files, hunks, line numbers, and counts', () => {
    const files = parseUnifiedDiff(sample)
    expect(files).toHaveLength(2)

    const [core, added] = files
    expect(core!.newPath).toBe('src/core.py')
    expect(core!.status).toBe('modified')
    expect(core!.additions).toBe(2)
    expect(core!.deletions).toBe(1)
    const lines = core!.hunks[0]!.lines
    expect(lines[0]).toMatchObject({ kind: 'context', oldNo: 1, newNo: 1 })
    expect(lines[1]).toMatchObject({ kind: 'del', oldNo: 2, newNo: null })
    expect(lines[2]).toMatchObject({ kind: 'add', oldNo: null, newNo: 2 })

    expect(added!.status).toBe('added')
    expect(added!.additions).toBe(2)
  })

  it('returns empty for empty input', () => {
    expect(parseUnifiedDiff('')).toEqual([])
  })
})
