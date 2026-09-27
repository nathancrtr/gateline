// Routes that carry a repository id (#494, docs/MULTI-REPO.md §6.4): the API
// and web shapes `/repos/<id>/-/runs/<slug>`, an id that nests, a slug made of
// every kind of character a run branch can carry, and the redirects that keep
// links made under the old names working. Expected paths are literals.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadSources, type RunSource } from '@gateline/core'
import { type FixtureRepo, generateFixtureRepo } from '@gateline/fixtures'
import type { Hono } from 'hono'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.ts'

const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }
const git = (dir: string, ...args: string[]) => execFileSync('git', ['-C', dir, ...args], { env, encoding: 'utf8' })

/**
 * A slug with every kind of character a run branch name can hold: git refuses
 * space, `~ ^ : ? * [ \`, control characters and `..`, and nothing else a
 * slug needs. For-each-ref's `run/*` pattern does not cross a slash, so a slug
 * never contains one (see local-source.ts `listRuns`).
 */
const ODD_SLUG = `Odd.Slug_+@!=,;$&'()%41#x"<>|{}café-9`
/** The same slug as a URL segment: `encodeURIComponent`, written out. */
const ODD_SLUG_URL = "Odd.Slug_%2B%40!%3D%2C%3B%24%26'()%2541%23x%22%3C%3E%7C%7B%7Dcaf%C3%A9-9"

const NESTED = 'gitlab.com/acme/platform/billing'

let fixture: FixtureRepo
let sources: RunSource[]
let app: Hono

beforeAll(async () => {
  fixture = generateFixtureRepo()
  // A nested GitLab group as the origin: the id is derived from it, four
  // segments deep. push:false keeps every write here local (and, at the CLI
  // tier, local-only), which reads do not need anyway.
  git(fixture.dir, 'remote', 'add', 'origin', 'git@gitlab.com:acme/platform/billing.git')
  git(fixture.dir, 'checkout', '-q', '-b', `run/${ODD_SLUG}`, 'main')
  mkdirSync(join(fixture.dir, 'runs', ODD_SLUG), { recursive: true })
  writeFileSync(join(fixture.dir, 'runs', ODD_SLUG, 'state.yaml'), 'run: odd\nphase: spec\ngates: {}\n')
  git(fixture.dir, 'add', '-A')
  git(fixture.dir, '-c', 'user.name=Fixture Operator', '-c', 'user.email=operator@example.test', 'commit', '-q', '-m', 'state(odd): artifacts')
  git(fixture.dir, 'checkout', '-q', 'main')
  ;({ sources } = await loadSources({ repoOverrides: [fixture.dir], push: false, configPath: '/nonexistent/gateline-494/config.yaml' }))
  app = createApp({ sources })
})
afterAll(() => rm(fixture.root, { recursive: true, force: true }))

describe('the API shape /api/repos/<id>/-/runs/<slug>', () => {
  it('serves a run under an id derived from a nested group’s origin', async () => {
    expect(sources.map((s) => s.id)).toEqual([NESTED])
    const res = await app.request('/api/repos/gitlab.com/acme/platform/billing/-/runs/g2-pending')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { summary: { source: string; slug: string } }
    expect(body.summary).toMatchObject({ source: NESTED, slug: 'g2-pending' })
  })

  it('serves every per-run route under that id', async () => {
    const base = '/api/repos/gitlab.com/acme/platform/billing/-/runs'
    for (const path of [
      `${base}/g2-pending/artifact?path=spec.md`,
      `${base}/g2-pending/lexicon`,
      `${base}/g2-pending/reviews`,
      `${base}/g2-pending/evidence`,
      `${base}/g0-pending/g0`,
      `${base}/g1-pending/g1`,
      `${base}/g3-pending/g3`,
      `${base}/escalated/escalation/0`,
      `${base}/g2-pending/diff`,
      `${base}/g2-pending/decisions`,
    ]) {
      expect((await app.request(path)).status, path).toBe(200)
    }
  })

  it('finds the id without regard to case', async () => {
    expect((await app.request('/api/repos/GitLab.com/ACME/Platform/Billing/-/runs/g2-pending')).status).toBe(200)
  })

  it('serves a slug made of every character a run branch can carry', async () => {
    const res = await app.request(`/api/repos/gitlab.com/acme/platform/billing/-/runs/${ODD_SLUG_URL}`)
    expect(res.status).toBe(200)
    expect(((await res.json()) as { summary: { slug: string } }).summary.slug).toBe(ODD_SLUG)
    expect((await app.request(`/api/repos/gitlab.com/acme/platform/billing/-/runs/${ODD_SLUG_URL}/lexicon`)).status).toBe(200)
    expect(encodeURIComponent(ODD_SLUG)).toBe(ODD_SLUG_URL)
  })

  it('404s an id that is not served, a shorter id, and the retired /api/runs shape', async () => {
    for (const path of [
      '/api/repos/gitlab.com/acme/other/-/runs/g2-pending',
      '/api/repos/gitlab.com/acme/platform/-/runs/g2-pending',
      '/api/repos/billing/-/runs/g2-pending',
      '/api/runs/billing/g2-pending',
    ]) {
      expect((await app.request(path)).status, path).toBe(404)
    }
  })

  it('takes a decision naming the repository by its id', async () => {
    const res = await app.request('/api/decisions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: NESTED, slug: 'g0-pending', action: 'pause', pauseReason: 'checking the id' }),
    })
    expect(res.status).toBe(200)
  })
})

describe('the web shape /repos/<id>/-/runs/<slug>', () => {
  // main.ts serves the SPA from a catch-all registered after createApp; a
  // stand-in here shows which requests reach it.
  const withSpa = (sourcesFor: RunSource[]): Hono => {
    const a = createApp({ sources: sourcesFor })
    a.get('*', (c) => c.text('spa'))
    return a
  }

  it('passes a current id through to the SPA untouched, whatever its case', async () => {
    const spa = withSpa(sources)
    for (const path of [
      '/repos/gitlab.com/acme/platform/billing/-/runs/g2-pending',
      '/repos/GITLAB.COM/acme/platform/billing/-/runs/g2-pending?decide=G2',
      `/repos/gitlab.com/acme/platform/billing/-/runs/${ODD_SLUG_URL}`,
    ]) {
      const res = await spa.request(path)
      expect(res.status, path).toBe(200)
      expect(await res.text()).toBe('spa')
    }
  })
})

describe('links made under the old names', () => {
  let base: string
  let billing: string
  let otherBilling: string
  let scratch: string
  let named: RunSource[]
  let spa: Hono

  async function repo(rel: string, origin?: string): Promise<string> {
    const dir = join(base, rel)
    await mkdir(dir, { recursive: true })
    git(dir, 'init', '-q', '-b', 'main')
    if (origin) git(dir, 'remote', 'add', 'origin', origin)
    return realpath(dir)
  }

  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), 'gateline-494-links-'))
    // Two clones whose directories are both called `billing` — before #494
    // they were served as `billing` and `billing-2` — and a local repository.
    billing = await repo('work/billing', 'git@github.com:acme/billing.git')
    otherBilling = await repo('side/billing', 'git@gitlab.com:other/billing.git')
    scratch = await repo('notes/scratch')
    const configPath = join(base, 'config.yaml')
    writeFileSync(
      configPath,
      [
        'sources:',
        `  - path: ${billing}`,
        '    former_ids: [github.com/acme/old-billing]',
        '  - name: other-billing',
        `    path: ${otherBilling}`,
        '  - name: jot',
        `    path: ${scratch}`,
        '',
      ].join('\n'),
    )
    ;({ sources: named } = await loadSources({ configPath }))
    spa = createApp({ sources: named })
    spa.get('*', (c) => c.text('spa'))
  })
  afterAll(() => rm(base, { recursive: true, force: true }))

  const location = async (path: string) => {
    const res = await spa.request(path)
    return { status: res.status, location: res.headers.get('location'), text: await res.text() }
  }

  it('names the set as the design says', () => {
    expect(named.map((s) => s.id)).toEqual(['github.com/acme/billing', 'gitlab.com/other/billing', 'local/jot'])
  })

  it('redirects an old config name', async () => {
    expect(await location('/runs/other-billing/g0-pending')).toMatchObject({
      status: 302,
      location: '/repos/gitlab.com/other/billing/-/runs/g0-pending',
    })
    expect(await location('/runs/jot/g0-pending')).toMatchObject({ status: 302, location: '/repos/local/jot/-/runs/g0-pending' })
  })

  it('redirects an old basename', async () => {
    expect(await location('/runs/scratch/g0-pending')).toMatchObject({ status: 302, location: '/repos/local/jot/-/runs/g0-pending' })
  })

  it('redirects either with the retired -2 suffix', async () => {
    expect(await location('/runs/other-billing-2/g0-pending')).toMatchObject({
      status: 302,
      location: '/repos/gitlab.com/other/billing/-/runs/g0-pending',
    })
    expect(await location('/runs/scratch-2/x')).toMatchObject({ status: 302, location: '/repos/local/jot/-/runs/x' })
  })

  it('redirects a former id, in the old shape and the new', async () => {
    expect(await location('/repos/github.com/acme/old-billing/-/runs/g0-pending')).toMatchObject({
      status: 302,
      location: '/repos/github.com/acme/billing/-/runs/g0-pending',
    })
    expect(await location('/repos/GitHub.com/Acme/Old-Billing/-/runs/g0-pending')).toMatchObject({
      status: 302,
      location: '/repos/github.com/acme/billing/-/runs/g0-pending',
    })
  })

  it('keeps the query string, and keeps the slug encoded', async () => {
    expect(await location('/runs/jot/g2-pending?tab=record&artifact=spec.md')).toMatchObject({
      status: 302,
      location: '/repos/local/jot/-/runs/g2-pending?tab=record&artifact=spec.md',
    })
    expect(await location(`/runs/jot/${ODD_SLUG_URL}`)).toMatchObject({
      status: 302,
      location: `/repos/local/jot/-/runs/${ODD_SLUG_URL}`,
    })
  })

  it('asks which repository was meant when an old name matches several', async () => {
    for (const old of ['billing', 'billing-2']) {
      const { status, location: loc, text } = await location(`/runs/${old}/g0-pending?decide=G0`)
      expect(status, old).toBe(300)
      expect(loc).toBeNull()
      expect(text).toContain('<title>Which repository?</title>')
      expect(text).toContain('<a href="/repos/github.com/acme/billing/-/runs/g0-pending?decide=G0">github.com/acme/billing</a>')
      expect(text).toContain('<a href="/repos/gitlab.com/other/billing/-/runs/g0-pending?decide=G0">gitlab.com/other/billing</a>')
      expect(text).not.toContain('local/jot')
    }
  })

  it('escapes what it prints on that page', async () => {
    const { text } = await location('/runs/billing/%3Cb%3Ex%3C%2Fb%3E')
    expect(text).not.toContain('<b>x</b>')
    expect(text).toContain('<code>&lt;b&gt;x&lt;/b&gt;</code>')
  })

  it('leaves a name that matches nothing to the SPA’s not-found, as before', async () => {
    expect(await location('/runs/nothing-like-it/g0-pending')).toMatchObject({ status: 200, location: null, text: 'spa' })
    expect(await location('/repos/github.com/nobody/nothing/-/runs/g0-pending')).toMatchObject({ status: 200, location: null, text: 'spa' })
    // With no SPA behind it, the server's own not-found.
    const bare = createApp({ sources: named })
    expect((await bare.request('/runs/nothing-like-it/g0-pending')).status).toBe(404)
  })
})
