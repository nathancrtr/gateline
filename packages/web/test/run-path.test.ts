// Where a run lives in a URL (#494): the path builder and parser, and the web
// client's calls made against the real server. The contract names each route
// by key; this is what shows the client's strings reach those routes, for an
// id that nests and a slug that needs encoding. Expected paths are literals.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { LocalGitSource } from '@gateline/core'
import { type FixtureRepo, generateFixtureRepo } from '@gateline/fixtures'
import { createApp } from '@gateline/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { api } from '../src/api.ts'
import { itemHref } from '../src/pages/inbox.tsx'
import { parseRunPath, runApiPath, runPath } from '../src/run-path.ts'

const ODD_SLUG = `Odd.Slug_+@!=,;$&'()%41#x"<>|{}café-9`
const ODD_SLUG_URL = "Odd.Slug_%2B%40!%3D%2C%3B%24%26'()%2541%23x%22%3C%3E%7C%7B%7Dcaf%C3%A9-9"

describe('runPath and parseRunPath', () => {
  it('puts the id, a dash segment, and the slug in that order', () => {
    expect(runPath('github.com/acme/billing', 'g2-pending')).toBe('/repos/github.com/acme/billing/-/runs/g2-pending')
    expect(runPath('local/demo', 'g2-pending', 'decide=G2')).toBe('/repos/local/demo/-/runs/g2-pending?decide=G2')
    expect(runApiPath('gitlab.com/acme/platform/billing', 'x')).toBe('/api/repos/gitlab.com/acme/platform/billing/-/runs/x')
  })

  it('encodes the slug and each id segment', () => {
    expect(runPath('local/demo', ODD_SLUG)).toBe(`/repos/local/demo/-/runs/${ODD_SLUG_URL}`)
  })

  it('reads back what it wrote, at any depth', () => {
    for (const [id, slug] of [
      ['local/demo', 'g0-pending'],
      ['github.com/Acme/Billing', ODD_SLUG],
      ['gitlab.com/acme/platform/payments/billing', 'a-run'],
    ] as const) {
      expect(parseRunPath(runPath(id, slug))).toEqual({ id, slug })
    }
  })

  it('reads a slug of "-" or "runs" without losing the id', () => {
    expect(parseRunPath('/repos/local/demo/-/runs/-')).toEqual({ id: 'local/demo', slug: '-' })
    expect(parseRunPath('/repos/local/demo/-/runs/runs')).toEqual({ id: 'local/demo', slug: 'runs' })
  })

  it('is null for anything that is not a run page', () => {
    for (const path of ['/', '/portfolio', '/runs/demo/g0-pending', '/repos/local/demo', '/repos/-/runs/x', '/repos/local/demo/-/runs', '/repos/local/demo/-/runs/x/y', '/repos/local/demo/-/x/y', '/repos/local/demo/-/runs/%E0%A4']) {
      expect(parseRunPath(path), path).toBeNull()
    }
  })

  it('is what the inbox links to', () => {
    const href = itemHref({ source: 'github.com/acme/billing', slug: 'g1-pending', kind: 'gate', gate: 'G1' } as Parameters<typeof itemHref>[0])
    expect(href).toBe('/repos/github.com/acme/billing/-/runs/g1-pending?decide=G1')
  })
})

describe('the web client reaches the server’s routes', () => {
  const NESTED = 'gitlab.com/acme/platform/billing'
  let fixture: FixtureRepo
  let app: ReturnType<typeof createApp>
  const requested: string[] = []

  beforeAll(() => {
    fixture = generateFixtureRepo()
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', fixture.dir, ...args], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } })
    git('checkout', '-q', '-b', `run/${ODD_SLUG}`, 'main')
    mkdirSync(`${fixture.dir}/runs/${ODD_SLUG}`, { recursive: true })
    writeFileSync(`${fixture.dir}/runs/${ODD_SLUG}/state.yaml`, 'run: odd\nphase: spec\ngates: {}\n')
    git('add', '-A')
    git('commit', '-q', '-m', 'state(odd): artifacts')
    git('checkout', '-q', 'main')
    app = createApp({ sources: [new LocalGitSource(NESTED, fixture.dir)] })
    // The browser's fetch, answered by the app in-process.
    vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
      requested.push(input)
      return app.request(`http://gatehouse.test${input}`, init)
    })
  })
  afterAll(async () => {
    vi.unstubAllGlobals()
    await rm(fixture.root, { recursive: true, force: true })
  })

  it('answers every per-run call for an id four segments deep', async () => {
    const detail = await api.run(NESTED, 'g2-pending')
    expect(detail.summary).toMatchObject({ source: NESTED, slug: 'g2-pending' })
    await api.artifact(NESTED, 'g2-pending', 'tasks/01-core.yaml')
    await api.lexicon(NESTED, 'g2-pending')
    await api.evidence(NESTED, 'g2-pending')
    await api.g0(NESTED, 'g0-pending')
    await api.g1(NESTED, 'g1-pending')
    await api.g3(NESTED, 'g3-pending')
    await api.escalation(NESTED, 'escalated', 0)
    await api.reviews(NESTED, 'g2-pending')
    await api.decisions(NESTED, 'g2-pending')
    await api.diff(NESTED, 'g2-pending')
    expect(requested).toContain('/api/repos/gitlab.com/acme/platform/billing/-/runs/g2-pending/artifact?path=tasks%2F01-core.yaml')
    expect(requested).toContain('/api/repos/gitlab.com/acme/platform/billing/-/runs/escalated/escalation/0')
  })

  it('answers for a slug that needs encoding', async () => {
    const detail = await api.run(NESTED, ODD_SLUG)
    expect(detail.summary.slug).toBe(ODD_SLUG)
    expect(requested).toContain(`/api/repos/gitlab.com/acme/platform/billing/-/runs/${ODD_SLUG_URL}`)
  })
})
