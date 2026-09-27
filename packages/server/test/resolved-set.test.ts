// `startServer({ resolved })` (#502): `gateline up` loads the set once, builds
// its engines from it, and hands the server the same sources, so the two
// cannot disagree about which repositories are served. Given a resolved set,
// the server serves exactly that set, prints it as it would a loaded one, and
// reads neither `repoOverrides` nor the config file.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalGitSource } from '@gateline/core'
import { generateFixtureRepo } from '@gateline/fixtures'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startServer } from '../src/main.ts'

const cleanups: string[] = []
afterEach(async () => {
  for (const dir of cleanups.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe('a set resolved by the caller', () => {
  it('is served as given; repoOverrides and the config file are not read', async () => {
    const served = generateFixtureRepo()
    const ignored = generateFixtureRepo()
    cleanups.push(served.dir, ignored.dir)
    // A config file that would fail to load if anything read it.
    const xdg = await mkdtemp(join(tmpdir(), 'gateline-resolved-'))
    cleanups.push(xdg)
    await writeFile(join(xdg, 'broken.yaml'), 'repositories: [\n')
    const source = new LocalGitSource('local/served', served.dir, { mode: 'decide', displayName: 'served' })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const server = await startServer({
        port: 0,
        host: '127.0.0.1',
        repoOverrides: [ignored.dir],
        resolved: { sources: [source], configPath: join(xdg, 'broken.yaml') },
      })
      try {
        const health = (await (await fetch(`${server.url}/api/health`)).json()) as { repositories: unknown[] }
        expect(health.repositories).toEqual([{ id: 'local/served', name: 'served', mode: 'decide' }])
        const lines = log.mock.calls.map((c) => String(c[0]))
        expect(lines.find((l) => l.startsWith('sources: '))).toBe(`sources: local/served (decide) (from ${join(xdg, 'broken.yaml')})`)
      } finally {
        server.close()
      }
    } finally {
      log.mockRestore()
    }
  })
})
