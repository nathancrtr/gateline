// The Record surface: the rail, the reader, the artifact body, its audit-time
// folds, and the diff pane. Split out of pages/run.tsx (#413) as a pure move —
// no behaviour, markup, or string changed; pages/run.tsx re-exports every
// symbol below so no import path a test already uses had to change.
import { splitSections } from '@gateline/core/record'
import { useQuery } from '@tanstack/react-query'
import { type ReactNode, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { type ArtifactKind, type ArtifactRef, api, type RunDetailResponse } from '../../api.ts'
import { ValidationBadge } from '../../components/chips.tsx'
import { DiffView } from '../../components/diff-view.tsx'
import { EvidenceRollupPanel } from '../../components/evidence.tsx'
import { FindingsPanel, useReviews, VerdictChip } from '../../components/findings.tsx'
import { CitedObjects } from '../../components/lexicon.tsx'
import { Markdown } from '../../components/markdown.tsx'
import { Address, Instruction, Name } from '../../components/vocabulary.tsx'
import { isAuditSection, itemCount } from '../../fold.ts'
import { DIFF_SELECTION, landingArtifact } from '../../landing.ts'
import { orderArtifacts, type RailLabel, railGroups } from '../../record-rail.ts'
import { EdgeFade, useScrollCue } from '../../scroll-cue.tsx'
import { PageStatus } from '../inbox.tsx'
import { LoadingSkeleton } from './header.tsx'

/**
 * Record — the run's committed output, and the answer to "show me the bytes"
 * (#258). The escape hatch and the fork fallback: whatever a structured surface
 * withholds itself over, the artifact it was reading is here in full.
 *
 * The change reads here too, as an entry below the artifacts rather than the
 * sibling `Diff` tab it used to be. It is not an artifact — nothing under
 * `runs/<slug>/` produced it — so it sits under its own heading, and it earns
 * its place in Gatehouse only as the surface-scoped view #270 built
 * (FRONTEND.md principle 7). `?tab=diff` links land here.
 */
export function RecordSurface({
  detail,
  selected,
  onSelect,
}: {
  detail: RunDetailResponse
  selected: string | null
  onSelect: (path: string) => void
}) {
  // What each artifact is arrives on the payload (#415): the rail, the landing
  // and the reader all read the kind off the ref, never off the path. A server
  // older than this page sends no refs — it happens for minutes under `up`,
  // while `self-update` has rebuilt the page and the old server drains — and
  // then nothing is derived: the rail says why instead of guessing kinds.
  const wireRefs = (detail as { artifactRefs?: ArtifactRef[] }).artifactRefs
  const refs = orderArtifacts(wireRefs ?? [])
  const paths = refs.map((r) => r.path)
  const showDiff = selected === DIFF_SELECTION
  // An explicit selection always wins; otherwise the pending gate's own packet
  // decides what opens (#250), and only then does filename order get a say.
  const current =
    (showDiff ? null : selected) ??
    landingArtifact({ items: detail.items, profile: detail.summary.profile, artifacts: refs }) ??
    paths.find((p) => p.endsWith('.md')) ??
    paths[0] ??
    null
  // Verdict chips on the review entries (#215): what the review concluded,
  // without opening it. Reports load lazily; until they do, an entry has no
  // chip. Its label never waits on them — the ref names the task (#415).
  const reports = useReviews(detail.summary.source, detail.summary.slug)
  const verdictsFor = (path: string) => {
    const report = reports?.find((r) => r.path === path)
    if (!report || report.rounds.length === 0) return null
    return <VerdictChip verdicts={report.rounds.map((r) => r.verdict)} compact />
  }
  return (
    <div className="grid grid-cols-[280px_1fr] gap-0 max-lg:flex max-lg:flex-col border-b border-line">
      <nav className="border-r border-line bg-surface py-[18px] max-lg:w-full max-lg:border-r-0 max-lg:border-b max-lg:py-2.5">
        <div className={`${NAV_LABEL} max-lg:px-3 max-lg:pb-1`}>Artifacts</div>
        <div className="max-lg:flex max-lg:flex-wrap max-lg:items-center max-lg:gap-x-1 max-lg:px-3">
          {/* Entries name kinds, not files (#401): the rail says what each
              artifact is, the reader header says where its bytes are. A task
              id names itself, in the code face, everywhere the record uses
              it (#425, docs/SEAM.md §8.2); every other kind is a UI-face
              label — `Ledger` for `state.yaml` since #425 too (§8.3). The
              numbered families sit under one caption each, so `tasks/` and
              `review-` are said once instead of on every line. */}
          {wireRefs === undefined && (
            <Instruction className="px-[18px] pb-2.5">
              This server is older than the page and does not say what each artifact is. Restart it to see the run’s record.
            </Instruction>
          )}
          <ul className="flex flex-col max-lg:contents">
            {railGroups(refs).map((group) =>
              group.entries.map((entry, i) => {
                const p = entry.path
                const v = detail.validations[p]
                return (
                  <li key={p} className="max-lg:min-w-0 max-lg:contents">
                    {i === 0 && group.caption && (
                      <div data-rail-caption className={`${NAV_LABEL} pt-2.5 pb-1 max-lg:px-2 max-lg:py-1.5 max-lg:shrink-0`}>
                        {group.caption}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => onSelect(p)}
                      data-artifact-entry={p}
                      data-selected={!showDiff && p === current ? 'true' : undefined}
                      className={navEntryClass(!showDiff && p === current, entry.face)}
                    >
                      {v && <ValidationBadge ok={v.ok} missing={v.missing} />}
                      {entry.face === 'name' ? (
                        <Name lead className="truncate">
                          {entry.text}
                        </Name>
                      ) : (
                        <span className="truncate">{entry.text}</span>
                      )}
                      {verdictsFor(p) && <span className="ml-auto max-lg:ml-1">{verdictsFor(p)}</span>}
                    </button>
                  </li>
                )
              }),
            )}
          </ul>
          <div className="mt-3.5 border-t border-line pt-3.5 max-lg:mt-0 max-lg:flex max-lg:items-center max-lg:border-t-0 max-lg:pt-0">
            <div className={`${NAV_LABEL} max-lg:px-2 max-lg:pb-0 max-lg:py-1.5 max-lg:shrink-0`}>The change</div>
            <button type="button" onClick={() => onSelect(DIFF_SELECTION)} data-select-diff className={navEntryClass(showDiff)}>
              <span className="truncate">diff by surface</span>
            </button>
          </div>
        </div>
        {/* The rail carries the badge only (#424): the failure notice, naming
            the contract by kind with the file after it, is the reader's, and
            saying it twice on one screen made neither the place to read it. */}
      </nav>
      <ReaderPane artifact={showDiff ? DIFF_SELECTION : current}>
        {showDiff ? (
          <DiffPane src={detail.summary.source} slug={detail.summary.slug} />
        ) : current ? (
          <ArtifactBody
            src={detail.summary.source}
            slug={detail.summary.slug}
            path={current}
            artifact={refs.find((r) => r.path === current) ?? null}
          />
        ) : (
          <PageStatus text="No artifacts yet." />
        )}
      </ReaderPane>
    </div>
  )
}

/** The picker's two section labels. Full-width rail below, an inline caption in
 *  the strip above the reader. */
const NAV_LABEL = 'font-ui text-[10.5px] text-muted px-[18px] pb-2.5'

/**
 * One picker entry, in both of the picker's shapes — and the artifact entries
 * and the diff entry share it, so the two can no longer drift apart. Below `lg`
 * the rail becomes a wrapping strip, so the selected mark moves from the left
 * edge to the bottom edge: a left rule reads as a rail only when the entries are
 * stacked. Only the mark and the tint depend on `active`; the shape never does.
 */
export const RECORD_ENTRY_SHAPE =
  'flex w-full items-center gap-2.5 px-[18px] py-2.5 text-left border-l-2 ' +
  'max-lg:w-auto max-lg:max-w-full max-lg:border-l-0 max-lg:border-b-2 max-lg:px-2 max-lg:py-1.5'

/**
 * The face says what the entry is (docs/SEAM.md §5): a kind label reads in
 * the UI face; a Name (a task id) and a literal path (`state.yaml` used to be
 * one; a file the framework has no position for still is) both read in the
 * code face — a Name through its own component, ink regardless of
 * selection, so `entryFace` only sets the size the two code-face cases share.
 * The reader can tell a name from an address without being told.
 */
export function navEntryClass(active: boolean, face: RailLabel['face'] = 'label') {
  const entryFace = face === 'label' ? 'font-ui text-[13.5px]' : 'font-mono text-[12.5px]'
  return active
    ? `${RECORD_ENTRY_SHAPE} ${entryFace} bg-accent-tint border-l-accent border-b-accent text-accent-deep font-semibold`
    : `${RECORD_ENTRY_SHAPE} ${entryFace} border-l-transparent border-b-transparent text-ink hover:bg-inset hover:text-ink`
}

/**
 * The reader's own scroll container (#281). Whatever an artifact turns out to
 * contain — a results table wider than the measure, a long command in a code
 * block, a lexicon card hanging off the right of the reference it belongs to —
 * stops here instead of widening the page body. Containment is the point: a page
 * that scrolls sideways drags the header and the picker along with it, and below
 * `lg` the reader is the column that keeps its width — the picker is the one
 * that gives width up.
 *
 * The scroll cue (#312) follows the portfolio table's (#297): a fade on
 * whichever edge has content beyond it, measured live, drawn above the
 * content so the reader's own tinted blocks cannot paint over it. It was
 * deferred when this pane was written, and rightly then: the idle lexicon
 * card was `visibility: hidden` but still laid out, so the pane reported
 * 12px of phantom overflow at 1024px with nothing to scroll to, and a cue
 * off `scrollWidth` would have lied. #308 made the idle card `display: none`;
 * the reader's idle `scrollWidth` now equals its `clientWidth`, and any
 * overflow it reports is real content. The `idle-card-collapsed` rule in the
 * geometry sweep is what keeps that true.
 */
function ReaderPane({ children, artifact }: { children: ReactNode; artifact?: string | null }) {
  const ref = useRef<HTMLDivElement>(null)
  const cue = useScrollCue(ref, [artifact])
  // `min-w-0` on the wrapper too: the reader is the column that yields width
  // below `lg`, and a wrapper without it would hold the column at its
  // content's width — the overflow then reaches the page body instead of
  // stopping here (the geometry sweep caught exactly that on state.yaml).
  return (
    <div className="relative min-w-0">
      <div ref={ref} data-reader className="min-w-0 overflow-x-auto">
        {children}
      </div>
      {cue.left && <EdgeFade edge="left" />}
      {cue.right && <EdgeFade edge="right" />}
    </div>
  )
}

/**
 * How the reader's badge and failure notice name the contract (#424): by the
 * contract's own name for the kind — `review report`, `work item` — with the
 * contract's file as an Address after it (docs/SEAM.md §2, §4 Container).
 *
 * The Address is dropped when it would only echo the filename in the header
 * beside it (#285/3): "runs/g2-pending/verification-report.md ✓ passes the
 * verification report contract verification-report.md" says one filename
 * twice in one strip. `review-01.md` checked against `review-report.md` is
 * the case the Address earns its place, since the path did not say it.
 *
 * A `null` contract — `retro.md` and anything else the framework checks for
 * presence only — has neither a name nor a file. A null name with a contract
 * is a path the run does not list, so no reference names its kind; the file
 * still follows as the Address, and the name is never minted from it.
 */
export function contractBadgeName(
  path: string,
  contract: string | null,
  contractName: string | null,
): { name: string | null; address: string | null } {
  if (contract === null) return { name: null, address: null }
  return { name: contractName, address: contract === path.split('/').pop() ? null : contract }
}

function ArtifactBody({ src, slug, path, artifact }: { src: string; slug: string; path: string; artifact: ArtifactRef | null }) {
  // The kind, off the ref (#415). A path the URL names that the run does not
  // list has no ref, and reads as a plain file.
  const kind = artifact?.kind ?? 'other'
  const { data, isLoading, error } = useQuery({
    queryKey: ['artifact', src, slug, path],
    queryFn: () => api.artifact(src, slug, path),
  })
  // A work item's `title:` heads its reader (#401): the rail says the id, and
  // the sentence the architect wrote is the one thing a YAML dump buries. The G1 packet already carries every work item parsed, under the
  // same query the G1 surface uses, so this is one cache entry, not a second
  // parser in the browser. Absent until it loads; nothing is invented.
  const isWorkItem = kind === 'work-item'
  const g1 = useQuery({ queryKey: ['g1', src, slug], queryFn: () => api.g1(src, slug), enabled: isWorkItem })
  const taskTitle = isWorkItem ? (g1.data?.tasks.find((t) => t.path === path)?.title ?? null) : null
  // Jump-to-definition (#163): the anchor param lands on the def-<id> heading
  // ids the lexicon rehype stage stamps onto R/ADR definition headings.
  const [params] = useSearchParams()
  const anchor = params.get('anchor')
  useEffect(() => {
    if (!anchor || !data) return
    const target = document.getElementById(anchor)
    // A definition inside a folded audit-time section (#217) opens its fold
    // before the jump, so a citation never lands on a closed heading.
    const fold = target?.closest('details')
    if (fold && !fold.open) fold.open = true
    target?.scrollIntoView({ block: 'start' })
  }, [anchor, data])
  if (isLoading) return <LoadingSkeleton text="Reading artifact…" />
  if (error) return <PageStatus text={(error as Error).message} bad />
  const { content, validation } = data!
  const contract = contractBadgeName(path, validation.contract, artifact?.contractName ?? null)
  const contractWords = `${contract.name ? `the ${contract.name} ` : ''}contract`
  return (
    <article className="relative min-h-0 px-10 py-8 max-lg:px-4 max-lg:py-6">
      <div className="max-w-[var(--measure)]">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[11.5px] text-muted pb-[18px] border-b border-line mb-[30px]">
          {taskTitle && (
            <span data-task-title className="basis-full font-ui text-[15px] font-semibold text-ink">
              {taskTitle}
            </span>
          )}
          <span className="text-ink">runs/{slug}/{path}</span>
          <span
            className="ml-auto max-lg:ml-0 font-semibold"
            title={validation.contract ? `${validation.ok ? 'passes' : 'fails'} ${contractWords}, ${validation.contract}` : undefined}
            data-contract-badge
          >
            <span className={`font-ui ${validation.ok ? 'text-ok' : 'text-bad'}`}>
              <span className="mr-1">{validation.ok ? '✓' : '✕'}</span>
              {validation.ok ? 'passes' : 'fails'} {contractWords}
            </span>
            {contract.address && (
              <>
                {' '}
                <Address size="md" className="font-normal">
                  {contract.address}
                </Address>
              </>
            )}
          </span>
        </div>
        {!validation.ok && (
          <p className="mb-4 border border-bad-line bg-bad-bg px-3 py-2 text-xs font-medium text-bad" data-contract-failure>
            Fails {contract.name ? `its ${contract.name}` : 'its'} contract
            {validation.contract && (
              <>
                {' '}
                <Address className="font-normal">{validation.contract}</Address>
              </>
            )}{' '}
            — missing: {validation.missing.join(', ')}
          </p>
        )}
        <CitedObjects content={content} path={path} />
        {kind === 'verification-report' && (
          <div className="mb-4">
            <EvidenceRollupPanel src={src} slug={slug} />
          </div>
        )}
        {kind === 'review-report' && <FindingsPanel src={src} slug={slug} path={path} />}
        {path.endsWith('.md') ? (
          <FoldedMarkdown content={content} kind={kind} audit={validation.audit ?? []} />
        ) : (
          <pre className="overflow-x-auto font-mono text-xs leading-5">{content}</pre>
        )}
      </div>
    </article>
  )
}

/**
 * The artifact, with its audit-time sections folded (#217). The contract
 * names them (`validation.audit`); each folds to its heading plus a count —
 * rows, items, or paragraphs, arithmetic over the text — and opens in place
 * to the verbatim section. Decide-time sections render as they always did.
 * A contract that names no audit-time section renders the artifact whole,
 * through the same single `Markdown` call as before: the split exists only
 * when there is something to fold.
 */
function FoldedMarkdown({ content, kind, audit }: { content: string; kind: ArtifactKind; audit: string[] }) {
  if (audit.length === 0) return <Markdown sourceKind={kind}>{content}</Markdown>
  // One `.prose-artifact` wrapper for the whole artifact, however many
  // renders it takes: the styles are descendant rules, and the DOM keeps
  // reading as one artifact.
  return (
    <div className="prose-artifact">
      {splitSections(content).map((section, i) => {
        // Only an H2 can be audit-time: an H1 — a review's appended round —
        // opens its own section, so its verdict never hides under a fold.
        if (section.heading === null || section.depth !== 2 || !isAuditSection(section.heading, audit)) {
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: sections split from one static artifact body in document order; a heading can be null (the preamble) or repeat (review rounds).
            <Markdown key={i} sourceKind={kind} unwrapped>
              {section.headingLine ? `${section.headingLine}\n${section.body}` : section.body}
            </Markdown>
          )
        }
        const count = itemCount(section.body)
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: see the case above — same static, document-order split.
          <details key={i} data-fold={section.heading} className="group mb-[18px]">
            <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-3 list-none [&::-webkit-details-marker]:hidden">
              {/* The heading's accessible name stays the heading; the glyph
                  and the count sit beside it, not inside it. */}
              <span aria-hidden="true" className="inline-block text-[0.7em] text-muted group-open:rotate-90">▶</span>
              <h2 className="!my-0">{section.heading}</h2>
              <span className="font-sans text-[13px] text-muted">
                {count.n} {count.unit} · audit-time, folded until opened
              </span>
            </summary>
            <Markdown sourceKind={kind} unwrapped>
              {section.body}
            </Markdown>
          </details>
        )
      })}
    </div>
  )
}

function DiffPane({ src, slug }: { src: string; slug: string }) {
  const { data, isLoading, error } = useQuery({ queryKey: ['diff', src, slug], queryFn: () => api.diff(src, slug) })
  if (isLoading) return <LoadingSkeleton text="Computing diff…" />
  if (error) return <PageStatus text={(error as Error).message} bad />
  if (data!.merged) return <PageStatus text="Run is merged — its change lives in the default branch history now." />
  return (
    <div className="px-[18px] py-[18px]">
      <DiffView files={data!.files} surface={data!.surface} src={src} slug={slug} />
    </div>
  )
}
