// The seam's DOM sweep (docs/SEAM.md §7 "Where the rule lives", #432).
//
// "A filename is never a label", and "an address never stands alone" (§2).
// The layering test (`web/test/seam.test.ts`) keeps web from *deriving* a kind
// from a path; this file keeps it from *printing* one. It is the third place
// the rule lives, and the one that catches the next ad hoc surface: a new
// component that renders `ref.path` in a caption passes every type check and
// every structural test, and only a sweep over what actually reached the page
// sees it.
//
// The rule, as asserted: over every demo fixture run, on every surface a
// reader meets, no run of text matches a filename (`plan.md`,
// `tasks/01.yaml`) or a run path (`runs/<slug>/`) unless it sits inside an
// Address (`[data-address]`, which `vocabulary.tsx`'s `Address` sets), or
// inside one of the exceptions — §10's "what stays exactly as it is", and the
// record's own words quoted — each listed below with its reason.
//
// Shape, after `geometry.spec.ts`: one browser context and one page for the
// whole file, every surface navigated fresh, each settled before it is read,
// and invariants rather than snapshots — nothing here records what a page
// says, only what it must never say outside an Address. Unlike the geometry
// sweep, the surfaces are enumerated from the fixture's own API rather than
// listed by hand: every run, every `?decide=` target its items name, every
// artifact its record lists. A fixture run added tomorrow is swept tomorrow.
// One width, 1440. The sweep reads the DOM's text, not what is painted, so an
// address shown only on hover, or a hover card that is `display: none` until
// it is wanted, is read the same as one on screen — a reader reaches both.
//
// The surfaces SEAM.md §9's later steps have not reached yet are a
// **shrinking allow-list** (`PENDING`). Each entry names the step that removes
// it (or, for a residue no step claims, the issue filed for it); an entry with
// no owner fails, and an entry that no longer matches any hit fails too — so
// the PR that fixes a surface must delete its entry, and the list can only
// get shorter.
import { type ChildProcess, spawn } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import { generateFixtureRepo } from '@gateline/fixtures'
import { type Browser, expect, type Page, test } from '@playwright/test'

// 4395–4399 are the other specs'; 4377 is the local dev server's.
const PORT = 4394
const ORIGIN = `http://127.0.0.1:${PORT}`
const WIDTH = 1440

/** What the rule looks for, as strings so they can cross into the page. */
const PATTERNS = {
  filename: String.raw`\b[\w.-]+\.(?:md|yaml|yml|json)\b`,
  'run-path': String.raw`runs/[\w-]+/`,
} as const
type PatternId = keyof typeof PATTERNS

/**
 * The exceptions: text that may carry a filename or a run path where it
 * stands. Two families. An Address, and the machine's word where it is the
 * fact, are the vocabulary's own (SEAM.md §5). The rest are §10's "what stays
 * exactly as it is", or the record's own words quoted verbatim (§2: the rule
 * governs the record's voice absolutely — a filename an agent wrote is the
 * record's, and the cockpit may not rephrase it).
 *
 * Each is a selector the hit's element is inside (`closest`), minus an
 * optional one it must not be inside: the lexicon's hover card is rendered
 * *within* quoted markdown but speaks in the cockpit's voice, so a quoted
 * passage does not excuse it. An exception that excuses nothing fails the
 * sweep — its selector has stopped finding the thing, or the thing is gone.
 */
const EXCEPTIONS: { within: string; notWithin?: string; reason: string; standing?: true }[] = [
  {
    within: '[data-address]',
    standing: true,
    reason: "An Address (vocabulary.tsx): the path in the code face, muted, after a name — where §2 says a path is printed.",
  },
  {
    within: '[data-diagnostic]',
    standing: true,
    reason: "A Diagnostic (vocabulary.tsx), §10: a parser's diagnostic with its caret — the machine's word where it is the fact.",
  },
  {
    within: '[data-reader] article > div > div:first-child > span.text-ink',
    reason:
      "§10: the reader header's `runs/<slug>/<path>` — the verification hook, beside the `?artifact=` URL. It follows the rail's name for the artifact; it is the Address the rail's label points at (§8.3).",
  },
  {
    within: '.prose-artifact, .prose-card',
    notWithin: '.lex-card, .lex-cited',
    reason:
      'The record\'s own words, quoted (§2, §5 Quoted passage): the artifact body in the Record reader, and a section, field or escalation quoted on a card. A filename the agent wrote is its word, byte-identical.',
  },
  {
    within: '[data-reader] [data-bytes]',
    reason:
      "§10: the file verbatim. A field view that is withheld — a fork whose work item writes its surface as a mapping (#434) — shows the bytes in its place, and the verbatim file shown because the view is withheld is the record's own bytes, like the artifact body above. Everywhere else it is behind \"show bytes\", so the sweep meets it only there.",
  },
  {
    within: '[data-ledger-actor="orchestrator"]',
    reason:
      "§10: the engine's verbs in the ledger — an engine row's words are its commit subject, verbatim (§5 Diagnostic: a commit subject is the machine's word where it is the fact). Step 10 (#430) linked the row to the view it names beside the subject; the subject stays as written.",
  },
]

/**
 * Who removes a pending entry: a SEAM.md §9 step, by number, with the issue
 * that carries it — or, for a residue no step claims, the follow-up issue
 * filed for it. Never neither: an entry with no owner is a debt nobody pays.
 */
type Owner = { step: 6 | 7 | 8 | 9 | 10; issue: number } | { step: null; issue: number }

interface Pending {
  /** The swept surface's label, matched as a regex (`round-cap · decide`). */
  surface: RegExp
  /** A selector the hit's element is inside. */
  within: string
  pattern: PatternId
  /** The offending text, when the selector covers more than this entry means to excuse. */
  text?: RegExp
  owner: Owner
  why: string
}

const OUTSIDE_STEPS = { step: null, issue: 435 } as const

/**
 * The residue: surfaces the epic's later steps have not reached yet, one
 * entry per (surface, pattern). The PR that fixes a surface deletes its
 * entry — the sweep fails on an entry that no longer matches anything — so
 * this list only gets shorter.
 *
 * What is *not* here, though the issue expected it, because the current
 * fixtures do not produce it: `pausedInstruction`'s `runs/<slug>/` (the
 * `paused-budget` fixture pauses for budget, whose instruction names no
 * path); the inbox row's escalation pointer (the `escalated` fixture is a
 * role escalation with a packet, not an engine one with a pointer); the G0
 * and staged cards (the G0 card's references are Addresses since step 3, and
 * no fixture is staged); and evidence.tsx's "verification-report.md states" and
 * the round-cap report chips, which step 3 already set as Addresses.
 */
const PENDING: Pending[] = [
  // Outside §9's steps (#435), found by this sweep.
  {
    surface: /./,
    within: '.lex-card-jump',
    pattern: 'filename',
    owner: OUTSIDE_STEPS,
    why: "The lexicon hover card's `spec.md:13 — jump to definition ↗` is an address set as a link label, and it spends ↗, which is Link-out's. It follows a Name, so the fix is an Address with a UI word.",
  },
  {
    surface: / · record · /,
    within: '.lex-cited',
    pattern: 'filename',
    owner: OUTSIDE_STEPS,
    why: 'The reader\'s "Cites …" strip links `spec.md:8` after each id: an address after a Name, as §2 wants it, but not rendered through Address.',
  },
  {
    surface: /^g1-pending · decide · G1$/,
    within: '[data-g1-coverage]',
    pattern: 'filename',
    text: /^plan\.md$/,
    owner: OUTSIDE_STEPS,
    why: "The G1 Coverage hint cites `contracts/plan.md` by filename. Step 5 named contracts by kind on the badge and the failure notice, but missed this hint.",
  },
  {
    surface: /^bad-state · /,
    within: '[data-spine-unknown]',
    pattern: 'filename',
    owner: OUTSIDE_STEPS,
    why: 'The run header on an unreadable record says `sequence unknown — state.yaml unreadable`: a filename in the cockpit\'s own copy, where the kind belongs.',
  },
  {
    surface: /^portfolio$/,
    within: 'tbody',
    pattern: 'filename',
    text: /^state\.yaml$/,
    owner: OUTSIDE_STEPS,
    why: "bad-state's portfolio row prints the YAML parser's message as a row line, not as a Diagnostic with its producer.",
  },
]

interface Surface {
  label: string
  path: string
  /** Rendered signal: nothing is read before this is visible. */
  ready: string
  /** Opens what a reader can open in place, so folded rows are swept too. */
  expand?: (p: Page) => Promise<void>
}

interface Hit {
  surface: string
  path: string
  pattern: PatternId
  /** The matched text. */
  match: string
  /** The whole run of text it was found in, trimmed, for context. */
  context: string
  /** The element holding the text, and its nearest ancestors with a data hook. */
  element: string
  /** Indices into EXCEPTIONS the hit's element is inside. */
  exceptions: number[]
  /** Indices into PENDING whose selector the hit's element is inside. */
  pendingWithin: number[]
}

let fixtureDir: string
let server: ChildProcess
let page: Page
const surfaces: Surface[] = []
const hits: Hit[] = []

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  test.setTimeout(600_000)
  fixtureDir = generateFixtureRepo().dir
  server = spawn('node', ['server/src/main.ts', '--repo', fixtureDir, '--port', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname,
    stdio: 'ignore',
  })
  let up = false
  for (let i = 0; i < 60 && !up; i++) {
    try {
      up = (await fetch(`${ORIGIN}/api/health`)).ok
    } catch {
      /* not up yet */
    }
    if (!up) await new Promise((r) => setTimeout(r, 500))
  }
  if (!up) throw new Error('server did not come up')

  surfaces.push(...(await enumerate()))
  page = await browser.newPage({ viewport: { width: WIDTH, height: 900 } })
  for (const s of surfaces) {
    await page.goto(ORIGIN + s.path)
    await expect(page.locator(s.ready).first(), `${s.label}: never rendered ${s.ready}`).toBeVisible()
    await settle(page)
    if (s.expand) {
      await s.expand(page)
      await settle(page)
    }
    for (const h of await scan(page)) hits.push({ surface: s.label, path: s.path, ...h })
  }
})

test.afterAll(async () => {
  // Triage aid for the PR that changes a surface: `SEAM_DUMP=<file>` writes
  // every hit — exempt, pending and breaching — with its element and context.
  if (process.env.SEAM_DUMP) writeFileSync(process.env.SEAM_DUMP, JSON.stringify({ surfaces, hits }, null, 1))
  await page?.close()
  server?.kill()
  if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true })
})

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(ORIGIN + path)
  if (!res.ok) throw new Error(`${path}: ${res.status}`)
  return (await res.json()) as T
}

interface WireItem {
  kind: string
  gate: string | null
  escalationIndex: number | null
}

/** The `?decide=` value an item is reached by — `inbox.tsx`'s `itemHref`, restated. */
function decideTarget(item: WireItem): string | null {
  if (item.kind === 'gate' && item.gate) return item.gate
  if (item.kind === 'escalation' && item.escalationIndex !== null) return `esc-${item.escalationIndex}`
  if (item.kind === 'paused') return 'paused'
  if (item.kind === 'staged') return 'staged'
  return null
}

/** Every surface of every fixture run, read off the API rather than listed by hand. */
async function enumerate(): Promise<Surface[]> {
  const out: Surface[] = [
    { label: 'inbox', path: '/', ready: '[data-inbox-row]' },
    { label: 'portfolio', path: '/portfolio', ready: 'table' },
  ]
  const { runs } = await getJson<{ runs: { source: string; slug: string }[] }>('/api/runs')
  for (const { source, slug } of runs) {
    const base = `/runs/${source}/${slug}`
    const detail = await getJson<{ items: WireItem[]; artifactRefs: { path: string }[] }>(`/api/runs/${source}/${slug}`)
    // Every `?decide=` target the run's items name — and the bare decide
    // surface for a run whose items have none (a round cap, a malformed
    // state), whose cards render there all the same.
    const targets = [...new Set(detail.items.map(decideTarget).filter((t): t is string => t !== null))]
    for (const t of targets) out.push({ label: `${slug} · decide · ${t}`, path: `${base}?decide=${encodeURIComponent(t)}`, ready: '[data-needs-card]' })
    if (targets.length === 0 && detail.items.length > 0) out.push({ label: `${slug} · decide`, path: `${base}?tab=decide`, ready: '[data-needs-card]' })
    for (const { path } of detail.artifactRefs) {
      out.push({ label: `${slug} · record · ${path}`, path: `${base}?tab=record&artifact=${encodeURIComponent(path)}`, ready: 'article' })
    }
    // History with every engine span opened: a folded row is still a row the
    // reader can open, and its words must hold to the rule when they do. Raw
    // mode ("show raw commits") is never pressed — it is §10's "bytes on
    // demand", exempt by construction rather than by selector.
    out.push({ label: `${slug} · history`, path: `${base}?tab=history`, ready: 'main', expand: openSpans })
  }
  return out
}

async function openSpans(p: Page) {
  for (const button of await p.locator('[data-ledger-span]:not([data-ledger-span-open]) button').all()) await button.click()
}

/** Wait until the page stops changing shape — `geometry.spec.ts`'s settle, for the same reason. */
async function settle(p: Page) {
  await p.evaluate(async () => {
    const frame = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
    await document.fonts?.ready
    let previous = ''
    for (let i = 0; i < 60; i++) {
      await frame()
      const loading = document.querySelectorAll('.skel').length
      const shape = `${loading}/${document.getElementsByTagName('*').length}/${document.body.innerText.length}`
      if (loading === 0 && shape === previous) return
      previous = shape
      await new Promise((r) => setTimeout(r, 50))
    }
    throw new Error(`page never settled (loading/elements/text = ${previous})`)
  })
}

/**
 * Every run of text on the page matching a pattern, with where it sits.
 *
 * A run, not a node: React renders `runs/{slug}/{path}` as five adjacent text
 * nodes, and a sweep that read them one at a time would never see a run path
 * whole. Adjacent text siblings are joined before matching; an element
 * between them ends the run, as it ends the reader's line of sight.
 */
async function scan(p: Page): Promise<Omit<Hit, 'surface' | 'path'>[]> {
  return await p.evaluate(
    ({ patterns, exceptions, pending }) => {
      const describe = (el: Element) => {
        const hooks = (e: Element) =>
          [...e.attributes]
            .filter((a) => a.name.startsWith('data-') && a.name !== 'data-discover')
            .map((a) => (a.value && a.value !== 'true' ? `${a.name}="${a.value.slice(0, 40)}"` : a.name))
            .join(' ')
        const cls = typeof el.className === 'string' && el.className ? `.${el.className.split(/\s+/).slice(0, 3).join('.')}` : ''
        const own = `<${el.tagName.toLowerCase()}${cls}${hooks(el) ? ` ${hooks(el)}` : ''}>`
        const trail: string[] = []
        for (let a = el.parentElement; a && a !== document.body && trail.length < 3; a = a.parentElement) {
          const h = hooks(a)
          if (h) trail.push(`[${h}]`)
        }
        return trail.length ? `${own} in ${trail.join(' in ')}` : own
      }
      const inside = (el: Element, within: string, notWithin?: string) =>
        el.closest(within) !== null && (!notWithin || el.closest(notWithin) === null)

      const out: Omit<Hit, 'surface' | 'path'>[] = []
      const read = (el: Element, text: string) => {
        for (const [id, source] of Object.entries(patterns)) {
          for (const m of text.matchAll(new RegExp(source, 'g'))) {
            out.push({
              pattern: id as PatternId,
              match: m[0],
              context: text.trim().replace(/\s+/g, ' ').slice(0, 160),
              element: describe(el),
              exceptions: exceptions.map((e, i) => (inside(el, e.within, e.notWithin) ? i : -1)).filter((i) => i >= 0),
              pendingWithin: pending.map((sel, i) => (el.closest(sel) ? i : -1)).filter((i) => i >= 0),
            })
          }
        }
      }
      for (const el of document.body.querySelectorAll('*')) {
        if (el.closest('script, style, noscript, template')) continue
        let run = ''
        for (const child of el.childNodes) {
          if (child.nodeType === Node.TEXT_NODE) run += child.textContent ?? ''
          else if (child.nodeType === Node.ELEMENT_NODE) {
            if (run) read(el, run)
            run = ''
          }
        }
        if (run) read(el, run)
      }
      return out
    },
    { patterns: PATTERNS, exceptions: EXCEPTIONS.map(({ within, notWithin }) => ({ within, notWithin })), pending: PENDING.map((e) => e.within) },
  )
}

/** The PENDING entries that own a hit. */
function ownersOf(h: Hit): number[] {
  return h.pendingWithin.filter((i) => {
    const e = PENDING[i]!
    return e.pattern === h.pattern && e.surface.test(h.surface) && (!e.text || e.text.test(h.match))
  })
}

const exempt = (h: Hit) => h.exceptions.length > 0
const render = (h: Hit) => `${h.surface}  (${h.path})\n    ${h.pattern} "${h.match}" in ${h.element}\n    text: "${h.context}"`

test('the sweep reached every surface, and its exceptions are live', () => {
  // Non-vacuity: a sweep that navigated nowhere finds nothing. The fixture
  // carries 15 runs, 13 of them with something to decide, each with a
  // history and several artifacts.
  expect(surfaces.filter((s) => s.label.includes(' · record · ')).length).toBeGreaterThan(40)
  expect(surfaces.filter((s) => s.label.includes(' · decide')).length).toBeGreaterThan(10)
  expect(surfaces.filter((s) => s.label.endsWith(' · history')).length).toBeGreaterThan(10)
  // And the exceptions are live: the reader header's address is on every
  // record surface, so a sweep that stopped seeing text would stop seeing it.
  expect(hits.filter(exempt).length).toBeGreaterThan(40)
})

test('no filename or run path is printed outside an Address', () => {
  const breaches = hits.filter((h) => !exempt(h) && ownersOf(h).length === 0)
  const total = hits.filter((h) => !exempt(h)).length
  test.info().annotations.push({
    type: 'seam',
    description: `${hits.length} hits over ${surfaces.length} surfaces: ${hits.length - total} exempt, ${total - breaches.length} pending, ${breaches.length} unowned`,
  })
  expect(
    breaches.map(render),
    `${breaches.length} of ${total} non-exempt hits are unowned — a filename or run path printed outside an Address (docs/SEAM.md §2). Wrap it in <Address> after a name, or, if a later #411 step removes it, add a PENDING entry naming that step and its issue:\n\n${breaches.map(render).join('\n\n')}`,
  ).toEqual([])
})

test('every pending entry has an owner, and still matches something', () => {
  const ownerless = PENDING.filter((e) => !Number.isInteger(e.owner?.issue) || (e.owner.step !== null && ![6, 7, 8, 9, 10].includes(e.owner.step)))
  expect(
    ownerless.map((e) => `${e.surface} ${e.within}`),
    'a PENDING entry names a #411 step (6–10) and its issue, or the issue filed for it — an entry with neither is a debt with nobody on it',
  ).toEqual([])
  const owned = new Set(hits.filter((h) => !exempt(h)).flatMap(ownersOf))
  const stale = PENDING.filter((_, i) => !owned.has(i)).map(
    (e) => `${e.owner.step === null ? '' : `step ${e.owner.step} `}#${e.owner.issue}: ${e.surface} ${e.within} (${e.pattern}) — ${e.why}`,
  )
  expect(stale, `PENDING entries that match no hit — the surface is fixed; delete the entry:\n${stale.join('\n')}`).toEqual([])
})

test('every exception still excuses something', () => {
  // A selector that finds nothing excuses nothing, and would go on excusing
  // nothing after the surface it named moved — at which point it is either
  // dead or, worse, about to excuse something new. The vocabulary's own two
  // (Address, Diagnostic) stand regardless.
  const used = new Set(hits.flatMap((h) => h.exceptions))
  const idle = EXCEPTIONS.filter((e, i) => !e.standing && !used.has(i)).map((e) => `${e.within} — ${e.reason}`)
  expect(idle, `exceptions that excuse no hit:\n${idle.join('\n')}`).toEqual([])
})
