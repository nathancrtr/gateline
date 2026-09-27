// #461: the portfolio cost 135 git processes for 20 runs. Names are now
// resolved by one long-lived reader, the default branch's name is asked
// once per request, and runs are summarized several at a time. None of that
// may change an answer.
import { execFileSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildPortfolio, Git, mapBounded, summarizeRun } from '../src/index.ts'
import { dropFixture, type FixtureContext, makeFixture } from './fixture.helper.ts'

let fx: FixtureContext

const git = (args: string[]): string | null => {
  try {
    return execFileSync('git', ['-C', fx.repo.dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null
  } catch {
    return null
  }
}

beforeAll(async () => {
  fx = await makeFixture()
})

afterAll(async () => {
  await dropFixture(fx)
})

describe('resolving names through the reader', () => {
  it('revParse answers what `git rev-parse` answers', async () => {
    const reader = new Git(fx.repo.dir)
    const branch = fx.repo.runs.find((r) => r.branch !== null)!.branch!
    const tip = git(['rev-parse', 'main'])!
    for (const rev of ['main', branch, `refs/heads/${branch}`, 'HEAD', tip, tip.slice(0, 12), 'main~1', 'no-such-branch', 'refs/remotes/origin/main']) {
      expect(await reader.revParse(rev), rev).toBe(git(['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]))
    }
  })

  it('revParse answers null for a name that is not a commit', async () => {
    const reader = new Git(fx.repo.dir)
    const blob = git(['rev-parse', 'main:README.md'])!
    expect(await reader.revParse(blob)).toBeNull()
  })

  it('objectId answers what `git rev-parse` answers, for files, directories and nothing', async () => {
    const reader = new Git(fx.repo.dir)
    for (const path of ['README.md', 'runs', 'contracts', 'runs/no-such-run', 'no such file.md']) {
      expect(await reader.objectId('main', path), path).toBe(git(['rev-parse', '--verify', '--quiet', `main:${path}`]))
    }
  })

  it('keeps answers matched to their questions when many are asked at once', async () => {
    const reader = new Git(fx.repo.dir)
    const paths = ['README.md', 'absent-1', 'runs', 'absent-2', 'contracts', 'README.md', 'absent-3', 'runs']
    const answers = await Promise.all(paths.map((p) => reader.objectId('main', p)))
    expect(answers).toEqual(paths.map((p) => git(['rev-parse', '--verify', '--quiet', `main:${p}`])))
  })

  it('never lets a line break in a name become a second question', async () => {
    const reader = new Git(fx.repo.dir)
    const [injected, after] = await Promise.all([reader.objectId('main', 'absent\nmain:contracts'), reader.objectId('main', 'README.md')])
    expect(injected).toBeNull()
    expect(after).toBe(git(['rev-parse', 'main:README.md']))
  })

  it('answers null, as before, where there is no repository', async () => {
    expect(await new Git('/nonexistent/gateline-no-repo').revParse('main')).toBeNull()
  })
})

describe('the default branch name', () => {
  it('is asked once across a listing and the template reads that follow', async () => {
    // The framework roots ask once for the life of the source; have that
    // behind us, and any earlier answer aged out, before counting.
    await fx.source.frameworkRoots()
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 60_000 })
    const asked = vi.spyOn(fx.source.git, 'defaultBranch')
    try {
      await fx.source.listRuns()
      await Promise.all(['spec.md', 'plan.md', 'work-item.yaml'].map((name) => fx.source.templates.read(name)))
      expect(asked).toHaveBeenCalledTimes(1)
    } finally {
      asked.mockRestore()
      vi.useRealTimers()
    }
  })

  it('is asked again once the answer has aged', async () => {
    await fx.source.listRuns()
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 120_000 })
    const asked = vi.spyOn(fx.source.git, 'defaultBranch')
    try {
      await fx.source.listRuns()
      expect(asked).toHaveBeenCalledTimes(1)
    } finally {
      asked.mockRestore()
      vi.useRealTimers()
    }
  })
})

describe('mapBounded', () => {
  const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 5))

  it('returns results in the order of the items, whichever finishes first', async () => {
    const out = await mapBounded([30, 1, 20, 2], 4, async (ms) => {
      await new Promise((resolve) => setTimeout(resolve, ms))
      return ms * 2
    })
    expect(out).toEqual([60, 2, 40, 4])
  })

  it('never runs more than the limit at once, and does run that many', async () => {
    let running = 0
    let peak = 0
    await mapBounded(Array.from({ length: 20 }, (_, i) => i), 3, async () => {
      peak = Math.max(peak, ++running)
      await tick()
      running--
    })
    expect(peak).toBe(3)
  })

  it('handles no items, and fewer items than the limit', async () => {
    expect(await mapBounded([], 8, async (x: number) => x)).toEqual([])
    expect(await mapBounded([1, 2], 8, async (x) => x + 1)).toEqual([2, 3])
  })

  it('rejects when any item fails', async () => {
    await expect(
      mapBounded([1, 2, 3], 2, async (x) => {
        if (x === 2) throw new Error('run 2 is unreadable')
        return x
      }),
    ).rejects.toThrow('run 2 is unreadable')
  })
})

describe('buildPortfolio', () => {
  it('gives the rows a one-at-a-time walk gives, in the same order', async () => {
    const together = await buildPortfolio([fx.source])
    const runs = []
    const inbox = []
    for (const ref of await fx.source.listRuns()) {
      const { summary, items } = await summarizeRun(fx.source, ref)
      runs.push(summary)
      inbox.push(...items)
    }
    inbox.sort((a, b) => (a.since ?? Infinity) - (b.since ?? Infinity))
    runs.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    expect(together.runs.map((r) => r.slug)).toEqual(runs.map((r) => r.slug))
    expect(together.inbox.map((i) => `${i.slug} ${i.kind} ${i.gate}`)).toEqual(inbox.map((i) => `${i.slug} ${i.kind} ${i.gate}`))
    expect(together.runs.length).toBeGreaterThan(8)
  })

  it('summarizes several runs at a time', async () => {
    let running = 0
    let peak = 0
    await buildPortfolio([fx.source], {
      summarize: async (source, ref) => {
        peak = Math.max(peak, ++running)
        try {
          return await summarizeRun(source, ref)
        } finally {
          running--
        }
      },
    })
    expect(peak).toBe(8)
  })
})
