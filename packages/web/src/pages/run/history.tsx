// The History ledger. Split out of pages/run.tsx (#413) as a pure move — no
// behaviour, markup, or string changed; pages/run.tsx re-exports every symbol
// below so no import path a test already uses had to change.
import { useQuery } from '@tanstack/react-query'
import { Fragment, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { type ArtifactRef, api, formatWhen, type InboxItem, type LedgerEntry, type LedgerQuote, type LedgerTarget, type RunDetailResponse } from '../../api.ts'
import { Imp } from '../../components/chips.tsx'
import { Markdown } from '../../components/markdown.tsx'
import { artifactHref, Fold, isName, KindLabel, Name, QuotedPassage, QuotedWord } from '../../components/vocabulary.tsx'
import { decideTargetIndex } from '../../landing.ts'
import { collapseEngineSpans } from '../../ledger-spans.ts'
import { usd } from '../../money.ts'
import { PageStatus } from '../inbox.tsx'
import { burdenPillNeeded } from './decide-card.tsx'

/** Actor treatment: a human decision reads as the decision it is; the engine's
 * verbs sit back in mono. The distinction is a fact of the grammar — the
 * `G<N> approved by <name>` form is reserved for named humans (AGENTS.md) and
 * the orchestrator structurally never writes `gates.*`. */
const LEDGER_TONE: Record<string, string> = {
  human: 'text-ink font-medium',
  orchestrator: 'font-mono text-[12px] text-muted',
  unknown: 'text-muted',
}

/**
 * A note longer than this folds (#426). Most notes are a line — "ADR-1
 * accepted", "merged" — and read best in the open; a decline's reason or a
 * resolution can run to paragraphs, and the ledger should still read as a
 * sequence of decisions.
 */
const NOTE_FOLD_LINES = 4
const NOTE_FOLD_CHARS = 360

export const noteFolds = (text: string) => text.split('\n').length > NOTE_FOLD_LINES || text.length > NOTE_FOLD_CHARS

/**
 * The caption over a quoted note: what the words are and whose they are. The
 * gate is named only when the row beside it does not already name it — a
 * commit outside the grammar (a v0 harvest, a run's first commit) can record
 * several gates' notes at once.
 */
export function noteCaption(q: LedgerQuote, e: Pick<LedgerEntry, 'gate' | 'kind'>, what: 'note' | 'reason'): string {
  const lead = what === 'reason' ? (e.kind === 'closed' ? 'reason' : 'closure reason') : q.gate && q.gate !== e.gate ? `${q.gate} note` : 'note'
  return q.by ? `${lead} by ${q.by}` : lead
}

/**
 * Where an engine row's link goes, if anywhere: the decide card while the run
 * still has that item, otherwise the Record reader at the artifact the row
 * names, provided the run has it. No target resolves → no link, never a dead one.
 */
export function ledgerLink(
  t: LedgerTarget | null,
  ctx: { src: string; slug: string; items: readonly InboxItem[]; artifacts: readonly ArtifactRef[] },
): { label: string; to: string } | null {
  if (!t) return null
  if (t.decide && decideTargetIndex(t.decide, [...ctx.items]) >= 0) {
    return { label: 'open the card', to: `/runs/${ctx.src}/${ctx.slug}?decide=${t.decide}` }
  }
  const ref = t.artifact ? ctx.artifacts.find((a) => a.path === t.artifact!.path) : undefined
  if (ref) return { label: `open the ${ref.contractName ?? 'artifact'}`, to: artifactHref(ctx.src, ctx.slug, ref.path) }
  return null
}

/** A record id as a Name where it can be one; anything else stays plain text rather than throwing. */
const NameOrText = ({ children }: { children: string }) => (isName(children) ? <Name size="sm">{children}</Name> : children)

/**
 * The human's own words under their decision row: a quoted passage, verbatim
 * and rendered as the markdown it was written in, captioned with whose words
 * they are. Folded only when long.
 */
function LedgerNote({ q, caption, field }: { q: LedgerQuote; caption: string; field: 'notes' | 'reason' }) {
  const body = (
    <div className="prose-card">
      <Markdown unwrapped>{q.text}</Markdown>
    </div>
  )
  if (noteFolds(q.text)) {
    return (
      <Fold heading={caption} data-ledger-note={field} data-ledger-note-gate={q.gate ?? undefined}>
        {body}
      </Fold>
    )
  }
  return (
    <div data-ledger-note={field} data-ledger-note-gate={q.gate ?? undefined}>
      <KindLabel as="p" size="xs" tone="muted" className="mb-1">
        {caption}
      </KindLabel>
      <QuotedPassage>{body}</QuotedPassage>
    </div>
  )
}

/** Verbs that carry a decision, and so earn a filled marker on the spine. */
const DECISION_KINDS = new Set(['gate-approved', 'gate-declined', 'escalation-resolved', 'paused', 'resumed', 'armed', 'staged', 'closed', 'reopened'])

/**
 * The decision ledger (#268): `state.yaml`'s history read as the decisions and
 * dispatches it records, not as a commit log. Per #259 / FRONTEND.md §4.1, time,
 * subject, author and short oid are the host's job — phase transitions, gate
 * approvals under the `G<N> approved by <name>` grammar, and the orchestrator's
 * verbs are what no host can represent.
 *
 * Verbatim and reachable (#261's standing rule): every word rendered comes
 * byte-identical from the record — `detail` is the raw remainder of the commit
 * subject and the extracted fields are substrings of it — and the raw commit
 * columns stay one toggle away rather than being deleted. Nothing here is
 * summarized and no verdict is computed.
 *
 * Gate decisions are enriched from the decisions endpoint, which reads
 * `state.yaml` *content* rather than subjects — this is what keeps the ledger
 * useful on the v0 runs (wordfreq/mdtoc/dupefind), whose commits predate the
 * `state(<slug>):` grammar and therefore all read as `other`.
 */
export function HistoryTab({
  history,
  src,
  slug,
  items = [],
  artifacts = [],
}: {
  history: RunDetailResponse['history']
  src: string
  slug: string
  /** The run's pending items, so an engine row links to a card only while it exists. */
  items?: readonly InboxItem[]
  /** The run's artifacts at this ref, so an engine row links only to one the reader can open. */
  artifacts?: readonly ArtifactRef[]
}) {
  const [raw, setRaw] = useState(false)
  // A run whose state.yaml is schema-invalid still renders its ledger (#198
  // precedent): parsing reads commit subjects only and never touches the state,
  // so a failed decisions fetch degrades this view rather than emptying it.
  const { data: decisions } = useQuery({
    queryKey: ['decisions', src, slug],
    queryFn: () => api.decisions(src, slug),
    enabled: Boolean(src && slug),
    retry: false,
  })

  // The burden pill's source on the v0 runs. The notes the endpoint also
  // carries are rendered from the ledger itself (#426), which attributes them
  // to the commit that recorded them rather than to the gate's latest state.
  const burdenByGate = useMemo(() => {
    const m = new Map<string, { burden: string | null }>()
    for (const d of decisions?.decisions ?? []) m.set(d.gate, { burden: d.burden })
    return m
  }, [decisions])

  const rows = useMemo(() => collapseEngineSpans(history), [history])
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set())

  if (history.length === 0) return <PageStatus text="No state history at this ref." />

  const renderRow = (i: number) => {
    const h = history[i]!
    const transition = Boolean(h.phase && i < history.length - 1 && history[i + 1]!.phase !== h.phase)
    const e = h.ledger
    const decided = DECISION_KINDS.has(e.kind)
    const extra = e.gate ? burdenByGate.get(e.gate) : undefined
    const link = e.actor === 'orchestrator' ? ledgerLink(e.target, { src, slug, items, artifacts }) : null
    // An escalation resolution is named by who escalated and about what; the
    // subject's `escalation #<n>` is an array index, an address, and stays
    // in raw mode with the rest of the commit's own columns.
    const namedEscalation = !raw && e.kind === 'escalation-resolved'
    const quotes = [
      ...e.notes.map((q) => ({ q, field: 'notes' as const, caption: noteCaption(q, e, 'note') })),
      ...(e.reason ? [{ q: e.reason, field: 'reason' as const, caption: noteCaption(e.reason, e, 'reason') }] : []),
    ]
    return (
      <li
        key={h.oid}
        data-ledger-actor={e.actor}
        data-ledger-kind={e.kind}
        className={`relative border-b border-line py-2.5 pl-7 text-sm last:border-b-0 before:absolute before:left-0.5 before:top-[15px] before:h-2.5 before:w-2.5 before:border before:content-[''] ${
          transition
            ? 'before:border-ink before:bg-ink'
            : decided
              ? 'before:border-ink before:bg-ground'
              : 'before:border-dotted before:border-muted before:bg-ground'
        }`}
      >
        {/* Only a row with a link wraps: at phone width the link takes its
            own line rather than squeezing the engine's subject to a letter.
            Every other row keeps the one-line ledger it always had. */}
        <div className={`flex items-baseline gap-x-3 gap-y-1 ${link ? 'max-sm:flex-wrap' : ''}`}>
          <span className="w-32 shrink-0 font-ui text-[11.5px] tabular-nums text-muted">{formatWhen(h.time)}</span>
          {/* A human's own decision is stamped onto the ledger — the one mark
              on this page that was pressed rather than printed. The words
              beside it are still the commit subject, verbatim. */}
          {decided && e.actor === 'human' && (
            <Imp tone="fill stamped" className="shrink-0">
              {e.gate ? `${e.gate} ${e.kind.replace('gate-', '')}` : e.kind.replace(/-/g, ' ')}
            </Imp>
          )}
          {namedEscalation ? (
            <span className={`min-w-0 flex-1 truncate text-[13px] ${LEDGER_TONE.human}`} data-ledger-escalation>
              {e.escalatedBy && (
                <>
                  <NameOrText>{e.escalatedBy}</NameOrText> escalated
                </>
              )}
              {e.escalatedAbout && (
                <>
                  {' · '}
                  <NameOrText>{e.escalatedAbout}</NameOrText>
                </>
              )}
              {(e.escalatedBy || e.escalatedAbout) && ' · '}
              {e.by ? `resolved by ${e.by}` : 'resolved'}
              {e.disposition && (
                <>
                  {' '}
                  <QuotedWord>{e.disposition}</QuotedWord>
                </>
              )}
            </span>
          ) : (
            <span className={`min-w-0 flex-1 truncate text-[13px] ${LEDGER_TONE[e.actor] ?? ''}`} title={h.subject}>
              {e.detail}
            </span>
          )}
          {/* The engine's subject stays its own words; the link after it is
              the cockpit's, to the view that exists (#426). */}
          {link && (
            <Link
              to={link.to}
              className="shrink-0 font-ui text-[11px] text-accent underline underline-offset-2 max-sm:order-last max-sm:basis-full max-sm:pl-[8.75rem]"
              data-ledger-link
            >
              {link.label}
            </Link>
          )}
          {/* The burden comes from the decisions endpoint, quoted,
              never scored — and the pill is dropped when the commit
              subject beside it already says the same word (#285/2). The
              modern grammar writes `G1 approved by operator [burden:
              light-correction]`, so on those rows the pill was the fact
              restated eight pixels to its right. It still earns its place
              on the v0 runs, whose subjects predate the bracketed form and
              where the endpoint reading `state.yaml` is the only source. */}
          {extra?.burden && burdenPillNeeded(e.detail, extra.burden) && (
            <span className="shrink-0 border border-line px-1.5 py-px font-mono text-[10.5px] text-muted">{extra.burden}</span>
          )}
          {e.actor === 'orchestrator' && (
            <span className="shrink-0 font-ui text-[10.5px] text-faint" title="committed under the orchestrator's bot identity">
              engine
            </span>
          )}
          {transition && <span className="shrink-0 font-mono text-[11px] text-accent-deep">→ {h.phase}</span>}
          {raw && (
            <>
              <span className="w-24 shrink-0 truncate text-right text-[11.5px] text-muted">{h.author}</span>
              <span className="shrink-0 font-mono text-[11px] text-faint">{h.oid.slice(0, 7)}</span>
            </>
          )}
        </div>
        {/* The approver's own words at this decision (#426, SEAM.md §8.6):
            gate notes, a resolution, a closure's reason — quoted under the
            row that recorded them, never folded into its line. */}
        {quotes.length > 0 && (
          <div className="mt-2 flex flex-col gap-2 sm:pl-[8.75rem]" data-ledger-notes>
            {quotes.map(({ q, field, caption }, k) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list read from one commit's state; two gates' notes can be the same words.
              <LedgerNote key={k} q={q} field={field} caption={caption} />
            ))}
          </div>
        )}
      </li>
    )
  }


  return (
    <div>
      <div className="mb-2 flex items-center justify-end">
        <button
          type="button"
          onClick={() => setRaw((v) => !v)}
          className="font-ui text-[11px] text-muted underline decoration-dotted underline-offset-2 hover:text-ink"
          aria-pressed={raw}
        >
          {raw ? 'hide raw commits' : 'show raw commits'}
        </button>
      </div>
      <ol
        data-ledger
        className="relative ml-1.5 flex flex-col before:absolute before:bottom-1.5 before:left-1.5 before:top-1.5 before:w-0.5 before:bg-line before:content-['']"
      >
        {rows.map((r) => {
          if (r.kind === 'row') return renderRow(r.index)
          const expanded = open.has(r.from)
          return (
            <Fragment key={`span-${r.from}`}>
              {/* One review round or more of engine rows, folded (#283): the
                  ledger reads as the decision sequence by default, and the
                  engine's work between two decisions is summarized from its
                  own rows — counts and the metered figures they carry, nothing
                  more — until it is opened. Every row stays reachable. */}
              <li
                data-ledger-span={r.count}
                data-ledger-span-open={expanded ? 'true' : undefined}
                className="relative flex items-baseline gap-3 border-b border-line py-2.5 pl-7 text-sm last:border-b-0 before:absolute before:left-0.5 before:top-[15px] before:h-2.5 before:w-2.5 before:border before:border-dotted before:border-muted before:bg-ground before:content-['']"
              >
                <span className="w-32 shrink-0 font-ui text-[11.5px] tabular-nums text-muted">{formatWhen(history[r.from]!.time)}</span>
                <button
                  type="button"
                  onClick={() => setOpen((prev) => {
                    const next = new Set(prev)
                    if (next.has(r.from)) next.delete(r.from)
                    else next.add(r.from)
                    return next
                  })}
                  aria-expanded={expanded}
                  className="min-w-0 flex-1 truncate text-left font-mono text-[12px] text-muted underline decoration-dotted underline-offset-2 hover:text-ink"
                  title={expanded ? 'fold these rows' : 'show every row'}
                >
                  engine · {r.count} actions ·{' '}
                  {r.verbs.map(([verb, n]) => `${n} ${verb}${verb === 'metered' && r.meteredUsd !== null ? ` (${usd(r.meteredUsd)})` : ''}`).join(' · ')}
                </button>
                {r.entered.map((phase, k) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: a bounce cycle can revisit the same phase, so the name isn't unique; this is a fixed sequence from committed history.
                  <span key={k} className="shrink-0 font-mono text-[11px] text-accent-deep">→ {phase}</span>
                ))}
              </li>
              {expanded && Array.from({ length: r.count }, (_, k) => renderRow(r.from + k))}
            </Fragment>
          )
        })}
      </ol>
    </div>
  )
}
