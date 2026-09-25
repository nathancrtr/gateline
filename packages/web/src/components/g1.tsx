// G1's packet (#255): the two claims the gate asks about, made checkable.
//
// "Is this how we'd want it built, cut into safe parallel pieces?" is two
// questions. Before this, plan.md and N task files rendered as sibling entries
// in an alphabetical list, opened one at a time in a 280px column — the
// approver held the coverage check and the overlap check in their head.
//
// Core computes both; this decides how they read. Three parts, in the order the
// gate asks them:
//
//   1. Coverage — every requirement the spec defines, against the plan's own
//      mapping table. An unmapped requirement leads, because contracts/plan.md
//      says an uncovered requirement is a malformed plan.
//   2. Parallel safety — the surface overlaps between work items, with the ones
//      no `depends_on` orders called out.
//   3. Decisions — the ADR cards, elided to their Choice line by the lexicon,
//      with the argument one click away and byte-identical.
//
// Presence, not verdicts. Every count here is a count of record entries, never
// a score: no coverage percentage, no plan grade, and an ordered overlap is
// shown as ordered rather than hidden, because two tasks may touch one file by
// design and that call is the approver's.

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type CoverageRow, type G1Packet as G1PacketData, type SurfaceOverlap, type WorkItem } from '../api.ts'
import { PACKET_FRAME, PACKET_LABEL, PacketSweep } from './findings.tsx'
import { CitedText, useLexicon } from './lexicon.tsx'

const artifactLink = (src: string, slug: string, path: string) =>
  `/runs/${src}/${slug}?tab=record&artifact=${encodeURIComponent(path)}`

export function G1Packet({ src, slug }: { src: string; slug: string }) {
  const { data, isPending } = useQuery({ queryKey: ['g1', src, slug], queryFn: () => api.g1(src, slug) })
  // Frame and label first, content when it arrives (#299). Rendering nothing
  // while the read is in flight made this card indistinguishable from a gate
  // that has no packet at all, and then shifted the buttons under the cursor.
  if (isPending) {
    return (
      <section className={PACKET_FRAME} data-g1-packet aria-busy="true">
        <p className={PACKET_LABEL}>G1 packet — composed from the record</p>
        <PacketSweep />
      </section>
    )
  }
  if (!data) return null
  const packet: G1PacketData = data
  return (
    <section className={PACKET_FRAME} data-g1-packet>
      <p className={PACKET_LABEL}>G1 packet — composed from the record</p>
      <Coverage packet={packet} src={src} slug={slug} />
      <ParallelSafety packet={packet} src={src} slug={slug} />
      <Decisions src={src} slug={slug} />
    </section>
  )
}

/** The fork fallback, in the one shape both halves use: name the grammar that
 *  was looked for, and route to the artifact that has the answer. */
function Withheld({ reason, src, slug, path, hook }: { reason: string; src: string; slug: string; path: string; hook: string }) {
  return (
    <p
      className="mt-1.5 border border-warn-line bg-warn-bg px-2.5 py-2 text-[12px] leading-[1.5] text-warn"
      data-withheld={hook}
    >
      {reason}{' '}
      <Link className="text-accent underline underline-offset-2" to={artifactLink(src, slug, path)}>
        read {path}
      </Link>
    </p>
  )
}

function GroupLabel({ children, hint }: { children: string; hint?: string }) {
  return (
    <p className="mt-2.5 font-ui text-[10.5px] text-faint">
      {children}
      {hint && <span className="ml-1.5 normal-case text-muted">· {hint}</span>}
    </p>
  )
}

/**
 * Requirement coverage. Uncovered requirements are the headline — the same
 * treatment #256 gives uncited criteria, and for the same reason: it is a fact
 * about the record, and the one thing the approver most needs before saying
 * yes.
 */
function Coverage({ packet, src, slug }: { packet: G1PacketData; src: string; slug: string }) {
  const uncovered = packet.coverage.filter((r) => r.defined && r.mapped.length === 0)
  const rest = packet.coverage.filter((r) => !uncovered.includes(r))
  return (
    <div data-g1-coverage>
      <GroupLabel hint="contracts/plan.md: every spec requirement maps to at least one task">Coverage</GroupLabel>
      {packet.mappingWithheld ? (
        <Withheld reason={packet.mappingWithheld} src={src} slug={slug} path="plan.md" hook="mapping" />
      ) : (
        <>
          {uncovered.length > 0 && (
            <p className="mt-1.5 text-[12.5px] leading-[1.5] text-warn" data-uncovered={uncovered.length}>
              {uncovered.length === 1 ? '1 requirement appears' : `${uncovered.length} requirements appear`} in no row of the
              plan's mapping table.
            </p>
          )}
          {/* The other direction of the same check, so it is boxed in the same
              list (#285/8). It shipped as a bare line under the list and read
              as leftover debug output: mono, unboxed, in the register of a
              section label, attached to nothing — and sitting between the last
              coverage box and the next group's heading, which is the one place
              on this card that belongs to neither. A work item no mapping row
              names is a coverage fact, so it is a row of the coverage list,
              sibling to the requirement that names no task. */}
          <ul className="mt-1.5 flex flex-col gap-1">
            {[...uncovered, ...rest].map((row) => (
              <CoverageEntry key={row.id} row={row} />
            ))}
            {packet.unmappedTasks.length > 0 && (
              <li
                className="border border-line bg-surface px-3 py-2 font-ui text-[11.5px] leading-[1.5] text-muted"
                data-unmapped-tasks
              >
                no mapping row names: {packet.unmappedTasks.join(', ')}
              </li>
            )}
          </ul>
        </>
      )}
    </div>
  )
}

function CoverageEntry({ row }: { row: CoverageRow }) {
  const lex = useLexicon()
  // The requirement verbatim from spec.md, when the spec defines it.
  const text = lex?.byId.get(row.id)?.at(-1)?.body ?? null
  const uncovered = row.defined && row.mapped.length === 0
  return (
    <li
      className={`border px-3 py-2 ${uncovered ? 'border-warn-line bg-warn-bg' : 'border-line bg-surface'}`}
      data-coverage={row.id}
      data-mapped={row.mapped.length}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="shrink-0 font-mono text-[11.5px] font-semibold text-ink">{row.id}</span>
        {row.shortName && <span className="shrink-0 text-[12.5px] font-medium text-ink">{row.shortName}</span>}
        {!row.defined && (
          <span className="shrink-0 font-ui text-[11px] text-warn">named by the mapping, defined in no spec</span>
        )}
        <span className="ml-auto flex shrink-0 flex-wrap items-baseline gap-1.5">
          {row.mapped.length === 0 ? (
            <span className="font-ui text-[11px] text-warn">no task</span>
          ) : (
            row.mapped.map((t) => (
              <span
                key={t}
                className={`border px-[7px] py-px font-mono text-[10.5px] leading-none ${
                  row.unknownTasks.includes(t) ? 'border-warn-line bg-warn-bg text-warn' : 'border-line bg-inset text-muted'
                }`}
                title={row.unknownTasks.includes(t) ? 'no tasks/*.yaml declares this id' : undefined}
              >
                {t}
              </span>
            ))
          )}
        </span>
      </div>
      {text && <p className="mt-1 text-[12.5px] leading-[1.5] text-muted">{text}</p>}
      {/* The task's own claim is a third, independent statement: it may name a
          requirement the table does not, and that difference is worth seeing. */}
      {row.claimedBy.length > 0 && row.claimedBy.some((id) => !row.mapped.includes(id)) && (
        <p className="mt-1 font-ui text-[11px] text-muted">
          claimed by the work item{row.claimedBy.length > 1 ? 's' : ''}: {row.claimedBy.join(', ')}
        </p>
      )}
    </li>
  )
}

/**
 * Parallel safety: which work items declared contact with the same ground, and
 * whether anything in the record orders them. An unordered overlap is the
 * decomposition defect G1 exists to catch — two implementers dispatched at once
 * onto one file.
 */
function ParallelSafety({ packet, src, slug }: { packet: G1PacketData; src: string; slug: string }) {
  const unordered = packet.overlaps.filter((o) => !o.ordered)
  const ordered = packet.overlaps.filter((o) => o.ordered)
  const readable = packet.tasks.filter((t) => t.withheld === null)
  return (
    <div data-g1-safety>
      <GroupLabel hint="two tasks with no dependency between them, declaring the same path">Parallel safety</GroupLabel>
      {packet.tasksWithheld ? (
        <Withheld reason={packet.tasksWithheld} src={src} slug={slug} path="plan.md" hook="tasks" />
      ) : (
        <>
          {unordered.length > 0 ? (
            <p className="mt-1.5 text-[12.5px] leading-[1.5] text-warn" data-unordered={unordered.length}>
              {unordered.length === 1 ? '1 pair of tasks declares' : `${unordered.length} pairs of tasks declare`} overlapping
              contact surfaces with no <span className="font-mono">depends_on</span> between them.
            </p>
          ) : (
            <p className="mt-1.5 text-[12.5px] text-muted">
              No two independent tasks declare the same path. {readable.length} work item{readable.length === 1 ? '' : 's'} read.
            </p>
          )}
          {packet.overlaps.length > 0 && (
            <ul className="mt-1.5 flex flex-col gap-1">
              {[...unordered, ...ordered].map((o) => (
                <OverlapEntry key={`${o.a}-${o.b}`} overlap={o} />
              ))}
            </ul>
          )}
          <ul className="mt-1.5 flex flex-col gap-1">
            {packet.tasks.map((t) => (
              <TaskEntry key={t.path} item={t} src={src} slug={slug} />
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function OverlapEntry({ overlap }: { overlap: SurfaceOverlap }) {
  return (
    <li
      className={`border px-3 py-2 ${overlap.ordered ? 'border-line bg-surface' : 'border-warn-line bg-warn-bg'}`}
      data-overlap={`${overlap.a}-${overlap.b}`}
      data-ordered={overlap.ordered ? 'true' : 'false'}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="shrink-0 font-mono text-[11.5px] font-semibold text-ink">
          {overlap.a} ↔ {overlap.b}
        </span>
        <span
          className={`shrink-0 border px-[7px] py-px font-mono text-[10.5px] font-semibold leading-none ${
            overlap.ordered ? 'border-line bg-inset text-muted' : 'border-warn-line bg-warn-bg text-warn'
          }`}
        >
          {overlap.ordered ? 'ordered by depends_on' : 'no dependency between them'}
        </span>
      </div>
      <ul className="mt-1 flex flex-col gap-0.5">
        {overlap.entries.map((e) => (
          <li key={`${e.a}|${e.b}`} className="font-mono text-[11.5px] text-muted">
            {e.a === e.b ? e.a : `${e.a} ⊃ ${e.b}`}
          </li>
        ))}
      </ul>
    </li>
  )
}

/** One work item: what it declared it would touch, and what orders it. */
function TaskEntry({ item, src, slug }: { item: WorkItem; src: string; slug: string }) {
  const [open, setOpen] = useState(false)
  return (
    <li className="border border-line bg-surface px-3 py-2" data-task={item.id || item.path}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="shrink-0 font-mono text-[11.5px] font-semibold text-ink">{item.id || item.path}</span>
        <span className="min-w-0 flex-1 text-[12.5px] text-ink">
          <CitedText>{item.title}</CitedText>
        </span>
        {item.dependsOn.length > 0 && (
          <span className="shrink-0 font-mono text-[10.5px] text-muted">after {item.dependsOn.join(', ')}</span>
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="shrink-0 border border-line bg-surface px-[7px] py-px font-mono text-[10.5px] font-semibold leading-none text-muted"
        >
          surface{open ? ' ▾' : ' ▸'}
        </button>
      </div>
      {item.withheld && <p className="mt-1 text-[11.5px] leading-[1.5] text-warn">{item.withheld}</p>}
      {open && (
        <>
          <ul className="mt-1 flex flex-col gap-0.5">
            {item.fileContactSurface.map((entry) => (
              <li key={entry} className="font-mono text-[11.5px] text-muted">
                {entry}
              </li>
            ))}
          </ul>
          <p className="mt-1">
            <Link className="font-mono text-[11px] text-accent underline underline-offset-2" to={artifactLink(src, slug, item.path)}>
              {item.path}
            </Link>
          </p>
        </>
      )}
    </li>
  )
}

/**
 * The ADR cards. `buildLexicon` already elides a decision to its `**Choice:**`
 * line — the decision in force — and keeps the Rejected/Consequences argument
 * behind the click, byte-identical. An amended ADR carries its qualifier, which
 * is how the record says which of two same-numbered decisions is the live one.
 */
function Decisions({ src, slug }: { src: string; slug: string }) {
  const lex = useLexicon()
  const [open, setOpen] = useState<string | null>(null)
  const decisions = (lex?.entries ?? []).filter((e) => e.kind === 'decision')
  if (decisions.length === 0) return null
  return (
    <div data-g1-decisions>
      <GroupLabel hint="the choice in force; the argument is one click away">Decisions</GroupLabel>
      <ul className="mt-1.5 flex flex-col gap-1">
        {decisions.map((entry, i) => {
          const key = `${entry.id}-${i}`
          const expanded = open === key
          return (
            <li key={key} className="border border-line bg-surface px-3 py-2" data-adr={entry.id}>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="shrink-0 font-mono text-[11.5px] font-semibold text-ink">{entry.id}</span>
                {entry.qualifier && (
                  <span className="shrink-0 border border-info-line bg-info-bg px-[7px] py-px font-mono text-[10.5px] leading-none text-info">
                    {entry.qualifier}
                  </span>
                )}
                <span className="min-w-0 flex-1 text-[12.5px] font-medium text-ink">{entry.shortName}</span>
                <button
                  type="button"
                  onClick={() => setOpen(expanded ? null : key)}
                  className="shrink-0 border border-line bg-surface px-[7px] py-px font-mono text-[10.5px] font-semibold leading-none text-muted"
                >
                  {expanded ? 'less ▾' : 'more ▸'}
                </button>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-[1.5] text-muted">
                <CitedText>{entry.body}</CitedText>
              </p>
              {/* The whole definition, verbatim — folding is never truncation. */}
              {expanded && (
                <pre className="mt-1.5 overflow-x-auto bg-inset p-2.5 font-mono text-[11.5px] leading-[1.5] text-ink whitespace-pre-wrap">
                  {entry.definition}
                </pre>
              )}
              <p className="mt-1">
                <Link
                  className="font-mono text-[11px] text-accent underline underline-offset-2"
                  to={`/runs/${src}/${slug}?tab=record&artifact=${encodeURIComponent(entry.artifact)}&anchor=def-${entry.id}`}
                >
                  {entry.artifact}:{entry.line}
                </Link>
              </p>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
