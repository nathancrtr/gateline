// Shared fixture lifecycle: one generated repo per test file.
import { rm } from 'node:fs/promises'
import { generateFixtureRepo, type FixtureRepo } from '@gateline/fixtures'
import { LocalGitSource } from '../src/index.ts'

export interface FixtureContext {
  repo: FixtureRepo
  source: LocalGitSource
}

export async function makeFixture(): Promise<FixtureContext> {
  const repo = generateFixtureRepo()
  return { repo, source: new LocalGitSource('fixture', repo.dir) }
}

export async function dropFixture(ctx: FixtureContext): Promise<void> {
  await rm(ctx.repo.dir, { recursive: true, force: true })
}
