// Minimal unified-diff parser: `git diff` text → structured files/hunks for
// the web diff viewer. No dependency; the format is stable.

export interface DiffLine {
  kind: 'context' | 'add' | 'del' | 'meta'
  text: string
  oldNo: number | null
  newNo: number | null
}

export interface DiffHunk {
  header: string
  lines: DiffLine[]
}

export interface DiffFile {
  oldPath: string
  newPath: string
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'binary'
  hunks: DiffHunk[]
  additions: number
  deletions: number
}

export function parseUnifiedDiff(text: string): DiffFile[] {
  const files: DiffFile[] = []
  let file: DiffFile | null = null
  let hunk: DiffHunk | null = null
  let oldNo = 0
  let newNo = 0

  const stripA = (p: string) => p.replace(/^[ab]\//, '')

  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const m = /^diff --git (?:"?a\/(.+?)"?) (?:"?b\/(.+?)"?)$/.exec(line)
      file = {
        oldPath: m ? m[1]! : '',
        newPath: m ? m[2]! : '',
        status: 'modified',
        hunks: [],
        additions: 0,
        deletions: 0,
      }
      files.push(file)
      hunk = null
      continue
    }
    if (!file) continue
    if (line.startsWith('new file mode')) file.status = 'added'
    else if (line.startsWith('deleted file mode')) file.status = 'deleted'
    else if (line.startsWith('rename from ')) {
      file.status = 'renamed'
      file.oldPath = stripA(line.slice('rename from '.length))
    } else if (line.startsWith('rename to ')) file.newPath = stripA(line.slice('rename to '.length))
    else if (line.startsWith('Binary files')) file.status = 'binary'
    else if (line.startsWith('@@')) {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
      oldNo = m ? Number(m[1]) : 0
      newNo = m ? Number(m[2]) : 0
      hunk = { header: line, lines: [] }
      file.hunks.push(hunk)
    } else if (hunk) {
      if (line.startsWith('+')) {
        hunk.lines.push({ kind: 'add', text: line.slice(1), oldNo: null, newNo: newNo++ })
        file.additions++
      } else if (line.startsWith('-')) {
        hunk.lines.push({ kind: 'del', text: line.slice(1), oldNo: oldNo++, newNo: null })
        file.deletions++
      } else if (line.startsWith(' ')) {
        hunk.lines.push({ kind: 'context', text: line.slice(1), oldNo: oldNo++, newNo: newNo++ })
      } else if (line.startsWith('\\')) {
        hunk.lines.push({ kind: 'meta', text: line, oldNo: null, newNo: null })
      }
    }
  }
  return files
}
