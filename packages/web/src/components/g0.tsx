// G0's packet (#440, #442, docs/SEAM.md §7): the spec read for "Is this what
// we actually want built?", beside the brief it answers.
//
// G0 had no packet: the card was the question, the buttons, and a row of
// references, and the one section the spec contract writes for this approver —
// Assumptions, "G0 can veto a stated choice, never a hidden one" — was
// reachable only by opening the spec whole. Core reads both artifacts; this
// decides how they read. In the order the gate asks:
//
//   1. Assumptions — every word of the section, first, because a stated
//      choice is what G0 can still veto cheaply: each list item quoted whole
//      with its marker, and each run of prose around the list (a lead-in that
//      tees a choice up, a sub-heading, a fenced example) quoted as its own
//      passage. Each passage's line is one gesture away, and one click lands
//      on it in the Record reader.
//   2. Requirements — the roster: each `R<n>` as a resolvable Name and its
//      short name as the heading says it. A heading the grammar cannot parse
//      withholds the roster's completeness, and its count with it.
//   3. The brief's Problem and Constraints, quoted beside the spec half and
//      captioned by kind, so the spec's choices are read against what was
//      asked.
//   4. The spec's Out of scope, folded exactly when the spec contract's
//      `AUDIENCE:` line calls it audit-time — the packet carries that
//      audience from validation, and a contract that does not say so leaves
//      the section open.
//
// Presence only. The spec half and the brief half sit side by side and
// nothing here relates them: no contract grammar links a brief's sentence to
// a requirement, so there is no coverage line, no count across the two, and
// no tint on either half. The one count is within the spec: how many
// requirements it heads, shown only when the roster is whole.
//
// The patch profile's G1 absorbs the G0 question — DESIGN.md §4.1: the brief
// and the work item are approved together — so its card takes the brief half
// (Problem, Constraints, Out of scope) and the card's own work item beside
// it (`children`). A patch run has no analyst and so no spec; this view has
// no spec half there, rather than one that could only ever withhold. The
// staged card reads the brief half through `StagedBrief`.

import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import {
  type AssumptionPassage,
  api,
  type G0Packet as G0PacketData,
  type G0Requirement,
  type Quotation,
  type QuotedSection,
  type WithheldReason,
} from '../api.ts'
import { lineAnchor } from '../line-anchor.ts'
import { PACKET_FRAME, PACKET_LABEL, PacketSweep } from './findings.tsx'
import { GroupLabel } from './g1.tsx'
import { Markdown } from './markdown.tsx'
import { Address, artifactHref, Count, Fold, KindLabel, Name, QuotedPassage, Withheld } from './vocabulary.tsx'

type Mode = 'gate' | 'patch'

const useG0 = (src: string, slug: string) => useQuery({ queryKey: ['g0', src, slug], queryFn: () => api.g0(src, slug) })

/**
 * The packet on a G0 card (`mode="gate"`), or on a patch run's G1 card
 * (`mode="patch"`): the brief half, with the card's work item as `children`.
 */
export function G0Packet({ src, slug, mode = 'gate', children }: { src: string; slug: string; mode?: Mode; children?: ReactNode }) {
  const { data, isPending } = useG0(src, slug)
  const label = `${mode === 'gate' ? 'G0' : 'G1'} packet — composed from the record`
  // Frame and label first, content when it arrives (#299): a card that renders
  // nothing while the read is in flight is shaped like a card with no packet.
  if (isPending) {
    return (
      <section className={PACKET_FRAME} data-g0-packet aria-busy="true">
        <p className={PACKET_LABEL}>{label}</p>
        <PacketSweep />
      </section>
    )
  }
  if (!data) return null
  const packet: G0PacketData = data
  if (mode === 'patch') {
    return (
      <section className={PACKET_FRAME} data-g0-packet data-g0-mode={mode}>
        <p className={PACKET_LABEL}>{label}</p>
        <div data-g0-brief>
          <BriefHalf packet={packet} src={src} slug={slug} />
          <SectionView
            label="Out of scope, from the brief"
            view="Out of scope"
            section={packet.briefOutOfScope}
            reason={packet.briefOutOfScopeWithheld}
            owner="brief"
            src={src}
            slug={slug}
            hook="brief-out-of-scope"
          />
        </div>
        {children}
      </section>
    )
  }
  return (
    <section className={`${PACKET_FRAME} @container`} data-g0-packet data-g0-mode={mode}>
      <p className={PACKET_LABEL}>{label}</p>
      {/* Two columns only where the card is wide enough to hold both at a
          reading measure; below that the brief follows the spec half. The
          spec half leads either way: Assumptions are what G0 vetoes. */}
      <div className="grid grid-cols-1 gap-x-5 @3xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="min-w-0" data-g0-spec>
          <Assumptions packet={packet} src={src} slug={slug} />
          <Roster packet={packet} src={src} slug={slug} />
        </div>
        <div className="min-w-0" data-g0-brief>
          <BriefHalf packet={packet} src={src} slug={slug} />
        </div>
      </div>
      <SectionView
        label="Out of scope"
        view="Out of scope"
        section={packet.outOfScope}
        reason={packet.outOfScopeWithheld}
        owner="spec"
        src={src}
        slug={slug}
        hook="out-of-scope"
      />
    </section>
  )
}

/** The fork fallback for a part of this packet, composed from its structured reason (#424). */
function PartWithheld({ view, reason, src, slug, hook }: { view: string; reason: WithheldReason; src: string; slug: string; hook: string }) {
  return <Withheld view={view} reason={reason} src={src} slug={slug} className="mt-1.5" data-withheld={hook} />
}

/**
 * Where a quotation starts: `at` and its address, linked into the Record
 * reader. A requirement's link lands on its heading (`def-R<n>`, the anchor
 * the lexicon stamps); every other quotation lands on its line (`L<n>`,
 * #441), its fold opened.
 */
function At({ quote, src, slug, anchor }: { quote: Pick<Quotation, 'at'>; src: string; slug: string; anchor?: string }) {
  return (
    <span className="font-ui text-[11px] text-faint" data-at>
      at{' '}
      <Address size="xs" to={artifactHref(src, slug, quote.at.path, anchor ?? lineAnchor(quote.at.line))}>
        {`${quote.at.path}:${quote.at.line}`}
      </Address>
    </span>
  )
}

/**
 * The address of a row, shown on hover or focus of the row — the way the
 * packet's reference rows show theirs — and always below `sm` or with no
 * hover, where there is no gesture to reveal it. In the DOM the whole time.
 *
 * `corner` floats it to the top right of a quoted passage, ahead of the
 * passage's words, so the words wrap around it: it holds a corner of the
 * first line rather than a line of its own, which at rest read as a blank
 * line under every quotation (measured at 1440).
 */
function Reveal({ children, corner = false }: { children: ReactNode; corner?: boolean }) {
  return (
    <span
      className={`min-w-0 opacity-0 [overflow-wrap:anywhere] group-hover:opacity-100 group-focus-within:opacity-100 max-sm:opacity-100 [@media(hover:none)]:opacity-100 ${corner ? 'float-right ml-3' : ''}`}
    >
      {children}
    </span>
  )
}

/**
 * One quotation in its hairline box, its address in the corner. An item keeps
 * its list marker, so it renders as the list it is — an indented paragraph
 * under it stays a paragraph of the item, not a code block — with the bullet
 * itself suppressed: one item per box needs no bullet to say it is one. An
 * ordered item keeps its number, which is the record's.
 */
function Passage({ quote, item = false, src, slug, ...rest }: { quote: Quotation; item?: boolean; src: string; slug: string } & { [k: `data-${string}`]: string | number }) {
  return (
    <QuotedPassage as="li" className="group" {...rest}>
      <Reveal corner>
        <At quote={quote} src={src} slug={slug} />
      </Reveal>
      {/* Important: `.prose-card ul` is an unlayered rule, which outranks any utility layer. */}
      <div className={`prose-card${item ? ' [&>ul]:list-none! [&>ul]:pl-0! [&>ul]:mb-0!' : ''}`}>
        <Markdown unwrapped>{quote.text}</Markdown>
      </div>
    </QuotedPassage>
  )
}

/**
 * The Assumptions, every word of the section. They lead: the contract writes
 * this section for the G0 approver, and a choice stated here is the one the
 * gate can still veto.
 */
function Assumptions({ packet, src, slug }: { packet: G0PacketData; src: string; slug: string }) {
  return (
    <div data-g0-assumptions>
      <GroupLabel hint="each ambiguity in the brief, and the choice the spec made">Assumptions</GroupLabel>
      {packet.assumptionsWithheld ? (
        <PartWithheld view="Assumptions" reason={packet.assumptionsWithheld} src={src} slug={slug} hook="assumptions" />
      ) : packet.assumptions.length === 0 ? (
        <p className="mt-1.5 text-[12.5px] text-muted" data-g0-empty="assumptions">
          The spec’s Assumptions section is empty.
        </p>
      ) : (
        <ul className="mt-1.5 flex flex-col gap-1">
          {packet.assumptions.map((a: AssumptionPassage) => (
            <Passage key={a.at.line} quote={a} item={a.kind === 'item'} src={src} slug={slug} data-assumption={a.at.line} data-passage-kind={a.kind} />
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * The requirement roster: what the spec says will be built, by the ids every
 * later gate cites. A Name resolves to its definition on hover; the address
 * lands on the heading. The count stands only over a whole roster: when a
 * heading names a requirement the grammar cannot parse, the roster says so
 * and lists what it read, uncounted.
 */
function Roster({ packet, src, slug }: { packet: G0PacketData; src: string; slug: string }) {
  return (
    <div data-g0-requirements>
      <GroupLabel hint="as the spec heads them; each id is cited downstream">Requirements</GroupLabel>
      {packet.requirementsWithheld ? (
        <PartWithheld view="Requirement roster" reason={packet.requirementsWithheld} src={src} slug={slug} hook="requirements" />
      ) : (
        <p className="mt-1 text-[11px] text-muted">
          <Count n={packet.requirements.length} one="requirement" many="requirements" />
        </p>
      )}
      {packet.requirements.length > 0 && (
        <ul className="mt-1 flex flex-col">
          {packet.requirements.map((r) => (
            <RosterRow key={`${r.id}-${r.at.line}`} req={r} src={src} slug={slug} />
          ))}
        </ul>
      )}
    </div>
  )
}

function RosterRow({ req, src, slug }: { req: G0Requirement; src: string; slug: string }) {
  return (
    <li className="group flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 px-1.5 py-1 hover:bg-inset" data-requirement={req.id}>
      <Name lead resolve className="shrink-0">
        {req.id}
      </Name>
      <span className="min-w-0 text-[12.5px] font-medium text-ink">{req.name}</span>
      <Reveal>
        <At quote={req} src={src} slug={slug} anchor={`def-${req.id}`} />
      </Reveal>
    </li>
  )
}

/**
 * One section quoted whole, under the kind that says whose words they are.
 * Folded when — and only when — its contract calls it audit-time (docs/SEAM.md
 * §5 Fold: "an audit-time section … reduced to heading"); present but holding
 * nothing but the template's comment, it says it is empty; missing, it says
 * what it looked for.
 */
function SectionView({
  label,
  view,
  section,
  reason,
  owner,
  src,
  slug,
  hook,
}: {
  label: string
  view: string
  section: QuotedSection | null
  reason: WithheldReason | null
  owner: 'spec' | 'brief'
  src: string
  slug: string
  hook: string
}) {
  if (section === null) {
    return reason ? <PartWithheld view={view} reason={reason} src={src} slug={slug} hook={hook} /> : null
  }
  const body =
    section.body === null ? (
      <p className="text-[12.5px] text-muted" data-g0-empty={hook}>
        The {owner}’s {section.heading} section is empty.
      </p>
    ) : (
      <ul className="flex flex-col">
        <Passage quote={section.body} src={src} slug={slug} data-quote={hook} />
      </ul>
    )
  if (section.audience === 'audit') {
    return (
      <Fold heading={section.heading} className="mt-2.5" data-g0-fold={hook}>
        {body}
      </Fold>
    )
  }
  return (
    <div className="mt-2.5" data-g0-section={hook}>
      <KindLabel as="p" tone="muted" className="mb-1">
        {label}
      </KindLabel>
      {body}
    </div>
  )
}

/** The brief's Problem and Constraints, verbatim; a missing section withholds, and what is there still renders. */
function BriefHalf({ packet, src, slug }: { packet: G0PacketData; src: string; slug: string }) {
  return (
    <>
      <SectionView label="Problem, from the brief" view="Problem" section={packet.problem} reason={null} owner="brief" src={src} slug={slug} hook="problem" />
      <SectionView
        label="Constraints, from the brief"
        view="Constraints"
        section={packet.constraints}
        reason={null}
        owner="brief"
        src={src}
        slug={slug}
        hook="constraints"
      />
      {packet.briefWithheld && <PartWithheld view="Problem and Constraints" reason={packet.briefWithheld} src={src} slug={slug} hook="brief" />}
    </>
  )
}

/**
 * The brief half on a staged card: what the run is for, quoted, beside the
 * terms arming accepts. No frame and no eyebrow — the card's own lines are the
 * packet there, and the passages are captioned by kind.
 */
export function StagedBrief({ src, slug }: { src: string; slug: string }) {
  const { data, isPending } = useG0(src, slug)
  if (isPending) return <PacketSweep />
  if (!data) return null
  return (
    <div className="max-w-[var(--measure)] [&>div:first-child]:mt-0" data-staged-brief>
      <BriefHalf packet={data} src={src} slug={slug} />
    </div>
  )
}
