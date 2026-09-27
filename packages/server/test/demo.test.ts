// `gateline ui --demo` (#498; docs/MULTI-REPO.md §9.7): two fixture
// repositories in directories with fixed names, so their ids are `local/demo`
// and `local/demo-small` on every start; `--demo=single` keeps one. Both
// carry the framework's root layout, so the framework check (#495) admits
// them, and the small one holds four runs in four different states.
import { rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startServer } from '../src/main.ts'

const generated: string[] = []
afterEach(async () => {
  for (const dir of generated.splice(0)) await rm(dir, { recursive: true, force: true })
})

/** Start the demo, read back what it serves, and stop it. */
async function serveDemo(demo: true | 'single') {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  try {
    const server = await startServer({ demo, port: 0, host: '127.0.0.1', push: false })
    try {
      const lines = log.mock.calls.map((c) => String(c[0]))
      for (const l of lines) if (l.startsWith('demo repository generated at ')) generated.push(dirname(l.slice('demo repository generated at '.length)))
      const get = async (path: string) => (await fetch(`${server.url}${path}`)).json()
      const health = (await get('/api/health')) as { sources: string[] }
      const runs = (await get('/api/runs')) as { runs: { source: string; slug: string; phase: string }[] }
      const inbox = (await get('/api/inbox')) as { items: { source: string }[] }
      return { lines, health, runs: runs.runs, inbox: inbox.items }
    } finally {
      server.close()
    }
  } finally {
    log.mockRestore()
  }
}

describe('ui --demo', () => {
  it('serves two repositories with fixed ids, the small one four runs in four states', async () => {
    const { lines, health, runs, inbox } = await serveDemo(true)
    expect(health.sources).toEqual(['local/demo', 'local/demo-small'])
    expect(lines.find((l) => l.startsWith('sources: '))).toBe('sources: local/demo (decide), local/demo-small (decide)')
    const small = runs.filter((r) => r.source === 'local/demo-small').map((r) => `${r.slug} ${r.phase}`)
    expect(small.sort()).toEqual(['csv-export spec', 'docs-refresh done', 'nightly-report paused', 'retry-policy implement'])
    expect(inbox.filter((i) => i.source === 'local/demo-small').length).toBe(3)
    expect(inbox.filter((i) => i.source === 'local/demo').length).toBe(14)
  }, 120_000)

  it('serves local/demo alone with --demo=single', async () => {
    const { health } = await serveDemo('single')
    expect(health.sources).toEqual(['local/demo'])
  }, 120_000)
})
