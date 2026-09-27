// #493: the standalone binary took `--repo` (default: cwd) and built its
// `Git`/`LocalGitSource` from the raw path. loadSources already normalizes
// `--repo` and config entries to the repository's work-tree toplevel (#83);
// the engine's own `--repo` did not, so naming a subdirectory would dispatch
// against an engine that lists no artifacts and misses default-branch runs,
// silently.
//
// `tick --dry-run` is the sanctioned no-dispatch, no-write way to exercise
// the binary end to end (AGENTS.md, ORCHESTRATOR.md): it derives and prints
// each run's next action without touching the repository or launching
// anything. This suite never runs `tick` (live), `watch`, or `sweep`.
import { execFile } from 'node:child_process'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { type FixtureRepo, generateFixtureRepo } from '@gateline/fixtures'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const exec = promisify(execFile)
const mainPath = resolve(dirname(fileURLToPath(import.meta.url)), '../src/main.ts')

let fixture: FixtureRepo
let toplevel: string
let nonGitDir: string

async function dryRun(repoDir: string): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await exec('node', [mainPath, '--repo', repoDir, 'tick', '--dry-run'])
    return { code: 0, stdout, stderr }
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string }
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' }
  }
}

beforeAll(async () => {
  fixture = generateFixtureRepo()
  toplevel = await realpath(fixture.dir)
  nonGitDir = await mkdtemp(join(tmpdir(), 'gateline-493-orch-nogit-'))
})

afterAll(async () => {
  await rm(fixture.dir, { recursive: true, force: true })
  await rm(nonGitDir, { recursive: true, force: true })
})

describe('engine --repo resolution (#493)', () => {
  it('a --repo naming a subdirectory derives the same actions as the repository root', async () => {
    const fromRoot = await dryRun(toplevel)
    const fromSub = await dryRun(join(fixture.dir, 'runs'))
    expect(fromRoot.code).toBe(0)
    expect(fromSub.code).toBe(0)
    expect(fromRoot.stdout).not.toBe('') // parity must not hold vacuously
    expect(fromSub.stdout).toBe(fromRoot.stdout)
  })

  it('a --repo outside any git repository fails with a clear message instead of proceeding', async () => {
    const result = await dryRun(nonGitDir)
    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain(`${nonGitDir} is not a git repository`)
  })
})
