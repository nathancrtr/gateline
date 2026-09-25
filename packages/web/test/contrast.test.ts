// The contrast table, recomputed from the token file (packages/web/DESIGN.md
// publishes the same table; this is what keeps it honest).
//
// Every pair below is a real use in the app — text token on the surface it is
// set on, a mark against the surface it separates itself from — and every
// floor is WCAG's: 4.5 for text, 3.0 for large text and meaningful non-text.
// A token is read out of `src/styles.css` by name, so a value edited there
// without re-running the numbers fails here rather than in someone's eyes.
//
// Decorative rules (the hairlines) are listed but not floored: they separate
// rows, and nothing is read from them.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/styles.css', import.meta.url)), 'utf8')

/** `--color-<name>: #rrggbb;` inside the @theme block, by name. */
export function token(name: string): string {
  const m = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(css)
  if (!m) throw new Error(`no hex token --color-${name} in styles.css`)
  return m[1]!.toUpperCase()
}

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!
}

/** WCAG 2.x contrast ratio, to two decimals. */
export function contrast(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return Math.round(((Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)) * 100) / 100
}

/** Every text pair the app sets, with its floor. Surfaces: the white
 *  ground, the panel-grey inset, the raised hover/selection step, the
 *  state tints, and the fills that reverse type out of them. */
export const TEXT_PAIRS: [text: string, surface: string, floor: number][] = [
  ['ink', 'ground', 4.5],
  ['ink', 'inset', 4.5],
  ['ink', 'raised', 4.5],
  ['muted', 'ground', 4.5],
  ['muted', 'inset', 4.5],
  ['muted', 'raised', 4.5],
  ['faint', 'ground', 4.5],
  ['faint', 'inset', 4.5],
  ['faint', 'raised', 4.5],
  ['accent', 'ground', 4.5], // links, the active entry
  ['accent', 'inset', 4.5],
  ['accent', 'accent-tint', 4.5], // a link inside the selected entry
  ['accent-deep', 'accent-tint', 4.5], // the selected record entry's own text
  ['accent-hover', 'ground', 4.5],
  ['ok', 'ground', 4.5], // approved
  ['ok', 'inset', 4.5],
  ['ok', 'ok-bg', 4.5],
  ['info', 'info-bg', 4.5],
  ['warn', 'ground', 4.5], // the caution ink
  ['warn', 'inset', 4.5],
  ['warn', 'warn-bg', 4.5],
  ['bad', 'ground', 4.5], // declined
  ['bad', 'inset', 4.5],
  ['bad', 'bad-bg', 4.5],
  ['ink', 'focus', 4.5], // the position cell: ink on the yellow
  ['on-solid', 'ink', 4.5], // reversed type on a filled impression / the primary button
  ['on-solid', 'mark', 4.5], // reversed type on the danger button
]

/** Marks that carry meaning against the surface they sit on: 3.0. */
export const MARK_PAIRS: [mark: string, surface: string, floor: number][] = [
  ['mark', 'ground', 3.0], // the over-budget bar, an error border, the alert rule
  ['mark', 'inset', 3.0],
  ['line-cool', 'ground', 3.0], // form control borders
  ['ink', 'ground', 3.0], // impression borders, meters, the band
  ['accent', 'ground', 3.0], // the selected entry's rule
]

/** Listed for the table; not floored (see the header). */
export const DECORATIVE_PAIRS: [rule: string, surface: string][] = [
  ['line', 'ground'],
  ['line', 'inset'],
  ['focus', 'ground'], // the yellow is a fill with ink on it, never read against the page
]

describe('the contrast table', () => {
  it.each(TEXT_PAIRS)('%s on %s clears %s for text', (text, surface, floor) => {
    expect(contrast(token(text), token(surface))).toBeGreaterThanOrEqual(floor)
  })

  it.each(MARK_PAIRS)('%s against %s clears %s as a mark', (mark, surface, floor) => {
    expect(contrast(token(mark), token(surface))).toBeGreaterThanOrEqual(floor)
  })

  it('gives each state colour one job: ok, warn and bad are three different inks, and info is the accent', () => {
    expect(new Set([token('ok'), token('warn'), token('bad')]).size).toBe(3)
    expect(token('info')).toBe(token('accent'))
    expect(token('mark')).toBe(token('bad'))
  })

  it('keeps colour off the frame: every state box is bordered by the hairline', () => {
    for (const state of ['ok', 'info', 'pend', 'warn', 'bad']) expect(token(`${state}-line`)).toBe(token('line'))
  })

  it('is one surface: the ground and the surface tokens are the same page', () => {
    expect(token('surface')).toBe(token('ground'))
  })

  it('prints the table DESIGN.md publishes', () => {
    const rows = [
      ...TEXT_PAIRS.map(([a, b, f]) => `${a} on ${b}: ${contrast(token(a), token(b))} (floor ${f})`),
      ...MARK_PAIRS.map(([a, b, f]) => `${a} vs ${b}: ${contrast(token(a), token(b))} (floor ${f}, non-text)`),
      ...DECORATIVE_PAIRS.map(([a, b]) => `${a} vs ${b}: ${contrast(token(a), token(b))} (decorative)`),
    ]
    expect(rows.length).toBeGreaterThan(0)
    // eslint-disable-next-line no-console
    console.log(rows.join('\n'))
  })
})
