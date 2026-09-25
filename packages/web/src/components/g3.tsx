// G3's packet (#403): the release plan, composed for "Ship it?".
//
// Every gate but G3 had a surface. G3 fell through to the generic card — the
// question, the buttons, and one `release-plan.md` chip between them — because
// until #260 the plan had no contract to parse against. The fixture's plan
// was complete the whole time; the card ignored all of it.
//
// Core reads the plan; this decides how it reads. Five parts, in the order the
// gate asks them:
//
//   1. Rollback — the trigger and whether rollback was exercised, verbatim
//      and first. The contract says this is what the approver is really being
//      asked about, and `no` is the most decision-bearing word in the artifact.
//   2. What ships — the change, its environment, and CI health as the plain
//      sentence Ops wrote. A red pipeline is an escalation, not a workaround.
//   3. Release steps — the ordered acts, one per item, with any the plan
//      itself calls irreversible marked.
//   4. Verified against — what G2 already signed off on: the report's own
//      verdict and the criteria no evidence cites, from the rollup the G2
//      surface reads. "Ship it" is read against "verified against what".
//   5. Verification after release and Blast radius — folded, the way §4.7
//      folds audit-time sections: there when needed, never truncated.
//
// Presence, not verdicts. `no` is set apart because the record said it, not
// because anything here scored the plan. There is no risk grade, no "safe to
// ship", and no link to a deploy target, because the record names none.

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type ReleasePacket as ReleasePacketData, type ReleaseStep } from '../api.ts'
import { ReportVerdict } from './evidence.tsx'
import { PACKET_FRAME, PACKET_LABEL, PacketSweep } from './findings.tsx'
import { GroupLabel, Withheld } from './g1.tsx'
import { Markdown } from './markdown.tsx'

const PLAN = 'release-plan.md'
const artifactLink = (src: string, slug: string, path: string) =>
  `/runs/${src}/${slug}?tab=record&artifact=${encodeURIComponent(path)}`

export function G3Packet({ src, slug }: { src: string; slug: string }) {
  const { data, isPending } = useQuery({ queryKey: ['g3', src, slug], queryFn: () => api.g3(src, slug) })
  // Frame and label first, content when it arrives (#299), so a G3 card is
  // never shaped like a card that has no packet at all.
  if (isPending) {
    return (
      <section className={PACKET_FRAME} data-g3-packet aria-busy="true">
        <p className={PACKET_LABEL}>G3 packet — composed from the record</p>
        <PacketSweep />
      </section>
    )
  }
  if (!data) return null
  const packet: ReleasePacketData = data
  return (
    <section className={PACKET_FRAME} data-g3-packet>
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <p className={PACKET_LABEL}>G3 packet — composed from the record</p>
        {!packet.hasPlan && <span className="font-ui text-[11px] text-faint">no release plan in the record</span>}
      </div>
      {packet.hasPlan && (
        <>
          <Rollback packet={packet} src={src} slug={slug} />
          <Shipping packet={packet} src={src} slug={slug} />
          <Steps packet={packet} src={src} slug={slug} />
          <VerifiedAgainst src={src} slug={slug} />
          <Fold heading="Verification after release" body={packet.verificationAfter} hook="verification-after" />
          <Fold heading="Blast radius" body={packet.blastRadius} hook="blast-radius" />
        </>
      )}
    </section>
  )
}

/** One fact from the plan, boxed: its label, its value verbatim. */
function Fact({
  label,
  value,
  tone = 'plain',
  hook,
}: {
  label: string
  value: string
  tone?: 'plain' | 'warn'
  hook: string
}) {
  return (
    <li
      className={`border px-3 py-2 ${tone === 'warn' ? 'border-warn-line bg-warn-bg' : 'border-line bg-surface'}`}
      data-fact={hook}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="shrink-0 font-ui text-[11px] text-muted">{label}</span>
        {/* The value is a line of the plan's markdown — a commit in a code
            span, a cited requirement — so it renders as one. */}
        <div className={`prose-card min-w-0 flex-1 ${tone === 'warn' ? 'font-medium text-warn' : ''}`}>
          <Markdown unwrapped sourcePath={PLAN}>
            {value}
          </Markdown>
        </div>
      </div>
    </li>
  )
}

/**
 * The way back, and whether it has been tried. Leads the packet: the contract
 * makes a plan without a tested rollback malformed, and "exercised: no" is a
 * fact the approver must see before the buttons, not inside a fold.
 */
function Rollback({ packet, src, slug }: { packet: ReleasePacketData; src: string; slug: string }) {
  return (
    <div data-g3-rollback>
      <GroupLabel hint="the signal that says undo this, and whether the undo has been tried">Rollback</GroupLabel>
      {packet.fieldsWithheld && <Withheld reason={packet.fieldsWithheld} src={src} slug={slug} path={PLAN} hook="fields" />}
      <ul className="mt-1.5 flex flex-col gap-1">
        {packet.rollbackTrigger !== null && <Fact label="Rollback trigger" value={packet.rollbackTrigger} hook="trigger" />}
        {packet.rollbackExercised !== null && (
          <Fact
            label="Rollback exercised"
            value={packet.rollbackExercised}
            tone={packet.exercisedWord === 'no' ? 'warn' : 'plain'}
            hook="exercised"
          />
        )}
      </ul>
      {packet.rollbackPlan && (
        <div className="mt-1.5 border border-line bg-surface px-3 py-2 text-[12.5px]" data-g3-rollback-plan>
          <div className="prose-card">
            <Markdown unwrapped sourcePath={PLAN}>{packet.rollbackPlan}</Markdown>
          </div>
        </div>
      )}
    </div>
  )
}

/** What ships and where, and whether the pipeline agrees it can. */
function Shipping({ packet, src, slug }: { packet: ReleasePacketData; src: string; slug: string }) {
  return (
    <div data-g3-shipping>
      <GroupLabel hint="the change, its environment, and the pipeline's word on it">What ships</GroupLabel>
      <ul className="mt-1.5 flex flex-col gap-1">
        {packet.changeReleased !== null && <Fact label="Change released" value={packet.changeReleased} hook="change" />}
        {packet.environment !== null && <Fact label="Environment" value={packet.environment} hook="environment" />}
      </ul>
      {packet.ciHealth === null ? (
        <Withheld reason="no CI health section." src={src} slug={slug} path={PLAN} hook="ci" />
      ) : (
        <div className="mt-1.5 border border-line bg-surface px-3 py-2 text-[12.5px]" data-g3-ci>
          <p className="font-ui text-[11px] text-muted">CI health</p>
          <div className="prose-card">
            <Markdown unwrapped sourcePath={PLAN}>{packet.ciHealth}</Markdown>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * The ordered acts the approver is authorising. A step the plan itself calls
 * irreversible is marked with the plan's own word; nothing else is inferred
 * about what a step can or cannot undo.
 */
function Steps({ packet, src, slug }: { packet: ReleasePacketData; src: string; slug: string }) {
  const irreversible = packet.steps.filter((s) => s.irreversible)
  return (
    <div data-g3-steps>
      <GroupLabel hint="in order, one act per item, executable as written">Release steps</GroupLabel>
      {packet.stepsWithheld ? (
        <Withheld reason={packet.stepsWithheld} src={src} slug={slug} path={PLAN} hook="steps" />
      ) : (
        <>
          {irreversible.length > 0 && (
            <p className="mt-1.5 text-[12.5px] leading-[1.5] text-warn" data-irreversible={irreversible.length}>
              The plan names {irreversible.length === 1 ? '1 step' : `${irreversible.length} steps`} as irreversible.
            </p>
          )}
          <ol className="mt-1.5 flex flex-col gap-1">
            {packet.steps.map((s) => (
              <StepEntry key={s.n} step={s} />
            ))}
          </ol>
        </>
      )}
    </div>
  )
}

function StepEntry({ step }: { step: ReleaseStep }) {
  return (
    <li
      className={`border px-3 py-2 ${step.irreversible ? 'border-warn-line bg-warn-bg' : 'border-line bg-surface'}`}
      data-step={step.n}
      data-irreversible={step.irreversible ? 'true' : undefined}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="shrink-0 font-mono text-[11.5px] font-semibold text-ink">{step.n}.</span>
        <div className="prose-card min-w-0 flex-1">
          <Markdown unwrapped sourcePath={PLAN}>
            {step.text}
          </Markdown>
        </div>
        {step.irreversible && (
          <span className="shrink-0 border border-warn-line bg-warn-bg px-[7px] py-px font-mono text-[10.5px] font-semibold leading-none text-warn">
            irreversible
          </span>
        )}
      </div>
    </li>
  )
}

/**
 * What G2 already signed off on. G3 sits on an approved G2, and the rollup
 * the G2 surface reads is one cache entry away: the report's own verdict,
 * quoted, and the criteria no evidence cites, as facts about the record.
 */
function VerifiedAgainst({ src, slug }: { src: string; slug: string }) {
  const { data } = useQuery({ queryKey: ['evidence', src, slug], queryFn: () => api.evidence(src, slug) })
  const uncited = data?.hasVerification && !data.withheld ? data.criteria.filter((c) => c.defined && c.evidence.length === 0 && !c.result) : []
  const cited = data?.hasVerification && !data.withheld ? data.criteria.filter((c) => c.defined && !uncited.includes(c)) : []
  return (
    <div data-g3-verified>
      <GroupLabel hint="what G2 approved, so “ship it” is read against “verified against what”">Verified against</GroupLabel>
      {!data ? null : !data.hasVerification ? (
        <p className="mt-1.5 text-[12.5px] text-muted">No verification report in the record.</p>
      ) : (
        <div className="mt-1.5 border border-line bg-surface px-3 py-2 text-[12.5px]">
          <ReportVerdict rollup={data} />
          {data.withheld ? (
            <p className="mt-1 text-[12px] leading-[1.5] text-muted">Evidence citations not computed — {data.withheld}</p>
          ) : (
            <p className="mt-1 text-[12.5px] leading-[1.5] text-muted" data-cited={cited.length} data-uncited={uncited.length}>
              {cited.length === 1 ? '1 criterion is' : `${cited.length} criteria are`} cited by verification evidence
              {uncited.length > 0 ? (
                <>
                  ; <span className="text-warn">no evidence cites {uncited.map((c) => c.id).join(', ')}</span>.
                </>
              ) : (
                '.'
              )}
            </p>
          )}
          <p className="mt-1">
            <Link
              className="font-mono text-[11px] text-accent underline underline-offset-2"
              to={artifactLink(src, slug, 'verification-report.md')}
            >
              verification-report.md
            </Link>
          </p>
        </div>
      )}
    </div>
  )
}

/** An audit-time section, folded to its heading and opened in place to its verbatim body (#217). */
function Fold({ heading, body, hook }: { heading: string; body: string | null; hook: string }) {
  const [open, setOpen] = useState(false)
  if (body === null) return null
  return (
    <div className="mt-2.5 border border-line bg-surface" data-g3-fold={hook} data-open={open ? 'true' : 'false'}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-baseline gap-2 px-3 py-2 text-left"
        aria-expanded={open}
      >
        <span className="font-ui text-[10.5px] text-muted">{open ? '▾' : '▸'}</span>
        <span className="text-[12.5px] font-medium text-ink">{heading}</span>
      </button>
      {open && (
        <div className="px-3 pb-2 text-[12.5px]">
          <div className="prose-card">
            <Markdown unwrapped sourcePath={PLAN}>{body}</Markdown>
          </div>
        </div>
      )}
    </div>
  )
}
