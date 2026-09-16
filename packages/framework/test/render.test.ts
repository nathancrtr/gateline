// The renderer against its own repository, plus the overlay path that this
// repository (which has no overlays/) cannot exercise.
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { listAdapters, loadAdapterManifest } from '../src/adapter.ts'
import { renderAgent, renderAll } from '../src/render.ts'
import { FrameworkError, parseList, parseRole } from '../src/role.ts'
import { coreRootFromLock, resolveCoreRoot } from '../src/roots.ts'

const REPO = fileURLToPath(new URL('../../../', import.meta.url))

describe('rendering this repository', () => {
  it('reproduces every checked-in agent file byte for byte', async () => {
    const { stale, written } = await renderAll(REPO, { check: true })
    expect(stale).toEqual([])
    expect(written).toEqual([])
  })

  // A renderer that found no adapters would also report nothing stale, so the
  // check above only means something alongside this one.
  it('covers all three adapters and every role each declares', async () => {
    const adapters = await listAdapters(REPO)
    expect(adapters).toEqual(['claude-code', 'copilot-cli', 'opencode'])
    let rendered = 0
    for (const adapter of adapters) {
      const manifest = await loadAdapterManifest(join(REPO, 'adapters', adapter, 'manifest.json'))
      expect(manifest.roles.length).toBeGreaterThan(0)
      rendered += manifest.roles.length
    }
    expect(rendered).toBe(24)
  })

  it('renders the three tool styles the adapters actually use', async () => {
    const claude = await loadAdapterManifest(join(REPO, 'adapters', 'claude-code', 'manifest.json'))
    const copilot = await loadAdapterManifest(join(REPO, 'adapters', 'copilot-cli', 'manifest.json'))
    const opencode = await loadAdapterManifest(join(REPO, 'adapters', 'opencode', 'manifest.json'))
    expect(await renderAgent(REPO, 'reviewer', claude)).toContain('\ntools: Read, Grep, Glob, Write, Bash\n')
    expect(await renderAgent(REPO, 'reviewer', copilot)).toContain('\ntools: [read, search, edit, execute]\n')
    const permissionMap = await renderAgent(REPO, 'reviewer', opencode)
    expect(permissionMap).toContain('\npermission:\n  "*": deny\n  read: allow\n')
    // extra_frontmatter is JSON-serialised, so a string keeps its quotes.
    expect(permissionMap).toContain('\nmode: "all"\n')
  })

  it('applies a role model override ahead of the profile map', async () => {
    const copilot = await loadAdapterManifest(join(REPO, 'adapters', 'copilot-cli', 'manifest.json'))
    expect(copilot.model_overrides?.reviewer).toBe('gpt-5.4')
    expect(await renderAgent(REPO, 'reviewer', copilot)).toContain('\nmodel: gpt-5.4\n')
    expect(await renderAgent(REPO, 'analyst', copilot)).toContain(`\nmodel: ${copilot.model_map.balanced}\n`)
  })
})

describe('role specs', () => {
  it('keeps a value containing colons intact', () => {
    const { frontmatter } = parseRole('---\ndispatch: Produces x. Use: this.\n---\nbody\n', 'r.md')
    expect(frontmatter.dispatch).toBe('Produces x. Use: this.')
  })

  it('skips blank and nested lines rather than half-parsing them', () => {
    const { frontmatter } = parseRole('---\na: 1\n\n  nested: 2\nb: 3\n---\nbody\n', 'r.md')
    expect(frontmatter).toEqual({ a: '1', b: '3' })
  })

  it('restores a body that contains its own --- delimiter', () => {
    const { body } = parseRole('---\na: 1\n---\n\ntop\n\n---\n\nbottom\n', 'r.md')
    expect(body).toBe('top\n\n---\n\nbottom\n')
  })

  it('rejects a file with no leading frontmatter block', () => {
    expect(() => parseRole('# Just a heading\n', 'r.md')).toThrow(FrameworkError)
  })

  it('parses bracketed capability lists', () => {
    expect(parseList('[read, search, shell]')).toEqual(['read', 'search', 'shell'])
    expect(parseList('[]')).toEqual([])
  })
})

describe('core-layer root resolution', () => {
  it('reads the prefixed layout out of a lock and defaults to the root layout', () => {
    expect(coreRootFromLock('{"layout":"prefixed","prefix":".gateline"}', '.gateline')).toBe('.gateline')
    expect(coreRootFromLock('{"layout":"root","prefix":".gateline"}', '.gateline')).toBe('')
    expect(coreRootFromLock(null, '.gateline')).toBe('')
    expect(coreRootFromLock('not json', '.gateline')).toBe('')
  })

  it('resolves this repository, which has no lock, at its own root', async () => {
    expect(await resolveCoreRoot(REPO)).toBe(resolve(REPO))
  })
})

describe('the overlay layer', () => {
  async function scratchRepo(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'gateline-render-'))
    await writeFile(join(dir, 'lock-placeholder'), '')
    return dir
  }

  it('splices _all and the per-role overlay, in that order, and nothing for comment-only stubs', async () => {
    const dir = await scratchRepo()
    try {
      const { cp, mkdir } = await import('node:fs/promises')
      for (const tree of ['roles', 'adapters']) await cp(join(REPO, tree), join(dir, tree), { recursive: true })
      await mkdir(join(dir, 'overlays'), { recursive: true })

      await writeFile(join(dir, 'overlays', '_all.md'), '<!-- only a comment -->\n')
      const claude = await loadAdapterManifest(join(dir, 'adapters', 'claude-code', 'manifest.json'))
      expect(await renderAgent(dir, 'analyst', claude)).not.toContain('OVERLAY')

      await writeFile(join(dir, 'overlays', '_all.md'), 'House rule: run the linter.\n')
      await writeFile(join(dir, 'overlays', 'analyst.md'), 'Analyst rule: cite the ticket.\n')
      const rendered = await renderAgent(dir, 'analyst', claude)
      expect(rendered).toContain('<!-- OVERLAY from overlays/_all.md - project policy layer -->\n\nHouse rule: run the linter.')
      expect(rendered).toContain('<!-- OVERLAY from overlays/analyst.md - project policy layer -->\n\nAnalyst rule: cite the ticket.')
      expect(rendered.indexOf('overlays/_all.md')).toBeLessThan(rendered.indexOf('overlays/analyst.md'))
      // Another role's overlay is not spliced into this one.
      expect(await renderAgent(dir, 'reviewer', claude)).not.toContain('cite the ticket')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('writes and then reports clean, and reports staleness after an edit', async () => {
    const dir = await scratchRepo()
    try {
      const { cp } = await import('node:fs/promises')
      for (const tree of ['roles', 'adapters']) await cp(join(REPO, tree), join(dir, tree), { recursive: true })
      const first = await renderAll(dir)
      expect(first.written.length).toBe(24)
      expect((await renderAll(dir, { check: true })).stale).toEqual([])

      const victim = join(dir, '.claude', 'agents', 'analyst.md')
      await writeFile(victim, `${await readFile(victim, 'utf8')}\nhand-edited\n`)
      expect((await renderAll(dir, { check: true })).stale).toEqual(['.claude/agents/analyst.md'])
      expect(await readdir(join(dir, '.opencode', 'agents'))).toHaveLength(8)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
