// Every view-model record that carries a repository id carries its display
// name beside it (#497, docs/MULTI-REPO.md §6.2, §9.2): the run summary, the
// inbox item and the two metrics records. Web shows the display name and must
// not derive it from the id, so core fills it here from `displayNameOf`.
//
// Read end to end from a config file, as an operator would set it: the
// fixture is given an origin, so its id is `github.com/acme/billing`, and the
// display name is the config's `name` when there is one and the id's last
// segment when there is not.
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildPortfolio, computeMetrics, deriveReadiness, loadSources, type RunSource, summarizeRun } from '../src/index.ts'
import { dropFixture, type FixtureContext, makeFixture } from './fixture.helper.ts'

let ctx: FixtureContext
let configDir: string

beforeAll(async () => {
  ctx = await makeFixture()
  // An origin that is never fetched or pushed: it names the repository, and
  // a config entry with no `push` key keeps push off.
  execFileSync('git', ['-C', ctx.repo.dir, 'remote', 'add', 'origin', 'git@github.com:acme/billing.git'])
  configDir = await mkdtemp(join(tmpdir(), 'gateline-497-cfg-'))
})

afterAll(async () => {
  await dropFixture(ctx)
  await rm(configDir, { recursive: true, force: true })
})

async function sourceFrom(entry: string): Promise<RunSource> {
  const configPath = join(configDir, `config-${Math.random().toString(36).slice(2)}.yaml`)
  // `mode: view`: every entry states its mode (#495), and this test only reads.
  await writeFile(configPath, `sources:\n  - path: ${ctx.repo.dir}\n    mode: view\n${entry}`)
  const { sources } = await loadSources({ configPath })
  expect(sources).toHaveLength(1)
  return sources[0]!
}

/** Every repository field the view models put on the wire, as `[id, display name]` pairs. */
async function everyRecord(source: RunSource): Promise<[string, string][]> {
  const { runs, inbox } = await buildPortfolio([source])
  const metrics = await computeMetrics([source])
  // Non-vacuity: the fixture has runs, things waiting, decisions taken and budgets.
  expect(runs.length).toBeGreaterThan(10)
  expect(inbox.length).toBeGreaterThan(10)
  expect(metrics.runs.length).toBeGreaterThan(5)
  expect(metrics.decisions.length).toBeGreaterThan(3)
  return [...runs, ...inbox, ...metrics.runs, ...metrics.decisions].map((r) => [r.source, r.sourceName])
}

describe('the display name travels with the id (#497)', () => {
  it('is the config `name` when the entry gives one', async () => {
    const source = await sourceFrom('    name: billing-app\n')
    const pairs = await everyRecord(source)
    expect(new Set(pairs.map(([id, name]) => `${id} → ${name}`))).toEqual(new Set(['github.com/acme/billing → billing-app']))
  })

  it("is the id's last segment when the entry gives no `name`", async () => {
    const source = await sourceFrom('')
    const pairs = await everyRecord(source)
    expect(new Set(pairs.map(([id, name]) => `${id} → ${name}`))).toEqual(new Set(['github.com/acme/billing → billing']))
  })

  it('is on the run detail parts too: the summary and the readiness items', async () => {
    const source = await sourceFrom('    name: billing-app\n')
    const ref = (await source.listRuns()).find((r) => r.slug === 'g0-pending')!
    const { summary, items } = await summarizeRun(source, ref)
    expect(summary).toMatchObject({ source: 'github.com/acme/billing', sourceName: 'billing-app', slug: 'g0-pending' })
    expect(items.map((i) => i.sourceName)).toEqual(['billing-app'])
    const readiness = await deriveReadiness(source, ref)
    expect(readiness.items.map((i) => [i.source, i.sourceName])).toEqual([['github.com/acme/billing', 'billing-app']])
  })

  it("falls back to the id's last segment for a driver that states no display name", async () => {
    // `RunSource.displayName` is optional, so a driver or a test double may
    // leave it out; `displayNameOf` supplies the fallback, and nothing here
    // may leave the field empty.
    const bare: RunSource = Object.create(ctx.source, { id: { value: 'gitlab.example/acme/group/billing' }, displayName: { value: undefined } })
    const ref = (await bare.listRuns()).find((r) => r.slug === 'g0-pending')!
    const { summary } = await summarizeRun(bare, ref)
    expect(summary.sourceName).toBe('billing')
  })
})
