// The scope and the grouping, computed (#498; docs/MULTI-REPO.md §9.1, §9.2).
//
// `src/scope.ts` is pure, so it is tested with literal inputs and literal
// expected values: which rows a scope keeps (ids compare without case), what
// an unknown id resolves to, each repository's count, the order repositories
// are listed in, and the order rows keep inside a group.
import { describe, expect, it } from 'vitest'
import {
  badgeText,
  compareRepositories,
  grouped,
  groupRows,
  inScope,
  isScopedPage,
  type Repository,
  repositoriesOf,
  resolveScope,
  scopedHref,
  scopeTitle,
} from '../src/scope.ts'

const BILLING = 'github.com/acme/billing'
const WEBSITE = 'github.com/acme/website'
const TOOLS = 'local/tools'

/** Rows as the API sends them: a repository id, its display name, and something to tell rows apart. */
const rows = [
  { source: WEBSITE, sourceName: 'marketing-site', slug: 'w-oldest' },
  { source: BILLING, sourceName: 'billing', slug: 'b-older' },
  { source: WEBSITE, sourceName: 'marketing-site', slug: 'w-newer' },
  { source: BILLING, sourceName: 'billing', slug: 'b-newest' },
]

const set: Repository[] = [
  { id: BILLING, name: 'billing', waiting: 2 },
  { id: WEBSITE, name: 'marketing-site', waiting: 2 },
  { id: TOOLS, name: 'tools', waiting: 0 },
]

describe('the set', () => {
  it('names each repository from its rows, counts its waiting decisions, and lists it by display name', () => {
    // Health lists the set in the operator's order; the listing is by name.
    // No row names local/tools, so it is shown, and sorted, by its id.
    expect(repositoriesOf([WEBSITE, TOOLS, BILLING], rows, rows)).toEqual([
      { id: BILLING, name: 'billing', waiting: 2 },
      { id: TOOLS, name: TOOLS, waiting: 0 },
      { id: WEBSITE, name: 'marketing-site', waiting: 2 },
    ])
  })

  it('names a repository with nothing waiting from other rows, and counts it zero', () => {
    const portfolio = [{ source: TOOLS, sourceName: 'tools' }]
    expect(repositoriesOf([WEBSITE, TOOLS, BILLING], [...rows, ...portfolio], rows)).toEqual(set)
  })

  it('takes names and modes from the served list (#499), so a repository with no rows is named', () => {
    const served = [
      { id: WEBSITE, name: 'marketing-site', mode: 'decide' as const },
      { id: TOOLS, name: 'tools', mode: 'view' as const },
      { id: BILLING, name: 'billing', mode: null },
    ]
    expect(repositoriesOf(served, rows, rows)).toStrictEqual([
      { id: BILLING, name: 'billing', waiting: 2, mode: null },
      { id: WEBSITE, name: 'marketing-site', waiting: 2, mode: 'decide' },
      { id: TOOLS, name: 'tools', waiting: 0, mode: 'view' },
    ])
  })

  it('marks a repository that could not be read, and counts nothing for it', () => {
    const unreadable = [{ source: 'Local/Tools', sourceName: 'tools', error: 'fatal: not a git repository' }]
    expect(repositoriesOf([WEBSITE, TOOLS, BILLING], rows, rows, unreadable)).toStrictEqual([
      { id: BILLING, name: 'billing', waiting: 2 },
      { id: TOOLS, name: TOOLS, waiting: 0, unreadable: 'fatal: not a git repository' },
      { id: WEBSITE, name: 'marketing-site', waiting: 2 },
    ])
  })

  it('orders by display name without case, then by id', () => {
    const listed = [
      { id: 'local/b', name: 'Zeta' },
      { id: 'local/c', name: 'alpha' },
      { id: 'local/a', name: 'Beta' },
      { id: 'github.com/x/alpha', name: 'Alpha' },
    ].sort(compareRepositories)
    expect(listed.map((r) => r.id)).toEqual(['github.com/x/alpha', 'local/c', 'local/a', 'local/b'])
  })
})

describe('the scope', () => {
  it('is the whole set with no repo parameter, or an empty one', () => {
    expect(resolveScope(null, set)).toEqual({ kind: 'all' })
    expect(resolveScope('', set)).toEqual({ kind: 'all' })
  })

  it('is one repository, matched by id without case', () => {
    expect(resolveScope('GitHub.com/Acme/Website', set)).toEqual({ kind: 'one', repository: { id: WEBSITE, name: 'marketing-site', waiting: 2 } })
  })

  it('does not match by display name: the parameter is an id', () => {
    expect(resolveScope('billing', set)).toEqual({ kind: 'unknown', asked: 'billing' })
  })

  it('is unknown for an id the set does not hold', () => {
    expect(resolveScope('github.com/acme/nope', set)).toEqual({ kind: 'unknown', asked: 'github.com/acme/nope' })
  })

  it('is the whole set when the set has one repository and the parameter names it', () => {
    expect(resolveScope(BILLING, [set[0]!])).toEqual({ kind: 'all' })
    expect(resolveScope(WEBSITE, [set[0]!])).toEqual({ kind: 'unknown', asked: WEBSITE })
  })

  it('keeps the rows of its repository, in order, comparing ids without case', () => {
    const scope = resolveScope('GITHUB.COM/ACME/BILLING', set)
    expect(inScope(rows, scope).map((r) => r.slug)).toEqual(['b-older', 'b-newest'])
    // A row whose id differs from the set's only in case is the same repository.
    expect(inScope([{ source: 'GitHub.com/acme/billing', slug: 'odd-case' }], scope).map((r) => r.slug)).toEqual(['odd-case'])
  })

  it('keeps every row when it is the whole set or unknown', () => {
    expect(inScope(rows, { kind: 'all' }).map((r) => r.slug)).toEqual(['w-oldest', 'b-older', 'w-newer', 'b-newest'])
    expect(inScope(rows, { kind: 'unknown', asked: 'x' }).length).toBe(4)
  })

  it('applies to Inbox, Portfolio and Metrics and to no other page', () => {
    expect(['/', '/portfolio', '/metrics', '/portfolio/new', '/repos/local/demo/-/runs/x'].map(isScopedPage)).toEqual([true, true, true, false, false])
  })
})

describe('grouping', () => {
  it('makes one group per repository of the set, in listing order, with rows in the order given', () => {
    expect(groupRows(rows, set).map((g) => [g.repository.name, g.rows.map((r) => r.slug)])).toEqual([
      ['billing', ['b-older', 'b-newest']],
      ['marketing-site', ['w-oldest', 'w-newer']],
      ['tools', []],
    ])
  })

  it('keeps a row whose repository is not in the set, in a group of its own at the end', () => {
    const stray = { source: 'local/gone', sourceName: 'gone', slug: 'g' }
    const groups = groupRows([stray, ...rows], set)
    expect(groups.map((g) => g.repository.id)).toEqual([BILLING, WEBSITE, TOOLS, 'local/gone'])
    expect(groups.at(-1)!.rows).toEqual([stray])
  })

  it('is on only for a joined page over several repositories that asks for it', () => {
    const on = new URLSearchParams('group=repository')
    expect(grouped(on, { kind: 'all' }, set)).toBe(true)
    expect(grouped(on, { kind: 'unknown', asked: 'x' }, set)).toBe(true)
    expect(grouped(on, { kind: 'one', repository: set[0]! }, set)).toBe(false)
    expect(grouped(on, { kind: 'all' }, [set[0]!])).toBe(false)
    expect(grouped(new URLSearchParams(''), { kind: 'all' }, set)).toBe(false)
    expect(grouped(new URLSearchParams('group=yes'), { kind: 'all' }, set)).toBe(false)
  })
})

describe('links, the badge and the title', () => {
  it('sets or drops the repo parameter, keeping the page’s others when asked', () => {
    expect(scopedHref('/portfolio', BILLING)).toBe('/portfolio?repo=github.com%2Facme%2Fbilling')
    expect(scopedHref('/', BILLING, new URLSearchParams('group=repository&repo=x'))).toBe('/?group=repository&repo=github.com%2Facme%2Fbilling')
    expect(scopedHref('/metrics', null, new URLSearchParams('repo=x'))).toBe('/metrics')
  })

  it('counts the whole set, and reads as two numbers under a scope', () => {
    expect(badgeText(30, null)).toBe('30')
    expect(badgeText(30, 3)).toBe('3 of 30')
    expect(badgeText(30, 0)).toBe('0 of 30')
    expect(badgeText(0, null)).toBe(null)
    expect(badgeText(0, 0)).toBe(null)
    // A repository that could not be read (#499): nothing is known to wait there, so the badge says 0 rather than disappearing.
    expect(badgeText(0, null, true)).toBe('0')
    expect(badgeText(0, 0, true)).toBe('0 of 0')
  })

  it('names the scope in the page title, and leaves the title alone without one', () => {
    expect(scopeTitle('Inbox', { kind: 'one', repository: set[1]! })).toBe('Inbox · marketing-site — Gatehouse')
    expect(scopeTitle('Inbox', { kind: 'all' })).toBe(null)
    expect(scopeTitle('Metrics', { kind: 'unknown', asked: 'x' })).toBe(null)
  })
})
