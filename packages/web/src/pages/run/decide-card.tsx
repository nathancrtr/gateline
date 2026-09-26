// The Decide surface's one card shape, and the small pure helpers that decide
// what it renders. Split out of pages/run.tsx (#413); pages/run.tsx
// re-exports the helpers it already exported, so no import path a test uses
// had to change. The packet's reference rows (#423) live here too.
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { type ArtifactRef, api, formatAge, type InboxItem, type ReviewReport, type RunDetailResponse } from '../../api.ts'
import { AgeBadge, Imp, KindChip } from '../../components/chips.tsx'
import {
  ARM_INSTRUCTION,
  BOUNCED_INSTRUCTION,
  DecidePanel,
  INFLIGHT_INSTRUCTION,
  LOST_DISPATCH_INSTRUCTION,
  pausedInstruction,
  ROUND_CAP_INSTRUCTION,
} from '../../components/decide.tsx'
import { EscalationPacket } from '../../components/escalation.tsx'
import { G2Packet } from '../../components/evidence.tsx'
import { PacketSweep, useReviews } from '../../components/findings.tsx'
import { G0Packet, StagedBrief } from '../../components/g0.tsx'
import { G1Packet } from '../../components/g1.tsx'
import { G3Packet } from '../../components/g3.tsx'
import { CitedText } from '../../components/lexicon.tsx'
import { RoundCapPanel } from '../../components/rounds.tsx'
import { UnreadableState } from '../../components/unreadable-state.tsx'
import {
  Address,
  artifactHref,
  Instruction,
  isName,
  KindLabel,
  Name,
  QuotedPassage,
  QuotedWord,
} from '../../components/vocabulary.tsx'
import { gateCardState } from '../../gate-state.ts'
import { usd } from '../../money.ts'
import type { KeyHint } from '../../use-keys.ts'
import { aboutWords, inboxTitle, NameOrNothing, predatesFacts } from '../inbox.tsx'
import { FieldViewBody } from './record.tsx'

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
  // Ink, not the declined red: a bounced packet is the machine's turn, not an
  // error on the reader's screen (settled decision 8).
  if (item.kind === 'gate' && !item.reviewable) return { text: BOUNCED_INSTRUCTION, tone: 'font-medium text-ink' }
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

/**
 * The record's words and references a card's facts carry, as one string to
 * look for artifacts in (#433): an escalation's reason line — the engine's
 * words, which may name the artifact it is about — and the artifact a hand
 * edit is owed on. Never a sentence the cockpit wrote.
 */
function mentions(item: InboxItem): string {
  const edit = item.paused?.handEdit
  return [item.escalation?.reason ?? '', edit?.kind === 'contract-dispute' ? edit.artifact.path : ''].join(' ')
}

/** The task a card's facts name: a round cap's, or the one an escalation is about. */
export function factTask(item: InboxItem): string | null {
  if (item.roundCap) return item.roundCap.task
  const about = item.escalation?.about
  if (about && 'task' in about) return about.task
  const edit = item.paused?.handEdit
  return edit?.kind === 'unknown-status' ? edit.task : null
}

/**
 * The artifacts a decide card offers, as references (#423): the packet, then
 * any artifact the card's own prose names that the packet does not.
 *
 * Built from `InboxItem.packetRefs` and `RunDetailResponse.artifactRefs`, the
 * refs core derived (#415) — nothing here reads a path to learn a kind. A
 * payload from a server older than the refs carries neither, and the card
 * then offers no rows rather than guessing them back from paths.
 */
export function packetReferences(item: InboxItem, detail: RunDetailResponse): ArtifactRef[] {
  const packet = (item as { packetRefs?: ArtifactRef[] }).packetRefs
  if (!packet) return []
  const all = (detail as { artifactRefs?: ArtifactRef[] }).artifactRefs ?? []
  const prose = mentions(item)
  // The ledger is offered even though the rail lists it last: it is where the
  // decision grammar lives, and a paused or staged card has nothing else.
  const offered = packet.filter((r) => detail.artifacts.includes(r.path) || r.kind === 'state')
  const mentioned = all.filter((r) => !item.packet.includes(r.path) && prose.includes(r.path))
  return [...offered, ...mentioned]
}

/** The kind, in the framework's words: the contract's own name, sentence case. */
const kindLabel = (ref: ArtifactRef): string | null =>
  ref.contractName === null ? null : ref.contractName.charAt(0).toUpperCase() + ref.contractName.slice(1)

/**
 * The id the record uses for the artifact, or null for a kind the framework
 * fixes one per run (the kind label is then the whole name). A work item is
 * its id; a review is the task its header names, with its round where the
 * packet holds more than one review of that task. A review whose header is
 * unreadable goes by its number. `G<n>` is never a name for a spec.
 */
export function referenceName(ref: ArtifactRef, among: readonly ArtifactRef[]): { name: string; round: number | null } | null {
  if (ref.kind === 'review-report') {
    const task = ref.reviewOf?.task ?? null
    if (task === null || !isName(task)) return ref.id !== null && isName(ref.id) ? { name: ref.id, round: null } : null
    const shared = among.filter((r) => r.kind === 'review-report' && r.reviewOf?.task === task).length > 1
    return { name: task, round: shared ? (ref.reviewOf?.round ?? null) : null }
  }
  if (ref.id !== null && isName(ref.id)) return { name: ref.id, round: null }
  return null
}

/**
 * What a review concluded, as the chip carried it (#215): its verdict in force,
 * or the arc from its first round's to its last when the two differ. Only a
 * review has one; the words are the report's own.
 */
export function referenceVerdicts(ref: ArtifactRef, reports: readonly ReviewReport[] | undefined): string[] {
  if (ref.kind !== 'review-report') return []
  const report = reports?.find((r) => r.path === ref.path)
  const verdicts = (report?.rounds ?? []).map((r) => r.verdict).filter((v): v is NonNullable<typeof v> => v !== null)
  if (verdicts.length === 0) return []
  const first = verdicts[0]!
  const last = verdicts[verdicts.length - 1]!
  return verdicts.length > 1 && first !== last ? [first, last] : [last]
}

/**
 * The packet's artifacts as reference rows (#423, docs/SEAM.md §2, §5): the
 * kind, the record's name for it, the verdict it states, and its address.
 *
 * This was a row of `imp` chips printing the path — `tasks/06-pages-workflow.yaml`,
 * `review-04.md` — in the border that belongs to a quoted word. A filename is
 * where the bytes live, not what the reader is deciding on, so the row now
 * leads with what the framework knows the file to be and the id the record
 * uses for it. The path is still one gesture away: it follows the name, muted,
 * shown on hover or focus of the row (always, below `sm` or with no hover),
 * and it is in the DOM the whole time, so copying the row or reading it with a
 * screen reader gets the address too. The row is the link into the Record
 * reader, as the chip was.
 */
export function ReferenceRows({
  refs,
  reports,
  src,
  slug,
}: {
  refs: readonly ArtifactRef[]
  reports: readonly ReviewReport[] | undefined
  src: string
  slug: string
}) {
  if (refs.length === 0) return null
  return (
    <ul className="flex min-w-0 flex-col" data-packet-refs>
      {refs.map((ref) => {
        const kind = kindLabel(ref)
        const named = referenceName(ref, refs)
        const verdicts = referenceVerdicts(ref, reports)
        // An artifact the framework has no kind for has only its address; it
        // is shown in the open, after a UI word, rather than on hover. Below
        // `sm` every address is in the open: a phone has no hover, and there
        // the address wraps to a line of its own, so hiding it left a blank
        // line under the row (measured at 390px).
        const addressOnly = kind === null && named === null
        return (
          <li key={ref.path}>
            <Link
              to={artifactHref(src, slug, ref.path)}
              className="group flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 px-1.5 py-1 hover:bg-inset focus-visible:bg-inset"
              data-ref-row={ref.path}
              data-ref-kind={ref.kind}
            >
              <KindLabel className="shrink-0 sm:w-[8.5rem]">{kind ?? 'File'}</KindLabel>
              {named && (
                <Name lead className="shrink-0">
                  {named.name}
                </Name>
              )}
              {named?.round != null && <span className="shrink-0 font-ui text-[11px] text-muted">round {named.round}</span>}
              {verdicts.length > 0 && (
                <span className="inline-flex shrink-0 items-baseline gap-1" data-ref-verdict={verdicts.join(' → ')}>
                  <QuotedWord>{verdicts[0]!}</QuotedWord>
                  {verdicts[1] && (
                    <>
                      <span className="font-ui text-[11px] text-faint">→</span>
                      <QuotedWord>{verdicts[1]}</QuotedWord>
                    </>
                  )}
                </span>
              )}
              <span
                className={
                  addressOnly
                    ? 'min-w-0 [overflow-wrap:anywhere]'
                    : 'min-w-0 opacity-0 [overflow-wrap:anywhere] group-hover:opacity-100 group-focus-visible:opacity-100 max-sm:opacity-100 [@media(hover:none)]:opacity-100'
                }
                data-ref-address
              >
                <Address size="xs">{ref.path}</Address>
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
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
  const task = factTask(item)
  const mentionedTask = task === null ? null : (detail.state?.tasks.find((t) => t.id === task) ?? null)
  // The packet as reference rows (#423). A chip that named a review carried
  // what that review concluded (#215), and the row keeps it: the G2 approver
  // should not have to open three files to learn that one said request-changes.
  const refs = packetReferences(item, detail)
  const chips = refs.length > 0 ? <ReferenceRows refs={refs} reports={reports} src={item.source} slug={item.slug} /> : null
  // Three chromes for three states (#159). An in-flight card is neither the
  // lifted accent of something to decide nor the red of something broken: it is
  // a card at rest, waiting on a machine, and its eyebrow says so rather than
  // claiming the human's attention for work that is already moving.
  const gateState = gateCardState(item)
  const inflight = gateState === 'inflight' ? item.inflight : null
  // Three impressions for three states (#159), in the inbox's colours
  // (settled decision 8): a gate ready to decide is the signal blue, hollow;
  // a card waiting on a machine and a bounced packet — which the engine
  // re-dispatches — are both dotted, the machine's turn, with the words
  // saying which. Any other kind's card says `needs you` in the plain mark and
  // lets its kind chip carry the colour (an escalation's caution, a malformed
  // record's red): an ink fill there was the heaviest mark on the card and, in
  // the impression grammar, the texture of a decision already taken. The card
  // itself is not boxed: it is a posting on the page, ruled above, with its
  // evidence and its affordance below.
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
            <Imp tone="dot">bounced{item.gate ? ` · ${item.gate}` : ''}</Imp>
          ) : (
            <Imp tone={item.kind === 'gate' ? 'go' : ''}>needs you{item.gate ? ` · ${item.gate}` : ''}</Imp>
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
        <h2 className="mt-3 mb-1.5 text-[22px] font-semibold leading-[1.2] text-ink" data-card-title>
          {inboxTitle(item)}
        </h2>
        <CardFacts item={item} now={now} />
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
        {/* G2's packet, composed in criterion order (#256). The one-line
            citation map this replaced still renders on verification-report.md
            itself, where the report's own markdown is already on screen. */}
        {/* G0's packet (#440): the spec's Assumptions leading, its requirement
            roster, and the brief's Problem and Constraints beside them.
            Rendered on a bounced card too, as G3's is: a spec missing its
            Assumptions says so in the packet, where the approver looks. */}
        {item.kind === 'gate' && item.gate === 'G0' && <G0Packet src={item.source} slug={item.slug} />}
        {/* G1's packet (#255): coverage against the plan's own mapping table,
            and the surface overlaps no dependency orders. A patch run has no
            plan, and its G1 absorbs the G0 question — brief and work item are
            approved together — so it takes G0's packet instead: the brief
            half and the work item, read as fields (#440, #442). */}
        {item.kind === 'gate' && item.gate === 'G1' && detail.summary.profile !== 'patch' && (
          <G1Packet src={item.source} slug={item.slug} />
        )}
        {item.kind === 'gate' && item.gate === 'G1' && detail.summary.profile === 'patch' && (
          <G0Packet src={item.source} slug={item.slug} mode="patch">
            <PatchWorkItems refs={item.packetRefs} src={item.source} slug={item.slug} />
          </G0Packet>
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
            rounds at once (#257). The reference rows below still offer every
            report; this is the comparison a list of files could not be. */}
        {item.kind === 'round-cap' && <RoundCapPanel src={item.source} slug={item.slug} task={mentionedTask?.id ?? null} />}
        {/* An escalation a role raised is a decision the role wrote down (#407):
            its Escalation section, verbatim, and the routes as it sees them,
            so the Resolve form's routes are read against something. An
            engine-originated one renders nothing here — its reason line above
            is the whole packet. */}
        {item.kind === 'escalation' && item.escalationIndex !== null && (
          <EscalationPacket src={item.source} slug={item.slug} index={item.escalationIndex} refs={item.packetRefs} />
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

/** The card's fact lines share one measure and one reading size. */
const FACT_LINE = 'max-w-[var(--measure)] text-[14.5px] leading-[1.55] text-ink'

/**
 * The card's own lines under its title, composed here from the item's facts
 * (#433, docs/SEAM.md §7 "facts, not sentences"). The card used to print
 * core's `detail` — a sentence written for the inbox row — and guess, word by
 * word, whether it restated the title (#294); it now says
 * only what the facts carry that the title and the eyebrow have not, in four
 * voices a reader can tell apart: the record's words quoted, its ids named,
 * addresses muted and following a name, and the cockpit's instructions
 * unboxed.
 */
export function CardFacts({ item, now }: { item: InboxItem; now: number }) {
  if (predatesFacts(item)) return <KeptSentences item={item} />
  switch (item.kind) {
    case 'gate':
      return <GateFacts item={item} now={now} />
    case 'escalation':
      return <EscalationFacts item={item} />
    case 'round-cap':
      // The round-cap panel below says what a breach usually means.
      return null
    case 'paused':
      return <PausedFacts item={item} />
    case 'staged':
      return <StagedFacts item={item} now={now} />
    case 'malformed':
      // The parser's diagnostic is the fact: a message, the offending line and
      // a caret under the column it failed at, which only `<pre>` keeps under
      // the character it names (#285/1). Byte for byte, labelled by producer.
      // Any other reason there is no state is the cockpit's sentence, never
      // set under the parser's name (#435).
      return item.unreadable ? (
        <div className="max-w-[var(--measure)]" data-card-diagnostic>
          <UnreadableState problem={item.unreadable} src={item.source} slug={item.slug} />
        </div>
      ) : null
  }
}

/**
 * An item from a server built before the facts (#433): its kept `detail`, as
 * the card printed it before, and a bounced gate's problems. For the one
 * release `title` and `detail` are kept (#411 step 8); delete with them.
 */
function KeptSentences({ item }: { item: InboxItem }) {
  const problems = item.kind === 'gate' ? item.problems : []
  return (
    <div className="flex flex-col gap-1" data-kept-sentences>
      {item.detail.includes('\n') ? (
        <pre className="max-w-[var(--measure)] overflow-x-auto whitespace-pre-wrap font-mono text-[12.5px] leading-[1.55] text-ink">
          {item.detail}
        </pre>
      ) : (
        <p className={FACT_LINE}>
          <CitedText>{item.detail}</CitedText>
        </p>
      )}
      {problems.map((p) => (
        <p key={p} className="font-mono text-[12px] text-ink">
          ✕ {p}
        </p>
      ))}
    </div>
  )
}

/**
 * A bounced gate names what failed (R3): each artifact by its contract's
 * name, its file as the address beside that name, and the missing sections or
 * keys as the contract spells them. A producer that re-dispatched and never
 * landed is said, with what to do about it; one still in flight is the
 * eyebrow's and the instruction's to say.
 */
function GateFacts({ item, now }: { item: InboxItem; now: number }) {
  const bounces = item.bouncedBy ?? []
  const waiting = item.waitingOn
  if (bounces.length === 0 && !waiting?.lost) return null
  return (
    <div className="flex flex-col gap-1">
      {bounces.map((b) => (
        <p key={b.path} className={FACT_LINE} data-bounce={b.path}>
          {b.absent ? (
            <>
              The {b.contractName ?? 'artifact'} is missing from the run <Address size="xs">{b.path}</Address>
            </>
          ) : (
            <>
              Fails its {b.contractName ?? 'artifact'} contract <Address size="xs">{b.path}</Address> — missing required {b.unit}:{' '}
              {b.missing.map((m, i) => (
                <span key={m}>
                  {i > 0 && ', '}
                  {isName(m) ? <Name>{m}</Name> : <code className="font-mono text-[11.5px] text-ink">{m}</code>}
                </span>
              ))}
            </>
          )}
        </p>
      ))}
      {waiting?.lost && isName(waiting.role) && (
        <>
          <p className={FACT_LINE} data-lost-dispatch>
            The <Name>{waiting.role}</Name> was re-dispatched {formatAge(waiting.since, now)} ago and has not landed the{' '}
            {waiting.artifact.contractName ?? 'artifact'}.
          </p>
          <Instruction className="max-w-[var(--measure)]">{LOST_DISPATCH_INSTRUCTION}</Instruction>
        </>
      )}
    </div>
  )
}

/**
 * What an escalation is about, and its reason line when that line is the
 * substance (docs/SEAM.md §3): an engine-originated escalation's reason is its
 * whole packet, and a role that wrote its words into the entry said them
 * there. A line that only points at the report the packet below already
 * opens (`… — see review-04.md`) is not repeated; History keeps it.
 */
function EscalationFacts({ item }: { item: InboxItem }) {
  const esc = item.escalation
  if (!esc) return null
  const about = esc.about
  return (
    <div className="flex flex-col gap-2">
      {about && (
        <p className={FACT_LINE} data-escalation-about>
          {aboutWords(about, 'About')}
        </p>
      )}
      {!esc.pointer && (
        <RecordPassage label="Reason, as recorded" data-escalation-reason>
          {esc.reason}
        </RecordPassage>
      )}
    </div>
  )
}

/** A line of the record's, quoted as a passage under the label that says whose it is. */
function RecordPassage({ label, children, ...rest }: { label: string; children: string } & { [k: `data-${string}`]: string | boolean }) {
  return (
    <div className="max-w-[var(--measure)]" {...rest}>
      <KindLabel tone="muted">{label}</KindLabel>
      <QuotedPassage className="mt-1 text-[14px] leading-[1.55]">
        <CitedText>{children}</CitedText>
      </QuotedPassage>
    </div>
  )
}

/**
 * A paused run: the facts that decide what clears it, then the cockpit's
 * instruction for its reason (#96, #348). A human's free-text hold reason is
 * quoted as a passage; the engine's own line for the pause, when the record
 * has one, is quoted beside the counts — rule DB pauses on *projected* spend,
 * so the counts alone would misstate why. The budget names the key the resume
 * form writes, as an address; a hand edit names the artifact, the keys or the
 * task it is owed on.
 */
function PausedFacts({ item }: { item: InboxItem }) {
  const paused = item.paused
  if (!paused) return null
  const budget = paused.budget
  const edit = paused.handEdit
  return (
    <div className="flex flex-col gap-1.5">
      {paused.freeText && paused.reason && (
        <RecordPassage label="Hold reason, as recorded" data-paused-hold>
          {paused.reason}
        </RecordPassage>
      )}
      {paused.reason === 'budget-exhausted' && budget && (
        <p className={FACT_LINE} data-paused-budget>
          {budget.spent !== null && <>{usd(budget.spent)} spent · </>}
          {budget.limit !== null ? (
            <>
              limit {usd(budget.limit)}, set by <Address size="xs">cost_limit_usd</Address>
            </>
          ) : (
            <>
              the run has no <Address size="xs">cost_limit_usd</Address>
            </>
          )}
        </p>
      )}
      {paused.cause && (
        <RecordPassage label={paused.reason === 'budget-exhausted' ? 'The engine’s reason, as recorded' : 'Last resolved escalation, as recorded'} data-paused-cause>
          {paused.cause}
        </RecordPassage>
      )}
      {edit?.kind === 'contract-dispute' && (
        <p className={FACT_LINE} data-hand-edit={edit.kind}>
          The {edit.artifact.contractName ?? 'artifact'} to fix <Address size="xs">{edit.artifact.path}</Address>
        </p>
      )}
      {edit?.kind === 'profile-violation' && (
        <p className={FACT_LINE} data-hand-edit={edit.kind}>
          Profile <Name>{edit.profile}</Name>, set by <Address size="xs">profile</Address>; the phase by{' '}
          <Address size="xs">phase</Address>
        </p>
      )}
      {edit?.kind === 'no-task-files' && (
        <p className={FACT_LINE} data-hand-edit={edit.kind}>
          Work items land at <Address size="xs">tasks/*.yaml</Address>
        </p>
      )}
      {edit?.kind === 'unknown-status' && (
        <p className={FACT_LINE} data-hand-edit={edit.kind}>
          Task <NameOrNothing id={edit.task} /> has status <QuotedWord>{edit.status}</QuotedWord>; the table knows{' '}
          {edit.known.map((k, i) => (
            <span key={k}>
              {i > 0 && ' '}
              <QuotedWord>{k}</QuotedWord>
            </span>
          ))}
        </p>
      )}
      <Instruction className="max-w-[var(--measure)]">{pausedInstruction(paused)}</Instruction>
    </div>
  )
}

/**
 * A staged run: what it is for, and the terms the Arm button accepts (#433,
 * #440). Arming is where the budget starts to meter, so the card says what
 * arming spends against before it offers the button: who staged the run and
 * when, the brief's Problem and Constraints quoted, the profile as the Name
 * the record gives it, and the ceiling `cost_limit_usd` records.
 */
function StagedFacts({ item, now }: { item: InboxItem; now: number }) {
  const staged = item.staged
  return (
    <div className="flex flex-col gap-2">
      {staged?.by && (
        <p className={FACT_LINE} data-staged-by>
          Staged by <span className="font-semibold">{staged.by}</span>
          {staged.at !== null && <> {formatAge(staged.at, now)} ago</>}
        </p>
      )}
      <StagedBrief src={item.source} slug={item.slug} />
      {staged && (
        // The facts the record states, and only those: whether the engine
        // enforces the ceiling, or requires one, is its flag, not the
        // record's, so the card claims neither (#442).
        <p className={FACT_LINE} data-staged>
          Profile <Name>{staged.profile}</Name> ·{' '}
          {staged.budgetCeiling === null ? (
            <>
              no ceiling — <Address size="xs">cost_limit_usd</Address> unset
            </>
          ) : (
            <>
              budget ceiling{' '}
              <span className="font-ui tabular-nums" data-budget-ceiling={staged.budgetCeiling}>
                {usd(staged.budgetCeiling)}
              </span>
              , set by <Address size="xs">cost_limit_usd</Address>
            </>
          )}
        </p>
      )}
      <Instruction className="max-w-[var(--measure)]">{ARM_INSTRUCTION}</Instruction>
    </div>
  )
}

/**
 * The work item a patch run's G1 approves with the brief (DESIGN.md §4.1),
 * read as fields over its contract's keys (#434's field view, the reader's
 * own), headed by its id and the title the author wrote. The bytes are one
 * toggle away inside the view, as in the reader.
 */
function PatchWorkItems({ refs, src, slug }: { refs: readonly ArtifactRef[]; src: string; slug: string }) {
  const items = refs.filter((r) => r.kind === 'work-item')
  if (items.length === 0) return null
  return (
    <div className="mt-2.5 flex flex-col gap-2" data-patch-work-items>
      {items.map((ref) => (
        <PatchWorkItem key={ref.path} artifact={ref} src={src} slug={slug} />
      ))}
    </div>
  )
}

function PatchWorkItem({ artifact, src, slug }: { artifact: ArtifactRef; src: string; slug: string }) {
  const { data } = useQuery({ queryKey: ['artifact', src, slug, artifact.path], queryFn: () => api.artifact(src, slug, artifact.path) })
  const fields = data?.fields ?? null
  const title = fields?.fields.find((f) => f.key === 'title')
  return (
    <div data-patch-work-item={artifact.id ?? artifact.path}>
      <p className="flex flex-wrap items-baseline gap-x-2">
        <KindLabel tone="muted">Work item</KindLabel>
        {artifact.id !== null && isName(artifact.id) && <Name lead>{artifact.id}</Name>}
        {title?.kind === 'passage' && <span className="text-[12.5px] font-medium text-ink">{title.value}</span>}
      </p>
      {!data ? (
        <PacketSweep />
      ) : fields ? (
        <div className="mt-1 border border-line bg-surface px-3 py-2 text-[12.5px]">
          <FieldViewBody view={fields} content={data.content} kind="work-item" src={src} slug={slug} />
        </div>
      ) : null}
    </div>
  )
}
