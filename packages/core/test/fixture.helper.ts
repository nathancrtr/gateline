// Shared fixture lifecycle: one generated repo per test file.
import { rm } from 'node:fs/promises'
import { type FixtureRepo, generateFixtureRepo } from '@gateline/fixtures'
import { LocalGitSource } from '../src/index.ts'

export interface FixtureContext {
  repo: FixtureRepo
  source: LocalGitSource
}

export async function makeFixture(): Promise<FixtureContext> {
  const repo = generateFixtureRepo()
  return { repo, source: new LocalGitSource('fixture', repo.dir) }
}

/**
 * Remove a fixture directory, retrying a transient `ENOTEMPTY` (#315).
 *
 * CI once failed `fetch-sync.test.ts` on teardown, not on its assertion:
 * `ENOTEMPTY: directory not empty, rmdir '…/.git/objects'`. The audit that
 * followed found no writer to await — the fixture generator is synchronous
 * (`execFileSync` throughout), every `Git.run` resolves only when its child
 * exits, `LocalGitSource` holds no timers, and a fresh fixture carries ~200
 * loose objects against git's auto-gc threshold of 6700, so no background
 * `gc` detaches from a commit. What remains is the filesystem: Node
 * documents that `rmdir` can report `ENOTEMPTY` transiently on a busy or
 * slow volume, and `maxRetries` is its remedy for exactly that. A persistent
 * failure still throws — nothing here swallows an error to go green.
 */
export async function dropDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}

export async function dropFixture(ctx: FixtureContext): Promise<void> {
  await dropDir(ctx.repo.dir)
}
