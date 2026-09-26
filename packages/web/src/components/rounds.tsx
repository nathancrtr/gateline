// The round-cap surface (#257): the last two review rounds, side by side.
//
// `rounds.ts` decides what did not converge; this decides how it reads. The
// card this replaces said "Read both sides, then unblock" over five filename
// chips into a one-at-a-time reader — at the one decision whose whole question
// is a comparison.
//
// Everything shown is verbatim from the reports and every report stays one
// click away, so folding here is never truncation. The group headings state
// what the record shows: a finding the later round did not mention is reported
// as not mentioned, never as resolved.
import { Link } from 'react-router-dom'
import { compareRounds, type RoundFinding, type RoundSide, reportsForTask } from '../rounds.ts'
import {
  Field,
  FindingCard,
  PACKET_FRAME,
  PACKET_LABEL,
  PacketSweep,
  plainQuote,
  unbulleted,
  useReviewsQuery,
  VerdictChip,
} from './findings.tsx'
import { Address, artifactHref, Withheld } from './vocabulary.tsx'

const NOTE_TONE: Record<RoundFinding['note'], string> = {
  'raised again': 'border-bad-line bg-bad-bg text-bad',
  'marked stands': 'border-warn-line bg-warn-bg text-warn',
  'not mentioned': 'border-line bg-inset text-muted',
  new: 'border-info-line bg-info-bg text-info',
  'marked resolved': 'border-ok-line bg-ok-bg text-ok',
}

export function RoundCapPanel({ src, slug, task }: { src: string; slug: string; task: string | null }) {
  const { reports, pending } = useReviewsQuery(src, slug)
  // "Not read yet" and "no reports in this record" are different facts (#299),
  // and the second is the one an empty card already states. Say the first.
  if (pending) {
    return (
      <section className={PACKET_FRAME} data-round-cap aria-busy="true">
        <p className={PACKET_LABEL}>Rounds — composed from the record</p>
        <PacketSweep />
      </section>
    )
  }
  if (!reports || reports.length === 0) return null
  const scoped = reportsForTask(reports, task)
  const comparison = compareRounds(scoped)

  // A forked grammar, or a single round: say which and stand down. The reports
  // are the answer in both cases, so they are what the panel offers. This is
  // the one branch that still lists them itself (#296): the panel withheld its
  // comparison, so the decide card around it may carry no report chips at all,
  // and "every report one click away" has nowhere else to live.
  if (!comparison.ok) {
    return (
      <section className={PACKET_FRAME} data-round-cap>
        <p className={PACKET_LABEL}>Rounds — composed from the record</p>
        <Withheld view="Round comparison withheld" reason={{ sentence: `${comparison.reason}.` }} className="mt-2" data-rounds-withheld />
        <div className="mt-2" data-round-reports>
          {/* #411 step 3: an Address never wears a chip border. These become
              reference rows — kind, name, quoted verdict — with the path on
              hover; until then they keep the chip the card's own row uses. */}
          <span className="flex flex-wrap gap-1.5">
            {scoped.map((r) => (
              <Link
                key={r.path}
                to={artifactHref(src, slug, r.path)}
                className="border border-line-cool bg-surface px-2 py-0.5 font-mono text-[11px] text-muted hover:border-accent hover:text-accent-deep"
              >
                {r.path}
              </Link>
            ))}
          </span>
        </div>
      </section>
    )
  }

  const { earlier, later, standing, fresh, resolved } = comparison
  return (
    <section className={PACKET_FRAME} data-round-cap>
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <p className={PACKET_LABEL}>
          Round {earlier.round} against round {later.round}
          {task ? ` · ${task}` : ''}
        </p>
        <Side side={earlier} />
        <span className="font-mono text-[11px] text-faint">→</span>
        <Side side={later} />
      </div>

      {/* The question the cap asks, answered first: what is still open in both
          rounds. DESIGN.md §4 points at the spec, which is why the requirement
          each finding cites resolves through the lexicon inside the card. */}
      <Group
        label={`Still open in both rounds — ${standing.length}`}
        hint="what did not converge; usually a spec ambiguity, not an implementation defect"
        items={standing}
        empty="Nothing was raised in both rounds — the cap was reached on findings that did not repeat."
        kind="standing"
      />
      {fresh.length > 0 && (
        <Group label={`New in round ${later.round} — ${fresh.length}`} items={fresh} kind="fresh" />
      )}
      {resolved.length > 0 && (
        <Group
          label={`Marked resolved — ${resolved.length}`}
          hint="closed by a disposition the reviewer wrote; folded, and expandable"
          items={resolved}
          kind="resolved"
        />
      )}
      {/* No "The reports, in full" row here (#296). The panel only ever renders
          inside the decide card, whose own artifact chips sit some 40px below
          it and list the same files carrying their verdicts — so this row was
          the weaker of two identical affordances stacked on top of each other.
          Every report is still one click away; it is one click away from the
          chips, which is where the reader was already going to look. */}
    </section>
  )
}

/** One side of the comparison: its round, its artifacts, and the verdict it recorded. */
function Side({ side }: { side: RoundSide }) {
  return (
    <span className="inline-flex items-baseline gap-1.5" data-round-side={side.round}>
      <span className="font-ui text-[11px] text-muted">round {side.round}</span>
      <VerdictChip verdicts={[side.verdict]} compact />
      {/* #411 step 3: the side names its reports by kind; the files follow. */}
      {side.paths.length > 0 && <Address size="xs">{side.paths.join(' · ')}</Address>}
    </span>
  )
}

function Group({
  label,
  hint,
  items,
  empty,
  kind,
}: {
  label: string
  hint?: string
  items: RoundFinding[]
  empty?: string
  kind: string
}) {
  return (
    <div className="mt-2.5" data-round-group={kind}>
      <p className="font-ui text-[10.5px] text-faint">
        {label}
        {hint && <span className="ml-1.5 normal-case text-muted">· {hint}</span>}
      </p>
      {items.length === 0 ? (
        empty && <p className="mt-1 text-[12px] text-muted">{empty}</p>
      ) : (
        <ul className="mt-1.5 flex flex-col gap-1.5">
          {items.map((item) => (
            <FindingCard
              key={item.finding.id}
              finding={item.finding}
              source={item.path}
              note={
                <span className="contents">
                  <span
                    className={`shrink-0 border px-[7px] py-px font-mono text-[10.5px] font-semibold leading-none ${NOTE_TONE[item.note]}`}
                    title={item.disposition ? plainQuote(item.disposition) : undefined}
                  >
                    {item.note}
                  </span>
                  {item.raisedIn.length > 1 && (
                    <span className="shrink-0 font-ui text-[10.5px] text-faint" title="rounds that raised this finding">
                      rounds {item.raisedIn.join(', ')}
                    </span>
                  )}
                </span>
              }
              // A finding closed by a disposition in another file folds too —
              // the card cannot know it is closed, so the comparison says so.
              defaultOpen={kind === 'resolved' ? false : undefined}
              extra={item.disposition && item.finding.resolution === null ? <ExtraDisposition text={item.disposition} /> : null}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

/** A disposition written in a different file from the finding it names — the
 *  file-per-round shape. The card would otherwise have nowhere to show it.
 *  Same bytes as the in-file case, so the same quoting and the same field: the
 *  bullet and the bold run are the report's markdown, not the reviewer's words
 *  (#282). */
function ExtraDisposition({ text }: { text: string }) {
  return <Field label="Disposition">{unbulleted(text)}</Field>
}
