// The Decide surface's one card shape, and the small pure helpers that decide
// what it renders. Split out of pages/run.tsx (#413) as a pure move — no
// behaviour, markup, or string changed; pages/run.tsx re-exports every symbol
// below so no import path a test already uses had to change.
import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { formatAge, type InboxItem, type RunDetailResponse } from '../../api.ts'
import { AgeBadge, Imp, KindChip } from '../../components/chips.tsx'
import { BOUNCED_INSTRUCTION, DecidePanel, INFLIGHT_INSTRUCTION, ROUND_CAP_INSTRUCTION } from '../../components/decide.tsx'
import { EscalationPacket } from '../../components/escalation.tsx'
import { G2Packet } from '../../components/evidence.tsx'
import { useReviews } from '../../components/findings.tsx'
import { G1Packet } from '../../components/g1.tsx'
import { G3Packet } from '../../components/g3.tsx'
import { CitedText } from '../../components/lexicon.tsx'
import { RoundCapPanel } from '../../components/rounds.tsx'
import { gateCardState } from '../../gate-state.ts'
import { isReviewPath } from '../../record-rail.ts'
import type { KeyHint } from '../../use-keys.ts'

/** Bare grammar — words that carry no fact of their own, so a sentence built
 *  only from these plus words already on screen adds nothing to the screen. */
const GRAMMAR = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'is', 'it', 'its',
  'of', 'on', 'or', 'that', 'the', 'this', 'to', 'was', 'were', 'with',
])

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)

/**
 * Does `line` say only what `shown` has already said? (#294)
 *
 * This decides whether a decision card renders its subtitle. It is a plain
 * containment check over words and never a paraphrase check: if every word of
 * the line beyond bare grammar already appears in the text rendered above it,
 * the line is a restatement and is dropped. One new word anywhere — an
 * escalation's reason, a bounce's "Packet malformed", a paused run's "Resume" —
 * and the whole line renders verbatim, as it always did.
 *
 * Nothing becomes unreachable this way. The suppressed words are, by the test's
 * own definition, still on the page a few pixels above.
 */
export function restatesWhatIsShown(line: string, shown: string): boolean {
  const vocabulary = new Set(words(shown))
  const carried = words(line).filter((w) => !GRAMMAR.has(w))
  return carried.length > 0 && carried.every((w) => vocabulary.has(w))
}

/**
 * A decision card's problems, minus the ones its description has already said
 * (#285/1).
 *
 * The malformed-state card carried the YAML parse error twice — once as
 * `detail`, once as its single `problem` — because core writes the same string
 * into both, and the card rendered both slots without ever comparing them.
 * Byte equality is the whole test: a bounced gate's problems name the missing
 * contract sections, which appear nowhere in its description, and every one of
 * them still renders.
 */
export function visibleProblems(item: InboxItem): string[] {
  return item.problems.filter((p) => p.trim() !== item.detail.trim())
}

/**
 * The instruction a card with no button has to give, for the description slot
 * (#285/6).
 *
 * Round-cap, bounce and in-flight are the three cards Gatehouse cannot offer a
 * control for — one needs a spec edit, one needs the artifacts fixed, and the
 * third (#159) needs only the wait — so the sentence saying what to do instead
 * *is* their affordance. In-flight is tested first, because it is a gate with
 * `reviewable: false` and would otherwise fall into the bounce row and be told
 * its packet was malformed. It used to render
 * where the buttons would have gone, at the card foot, right-aligned and small,
 * which is the treatment for a footnote. Every other kind returns null and is
 * unchanged: its instruction is a button.
 */
export function cardInstruction(item: InboxItem): { text: string; tone: string } | null {
  if (item.kind === 'round-cap') return { text: ROUND_CAP_INSTRUCTION, tone: 'text-ink' }
  if (gateCardState(item) === 'inflight') return { text: INFLIGHT_INSTRUCTION, tone: 'font-medium text-muted' }
  if (item.kind === 'gate' && !item.reviewable) return { text: BOUNCED_INSTRUCTION, tone: 'font-medium text-bad' }
  return null
}

/**
 * Whether a ledger row still needs its burden pill (#285/2).
 *
 * The row reads `G1 approved by operator [burden: light-correction]` — the
 * commit subject, verbatim — and then drew a `light-correction` pill eight
 * pixels to its right, which is the same fact from a second source rather than
 * a second fact. The pill earns its place only where the subject does not carry
 * the word: the v0 runs (wordfreq/mdtoc/dupefind) predate the bracketed grammar
 * entirely, and there the decisions endpoint reading `state.yaml` is the only
 * place the burden exists.
 */
export function burdenPillNeeded(detail: string, burden: string): boolean {
  return !detail.includes(burden)
}

/** A pending decision, rendered as a stakes-varied card. Candidate A:
 *  4px accent left-rail + tinted ground + lifted shadow. Reviewable cards
 *  get accent-tint ground, bounced cards get bad-bg — no animation, no glow. */
export function NeedsYouCard({
  item,
  now,
  detail,
  primary,
  sentHere,
  pageHints,
}: {
  item: InboxItem
  now: number
  detail: RunDetailResponse
  primary?: boolean
  sentHere?: boolean
  pageHints?: readonly KeyHint[]
}) {
  const urgent = item.since !== null && now - item.since > 3 * 86_400
  const ageLabel = `waiting ${formatAge(item.since, now)}`
  // `item.detail` is written for an inbox row, where "<slug> is waiting on G2"
  // is what tells you which run you are looking at. Here the slug is the H1, the
  // gate is in the chip, "waiting" is in the badge on the same line, and the
  // question is the title — so the line is words the reader has already read.
  const restated = restatesWhatIsShown(item.detail, `${item.title} ${item.slug} ${ageLabel}`)
  // A malformed-state `detail` is a parser's diagnostic, not a sentence: a
  // message, a blank line, the offending source line, and a caret under the
  // column it failed at. Flowed as prose that caret wraps to wherever the
  // measure happens to break and points at nothing — the "dangling caret" of
  // #285/1. Mono and pre-wrap put it back under the character it names, and
  // the string is still rendered byte for byte.
  const diagnostic = item.detail.includes('\n')
  const problems = visibleProblems(item)
  const instruction = cardInstruction(item)
  // Arriving from an inbox link: bring the named card into view and give it
  // focus, so the decision is where the eye and the keyboard already are.
  const cardRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!sentHere) return
    cardRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    cardRef.current?.focus({ preventScroll: true })
  }, [sentHere])
  // The card names artifacts and tasks in prose; resolve those mentions from
  // data already in the detail payload so the card answers "what happened,
  // where do I look" without a trip to the tabs.
  const reports = useReviews(item.source, item.slug)
  const prose = `${item.title} ${item.detail}`
  const mentioned = detail.artifacts.filter((p) => !item.packet.includes(p) && prose.includes(p))
  const chipPaths = [...item.packet.filter((p) => detail.artifacts.includes(p) || p === 'state.yaml'), ...mentioned]
  const mentionedTask = detail.state?.tasks.find((t) => prose.includes(t.id)) ?? null
  // A packet chip that names a review carries what that review concluded
  // (#215) — the G2 approver should not have to open three files to learn
  // that one of them said request-changes.
  const chips =
    chipPaths.length > 0
      ? chipPaths.map((p) => {
          const report = isReviewPath(p) ? reports?.find((r) => r.path === p) : undefined
          const verdicts = (report?.rounds ?? []).map((r) => r.verdict).filter((v): v is NonNullable<typeof v> => v !== null)
          const verdictArc =
            verdicts.length === 0 ? null : verdicts.length > 1 && verdicts[0] !== verdicts[verdicts.length - 1] ? `${verdicts[0]} → ${verdicts[verdicts.length - 1]}` : verdicts[verdicts.length - 1]
          return (
            <Link
              key={p}
              to={`/runs/${item.source}/${item.slug}?tab=record&artifact=${encodeURIComponent(p)}`}
              className="imp hover:bg-inset"
            >
              {p}
              {/* The verdict rides inside the same impression as the name, in
                  the name-plus-code grammar: a chip nested in a chip stood
                  4px taller than its neighbours (measured, 2026-09-04). */}
              {verdictArc && <span className="text-muted"> · {verdictArc}</span>}
            </Link>
          )
        })
      : null
  // Three chromes for three states (#159). An in-flight card is neither the
  // lifted accent of something to decide nor the red of something broken: it is
  // a card at rest, waiting on a machine, and its eyebrow says so rather than
  // claiming the human's attention for work that is already moving.
  const gateState = gateCardState(item)
  const inflight = gateState === 'inflight' ? item.inflight : null
  // Three impressions for three states (#159). Something to decide is the
  // filled mark; a card waiting on a machine is dotted, at rest; a bounced
  // packet is hatched. The card itself is not boxed: it is a posting on the
  // page, ruled above, with its evidence and its affordance below.
  // No overflow-hidden on the card: the lexicon hover card (#252) is
  // absolutely positioned and would be clipped by it.
  return (
    <section
      className="relative border-t border-ink pt-5 first:border-t-0 first:pt-1"
      data-needs-card
      data-card-state={gateState ?? undefined}
      data-sent-here={sentHere ? 'true' : undefined}
      ref={cardRef}
      tabIndex={-1}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-3 flex-wrap">
          {inflight ? (
            <Imp tone="dot">
              waiting on {inflight.role}
              {item.gate ? ` · ${item.gate}` : ''}
            </Imp>
          ) : gateState === 'bounced' ? (
            <Imp tone="hatch">bounced{item.gate ? ` · ${item.gate}` : ''}</Imp>
          ) : (
            <Imp tone="fill">needs you{item.gate ? ` · ${item.gate}` : ''}</Imp>
          )}
          {/* On a gate the KindChip says `● G2` eight pixels from a chip that
              already says `NEEDS YOU · G2` (#294) — two markers, one fact. Every
              other kind names something the chip beside it does not: escalation,
              round-cap, paused, malformed, staged. The chip itself is unchanged
              and still earns its place in the inbox, where rows carry no gate
              label of their own. */}
          {item.kind !== 'gate' && <KindChip item={item} />}
          <span className="ml-auto">
            <AgeBadge label={ageLabel} urgent={urgent} />
          </span>
        </div>
        <h2 className="mt-3 mb-1.5 text-[22px] font-semibold leading-[1.2] text-ink">
          <CitedText>{item.title}</CitedText>
        </h2>
        {!restated &&
          (diagnostic ? (
            <pre className="max-w-[var(--measure)] overflow-x-auto whitespace-pre-wrap font-mono text-[12.5px] leading-[1.55] text-ink">
              {item.detail}
            </pre>
          ) : (
            <p className="max-w-[var(--measure)] text-[14.5px] text-ink leading-[1.55]">
              <CitedText>{item.detail}</CitedText>
            </p>
          ))}
        {instruction && (
          <p data-card-instruction className={`mt-1.5 max-w-[var(--measure)] text-[14.5px] leading-[1.55] ${instruction.tone}`}>
            {instruction.text}
          </p>
        )}
        {mentionedTask && (
          <p className="mt-1.5 font-ui text-[12px] text-muted">
            {mentionedTask.id} · {mentionedTask.status} · review round {mentionedTask.review_rounds}/{detail.summary.tasks.roundCap}
          </p>
        )}
        {problems.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1">
            {problems.map((p) => (
              <li key={p} className="font-mono text-[12px] text-bad">
                ✕ {p}
              </li>
            ))}
          </ul>
        )}
        {/* G2's packet, composed in criterion order (#256). The one-line
            citation map this replaced still renders on verification-report.md
            itself, where the report's own markdown is already on screen. */}
        {/* G1's packet (#255): coverage against the plan's own mapping table,
            and the surface overlaps no dependency orders. A patch run has no
            plan.md and no spec, so its G1 keeps the brief-plus-work-item view. */}
        {item.kind === 'gate' && item.gate === 'G1' && detail.summary.profile !== 'patch' && (
          <G1Packet src={item.source} slug={item.slug} />
        )}
        {item.kind === 'gate' && item.gate === 'G2' && (
          <G2Packet src={item.source} slug={item.slug} profile={detail.summary.profile} />
        )}
        {/* G3's packet (#403): the release plan read for what "Ship it?" asks
            — rollback first, then what ships, the ordered steps, and what G2
            already verified. Rendered on a bounced card too: seeing what is
            malformed is exactly the job in that state. */}
        {item.kind === 'gate' && item.gate === 'G3' && <G3Packet src={item.source} slug={item.slug} />}
        {/* A round cap asks what did not converge, which is a question about two
            rounds at once (#257). The chip list below still offers every report;
            this is the comparison the chips could not be. */}
        {item.kind === 'round-cap' && <RoundCapPanel src={item.source} slug={item.slug} task={mentionedTask?.id ?? null} />}
        {/* An escalation a role raised is a decision the role wrote down (#407):
            its Escalation section, verbatim, and the routes as it sees them,
            so the Resolve form's routes are read against something. An
            engine-originated one renders nothing here — its reason line above
            is the whole packet. */}
        {item.kind === 'escalation' && item.escalationIndex !== null && (
          <EscalationPacket src={item.source} slug={item.slug} index={item.escalationIndex} />
        )}
        <DecidePanel
          item={item}
          profile={detail.summary.profile}
          primary={primary}
          sentHere={sentHere}
          chips={chips}
          pageHints={pageHints}
        />
      </div>
    </section>
  )
}
