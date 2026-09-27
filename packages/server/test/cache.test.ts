// #461: a view is kept for as long as the refs it was derived from stay put.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ViewCache } from '../src/cache.ts'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

const counter = () => {
  let n = 0
  return vi.fn(async () => ++n)
}

describe('ViewCache', () => {
  it('keeps a value while its print is unchanged, however long that is', async () => {
    const cache = new ViewCache(30_000)
    const compute = counter()
    expect(await cache.get('k', 'p1', compute)).toBe(1)
    vi.advanceTimersByTime(24 * 60 * 60 * 1000)
    expect(await cache.get('k', 'p1', compute)).toBe(1)
    expect(compute).toHaveBeenCalledTimes(1)
  })

  it('recomputes when the print changes', async () => {
    const cache = new ViewCache(30_000)
    const compute = counter()
    await cache.get('k', 'p1', compute)
    expect(await cache.get('k', 'p2', compute)).toBe(2)
    expect(await cache.get('k', 'p2', compute)).toBe(2)
    expect(compute).toHaveBeenCalledTimes(2)
  })

  it('keeps entries under different keys apart', async () => {
    const cache = new ViewCache(30_000)
    const a = counter()
    const b = counter()
    await cache.get('a', 'p1', a)
    await cache.get('b', 'p1', b)
    await cache.get('a', 'p2', a)
    await cache.get('b', 'p1', b)
    expect(a).toHaveBeenCalledTimes(2)
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('expires a value that says it reads the clock, and only that one', async () => {
    const cache = new ViewCache(30_000)
    const clocked = counter()
    const pure = counter()
    await cache.get('clocked', 'p1', clocked, { expires: () => true })
    await cache.get('pure', 'p1', pure, { expires: () => false })
    vi.advanceTimersByTime(29_000)
    await cache.get('clocked', 'p1', clocked, { expires: () => true })
    expect(clocked).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(2_000)
    await cache.get('clocked', 'p1', clocked, { expires: () => true })
    await cache.get('pure', 'p1', pure, { expires: () => false })
    expect(clocked).toHaveBeenCalledTimes(2)
    expect(pure).toHaveBeenCalledTimes(1)
  })

  it('expires every value of a source that cannot name its refs', async () => {
    const cache = new ViewCache(30_000)
    const compute = counter()
    await cache.get('k', null, compute)
    vi.advanceTimersByTime(31_000)
    await cache.get('k', null, compute)
    expect(compute).toHaveBeenCalledTimes(2)
  })

  it('shares one computation between callers that arrive while it runs', async () => {
    const cache = new ViewCache(30_000)
    const compute = counter()
    const [a, b] = await Promise.all([cache.get('k', 'p1', compute), cache.get('k', 'p1', compute)])
    expect([a, b]).toEqual([1, 1])
    expect(compute).toHaveBeenCalledTimes(1)
  })

  it('does not keep a failure', async () => {
    const cache = new ViewCache(30_000)
    let fail = true
    const compute = vi.fn(async () => {
      if (fail) throw new Error('git fell over')
      return 'ok'
    })
    await expect(cache.get('k', 'p1', compute)).rejects.toThrow('git fell over')
    fail = false
    expect(await cache.get('k', 'p1', compute)).toBe('ok')
  })
})
