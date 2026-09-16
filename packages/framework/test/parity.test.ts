// TEMPORARY, and deliberately so. While both renderers exist, this is the
// proof that the TypeScript port is a port and not a rewrite: it runs
// scripts/render-agents.py and this package over identical inputs and diffs
// the bytes. It goes away in the same change that deletes the Python renderer,
// by which point the golden expectations in render.test.ts carry the contract.
//
// The checked-in agent files already prove parity on this repository's own
// inputs. What they cannot cover is `overlays/`, which this repository does not
// have, so the fixture below adds one.
import { execFile } from 'node:child_process'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { renderAll } from '../src/render.ts'

const REPO = fileURLToPath(new URL('../../../', import.meta.url))
const exec = promisify(execFile)

const OUTPUT_DIRS = ['.claude/agents', '.github/agents', '.opencode/agents']

async function havePython(): Promise<boolean> {
  try {
    await exec('python3', ['--version'])
    return true
  } catch {
    return false
  }
}

/** Every rendered file under the known output dirs, keyed by relative path. */
async function snapshot(root: string): Promise<Map<string, string>> {
  const files = new Map<string, string>()
  for (const dir of OUTPUT_DIRS) {
    let names: string[]
    try {
      names = await readdir(join(root, dir))
    } catch {
      continue
    }
    for (const name of names.sort()) files.set(`${dir}/${name}`, await readFile(join(root, dir, name), 'utf8'))
  }
  return files
}

describe('parity with scripts/render-agents.py', () => {
  it('produces byte-identical output for a tree that has overlays', async ({ skip }) => {
    if (!(await havePython())) skip()
    const dir = await mkdtemp(join(tmpdir(), 'gateline-parity-'))
    try {
      for (const tree of ['roles', 'adapters']) await cp(join(REPO, tree), join(dir, tree), { recursive: true })
      await mkdir(join(dir, 'scripts'), { recursive: true })
      await cp(join(REPO, 'scripts', 'render-agents.py'), join(dir, 'scripts', 'render-agents.py'))
      await mkdir(join(dir, 'overlays'), { recursive: true })
      await writeFile(join(dir, 'overlays', '_all.md'), 'House rule: run the linter before every commit.\n')
      await writeFile(join(dir, 'overlays', 'analyst.md'), '<!-- a comment, then real policy -->\nAnalyst rule: cite the ticket.\n')
      await writeFile(join(dir, 'overlays', 'reviewer.md'), '<!-- comment-only stub: splices nothing -->\n')

      await exec('python3', [join(dir, 'scripts', 'render-agents.py')])
      const fromPython = await snapshot(dir)
      expect(fromPython.size).toBe(24)

      for (const out of OUTPUT_DIRS) await rm(join(dir, out), { recursive: true, force: true })
      await renderAll(dir)
      const fromTypeScript = await snapshot(dir)

      expect([...fromTypeScript.keys()]).toEqual([...fromPython.keys()])
      for (const [path, expected] of fromPython) expect(fromTypeScript.get(path), path).toBe(expected)
      // Guard the fixture itself: if overlays stopped being spliced, the two
      // renderers would still agree, and this test would prove nothing.
      expect(fromPython.get('.claude/agents/analyst.md')).toContain('Analyst rule: cite the ticket.')
      // _all reaches every agent; reviewer's own stub is comment-only, so it
      // contributes nothing beyond that.
      expect(fromPython.get('.claude/agents/reviewer.md')).toContain('overlays/_all.md')
      expect(fromPython.get('.claude/agents/reviewer.md')).not.toContain('overlays/reviewer.md')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
