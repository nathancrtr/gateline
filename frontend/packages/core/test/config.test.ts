// #83 regression: loadSources roots every source at the work-tree toplevel.
// A subdirectory source reads state fine (`show ref:path` is root-relative)
// but lists no artifacts (pathspecs are cwd-relative), so gates vanish from
// the inbox without an error. All three acceptance paths must normalize.
import { mkdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildPortfolio, loadSources, type LocalGitSource } from '../src/index.ts'
import { dropFixture, makeFixture, type FixtureContext } from './fixture.helper.ts'

let ctx: FixtureContext
let toplevel: string
let subdir: string
// A config path that never exists, so loadSources exercises the cwd fallback
// instead of reading the developer's real ~/.config/agentic/config.yaml.
const noConfig = { configPath: '/nonexistent/agentic-83/config.yaml' }

beforeAll(async () => {
  ctx = await makeFixture()
  toplevel = await realpath(ctx.repo.dir)
  subdir = join(ctx.repo.dir, 'subdir-83')
  await mkdir(subdir, { recursive: true })
})

afterAll(async () => {
  await dropFixture(ctx)
})

describe('loadSources roots sources at the repo toplevel (#83)', () => {
  it('cwd fallback from a subdirectory resolves to the toplevel', async () => {
    const { sources, warnings } = await loadSources({ cwd: subdir, ...noConfig })
    expect(warnings).toEqual([])
    expect(sources).toHaveLength(1)
    expect((sources[0] as LocalGitSource).dir).toBe(toplevel)
  })

  it('--repo pointing at a subdirectory resolves to the toplevel', async () => {
    const { sources } = await loadSources({ repoOverrides: [subdir], cwd: subdir, ...noConfig })
    expect(sources).toHaveLength(1)
    expect((sources[0] as LocalGitSource).dir).toBe(toplevel)
  })

  it('inbox derived from a subdirectory launch matches the repo root', async () => {
    const { sources } = await loadSources({ cwd: subdir, ...noConfig })
    const fromSub = await buildPortfolio(sources)
    const fromRoot = await buildPortfolio([ctx.source])
    const key = (i: { kind: string; slug: string; gate: string | null }) => `${i.kind}:${i.slug}:${i.gate}`
    expect(fromSub.inbox.length).toBeGreaterThan(0) // parity must not hold vacuously
    expect(fromSub.inbox.map(key)).toEqual(fromRoot.inbox.map(key))
    // The symptom that shipped: runs render while the inbox is empty.
    expect(fromSub.runs.length).toBe(fromRoot.runs.length)
  })
})
