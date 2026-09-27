// The contrast table, recomputed from the token file (packages/web/DESIGN.md
// publishes the same table; this is what keeps it honest).
//
// The last block reads DESIGN.md itself. Its Contrast table must list exactly
// the pairs below, each with the ratio and floor computed here, and each colour
// its Tokens table states must be the value in `src/styles.css`. Without that,
// the published table could drift from the CSS while every floor still held.
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
const design = readFileSync(fileURLToPath(new URL('../DESIGN.md', import.meta.url)), 'utf8')

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
  ['accent', 'ground', 4.5], // links, the active entry, a ready gate's chip
  ['accent', 'inset', 4.5],
  ['accent', 'accent-tint', 4.5], // a link inside the selected entry; a ready gate's chip on the selected row
  ['accent-deep', 'accent-tint', 4.5], // the selected record entry's own text
  ['accent-hover', 'ground', 4.5],
  ['ok', 'ground', 4.5], // approved
  ['ok', 'inset', 4.5],
  ['ok', 'ok-bg', 4.5],
  ['info', 'info-bg', 4.5],
  ['warn', 'ground', 4.5], // the caution ink
  ['warn', 'inset', 4.5],
  ['warn', 'accent-tint', 4.5], // a stuck item's chip on the selected inbox row
  ['warn', 'warn-bg', 4.5],
  ['bad', 'ground', 4.5], // declined
  ['bad', 'inset', 4.5],
  ['bad', 'accent-tint', 4.5], // a malformed record's chip on the selected inbox row
  ['bad', 'bad-bg', 4.5],
  ['ink', 'focus', 4.5], // the position cell: ink on the yellow
  ['on-solid', 'ink', 4.5], // reversed type on a filled impression / the primary button
  ['on-solid', 'mark', 4.5], // reversed type on the danger button
  ['on-solid', 'ok', 4.5], // reversed type on an approved gate (settled decision 8)
]

/** Marks that carry meaning against the surface they sit on: 3.0. */
export const MARK_PAIRS: [mark: string, surface: string, floor: number][] = [
  ['mark', 'ground', 3.0], // the over-budget bar, an error border, the alert rule
  ['mark', 'inset', 3.0],
  ['line-cool', 'ground', 3.0], // form control borders
  ['ink', 'ground', 3.0], // impression borders, meters, the band
  ['accent', 'ground', 3.0], // the selected entry's rule, a ready gate's border
  ['accent', 'accent-tint', 3.0], // a ready gate's border on the selected inbox row
  ['warn', 'ground', 3.0], // a stuck item's border
  ['warn', 'accent-tint', 3.0],
  ['mark', 'accent-tint', 3.0], // a malformed record's hatch on the selected row
  ['ok', 'ground', 3.0], // an approved gate's fill against the page
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

/** The table rows (header and separator dropped) of DESIGN.md's `## <heading>` section. */
function tableRows(heading: string): string[][] {
  const start = design.indexOf(`\n## ${heading}\n`)
  if (start < 0) throw new Error(`no "## ${heading}" section in DESIGN.md`)
  const end = design.indexOf('\n## ', start + 1)
  const body = design.slice(start, end < 0 ? undefined : end)
  const rows = body
    .split('\n')
    .filter((l) => l.startsWith('|'))
    .map((l) =>
      l
        .slice(1, -1)
        .split('|')
        .map((c) => c.trim()),
    )
  return rows.slice(2)
}

/** A colour as `r,g,b,a`, from `#rrggbb` or `rgba(r, g, b, a)`; null for anything else. */
function colour(value: string): string | null {
  const hex = /^#([0-9a-f]{6})$/i.exec(value)
  if (hex) return [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16)).concat(1).join(',')
  const rgba = /^rgba\(([^)]*)\)$/.exec(value)
  if (rgba) return rgba[1]!.split(',').map((n) => Number(n.trim())).join(',')
  return null
}

/** Every `--color-*` token in styles.css whose name matches `pattern` (`*` is a wildcard), with its raw value. */
function cssColours(pattern: string): [name: string, value: string][] {
  const re = new RegExp(`^${pattern.replace(/[-]/g, '\\-').replace('*', '[a-z-]+')}$`)
  return [...css.matchAll(/(--color-[a-z-]+):\s*([^;]+);/g)].filter((m) => re.test(m[1]!)).map((m) => [m[1]!, m[2]!.trim()])
}

describe("DESIGN.md's tables agree with styles.css", () => {
  const published = tableRows('Contrast').map(([pair, ratio, floor]) => {
    const m = /^(\S+) (on|vs) (\S+)(?: \((non-text|decorative)\))?$/.exec(pair!)
    if (!m) throw new Error(`DESIGN.md contrast row not understood: "${pair}"`)
    return { a: m[1]!, b: m[3]!, kind: m[4] ?? 'text', ratio: ratio!, floor: floor! }
  })
  const computed = [
    ...TEXT_PAIRS.map(([a, b, f]) => ({ a, b, kind: 'text', floor: f.toFixed(1) })),
    ...MARK_PAIRS.map(([a, b, f]) => ({ a, b, kind: 'non-text', floor: f.toFixed(1) })),
    ...DECORATIVE_PAIRS.map(([a, b]) => ({ a, b, kind: 'decorative', floor: '—' })),
  ]
  const key = (r: { a: string; b: string; kind: string }) => `${r.a} ${r.kind === 'text' ? 'on' : 'vs'} ${r.b} (${r.kind})`

  it('lists every pair this file checks, and no other', () => {
    expect(published.map(key)).toEqual(computed.map(key))
  })

  it.each(computed.map((r) => [key(r), r] as const))('publishes the computed ratio and floor for %s', (k, r) => {
    const row = published.find((p) => key(p) === k)
    expect(row, `no row for ${k} in DESIGN.md`).toBeDefined()
    // The table rounds to two decimals and drops trailing zeros, as `contrast` does.
    const ratio = contrast(token(r.a), token(r.b))
    expect(Number(row!.ratio), `DESIGN.md says ${row!.ratio}, styles.css computes ${ratio}`).toBe(ratio)
    expect(row!.floor, `DESIGN.md's floor for ${k}`).toBe(r.floor)
  })

  it('states each token colour as styles.css sets it', () => {
    let checked = 0
    for (const [cell, value] of tableRows('Tokens')) {
      const name = /^`(--color-[a-z*-]+)`$/.exec(cell!)?.[1]
      const stated = colour(/^`(.*)`$/.exec(value!)?.[1] ?? '')
      if (!name || !stated) continue // a prose value, or a token that is not a colour
      const matches = cssColours(name)
      expect(matches.length, `${name} is in DESIGN.md but not in styles.css`).toBeGreaterThan(0)
      for (const [cssName, cssValue] of matches) {
        expect(colour(cssValue), `${cssName}: DESIGN.md says ${value}, styles.css says ${cssValue}`).toBe(stated)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(25)
  })
})
