// One run's story: header + gate ledger, then the surface the run's own state
// asks for — Decide, Record, History (#258). Those are three tasks, not three
// storage locations: the tab bar this replaced was `Artifacts | Diff | History`,
// a filesystem hierarchy standing in for the human's job at a gate.
// Decision affordances live in the cards (M2 wires them to POST /api/decisions).
//
// The three surfaces themselves — the Decide card, the Record rail/reader/diff,
// and the History ledger — live in `pages/run/*.tsx` (#413): this file keeps
// `RunPage` and re-exports every symbol a test imports from here, so no import
// path had to change.
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../api.ts'
import { KeyHints } from '../components/chips.tsx'
import { CloseRunPanel, ClosureRecordBlock } from '../components/close-run.tsx'
import { LexiconProvider, useRunLexicon } from '../components/lexicon.tsx'
import { decideTargetIndex, resolveSurface, type Surface } from '../landing.ts'
import { orderArtifacts } from '../record-rail.ts'
import { type KeyHint, useKeys } from '../use-keys.ts'
import { PageStatus } from './inbox.tsx'
import { burdenPillNeeded, cardInstruction, NeedsYouCard, restatesWhatIsShown, visibleProblems } from './run/decide-card.tsx'
import { LoadingSkeleton, RunHeader, RunMetadata, roundsLabel, SurfaceTab, TaskBoard } from './run/header.tsx'
import { HistoryTab } from './run/history.tsx'
import { contractBadgeName, navEntryClass, RECORD_ENTRY_SHAPE, RecordSurface } from './run/record.tsx'

export {
  burdenPillNeeded,
  cardInstruction,
  contractBadgeName,
  navEntryClass,
  RECORD_ENTRY_SHAPE,
  restatesWhatIsShown,
  roundsLabel,
  visibleProblems,
}

export function RunPage() {
  const { src, slug } = useParams<{ src: string; slug: string }>()
  const [params, setParams] = useSearchParams()

  const navigate = useNavigate()
  const { data, isLoading, error } = useQuery({
    queryKey: ['run', src, slug],
    queryFn: () => api.run(src!, slug!),
    enabled: Boolean(src && slug),
  })
  const lexicon = useRunLexicon(src, slug)

  // Which surface the URL asks for and which it gets. Pure, so it runs before
  // the loading guards below; until the run loads nothing is pending, which is
  // why the rewrite effect waits for `data` rather than acting on that.
  const pending = (data?.items.length ?? 0) > 0
  const route = resolveSurface({ tab: params.get('tab'), artifact: params.get('artifact') }, { pending })

  // A link that named a retired container tab still works, and leaves a
  // canonical URL behind: `?tab=artifacts` and `?tab=diff` are the record, and
  // a `?tab=decide` that has aged out is too. Replace, never push — a redirect
  // the reader never asked for should not cost them a back button press.
  useEffect(() => {
    if (!data || !route.rewrite) return
    const next = new URLSearchParams(window.location.search)
    next.set('tab', route.surface)
    if (route.selection === null) next.delete('artifact')
    else next.set('artifact', route.selection)
    setParams(next, { replace: true })
  }, [data, route.rewrite, route.surface, route.selection, setParams])

  // e cycles artifacts; esc returns to the inbox unless a decision is open.
  const keyHandlers = useMemo(
    () => ({
      e: () => {
        // The same order the picker is in, so `e` walks the list the reader is
        // looking at rather than the alphabet behind it (#285/4).
        const paths = orderArtifacts(data?.artifactRefs ?? []).map((r) => r.path)
        if (!paths.length) return
        const current = new URLSearchParams(window.location.search).get('artifact')
        const idx = current ? paths.indexOf(current) : -1
        const nextPath = paths[(idx + 1) % paths.length]!
        const next = new URLSearchParams(window.location.search)
        next.set('tab', 'record')
        next.set('artifact', nextPath)
        setParams(next, { replace: true })
      },
      Escape: () => {
        if (document.body.dataset.deciding !== 'true') void navigate('/')
      },
    }),
    [data, navigate, setParams],
  )
  useKeys(keyHandlers, Boolean(data))

  if (isLoading) return <LoadingSkeleton text="Reading run…" />
  if (error) return <PageStatus text={`Could not load run: ${(error as Error).message}`} bad />
  const detail = data!
  const { summary, items, now } = detail

  const header = <RunHeader summary={summary} detail={detail} />

  // The banner marks the state and shows the bytes; the parse error itself is
  // said once, by the card (#285/1). All three of `stateError`, the card's
  // `detail` and the card's single `problem` are the same string byte for byte,
  // and this page rendered all three — the reader met one parse error three
  // times before reaching the file it is about. Nothing is lost: the words are
  // in the card a few hundred pixels down, and the excerpt they refer to is
  // here — carrying the parse error as its hover text, so the diagnosis stays
  // one gesture away on the Record and History surfaces too, where the card is
  // a tab click rather than a scroll.
  const stateErrorBlock = detail.stateError ? (
    <div className="mb-6 border border-bad-line bg-bad-bg px-3.5 py-3">
      <p className="text-[13px] font-semibold text-bad">Malformed run state</p>
      {detail.stateRaw && (
        <pre
          title={detail.stateError}
          className="mt-2.5 overflow-x-auto bg-inset p-2.5 font-mono text-[11.5px] leading-[1.5] text-ink"
        >{detail.stateRaw}</pre>
      )}
    </div>
  ) : null

  const setSurface = (s: Surface) => {
    const next = new URLSearchParams(params)
    next.set('tab', s)
    if (s !== 'record') next.delete('artifact')
    setParams(next, { replace: true })
  }

  // One layout, with the Decide surface present or absent. The page used to
  // fork its whole shape on this flag — a two-column rail when something was
  // pending, one flowing column when nothing was — because it could not predict
  // what a state needs. Since #249 closed the gate and profile vocabulary it
  // can, so the prediction moved into the surface and the fork went away with
  // the duplicate vitals it required. Status content is still never boxed: card
  // chrome belongs to the decision cards alone.
  const busy = items.length > 0

  // The inbox already encodes what it is calling you to decide (`?decide=G2`,
  // `esc-<n>`, `paused`, `staged`); until #216 the run page dropped it on the
  // floor. When it names a card that is still pending, that card is the one
  // the keyboard loop drives and the one focus lands on. A stale or unknown
  // value resolves to -1 and everything below behaves exactly as before.
  const decideIndex = decideTargetIndex(params.get('decide'), items)
  const primaryIndex = decideIndex >= 0 ? decideIndex : items.findIndex((x) => x.reviewable)

  // The run page's half of the keyboard loop, advertised (#284). `e` is only
  // offered when there is something for it to cycle, and `esc` says where it
  // actually goes rather than the vaguer "back": from an idle run page it is
  // the inbox, and the only case where it means something else — closing an
  // open decision form — is the case in which no hint is on screen at all.
  const pageHints: KeyHint[] = [
    ...(detail.artifacts.length > 0 ? ([['e', 'next artifact']] as KeyHint[]) : []),
    ['esc', 'inbox'],
  ]
  // Whether a decision card is showing them for us. `DecidePanel` renders the
  // hints for the primary card so they can vanish with the card's idle mode;
  // that only happens on the Decide surface, and only when a card is primary.
  const primaryCardHints = route.surface === 'decide' && primaryIndex >= 0

  const board = summary.tasks.total > 0 && detail.state ? <TaskBoard state={detail.state} roundCap={summary.tasks.roundCap} /> : null

  // The lexicon covers the whole page, not just the artifact reader: a
  // decision card that names AC2.1 should resolve it where it stands (#252).
  return (
    <LexiconProvider value={lexicon}>
      <div className="mx-auto max-w-5xl">
        <div className="border-b border-line pb-7">
          {header}
          {stateErrorBlock}
          {summary.phase === 'closed' && <ClosureRecordBlock source={src!} slug={slug!} closure={summary.closure} />}
          <RunMetadata summary={summary} board={board} />
        </div>

        <nav className="mt-6 mb-[18px] flex gap-0.5 border-b border-line" data-surfaces>
          {busy && (
            <SurfaceTab surface="decide" label="Decide" count={items.length} current={route.surface} onSelect={setSurface} />
          )}
          <SurfaceTab surface="record" label="Record" count={detail.artifacts.length} current={route.surface} onSelect={setSurface} />
          <SurfaceTab surface="history" label="History" count={detail.history.length} current={route.surface} onSelect={setSurface} />
        </nav>

        {route.surface === 'decide' && (
          <section className="flex flex-col gap-4 pb-7 border-b border-line">
            {items.map((item, i) => (
              <NeedsYouCard
                key={`${item.kind}-${item.gate ?? item.escalationIndex ?? i}`}
                item={item}
                now={now}
                detail={detail}
                primary={i === primaryIndex}
                sentHere={i === decideIndex}
                pageHints={pageHints}
              />
            ))}
          </section>
        )}
        {route.surface === 'record' && (
          <RecordSurface
            detail={detail}
            selected={route.selection}
            onSelect={(p) => {
              const next = new URLSearchParams(params)
              next.set('tab', 'record')
              next.set('artifact', p)
              next.delete('anchor')
              setParams(next, { replace: true })
            }}
          />
        )}
        {route.surface === 'history' && <HistoryTab history={detail.history} src={src!} slug={slug!} items={items} artifacts={detail.artifactRefs} />}
        {/* The page's own keys, wherever the primary card is not already
            carrying them (#284) — a surface with no decision on it, or one
            whose cards are all bounced and drive no keyboard loop. Above the
            close-run affordance, because a hint belongs with what it is a hint
            about and not under the one destructive control on the page. */}
        {!primaryCardHints && <KeyHints hints={pageHints} className="mt-3.5 text-right" />}
        <CloseRunPanel source={src!} slug={slug!} phase={summary.phase} />
      </div>
    </LexiconProvider>
  )
}
