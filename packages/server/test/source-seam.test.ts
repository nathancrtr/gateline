/**
 * The server and the view model reach a repository only through `RunSource`
 * (docs/MULTI-REPO.md §5 rule 3, #496).
 *
 * The server used to cast a source to reach its directory — for the ref
 * watcher, for engine liveness and for the runner's repository — which a
 * driver with no local clone (a later `GitHubSource`) could never satisfy.
 * Each is now a method on the source (`watchRefs`, `engineHealth`,
 * `branchTip`), optional where such a driver could not provide it. This test
 * is what keeps a cast from coming back: a structural type naming `dir`,
 * whether inline in an `as` or declared to be cast to, is a way around the
 * interface.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import type { RunSource } from '@gateline/core'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.ts'

const PACKAGES = resolve(import.meta.dirname, '../..')

/** The code that must see a repository only as a `RunSource`. */
const GUARDED = ['server/src', 'core/src/view-model']

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    return /\.tsx?$/.test(entry.name) ? [full] : []
  })
}

/** `as { dir?: string }`, `as { id: string; dir: string }`, and the like. */
const INLINE_CAST = /\bas\s*\{[^}]*\bdir\??\s*:/
/** A type or interface member `dir: string` / `dir?: string`, which exists to be cast to. */
const DIR_MEMBER = /^\s*(?:readonly\s+)?dir\??\s*:\s*string\b/m

function reachesPastTheSource(text: string): string[] {
  const found: string[] = []
  if (INLINE_CAST.test(text)) found.push('a cast to an object type with `dir`')
  if (DIR_MEMBER.test(text)) found.push('a structural type declaring `dir`')
  return found
}

describe('the RunSource seam', () => {
  it('no file in the server or the view model casts a source to reach its directory', () => {
    const violations: string[] = []
    for (const area of GUARDED) {
      for (const file of walk(join(PACKAGES, area))) {
        for (const what of reachesPastTheSource(readFileSync(file, 'utf8'))) violations.push(`${relative(PACKAGES, file)}: ${what}`)
      }
    }
    expect(violations).toEqual([])
  })

  it('recognises the shapes the casts took', () => {
    expect(reachesPastTheSource('const dir = (source as { dir?: string }).dir')).toEqual(['a cast to an object type with `dir`'])
    expect(reachesPastTheSource('const s = source as { id: string; dir: string }')).toEqual(['a cast to an object type with `dir`'])
    expect(reachesPastTheSource('interface SyncCapable {\n  id: string\n  dir?: string\n}')).toEqual(['a structural type declaring `dir`'])
    expect(reachesPastTheSource('const fixture = generateFixtureRepo()\nrepoOverrides = [fixture.dir]')).toEqual([])
  })
})

describe('a source with no local clone', () => {
  // What a driver that reads a git host's API would look like to the server:
  // no `watchRefs`, `engineHealth` or `branchTip`. The routes do without.
  const remote = { id: 'github.com/acme/billing', displayName: 'billing', listRuns: async () => [] } as unknown as RunSource

  it('reports no engine health rather than failing', async () => {
    const res = await createApp({ sources: [remote] }).request('/api/engine-health')
    expect(res.status).toBe(200)
    expect(((await res.json()) as { engines: unknown }).engines).toEqual({})
  })
})
