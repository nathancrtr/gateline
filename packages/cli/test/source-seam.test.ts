/**
 * The CLI reaches a repository's clone only through `RunSource`
 * (docs/MULTI-REPO.md §5 rule 3, #502).
 *
 * `arm` and `sync` used to cast a source to `{ dir?: string }` to find where
 * to run `gh`, which a driver with no local clone (a later `GitHubSource`)
 * could never satisfy. They now ask the source for `workingDirectory()`, an
 * optional method, and say so when it is absent. This test keeps the cast
 * from coming back, as `server/test/source-seam.test.ts` does for the server
 * and the view model: a structural type naming `dir`, inline in an `as` or
 * declared to be cast to, is a way around the interface.
 *
 * `LocalGitSource.dir` is public, so two more shapes are refused: a cast to
 * the concrete driver (`as LocalGitSource`), and reading `.dir` off anything
 * named `source` or `...Source` (`source.dir`, `repoSource?.dir`,
 * `(source as never).dir`). What this does not catch: the directory read
 * through a variable with another name, destructured (`const { dir } =
 * source`), or through `as any` into a differently named binding. It is a
 * guard against the easy way back, not a proof.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = resolve(import.meta.dirname, '../src')

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
/** A cast to the concrete driver, whose `dir` is public. */
const DRIVER_CAST = /\bas\s+LocalGitSource\b/
/** `.dir` read off anything named `source` or `...Source`, directly or through a cast in parentheses. */
const SOURCE_DIR = /\b\w*[sS]ource(?:\s+as\s+[^)]*\))?\??\.dir\b/

function reachesPastTheSource(text: string): string[] {
  const found: string[] = []
  if (INLINE_CAST.test(text)) found.push('a cast to an object type with `dir`')
  if (DIR_MEMBER.test(text)) found.push('a structural type declaring `dir`')
  if (DRIVER_CAST.test(text)) found.push('a cast to LocalGitSource')
  if (SOURCE_DIR.test(text)) found.push('`.dir` read off a source')
  return found
}

describe('the RunSource seam, in the CLI', () => {
  it('no file in the CLI casts a source to reach its directory', () => {
    const violations: string[] = []
    for (const file of walk(SRC)) {
      for (const what of reachesPastTheSource(readFileSync(file, 'utf8'))) violations.push(`${relative(SRC, file)}: ${what}`)
    }
    expect(violations).toEqual([])
  })

  it('recognises the shapes the casts took', () => {
    expect(reachesPastTheSource('const dir = (source as { dir?: string }).dir')).toEqual(['a cast to an object type with `dir`', '`.dir` read off a source'])
    expect(reachesPastTheSource('const s = source as { id: string; dir: string }')).toEqual(['a cast to an object type with `dir`'])
    expect(reachesPastTheSource('interface WithClone {\n  id: string\n  dir?: string\n}')).toEqual(['a structural type declaring `dir`'])
    // A result type that carries a resolved directory is not a cast of a source.
    expect(reachesPastTheSource('Promise<{ ok: true; dir: string } | { ok: false; error: string }>')).toEqual([])
    expect(reachesPastTheSource('const dir = source.workingDirectory?.()')).toEqual([])
    expect(reachesPastTheSource('const dir = (source as LocalGitSource).dir')).toEqual(['a cast to LocalGitSource', '`.dir` read off a source'])
    expect(reachesPastTheSource('const dir = (source as never).dir')).toEqual(['`.dir` read off a source'])
    expect(reachesPastTheSource('const dir = repoSource?.dir')).toEqual(['`.dir` read off a source'])
    expect(reachesPastTheSource('const dir = source.dir')).toEqual(['`.dir` read off a source'])
    expect(reachesPastTheSource('const dir = resolved.dir')).toEqual([])
  })
})
