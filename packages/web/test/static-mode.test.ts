// The one flag the live and static builds diverge on (ADR-4). Pure, no DOM:
// every helper takes its env explicitly here rather than reading the module's
// build-time `env`, so the same assertions cover both builds without two
// separate builds running under vitest.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { artifactPath } from '../src/api.ts'
import { eventsUrl, pathPrefix, readUrl, routerBasename, type StaticModeEnv, writeUrl } from '../src/static-mode.ts'

const LIVE: StaticModeEnv = { baseUrl: '/', isStatic: false }
const STATIC: StaticModeEnv = { baseUrl: '/demo/', isStatic: true }

describe('static-mode: live env reproduces today\'s URLs', () => {
  it('pathPrefix is empty', () => {
    expect(pathPrefix(LIVE)).toBe('')
  })

  it('readUrl adds no prefix or suffix', () => {
    expect(readUrl('/api/inbox', LIVE)).toBe('/api/inbox')
  })

  it('writeUrl adds no prefix', () => {
    expect(writeUrl('/api/decisions', LIVE)).toBe('/api/decisions')
  })

  it('eventsUrl is the live SSE route', () => {
    expect(eventsUrl(LIVE)).toBe('/api/events')
  })

  it('routerBasename is /', () => {
    expect(routerBasename(LIVE)).toBe('/')
  })

  it('readUrl never throws on a query string — the guard is static-only', () => {
    expect(readUrl('/api/x?y=1', LIVE)).toBe('/api/x?y=1')
  })
})

describe('static-mode: static env prefixes and suffixes for the demo', () => {
  it('pathPrefix is /demo', () => {
    expect(pathPrefix(STATIC)).toBe('/demo')
  })

  it('readUrl prefixes with /demo and appends .json', () => {
    expect(readUrl('/api/runs/fixture/g2-pending', STATIC)).toBe('/demo/api/runs/fixture/g2-pending.json')
  })

  it('writeUrl prefixes with /demo and is never suffixed', () => {
    expect(writeUrl('/api/decisions', STATIC)).toBe('/demo/api/decisions')
  })

  it('eventsUrl is null', () => {
    expect(eventsUrl(STATIC)).toBeNull()
  })

  it('routerBasename is /demo', () => {
    expect(routerBasename(STATIC)).toBe('/demo')
  })

  it('readUrl throws on a path carrying a query string', () => {
    expect(() => readUrl('/api/runs/repo/slug/artifact?path=spec.md', STATIC)).toThrow()
  })

  it('readUrl does not throw on a query-free path', () => {
    expect(() => readUrl('/api/runs', STATIC)).not.toThrow()
  })
})

describe('static-mode: default env is the module-level export', () => {
  it('readUrl/writeUrl/eventsUrl/routerBasename all accept being called with no env', () => {
    expect(() => readUrl('/api/inbox')).not.toThrow()
    expect(() => writeUrl('/api/decisions')).not.toThrow()
    expect(() => eventsUrl()).not.toThrow()
    expect(() => routerBasename()).not.toThrow()
  })
})

describe('artifactPath: the path form the server route expects (ADR-2)', () => {
  it('encodes a single-segment path', () => {
    expect(artifactPath('repo', 'wordfreq', 'spec.md')).toBe('/api/runs/repo/wordfreq/artifact/spec.md')
  })

  it('keeps literal slashes between segments unencoded', () => {
    // Each path *segment* is encoded on its own and rejoined with '/', so a
    // run-relative path with several directory levels keeps its structure —
    // the server's regex decodes the whole remainder in one pass and expects
    // exactly this shape.
    expect(artifactPath('repo', 'wordfreq', 'tasks/01-core.yaml')).toBe('/api/runs/repo/wordfreq/artifact/tasks/01-core.yaml')
  })

  it('encodes characters that would otherwise change the URL grammar', () => {
    expect(artifactPath('repo', 'slug', 'a b/c?d.md')).toBe('/api/runs/repo/slug/artifact/a%20b/c%3Fd.md')
  })
})

// F1: the module-level `env` and `api`'s wiring into `readUrl`/`artifactPath`
// are otherwise untested — every fixture above supplies its own `StaticModeEnv`
// and never exercises the build-time flag or the two call sites that read the
// module default. These three pin that: the flag itself, and both of `api`'s
// two shapes of GET (a plain path and the artifact path form) resolving through
// it. `vi.resetModules()` before each dynamic `import()` is required because
// `env` is computed once, at module evaluation, from `import.meta.env`.
describe('static-mode: the build-time flag actually gates behaviour (F1)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('VITE_GATELINE_STATIC=1 makes env.isStatic true (not truthy-by-accident: only exactly "1")', async () => {
    vi.stubEnv('VITE_GATELINE_STATIC', '1')
    vi.stubEnv('BASE_URL', '/demo/')
    vi.resetModules()
    const { env } = await import('../src/static-mode.ts')
    expect(env).toEqual({ baseUrl: '/demo/', isStatic: true })
  })

  it('api.inbox() resolves through readUrl in static mode: fetches /demo/api/inbox.json', async () => {
    vi.stubEnv('VITE_GATELINE_STATIC', '1')
    vi.stubEnv('BASE_URL', '/demo/')
    vi.resetModules()
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const { api } = await import('../src/api.ts')
    await api.inbox()
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/demo/api/inbox.json')
  })

  it('api.artifact() resolves through artifactPath + readUrl in static mode: fetches the .json file form', async () => {
    vi.stubEnv('VITE_GATELINE_STATIC', '1')
    vi.stubEnv('BASE_URL', '/demo/')
    vi.resetModules()
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const { api } = await import('../src/api.ts')
    await api.artifact('fixture', 'g2-pending', 'tasks/01-core.yaml')
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/demo/api/runs/fixture/g2-pending/artifact/tasks/01-core.yaml.json')
  })
})
