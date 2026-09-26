/// <reference types="vite/client" />
// The vocabulary of representations (#414, epic #411): the eleven kinds of
// thing the cockpit renders, one component each.
//
// docs/SEAM.md §5 is the table this module implements, row by row: each
// component carries its kind's signal (face, weight, colour, position) and
// encodes its "must never" as a type where one can hold it, as a dev-time
// invariant where the check is cheap, and as a comment otherwise. §2 names the
// four voices the kinds are spoken in (the record's, the framework's, the
// machine's, the cockpit's); §4 the four classes of record element; §7 the
// layering rule this module is the web half of — the web layer renders only
// its own voice directly, and everything else through these components. The
// tokens spent here are the ones `packages/web/DESIGN.md` records.
//
// Step 1 of the epic is consolidation with no visible change, so where the
// table's signal and today's pixels disagree the pixels win, and the
// component says so beside the prop that keeps them. The colour pass after
// this step settles those; later steps (numbered as in SEAM.md §9) retire the
// transitional arms marked here.
//
// `className` on these components is for position only — margin, flex
// placement, the surface's type scale — never for face, weight or colour.
// Those are what the component is for.

import type { MouseEventHandler, ReactNode } from 'react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { WithheldReason } from '../api.ts'
import { CitedText } from './lexicon.tsx'

/** `data-*` hooks pass through untouched: tests and e2e find surfaces by them. */
type DataAttrs = { [k: `data-${string}`]: string | number | boolean | undefined }

function dataAttrs(props: object): DataAttrs {
  const out: DataAttrs = {}
  for (const [k, v] of Object.entries(props)) if (k.startsWith('data-')) out[k as `data-${string}`] = v as DataAttrs[`data-${string}`]
  return out
}

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ')

/**
 * The code face's three sizes, as the packets already spend them: 10.5px in a
 * row's metadata, 11px on a line of its own, 11.5px leading a row.
 */
export type CodeSize = 'xs' | 'sm' | 'md'
const CODE_SIZE: Record<CodeSize, string> = { xs: 'text-[10.5px]', sm: 'text-[11px]', md: 'text-[11.5px]' }

/**
 * A dev-time invariant. It throws under Vite's dev server and in the test
 * suite, and compiles away in the production bundle — a violation is a bug in
 * the caller, and the reader of a built cockpit should never pay for it.
 */
function invariant(ok: boolean, message: string): void {
  if (!ok && import.meta.env.DEV) throw new Error(`vocabulary: ${message}`)
}

/**
 * The one link into the Record reader. Five packet modules each carried their
 * own copy of this template; they now share it.
 */
export const artifactHref = (src: string, slug: string, path: string, anchor?: string) =>
  `/runs/${src}/${slug}?tab=record&artifact=${encodeURIComponent(path)}${anchor ? `&anchor=${anchor}` : ''}`

// ---------------------------------------------------------------------------
// Address — the machine's voice (SEAM.md §4 Address, §5 row 1).

/**
 * A location: a path, `file:line`, an oid. Provenance and the verification
 * hook, so it is always reachable — code face, muted, link blue only when it
 * is a link.
 *
 * Must never: be the only name of a thing, or lead a row (it follows a Name or
 * a UI word — `branch`, `read at`, `committed`); wear a chip border (so no
 * border class exists here to reach for); be mid-truncated (so no `truncate`).
 * The first two are the callers' to keep and are marked at each caller that
 * does not yet (#411 step 3 names every packet reference by kind).
 *
 * Muted today is the `faint` step of the muted ink, which is what every plain
 * address in the packets already used.
 */
export function Address({
  children,
  to,
  size = 'sm',
  className,
  onClick,
}: {
  children: string
  /** An in-app route (the Record reader). A host page is a LinkOut, never this. */
  to?: string
  size?: CodeSize
  className?: string
  onClick?: MouseEventHandler<HTMLAnchorElement>
}) {
  if (to !== undefined) {
    return (
      <Link className={cx('font-mono', CODE_SIZE[size], 'text-accent underline underline-offset-2', className)} to={to} onClick={onClick} data-address>
        {children}
      </Link>
    )
  }
  return (
    <span className={cx('font-mono', CODE_SIZE[size], 'text-faint', className)} data-address>
      {children}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Name — the record's voice (§4 Identifier, §5 row 2, §8.2).

/** A slash, or a trailing `.ext` that starts with a letter (`AC2.1` is a Name; `plan.md` is not). */
const NOT_A_NAME = /\/|\.[A-Za-z][A-Za-z0-9]{0,4}$/

/** True when the string can be a Name: no slash, no file extension. */
export const isName = (text: string) => !NOT_A_NAME.test(text)

/**
 * An identifier the record uses everywhere — a task id, `R<n>`, `AC<n>.<m>`,
 * `ADR-<n>`, `F<n>` — verbatim, in the code face, in ink; semibold when it
 * leads a row. `resolve` runs it through the lexicon, which gives it the
 * dotted underline and the hover card where the run defines it.
 *
 * Must never: be paraphrased or reformatted (it takes a string and prints it);
 * be set in the Address treatment (ink, never muted or blue); contain a slash
 * or an extension — a path handed to a Name is a bug, and throws in dev.
 */
export function Name({
  children,
  lead = false,
  size = 'md',
  resolve = false,
  className,
}: {
  children: string
  lead?: boolean
  size?: CodeSize
  resolve?: boolean
  className?: string
}) {
  invariant(isName(children), `a Name never contains a slash or an extension: ${JSON.stringify(children)}`)
  return (
    <span className={cx('font-mono', CODE_SIZE[size], lead && 'font-semibold', 'text-ink', className)} data-name>
      {resolve ? <CitedText>{children}</CitedText> : children}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Kind label — the framework's voice (§4 Container, §5 row 3).

const FILENAME = /\S\.(?:md|ya?ml|json)\b|\//

export type LabelTone = 'ink' | 'muted' | 'faint'
const LABEL_TONE: Record<LabelTone, string> = { ink: 'text-ink', muted: 'text-muted', faint: 'text-faint' }

/**
 * What a thing is, in the UI face and sentence case: a caption, a group, an
 * attribution ("Verification states …").
 *
 * Must never: be minted per run, or replace a record word that exists (the
 * caller's to keep); be a filename — throws in dev.
 *
 * §5 sets the kind label in ink. Every caption in the packets today is set in
 * the muted steps, so `tone` keeps each one's pixels until the colour pass.
 */
export function KindLabel({
  children,
  as: As = 'span',
  size = 'sm',
  tone = 'ink',
  className,
}: {
  children: string
  as?: 'span' | 'p' | 'dt'
  size?: 'xs' | 'sm'
  tone?: LabelTone
  className?: string
}) {
  invariant(!FILENAME.test(children), `a Kind label is never a filename: ${JSON.stringify(children)}`)
  return (
    <As className={cx('font-ui', size === 'xs' ? 'text-[10.5px]' : 'text-[11px]', LABEL_TONE[tone], className)} data-kind-label>
      {children}
    </As>
  )
}

// ---------------------------------------------------------------------------
// Quoted word — the record's voice (§4 Identifier, §5 row 4).

/**
 * The gate-state quartet plus the plain impression. There is no other tone:
 * a quoted word is never tinted outside the quartet (§5; DESIGN.md
 * "Every other colour has one job").
 */
export type QuotedTone = 'plain' | 'ok' | 'warn' | 'bad' | 'info'
const QUOTED_TONE: Record<QuotedTone, string> = {
  plain: 'border-line bg-inset text-muted',
  ok: 'border-ok-line bg-ok-bg text-ok',
  warn: 'border-warn-line bg-warn-bg text-warn',
  bad: 'border-bad-line bg-bad-bg text-bad',
  info: 'border-info-line bg-info-bg text-info',
}

/**
 * A state the record states — a verdict, a status, a severity, a burden,
 * `yes`/`no` — as the impression: bordered code face. The chip border belongs
 * to this kind alone.
 *
 * Must never: be a synonym or a computed rollup (it prints the record's
 * token, so a caller computing one is the bug); be nested in another chip
 * (children is a string, so it cannot hold one); be tinted outside the
 * quartet (the tone is a closed union).
 */
export function QuotedWord({
  children,
  tone = 'plain',
  title,
  className,
}: {
  children: string
  tone?: QuotedTone
  title?: string
  className?: string
}) {
  return (
    <span
      className={cx('border px-[7px] py-px font-mono text-[10.5px] font-semibold leading-none', QUOTED_TONE[tone], className)}
      title={title}
      data-quoted-word={children}
    >
      {children}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Quoted passage — the record's voice (§4 Substance, §5 row 5).

/**
 * The record's words at card scale: the one boxed thing on the page, a
 * hairline box on the surface.
 *
 * `caution` is the tint §8.4 allows on a record token whose contract fixes a
 * binary and one value asks for the human's attention (`**Rollback
 * exercised:** no`, an irreversible step). The words inside must state the
 * fact the colour carries; the colour never carries what the words do not.
 *
 * Must never: be truncated (fold instead — there is no truncating prop); be
 * rendered as `<pre>` when it is markdown (the caller hands it rendered
 * markdown; `Diagnostic` is the `<pre>` kind); be reflowed into the view's own
 * sentence; be attributed by filename.
 */
export function QuotedPassage({
  children,
  as: As = 'div',
  tone = 'plain',
  className,
  ...rest
}: {
  children: ReactNode
  as?: 'div' | 'li'
  tone?: 'plain' | 'caution'
  className?: string
} & DataAttrs) {
  return (
    <As
      className={cx('border px-3 py-2', tone === 'caution' ? 'border-warn-line bg-warn-bg' : 'border-line bg-surface', className)}
      {...dataAttrs(rest)}
    >
      {children}
    </As>
  )
}

/**
 * One field of a record section: its label as written, its value verbatim.
 * Two forms, one signal. On a packet's surface the field is a quoted passage
 * of its own, boxed; inside a box that already is the passage (a finding
 * card), it is the same row unboxed, because §5 allows one boxed thing and a
 * box inside a box would be a second.
 *
 * The value is whatever the caller quotes — `Markdown` for a section's line,
 * `Inline` for a finding's cell — so the field owns the frame, the label and
 * the slot, and the quoting stays with the quote.
 */
export function FieldRow({
  label,
  children,
  nested = false,
  tone = 'plain',
  ...rest
}: {
  label: string
  children: ReactNode
  nested?: boolean
  tone?: 'plain' | 'caution'
} & DataAttrs) {
  if (nested) {
    return (
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5" {...dataAttrs(rest)}>
        <KindLabel as="dt" size="xs" tone="muted" className="shrink-0">
          {label}
        </KindLabel>
        <dd className="min-w-0 flex-1 text-muted">{children}</dd>
      </div>
    )
  }
  return (
    <QuotedPassage as="li" tone={tone} {...dataAttrs(rest)}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <KindLabel tone="muted" className="shrink-0">
          {label}
        </KindLabel>
        <div className={cx('prose-card min-w-0 flex-1', tone === 'caution' && 'font-medium text-warn')}>{children}</div>
      </div>
    </QuotedPassage>
  )
}

// ---------------------------------------------------------------------------
// Count — the framework's voice (§5 row 6).

/**
 * The size of what is on the table, in the UI face with tabular figures,
 * adjoining the noun it counts.
 *
 * Must never: become a percentage, a meter or a grade (it takes a whole
 * number and a noun, nothing to divide by); take colour (there is no tone —
 * it inherits the ink of the line it sits in). A ratio is allowed only where
 * the record states the cap (`rounds 3/3`), via `of`.
 */
export function Count({ n, one, many, of }: { n: number; one: string; many: string; of?: number }) {
  invariant(Number.isInteger(n) && n >= 0, `a Count is a whole number of record entries: ${n}`)
  return (
    <span className="font-ui tabular-nums" data-count={n}>
      {of === undefined ? `${n} ${n === 1 ? one : many}` : `${many} ${n}/${of}`}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Fold — the framework's voice (§5 row 7).

/**
 * The one fold: `▸`, the heading in the artifact's face, the count beside it,
 * and the body opened in place, verbatim. For an audit-time section or
 * resolved history.
 *
 * Must never: hide a decide-time section, or default closed over what the
 * gate asks about — the caller chooses what folds, and `defaultOpen` exists
 * for the section that must not start closed. Folding is never truncation:
 * the body is the whole section.
 */
export function Fold({
  heading,
  count,
  children,
  defaultOpen = false,
  className,
  ...rest
}: {
  heading: string
  count?: number
  children: ReactNode
  defaultOpen?: boolean
  className?: string
} & DataAttrs) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={cx('border border-line bg-surface', className)} data-fold data-open={open ? 'true' : 'false'} {...dataAttrs(rest)}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-baseline gap-2 px-3 py-2 text-left" aria-expanded={open}>
        <span className="font-ui text-[10.5px] text-muted">{open ? '▾' : '▸'}</span>
        <span className="text-[12.5px] font-medium text-ink">{heading}</span>
        {count !== undefined && <span className="font-ui text-[11px] tabular-nums text-faint">{count}</span>}
      </button>
      {open && <div className="px-3 pb-2 text-[12.5px]">{children}</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Link-out — the framework's voice (§5 row 8).

/**
 * A page the host owns — the branch, the PR — in link blue, `↗`, a new tab.
 * `↗` is reserved for this component: nothing else in the vocabulary renders
 * it, and a route inside the cockpit is an Address or a UI word.
 *
 * Must never: be the only route to the thing (the caller's to keep); be shown
 * when no target resolves — an empty href renders nothing.
 */
export function LinkOut({ href, children, className }: { href: string | null | undefined; children: string; className?: string }) {
  if (!href) return null
  return (
    <a className={cx('text-accent underline underline-offset-2', className)} href={href} target="_blank" rel="noopener noreferrer" data-link-out>
      {children} ↗
    </a>
  )
}

// ---------------------------------------------------------------------------
// Withheld view — the framework's voice (§5 row 9, §7 "structured withheld").

/**
 * The fork fallback: a caution field, and one UI-face sentence composed here
 * from the packet's structured reason (#424) —
 *
 *   <view> withheld — looked for <grammar> <token> in the <kind>. Open the <kind>
 *
 * The grammar is the framework's words for a contract section or key; the
 * token is the record's own spelling, set in the code face; the kind is the
 * contract's name for the artifact looked in, and the one link opens it. When
 * the record has no such artifact, the sentence says so and there is nothing
 * to open. Core states only the facts; the words are the cockpit's.
 *
 * Must never: read as a fault (caution, never the declined red); be silent
 * (a reason is required); cite an issue number, or link by filename (the
 * reason carries neither, and the link is named by the contract's kind).
 */
export function Withheld({
  view,
  reason,
  src,
  slug,
  after,
  link = true,
  className,
  ...rest
}: {
  /** What stood down, as a UI-face noun: "Criterion view", "Coverage". The component says "withheld". */
  view: string
  reason: WithheldReason
  /** The run the artifact is in, for the one link to it. */
  src: string
  slug: string
  /** A cockpit sentence after the reason — what the reader still has. */
  after?: string
  /**
   * Whether to link the artifact looked in. Off only where the reader is
   * already on that artifact (the Record reader's own panel), where the link
   * would open the page it sits on.
   */
  link?: boolean
  className?: string
} & DataAttrs) {
  const at = reason.lookedIn
  const kind = at?.contractName ?? 'artifact'
  return (
    <p
      className={cx('border border-warn-line bg-warn-bg px-2.5 py-2 text-[12px] leading-[1.5] text-warn', className)}
      data-withheld-view
      {...dataAttrs(rest)}
    >
      {view} withheld — looked for {reason.grammar}
      {reason.token && (
        <>
          {' '}
          <span className="font-mono">{reason.token}</span>
        </>
      )}
      {at === null ? (
        ', and the record has none.'
      ) : at.kind === 'work-item' && at.id !== null ? (
        <>
          {' in work item '}
          <Name size="sm">{at.id}</Name>.
        </>
      ) : (
        ` in the ${kind}.`
      )}
      {after && ` ${after}`}
      {at !== null && link && (
        <>
          {' '}
          <Link className="text-accent underline underline-offset-2" to={artifactHref(src, slug, at.path)} data-withheld-open>
            Open the {kind}
          </Link>
        </>
      )}
    </p>
  )
}

// ---------------------------------------------------------------------------
// Diagnostic — the machine's voice (§5 row 10).

/**
 * The machine's word where it is the fact — a YAML error with its caret, a
 * commit subject, an engine verb — in `<pre>` (or inline code), ink, under a
 * UI-face label naming what produced it.
 *
 * Must never: be flowed as prose (it is `<pre>` or `<code>`, whitespace kept);
 * be titled as the record's word about the run, or stand untitled (the
 * producer is required); lead a table cell (the label precedes it).
 */
export function Diagnostic({ producer, children, inline = false }: { producer: string; children: string; inline?: boolean }) {
  if (inline) {
    return (
      <span data-diagnostic>
        <span className="font-ui text-[11px] text-muted">{producer}</span>{' '}
        <code className="font-mono text-ink">{children}</code>
      </span>
    )
  }
  return (
    <div data-diagnostic>
      <p className="font-ui text-[11px] text-muted">{producer}</p>
      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap bg-inset p-2.5 font-mono text-[11.5px] leading-[1.5] text-ink">{children}</pre>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Instruction — the cockpit's voice (§5 row 11, §6).

const QUOTE_MARK = /^\s*["“”‘’'«]|["“”‘’'»]\s*$/

/**
 * What to do next, in the UI's own words: UI face, unboxed, never in quotes.
 *
 * Must never: restate or quote the record (children is a plain string, so it
 * cannot hold a quoted component, and a string wrapped in quote marks throws
 * in dev); be composed in core (the caller's to keep — the sentence is a web
 * constant, as `decide.tsx`'s are).
 */
export function Instruction({ children, className }: { children: string; className?: string }) {
  invariant(!QUOTE_MARK.test(children), `an Instruction is never in quotes: ${JSON.stringify(children)}`)
  return (
    <p className={cx('font-ui text-[12.5px] leading-[1.5] text-muted', className)} data-instruction>
      {children}
    </p>
  )
}
