// #493: `up` computed `repoDir` from `--repo` (or the cwd) and handed it to
// the engine unresolved. loadSources already normalizes `--repo` and config
// entries to the repository's work-tree toplevel (#83); the engine side of
// `up` did not, so a `--repo` naming a subdirectory would dispatch against an
// engine that lists no artifacts and misses default-branch runs, silently.
//
// This never runs `up` itself — that starts a real server and engine, which
// dispatches metered agents (forbidden in this suite). `resolveUpRepoDir` is
// the pure resolution step `up` calls before doing anything else, so it is
// tested directly.
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type FixtureRepo, generateFixtureRepo } from '@gateline/fixtures'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolveUpRepoDir } from '../src/main.ts'

let fixture: FixtureRepo
let toplevel: string
let nonGitDir: string

beforeAll(async () => {
  fixture = generateFixtureRepo()
  toplevel = await realpath(fixture.dir)
  nonGitDir = await mkdtemp(join(tmpdir(), 'gateline-493-nogit-'))
})

afterAll(async () => {
  await rm(fixture.root, { recursive: true, force: true })
  await rm(nonGitDir, { recursive: true, force: true })
})

describe('resolveUpRepoDir (#493)', () => {
  it('a repository root resolves to itself', async () => {
    const result = await resolveUpRepoDir(fixture.dir)
    expect(result).toEqual({ ok: true, dir: toplevel })
  })

  it('a subdirectory of a repository resolves to the repository toplevel', async () => {
    const result = await resolveUpRepoDir(join(fixture.dir, 'runs'))
    expect(result).toEqual({ ok: true, dir: toplevel })
  })

  it('a directory outside any git repository fails with a clear message instead of proceeding', async () => {
    const result = await resolveUpRepoDir(nonGitDir)
    expect(result.ok).toBe(false)
    expect(result).toEqual({ ok: false, error: `${nonGitDir} is not a git repository — \`up\` needs one writable clone (pass --repo)` })
  })
})
