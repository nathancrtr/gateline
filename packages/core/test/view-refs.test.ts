// #461: "did anything change" is a question about the refs views read, and a
// run's views depend on that run's refs plus the default branch — not on
// every ref in the repository.
import { describe, expect, it } from 'vitest'
import { type NamedRef, runPrint, viewRefsOf } from '../src/index.ts'

const ref = (name: string, oid: string, symref = ''): NamedRef => ({ ref: name, oid, symref })
const noHead = async () => null

const base = [
  ref('refs/heads/main', 'm1'),
  ref('refs/remotes/origin/HEAD', 'm1', 'refs/remotes/origin/main'),
  ref('refs/remotes/origin/main', 'm1'),
  ref('refs/heads/run/alpha', 'a1'),
  ref('refs/remotes/origin/run/alpha', 'a0'),
  ref('refs/heads/run/beta', 'b1'),
  ref('refs/heads/web/some-work', 'w1'),
  ref('refs/remotes/origin/web/some-work', 'w0'),
]

const moved = (name: string, oid: string) => base.map((r) => (r.ref === name ? { ...r, oid } : r))

describe('viewRefsOf', () => {
  it('ignores a branch no view reads, local or remote', async () => {
    const before = await viewRefsOf(base, noHead)
    expect((await viewRefsOf(moved('refs/heads/web/some-work', 'w2'), noHead)).all).toBe(before.all)
    expect((await viewRefsOf(moved('refs/remotes/origin/web/some-work', 'w2'), noHead)).all).toBe(before.all)
    expect((await viewRefsOf([...base, ref('refs/heads/docs/new', 'd1')], noHead)).all).toBe(before.all)
  })

  it('a commit on one run changes that run and no other', async () => {
    const before = await viewRefsOf(base, noHead)
    const after = await viewRefsOf(moved('refs/heads/run/alpha', 'a2'), noHead)
    expect(after.all).not.toBe(before.all)
    expect(runPrint(after, 'alpha')).not.toBe(runPrint(before, 'alpha'))
    expect(runPrint(after, 'beta')).toBe(runPrint(before, 'beta'))
  })

  it("a run's remote-tracking ref counts as that run's", async () => {
    const before = await viewRefsOf(base, noHead)
    const after = await viewRefsOf(moved('refs/remotes/origin/run/alpha', 'a1'), noHead)
    expect(runPrint(after, 'alpha')).not.toBe(runPrint(before, 'alpha'))
    expect(runPrint(after, 'beta')).toBe(runPrint(before, 'beta'))
  })

  it('the default branch moving changes every run, including one with no branch left', async () => {
    const before = await viewRefsOf(base, noHead)
    for (const name of ['refs/heads/main', 'refs/remotes/origin/main']) {
      const after = await viewRefsOf(moved(name, 'm2'), noHead)
      for (const slug of ['alpha', 'beta', 'merged-long-ago']) {
        expect(runPrint(after, slug), `${name} / ${slug}`).not.toBe(runPrint(before, slug))
      }
    }
  })

  it('a new run and a deleted run are both changes', async () => {
    const before = await viewRefsOf(base, noHead)
    expect((await viewRefsOf([...base, ref('refs/heads/run/gamma', 'g1')], noHead)).all).not.toBe(before.all)
    expect((await viewRefsOf(base.filter((r) => r.ref !== 'refs/heads/run/beta'), noHead)).all).not.toBe(before.all)
  })

  it('follows origin/HEAD to a default branch that is not main or master', async () => {
    const refs = [
      ref('refs/heads/trunk', 't1'),
      ref('refs/remotes/origin/HEAD', 't1', 'refs/remotes/origin/trunk'),
      ref('refs/remotes/origin/trunk', 't1'),
      ref('refs/heads/run/alpha', 'a1'),
    ]
    const before = await viewRefsOf(refs, noHead)
    const after = await viewRefsOf(refs.map((r) => (r.ref === 'refs/heads/trunk' ? { ...r, oid: 't2' } : r)), noHead)
    expect(runPrint(after, 'alpha')).not.toBe(runPrint(before, 'alpha'))
  })

  it('falls back to the branch HEAD names when nothing else says which is the default', async () => {
    const refs = [ref('refs/heads/develop', 'd1'), ref('refs/heads/run/alpha', 'a1')]
    const head = async () => 'develop'
    const before = await viewRefsOf(refs, head)
    const after = await viewRefsOf([ref('refs/heads/develop', 'd2'), refs[1]!], head)
    expect(runPrint(after, 'alpha')).not.toBe(runPrint(before, 'alpha'))
  })

  it('does not depend on the order git lists refs in', async () => {
    expect((await viewRefsOf(base.toReversed(), noHead)).all).toBe((await viewRefsOf(base, noHead)).all)
  })
})
