// Live smoke of the claude-code headless path: one real dispatch through the
// HeadlessDispatcher and the real manifest, proving invocation + usage
// parsing against the actual CLI. Opt-in (real spend): ORCH_LIVE_SMOKE=1.
// Run from the repo root: ORCH_LIVE_SMOKE=1 npx vitest run packages/orchestrator/test/live-smoke.test.ts
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadHeadlessManifest } from '../src/manifest.ts'
import { HeadlessDispatcher } from '../src/seam.ts'

const live = process.env.ORCH_LIVE_SMOKE === '1'

describe.skipIf(!live)('claude-code headless (live)', () => {
  it('dispatches one prompt and parses real usage', { timeout: 300_000 }, async () => {
    const repoRoot = resolve(fileURLToPath(import.meta.url), '../../../..')
    const manifest = await loadHeadlessManifest(repoRoot, 'claude-code')
    // Neutral prompt: the manifest template normally names a subagent via
    // {role}; for the smoke we only prove the invocation + usage plumbing.
    const dispatcher = new HeadlessDispatcher({
      ...manifest,
      dispatchPrompt: '{body}',
    })
    const outcome = await dispatcher.dispatch({
      cwd: tmpdir(),
      role: 'analyst',
      body: 'Reply with exactly the word: pong',
      timeoutMs: 240_000,
    })
    expect(outcome.ok).toBe(true)
    expect(outcome.error).toBeNull()
    expect(outcome.costUsd).toBeGreaterThan(0)
    expect(outcome.tokensIn).toBeGreaterThan(0)
    expect(outcome.tokensOut).toBeGreaterThan(0)
  })
})
