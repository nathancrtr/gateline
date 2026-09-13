// Local-only wiring through the server/orchestrator seam (spec R2, R4):
// the engine's heartbeat sync and first-dispatch draft-PR ensure both honor
// a resolved `localOnly` flag (AC2.2, AC2.4 engine half), and the standalone
// binary's `assembleOrchestrator` rejects the same push+local-only conflict
// `loadSources` does — since the binary never calls `loadSources` itself
// (ADR-5) — and auto-detects local-only off a missing origin (AC1.1,
// mirroring the core resolution table).
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LocalOnlyPushConflictError } from '@gateline/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Engine } from '../src/engine.ts'
import { assembleOrchestrator } from '../src/start.ts'
import { FakeDispatcher, makeToyRepo, TEST_REGISTRY } from './engine.helper.ts'

const BOT = { name: 'gateline-orchestrator', email: 'orchestrator@gateline.invalid' }

const cleanups: string[] = []
afterEach(() => {
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function toyRepo() {
  const made = makeToyRepo()
  cleanups.push(made.dir)
  return made
}

/** Give the toy repo a bare origin, matching push.test.ts/hosted.test.ts. */
function addOrigin(dir: string): string {
  const bare = `${dir}-origin.git`
  cleanups.push(bare)
  execFileSync('git', ['clone', '--quiet', '--bare', dir, bare])
  execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', bare])
  return bare
}

/**
 * A minimal `claude-code` headless manifest so `assembleOrchestrator` can
 * resolve an adapter without shelling out to a real harness (loadRegistry
 * itself degrades to `null` with no `registry/models.yaml`, but the
 * adapter manifest is read unconditionally).
 */
function withAdapterManifest(dir: string): void {
  const manifestDir = join(dir, 'adapters', 'claude-code')
  mkdirSync(manifestDir, { recursive: true })
  writeFileSync(
    join(manifestDir, 'manifest.json'),
    JSON.stringify({
      adapter: 'claude-code',
      headless: { command: ['true'], dispatch_prompt: '{body}', usage_report: { format: 'static-estimate' } },
      model_map: {},
      model_overrides: {},
      model_vendors: {},
    }),
  )
}

describe('engine heartbeat sync under local-only (AC2.4)', () => {
  it('performs zero git invocations over a cloned fixture', async () => {
    const { dir } = toyRepo()
    const bare = addOrigin(dir)
    execFileSync('git', ['-C', dir, 'push', '--quiet', 'origin', 'run/toy'])

    const clone = `${dir}-clone`
    cleanups.push(clone)
    execFileSync('git', ['clone', '--quiet', bare, clone])

    const engine = new Engine({
      repoDir: clone,
      identity: BOT,
      dispatcher: new FakeDispatcher(() => ({})),
      registry: TEST_REGISTRY,
      localOnly: true,
    })
    const runSpy = vi.spyOn(engine.source.git, 'run')

    await engine.syncFromRemote()

    expect(runSpy).not.toHaveBeenCalled()
  })
})

describe('engine first-dispatch draft-PR ensure under local-only (AC2.2)', () => {
  it('logs the skipped local-only note and never shells out to gh', async () => {
    const { dir } = toyRepo()
    const lines: string[] = []
    const dispatcher = new FakeDispatcher(() => ({}))
    const engine = new Engine({
      repoDir: dir,
      identity: BOT,
      dispatcher,
      registry: TEST_REGISTRY,
      localOnly: true,
      log: (l) => lines.push(l),
    })

    const outcomes = await engine.tick()
    await engine.drain()

    expect(outcomes.find((o) => o.slug === 'toy')?.launched).toBe(1)
    expect(dispatcher.calls.length).toBe(1)
    const ensureLine = lines.find((l) => l.includes('draft PR ensure'))
    expect(ensureLine).toContain('skipped')
    expect(ensureLine).toContain('local-only')
  })
})

describe('assembleOrchestrator: local-only vs --push (AC4.1)', () => {
  it('rejects { localOnly: true, push: true } with LocalOnlyPushConflictError', async () => {
    const { dir } = toyRepo()
    await expect(assembleOrchestrator({ repoDir: dir, localOnly: true, push: true })).rejects.toThrow(
      LocalOnlyPushConflictError,
    )
  })
})

describe('assembleOrchestrator: auto-detect (AC1.1)', () => {
  it('resolves local-only on a remoteless repoDir with no flags', async () => {
    const { dir } = toyRepo()
    withAdapterManifest(dir)

    const { engine } = await assembleOrchestrator({ repoDir: dir })

    expect(engine.source.localOnly).toBe(true)
  })
})
