/**
 * One money formatter (#447). Before `money.ts`, a dollar figure was
 * formatted three ways in three places: the header meter rounded whole
 * dollars but kept cents on a fraction, `usd()` in `inbox.tsx` always kept
 * two decimals, and `metrics.tsx`/`decide.tsx` printed the raw number
 * (`$18.5`). Same ceiling, three spellings depending which component drew
 * it.
 *
 * This file holds two things: the formatter's own behaviour, and a guard
 * that a money site cannot format a dollar figure on its own. The guard is
 * a source scan, not an AST walk (contrast `seam.test.ts`, which needs the
 * AST because path-shaped string literals are common and innocent) — a
 * literal `$` glued to an interpolation, or a `.toFixed(2)` call, is rare
 * enough outside `money.ts` that a plain substring/regex search stays
 * precise. It does not (and cannot, cheaply) catch a raw number handed to
 * plain JSX text with no template literal at all — the two sites in
 * `components/decide.tsx` fixed alongside this module were that shape, and
 * nothing short of a full parse (like `seam.test.ts`'s) would have caught
 * them mechanically; this guard's job is to stop the patterns above from
 * coming back, not to prove every past bug was structurally unrepeatable.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { usd } from '../src/money.ts'

describe('usd', () => {
  it('renders a whole dollar amount whole', () => {
    expect(usd(10)).toBe('$10')
    expect(usd(0)).toBe('$0')
  })

  it('keeps two decimals on a fractional amount', () => {
    expect(usd(18.5)).toBe('$18.50')
    expect(usd(10.4)).toBe('$10.40')
    expect(usd(0.37)).toBe('$0.37')
  })

  it('never needs more than two decimals: it rounds rather than truncates', () => {
    expect(usd(0.375)).toBe('$0.38')
    // Rounds to the cent first, so a fraction of a cent that rounds down to
    // nothing is a whole $0, not a "$0.00" that implies a cent was tracked.
    expect(usd(0.001)).toBe('$0')
  })

  it('rounds to the cent before asking whether the amount is whole, so a float sum reads the same as its exact value', () => {
    // 6.4 + 3.6 lands on 10.000000000000002, not 10 — checking Number.isInteger
    // against the raw float printed "$10.00" beside a limit that printed "$10",
    // the exact mismatch this module exists to remove.
    expect(usd(6.4 + 3.6)).toBe('$10')
    expect(usd(10.000000000000002)).toBe('$10')
    expect(usd(9.999)).toBe('$10')
    expect(usd(0.005)).toBe('$0.01') // Math.round(0.5) rounds half up
  })

  it('handles zero and negative amounts sanely', () => {
    expect(usd(0)).toBe('$0')
    expect(usd(-0)).toBe('$0')
    expect(usd(-10)).toBe('$-10')
    expect(usd(-10.4)).toBe('$-10.40')
  })

  it('exact keeps two decimals even on a whole number', () => {
    expect(usd(0, { exact: true })).toBe('$0.00')
    expect(usd(18.5, { exact: true })).toBe('$18.50')
    expect(usd(10, { exact: true })).toBe('$10.00')
  })
})

const SRC = resolve(import.meta.dirname, '../src')

/** Every `.ts`/`.tsx` source file under `web/src`, `money.ts` itself excluded. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) sourceFiles(p, out)
    else if (/\.tsx?$/.test(entry.name) && relative(SRC, p) !== 'money.ts') out.push(p)
  }
  return out
}

/** A money site formatting on its own: a literal `$` glued to a template
 *  interpolation (`` `$${n}` ``), or a `.toFixed(2)` call — the two decimal
 *  places a dollar amount takes and a duration or other measurement does
 *  not (the one legitimate `.toFixed(` in this tree, a duration in
 *  `metrics.tsx`, uses one decimal place, not two). */
const MONEY_SMELLS: { name: string; pattern: RegExp }[] = [
  { name: 'a literal $ glued to a template interpolation ($${…})', pattern: /\$\$\{/ },
  { name: 'a .toFixed(2) call', pattern: /\.toFixed\(2\)/ },
  { name: "string concatenation with a literal '$'", pattern: /'\$'\s*\+|"\$"\s*\+/ },
]

describe('every money site uses money.ts (#447)', () => {
  it('has no site formatting a dollar amount on its own', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(SRC)) {
      const text = readFileSync(file, 'utf8')
      for (const smell of MONEY_SMELLS) {
        if (smell.pattern.test(text)) offenders.push(`${relative(SRC, file)}: ${smell.name}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
