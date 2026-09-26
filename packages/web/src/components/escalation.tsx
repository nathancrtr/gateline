// The escalation packet (#407): the escalating role's own words on the card,
// not a pointer to a file.
//
// The card showed the engine's reason line — `reviewer escalated task
// 04-fixture-label — see review-04.md` — and a chip, and the Resolve form
// asked for a disposition and a route before the human had seen what was
// asked. What was behind the click: a paragraph naming the requirement, the
// plan's omission, the file no remaining task owns, and two options that map
// almost directly onto the routes the form offers.
//
// Core joins the escalation record with the report it names (#405 gave the
// report a section to read). This decides how it reads, in the order the
// human resolves it:
//
//   1. What is defective — the section's fields (traces to, outside every
//      remaining surface / criteria affected) and its paragraph, verbatim.
//   2. The routes as the escalating role sees them — the section's options,
//      so the Resolve form's radio group is read against them.
//   3. The report — its own verdict on the diff when it gave one, the
//      standing findings, and one click to the artifact.
//
// An engine-originated escalation renders nothing here: its reason is the
// whole packet, and the card already shows it. A report without the section
// withholds the packet and names the grammar it looked for.
//
// Presence, not verdicts. No route is recommended, no option is ranked, and
// nothing is restated in the packet's own words.

import { useQuery } from '@tanstack/react-query'
import { api, type EscalationPacket as EscalationPacketData } from '../api.ts'
import { PACKET_FRAME, PACKET_LABEL, PacketSweep } from './findings.tsx'
import { GroupLabel } from './g1.tsx'
import { Markdown } from './markdown.tsx'
import { Address, artifactHref, FieldRow, QuotedPassage, Withheld } from './vocabulary.tsx'

export function EscalationPacket({ src, slug, index }: { src: string; slug: string; index: number }) {
  const { data, isPending } = useQuery({
    queryKey: ['escalation', src, slug, index],
    queryFn: () => api.escalation(src, slug, index),
  })
  if (isPending) {
    return (
      <section className={PACKET_FRAME} data-escalation-packet aria-busy="true">
        <p className={PACKET_LABEL}>Escalation packet — composed from the record</p>
        <PacketSweep />
      </section>
    )
  }
  if (!data || data.origin === 'engine') return null
  const packet: EscalationPacketData = data
  const who = packet.role ?? 'the escalating role'
  return (
    <section className={PACKET_FRAME} data-escalation-packet data-origin={packet.origin}>
      <p className={PACKET_LABEL}>Escalation packet — composed from the record</p>
      {packet.withheld ? (
        <Withheld view="Escalation view" reason={packet.withheld} src={src} slug={slug} className="mt-1.5" data-withheld="section" />
      ) : (
        <>
          <Defect packet={packet} who={who} />
          <Routes packet={packet} who={who} />
        </>
      )}
      <Report packet={packet} src={src} slug={slug} />
    </section>
  )
}

/**
 * What is defective, in the escalating role's words. The fields lead because
 * they are the grammar — where it traces, whose surface it falls outside —
 * and the paragraph follows because READABILITY makes its first sentence the
 * takeaway. `Diff verdict` is not here: it is a fact about the report, below.
 */
/**
 * The section's prose, split at the list's lead-in. The contract's shape is a
 * paragraph, then "The options as I see them:" and the list; the parser keeps
 * the lead-in with the prose because it is prose. On the card the list sits
 * under its own label, so a lead-in left at the foot of the paragraph box
 * would point at nothing. It moves to head the list — every word still
 * shown, in the place it was written to introduce.
 */
function splitLeadIn(prose: string): { body: string; leadIn: string | null } {
  const lines = prose.split('\n')
  let last = lines.length - 1
  while (last >= 0 && lines[last]!.trim() === '') last--
  if (last < 0 || !lines[last]!.trim().endsWith(':')) return { body: prose, leadIn: null }
  return { body: lines.slice(0, last).join('\n').trim(), leadIn: lines[last]!.trim() }
}

function Defect({ packet, who }: { packet: EscalationPacketData; who: string }) {
  const section = packet.section!
  const fields = Object.entries(section.fields).filter(([label]) => label !== 'Diff verdict')
  const { body } = splitLeadIn(section.prose)
  return (
    <div data-escalation-defect>
      <GroupLabel hint={`what ${who} found, verbatim`}>What is defective</GroupLabel>
      {fields.length > 0 && (
        <ul className="mt-1.5 flex flex-col gap-1">
          {fields.map(([label, value]) => (
            <FieldRow key={label} label={label} data-escalation-field={label.toLowerCase().replace(/[^a-z]+/g, '-')}>
              <Markdown unwrapped>{value}</Markdown>
            </FieldRow>
          ))}
        </ul>
      )}
      {body && (
        <QuotedPassage className="mt-1.5" data-escalation-prose>
          <div className="prose-card">
            <Markdown unwrapped>{body}</Markdown>
          </div>
        </QuotedPassage>
      )}
    </div>
  )
}

/**
 * The routes as the escalating role sees them. Numbered so the human can name
 * one in the disposition note; not ranked, because the role recommends and
 * never decides, and the order is the order the section wrote them in.
 */
function Routes({ packet, who }: { packet: EscalationPacketData; who: string }) {
  const options = packet.section!.options
  if (options.length === 0) return null
  const { leadIn } = splitLeadIn(packet.section!.prose)
  return (
    <div data-escalation-routes>
      <GroupLabel hint={`as ${who} sees them — the Resolve form's routes are read against these`}>Options</GroupLabel>
      {leadIn && (
        <p className="mt-1.5 text-[12.5px] leading-[1.5] text-muted" data-escalation-lead-in>
          {leadIn}
        </p>
      )}
      <ol className="mt-1.5 flex flex-col gap-1">
        {options.map((o, i) => (
          <QuotedPassage as="li" key={o} data-escalation-option={i + 1}>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="shrink-0 font-mono text-[11.5px] font-semibold text-ink">{i + 1}.</span>
              <div className="prose-card min-w-0 flex-1">
                <Markdown unwrapped>{o}</Markdown>
              </div>
            </div>
          </QuotedPassage>
        ))}
      </ol>
    </div>
  )
}

/**
 * The report behind the escalation: its own verdict on the diff when it gave
 * one (ESCALATE SCOPE lets a review approve the diff and escalate the run at
 * once), the findings still standing, and the artifact itself one click away.
 */
function Report({ packet, src, slug }: { packet: EscalationPacketData; src: string; slug: string }) {
  const diffVerdict = packet.section?.diffVerdict ?? null
  return (
    <div data-escalation-report>
      <GroupLabel hint="the artifact the escalation lives in">The report</GroupLabel>
      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1 border border-line bg-surface px-3 py-2 text-[12.5px]">
        {/* #411 step 3: the report is named by its kind, and this Address
            follows the name instead of leading the row. */}
        <Address size="md" to={artifactHref(src, slug, packet.artifact!)}>
          {packet.artifact!}
        </Address>
        {packet.reportVerdict && (
          <span className="text-muted">
            verdict <span className="font-mono text-ink">{packet.reportVerdict}</span>
          </span>
        )}
        {diffVerdict && (
          <span className="text-muted" data-escalation-diff-verdict={diffVerdict}>
            the diff itself: <span className="font-mono text-ink">{diffVerdict}</span>
          </span>
        )}
        {packet.standingFindings !== null && (
          <span className="text-muted" data-escalation-standing={packet.standingFindings}>
            {packet.standingFindings === 1 ? '1 finding standing' : `${packet.standingFindings} findings standing`}
          </span>
        )}
      </div>
    </div>
  )
}
