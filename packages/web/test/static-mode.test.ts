// The one flag the live and static builds diverge on (ADR-4). Pure, no DOM:
// every helper takes its env explicitly here rather than reading the module's
// build-time `env`, so the same assertions cover both builds without two
// separate builds running under vitest.
import { describe, expect, it } from 'vitest'
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
