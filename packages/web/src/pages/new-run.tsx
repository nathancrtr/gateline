// New-run staging: the web sibling of `gateline new`. genesis-preview candidate
// (state.yaml gates.G1.notes) — the organizing element is the record itself,
// previewed live via the same planRunScaffold the server commits with (ADR-6),
// so the preview cannot drift from the truth. No model/API call of any kind
// (AC2.3); the operator's own words are the only prose that lands in the brief
// (AC2.1). Outcome/flash rendering for all five submission outcomes lives
// here — decide.tsx is untouched (task 05 owns the Arm affordance only).

import { planRunScaffold, type RunScaffold, ScaffoldError, SLUG_PATTERN } from '@gateline/core/record'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ApiError, api, PROFILE_GATES, type Profile, type StageOutcomeView, type StagingSourceConfig } from '../api.ts'
import { Imp } from '../components/chips.tsx'
import { PageStatus } from './inbox.tsx'

const PROFILES: Profile[] = ['patch', 'standard', 'full']
// Fallback only until GET /api/staging responds; core's own SLUG_PATTERN (not
// a re-derived literal, ADR-3) — the server-supplied pattern takes over the
// instant config loads, so this value is never in force while the form is
// interactive.
const FALLBACK_SLUG_PATTERN = SLUG_PATTERN

/** Suggests a slug from a title — lowercase, dashes, trimmed. Also reused to
 * turn a section heading into a stable anchor id. */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** The client's structure-only assembly of intent-brief.md (plan ADR-5): one
 * `## <heading>` per required section, in the contract's own order, with only
 * the operator's typed text underneath. The server re-validates this markdown
 * (its wording is what a refusal displays) — this function never drafts
 * prose of its own. */
function assembleBrief(title: string, headings: string[], sections: Record<string, string>): string {
  const body = headings.map((h) => `## ${h}\n\n${(sections[h] ?? '').trim()}\n`).join('\n')
  return `# Intent Brief: ${title.trim()}\n\n${body}`
}

/** Identical wording used both in the error summary's links and inline at
 * each field (ux REC6) — the summary's own top line quotes the server's
 * message verbatim; this per-field phrase is the client's, kept consistent
 * between the two render sites. */
function sectionErrorText(heading: string): string {
  return `## ${heading} is empty — the record cannot carry a blank section`
}

type Outcome = StageOutcomeView | { outcome: 'network-error'; message: string }

export function NewRunPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const config = useQuery({ queryKey: ['staging-config'], queryFn: api.stagingConfig })

  const [sourceId, setSourceId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [profile, setProfile] = useState<Profile>('standard')
  const [budget, setBudget] = useState('')
  const [sections, setSections] = useState<Record<string, string>>({})
  const [intakeSource, setIntakeSource] = useState('')
  const [intakeRef, setIntakeRef] = useState('')
  const [intakeUrl, setIntakeUrl] = useState('')
  const [clientKey] = useState(() => crypto.randomUUID())
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const errSummaryRef = useRef<HTMLDivElement>(null)

  const sources = config.data?.sources ?? []
  const source: StagingSourceConfig | null = sources.find((s) => s.id === sourceId) ?? sources[0] ?? null

  // Default the picker to the first configured source once config loads.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberately narrower than the full capture set — this only needs to notice the count changing (config loaded), not re-run when sourceId (which it sets) or the array reference changes.
  useEffect(() => {
    if (sourceId === null && sources[0]) setSourceId(sources[0].id)
  }, [sources.length])

  // A fresh draft per required-section list (only changes if the source
  // changes) — never carries stale keys from a previously selected source.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on source?.id on purpose — a fresh draft only when the selected source itself changes, not on every source/briefSections identity change.
  useEffect(() => {
    if (!source) return
    setSections((prev) => {
      const next: Record<string, string> = {}
      for (const heading of source.briefSections) next[heading] = prev[heading] ?? ''
      return next
    })
  }, [source?.id])

  useEffect(() => {
    if (!slugTouched) setSlug(slugify(title))
  }, [title, slugTouched])

  useEffect(() => {
    if (outcome?.outcome === 'refused' && outcome.reason === 'missing-sections') errSummaryRef.current?.focus()
  }, [outcome])

  const slugPattern = config.data?.slugPattern ?? FALLBACK_SLUG_PATTERN
  const slugRe = useMemo(() => new RegExp(slugPattern), [slugPattern])
  const slugValid = slug.length > 0 && slugRe.test(slug)
  const sectionEntries = source?.briefSections ?? []
  const missingLocal = sectionEntries.filter((h) => !(sections[h] ?? '').trim())
  const briefMarkdown = useMemo(() => assembleBrief(title, sectionEntries, sections), [title, sectionEntries, sections])
  const budgetTrimmed = budget.trim()
  // Never coerce a bad value to null (that silently degrades to an unmetered
  // run, F2) — an operator who typed a ceiling gets that ceiling or a
  // refusal to submit, never silence. `costLimitUsd` carries the raw parsed
  // number through to both the preview and the request; `budgetInvalid`
  // gates readiness so a non-finite or negative value can never reach
  // either.
  const costLimitUsd = budgetTrimmed === '' ? null : Number(budgetTrimmed)
  const budgetInvalid = costLimitUsd !== null && (!Number.isFinite(costLimitUsd) || costLimitUsd < 0)
  const intake = {
    source: intakeSource.trim() || null,
    ref: intakeRef.trim() || null,
    url: intakeUrl.trim() || null,
    clientKey,
  }

  // Live record preview (ADR-6): the same pure planner the server commits
  // with, called on every keystroke. It never fails on a section left blank
  // (the assembled markdown always carries its heading chrome, so it is
  // never literally empty) — only an invalid slug/title/budget throws.
  // `budgetInvalid` is checked first so a non-finite value (e.g. `1e999` →
  // `Infinity`) never even reaches the planner with a coerced-away ceiling;
  // core's own ScaffoldError text still surfaces for the finite-but-rejected
  // shapes the planner itself catches.
  let scaffold: RunScaffold | null = null
  let scaffoldError: string | null = null
  if (title.trim() && slug) {
    if (budgetInvalid) {
      scaffoldError = `Budget ceiling must be a finite, non-negative number (got ${budgetTrimmed}).`
    } else {
      try {
        scaffold = planRunScaffold({
          slug,
          title,
          profile,
          briefMarkdown,
          costLimitUsd,
          intake,
          stagedBy: source?.identity?.name ?? '(no identity configured)',
        })
      } catch (e) {
        scaffoldError = e instanceof ScaffoldError ? e.message : (e as Error).message
      }
    }
  }

  // `!scaffoldError` closes F2: any budget the planner itself would reject —
  // and by construction the only remaining path into scaffoldError once
  // title/slug/sections are already valid — keeps submit disabled rather
  // than degrading the request into an unmetered run.
  const ready = Boolean(source) && slugValid && title.trim().length > 0 && missingLocal.length === 0 && !scaffoldError

  const mutation = useMutation({
    mutationFn: api.stage,
    onSuccess: (result) => {
      setOutcome(result)
      if (result.outcome === 'created' && source) {
        void queryClient.invalidateQueries()
        // Only navigate away on a clean create. When the push failed
        // (F1), the record is real but the remote never got run/<slug> —
        // stay put and render the warning below with a manual link, rather
        // than silently carrying the operator to a page that implies full
        // replication.
        if (!result.pushFailed) navigate(`/runs/${source.id}/${result.slug}`)
      }
    },
    onError: (e) => {
      setOutcome({ outcome: 'network-error', message: e instanceof ApiError ? e.message : (e as Error).message })
    },
  })

  const submit = () => {
    if (!ready || !source || mutation.isPending) return
    mutation.mutate({
      source: source.id,
      slug,
      title: title.trim(),
      profile,
      briefMarkdown,
      costLimitUsd,
      intake,
    })
  }

  if (config.isLoading) return <PageStatus text="Reading staging configuration…" />
  if (config.error) return <PageStatus text={`Could not load staging configuration: ${(config.error as Error).message}`} bad />
  if (!source) return <PageStatus text="No sources are configured — nothing to stage a run against." bad />

  let submitHint: string
  if (missingLocal.length > 0) submitHint = `${missingLocal.length} required section${missingLocal.length > 1 ? 's are' : ' is'} still empty — ${missingLocal.join(', ')}. The server re-checks on submit; its wording is what you would see.`
  else if (!slugValid) submitHint = `Slug must match ${slugPattern} (branch- and path-safe).`
  else if (scaffoldError) submitHint = scaffoldError
  else submitHint = `Creates run/${slug} and commits the record shown. Nothing dispatches, nothing is spent — Arm is a separate decision on the staged run.`

  return (
    <div className="mx-auto max-w-5xl">
      <header>
        <h1 className="text-[20px] font-semibold leading-[1.25] text-ink">Stage a run</h1>
        <p className="mt-1 max-w-[var(--measure)] text-[13px] text-muted">
          Author the intent brief, choose a profile and a budget. The record the server will commit assembles itself on the right. Staging commits that record and nothing more.
        </p>
      </header>

      <div className="grid grid-cols-[1fr_480px] gap-12 mt-6 items-start max-lg:flex max-lg:flex-col-reverse">
        <div className="min-w-0 flex-1">
          {outcome?.outcome === 'created' && !outcome.pushFailed && (
            <Flash tone="ok">
              <p className="font-semibold">
                Staged {outcome.slug} — committed {outcome.commit.slice(0, 10)} on {outcome.branch}.
              </p>
              <p className="mt-1 text-muted">
                Taking you to the run, where Arm is the next decision. Nothing has dispatched and nothing is spent.
              </p>
            </Flash>
          )}

          {outcome?.outcome === 'created' && outcome.pushFailed && (
            <Flash tone="warn">
              <p className="font-semibold">
                Staged {outcome.slug} — committed {outcome.commit.slice(0, 10)} on {outcome.branch}, but the push failed.
              </p>
              <p className="mt-1.5 font-ui text-xs text-muted">{outcome.pushFailed}</p>
              <p className="mt-1.5 text-muted">
                The commit is local only — the remote never received run/{outcome.slug}. Nothing has dispatched and
                nothing is spent; retry the push from the server, then continue.
              </p>
              <Link to={`/runs/${source.id}/${outcome.slug}`} className="mt-2 inline-block font-semibold text-bad hover:underline">
                Continue to {outcome.slug}
              </Link>
            </Flash>
          )}

          {outcome?.outcome === 'exists' && (
            <Flash tone="info">
              <p className="font-semibold">Already staged — this exact request was recorded before.</p>
              <p className="mt-1 text-muted">No second commit was made; there is nothing to redo. This is not an error.</p>
              <Link to={`/runs/${source.id}/${outcome.slug}`} className="mt-2 inline-block font-semibold text-ink hover:underline">
                Open {outcome.slug}
              </Link>
            </Flash>
          )}

          {outcome?.outcome === 'refused' && outcome.reason === 'slug-taken' && (
            <Flash tone="bad">
              <p className="font-semibold">Refused — slug taken.</p>
              <p className="mt-1 text-muted">{outcome.message}</p>
              <Link to={`/runs/${source.id}/${slug}`} className="mt-2 inline-block font-semibold text-bad hover:underline">
                Open the existing {slug}
              </Link>
            </Flash>
          )}

          {/* `conflict` is not a slug-taken collision — it's the default branch
              having no commits to stage against, or a lost CAS race. Neither
              implies an existing run at this slug, so this taxonomy member
              gets its own re-present-don't-retry posture (ux P6/REC11), the
              same `warn` tone `decide.tsx` already uses for its 409 conflict,
              never the slug-taken headline or a link that may 404. */}
          {outcome?.outcome === 'refused' && outcome.reason === 'conflict' && (
            <Flash tone="warn">
              <p className="font-semibold">Refused — re-check and retry.</p>
              <p className="mt-1 text-muted">{outcome.message}</p>
              <p className="mt-1.5 text-[12px] text-muted">
                Not a slug collision — the branch could not be created as requested. Nothing was committed; review the
                details above and submit again.
              </p>
            </Flash>
          )}

          {outcome?.outcome === 'refused' && outcome.reason === 'no-identity' && (
            <Flash tone="cfg">
              <p className="font-semibold">Refused — no resolvable identity.</p>
              <p className="mt-1.5 font-ui text-xs text-muted">{outcome.message}</p>
              <p className="mt-1.5 text-muted">
                This is deployment configuration, not a form problem — no field here can cure it, and Gatehouse will not guess or ask
                you to type a name. Your draft is intact.
              </p>
            </Flash>
          )}

          {outcome?.outcome === 'refused' && outcome.reason === 'invalid-input' && (
            <Flash tone="bad">
              <p className="font-semibold">Refused.</p>
              <p className="mt-1 text-muted">{outcome.message}</p>
            </Flash>
          )}

          {outcome?.outcome === 'network-error' && <Flash tone="bad">{outcome.message}</Flash>}

          {outcome?.outcome === 'refused' && outcome.reason === 'missing-sections' && (
            <div
              ref={errSummaryRef}
              tabIndex={-1}
              role="alert"
              className="mb-4 border-t border-b border-mark py-3.5"
            >
              <p className="text-sm font-semibold text-bad">Staging refused — the brief is missing required sections</p>
              <p className="mt-1.5 font-ui text-xs text-muted">server: {outcome.message}</p>
              <ul className="mt-2 flex flex-col gap-1">
                {(outcome.missing ?? []).map((heading) => (
                  <li key={heading}>
                    <a href={`#section-${slugify(heading)}`} className="text-[13px] font-semibold text-bad hover:underline">
                      {sectionErrorText(heading)}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {sources.length > 1 && (
            <div className="mb-[22px]">
              <label htmlFor="source" className="block text-[12px] text-muted mb-[5px]">
                Repository
              </label>
              <select
                id="source"
                value={source.id}
                onChange={(e) => setSourceId(e.target.value)}
                className="input-well w-full px-3 py-[8px] text-[14px]"
              >
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.id}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11.5px] text-muted">
                Multiple sources are configured, so Gatehouse asks which repo carries the record. It selects among Gatehouse's own
                sources — never an external system.
              </p>
            </div>
          )}

          <div className="mb-[22px]">
            <label htmlFor="title" className="block text-[12px] text-muted mb-[5px]">
              Title
            </label>
            <input
              id="title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="input-well w-full px-3 py-[8px] text-[14px]"
            />
          </div>

          <div className="mb-[22px]">
            <label htmlFor="slug" className="block text-[12px] text-muted mb-[5px]">
              Slug <span className="font-normal text-muted">— permanent after staging</span>
            </label>
            <div className="flex items-center gap-2.5">
              <input
                id="slug"
                type="text"
                value={slug}
                onChange={(e) => {
                  setSlug(e.target.value)
                  setSlugTouched(true)
                }}
                className={`flex-1 input-well font-mono text-[13.5px] px-3 py-[8px] ${slug && !slugValid ? 'err' : ''}`}
              />
              <span className="whitespace-nowrap font-mono text-[12.5px] text-muted">
                run/{slug || '…'}
              </span>
            </div>
            <p className="mt-1.5 text-[12px] text-muted font-ui">
              Suggested from the title; edit it until you stage. It names the branch and the run directory forever.
            </p>
          </div>

          <fieldset className="mb-[22px]">
            <legend className="block text-[12px] text-muted mb-[7px]">
              Profile · which gates the run carries
            </legend>
            <div className="flex flex-wrap gap-2.5">
              {PROFILES.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setProfile(p)}
                  className={`flex min-w-[150px] flex-col gap-2 text-left border px-3.5 py-3 ${
                    profile === p ? 'border-ink bg-accent-tint' : 'border-line hover:border-ink'
                  }`}
                  aria-pressed={profile === p}
                >
                  <span className="text-[14px] font-semibold text-ink">{p}</span>
                  <span className="flex flex-wrap gap-[4px]">
                    {PROFILE_GATES[p].map((g) => (
                      <Imp key={g} tone={profile === p ? 'fill' : ''}>
                        {g}
                      </Imp>
                    ))}
                  </span>
                </button>
              ))}
            </div>
            {profile === 'patch' && (
              <p className="mt-1.5 text-[12px] text-muted">
                Choosing <span className="font-semibold text-ink">patch</span> also scaffolds a placeholder task stub (
                <code className="font-mono">tasks/01-{slug || '&lt;slug&gt;'}.yaml</code>) you fill in before arming — it appears
                in the record preview.
              </p>
            )}
          </fieldset>

          <div className="mb-[22px] max-w-[220px]">
            <label htmlFor="budget" className="block text-[12px] text-muted mb-[5px]">
              Budget ceiling (USD)
            </label>
            <input
              id="budget"
              type="number"
              min="0"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              className={`input-well w-full px-3 py-[8px] text-[14px] ${budgetInvalid ? 'err' : ''}`}
            />
            <p className="mt-1.5 text-[12px] text-muted font-ui">Blank = no ceiling; the run reads as unmetered.</p>
          </div>

          <div className="mb-6">
            <p className="mb-[14px] border-b border-ink pb-2 text-[13px] font-semibold text-ink">
              Intent brief — structure from the contract, words from you
            </p>
            {sectionEntries.map((heading) => {
              const anchorId = `section-${slugify(heading)}`
              const isServerMissing = outcome?.outcome === 'refused' && outcome.reason === 'missing-sections' && (outcome.missing ?? []).includes(heading)
              const filled = Boolean((sections[heading] ?? '').trim())
              return (
                <div
                  key={heading}
                  id={anchorId}
                  className="mb-4"
                >
                  <div className="flex items-center gap-2.5 pb-[5px]">
                    <span className="font-mono text-[12.5px] text-ink">## {heading}</span>
                    <span className="font-ui text-[11px] text-muted">{filled ? '✓ filled' : '· required'}</span>
                    {isServerMissing && <span className="ml-auto text-xs font-semibold text-bad">{sectionErrorText(heading)}</span>}
                  </div>
                  <textarea
                    value={sections[heading] ?? ''}
                    onChange={(e) => setSections((prev) => ({ ...prev, [heading]: e.target.value }))}
                    placeholder={`Your ${heading.toLowerCase()} text, in your own words. Placeholders are never submitted.`}
                    rows={3}
                    className={`input-well w-full resize-y px-3 py-2.5 font-sans text-[15px] placeholder:text-muted min-h-[96px] ${isServerMissing ? 'err' : ''}`}
                  />
                </div>
              )
            })}
            <p className="mt-1 text-[12px] text-muted font-ui">
              Section headings come from the source's contract template — they are fixed chrome, not content. Gatehouse never
              writes a word of the brief.
            </p>
          </div>

          <div className="mb-[22px]">
            <p className="mb-[14px] border-b border-ink pb-2 text-[13px] font-semibold text-ink">
              Provenance — optional, your own pointer text
            </p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label htmlFor="intake-source" className="block font-ui text-[11.5px] text-muted mb-1.5">
                  source
                </label>
                <input
                  id="intake-source"
                  type="text"
                  value={intakeSource}
                  onChange={(e) => setIntakeSource(e.target.value)}
                  className="input-well w-full px-3 py-[8px] font-mono text-[13.5px]"
                />
              </div>
              <div>
                <label htmlFor="intake-ref" className="block font-ui text-[11.5px] text-muted mb-1.5">
                  ref
                </label>
                <input
                  id="intake-ref"
                  type="text"
                  value={intakeRef}
                  onChange={(e) => setIntakeRef(e.target.value)}
                  className="input-well w-full px-3 py-[8px] font-mono text-[13.5px]"
                />
              </div>
              <div>
                <label htmlFor="intake-url" className="block font-ui text-[11.5px] text-muted mb-1.5">
                  url
                </label>
                <input
                  id="intake-url"
                  type="text"
                  value={intakeUrl}
                  onChange={(e) => setIntakeUrl(e.target.value)}
                  placeholder="—"
                  className="input-well w-full px-3 py-[8px] font-mono text-[13.5px] placeholder:text-muted"
                />
              </div>
            </div>
            <p className="mt-1.5 text-[12px] text-muted font-ui">
              Recorded verbatim into the genesis commit's <code>intake:</code> block. Nothing here is
              fetched, previewed, or checked — a URL is a string you vouch for, not an object Gatehouse retrieves.
            </p>
          </div>

          <div className="mb-[22px] flex flex-wrap items-center gap-2.5 border-t border-b border-line py-3 text-[13px] text-ink">
            <span className="text-[12px] text-muted">Recorded as</span>
            {source.identity ? (
              <>
                <span className="font-semibold text-ink">{source.identity.name}</span>
                <span className="font-mono text-[12.5px] text-muted">&lt;{source.identity.email}&gt;</span>
              </>
            ) : (
              <span className="font-ui text-[12.5px] font-semibold text-bad">no identity configured on this source</span>
            )}
            <span className="ml-auto text-right font-ui text-[11px] text-muted">
              — author &amp; committer · displayed, never asked
            </span>
          </div>

          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={submit}
              disabled={!ready || mutation.isPending}
              className="btn"
            >
              {mutation.isPending ? 'Committing…' : 'Stage run'}
            </button>
            <p className="text-[12.5px] leading-[1.5] text-muted max-w-[34ch]">{submitHint}</p>
          </div>
        </div>

        <RecordPreview
          slug={slug}
          profile={profile}
          scaffold={scaffold}
          ready={ready}
          sections={sections}
          sectionEntries={sectionEntries}
          clientKey={clientKey}
          identity={source.identity}
        />
      </div>
    </div>
  )
}

function RecordPreview({
  slug,
  profile,
  scaffold,
  ready,
  sections,
  sectionEntries,
  clientKey,
  identity,
}: {
  slug: string
  profile: Profile
  scaffold: RunScaffold | null
  ready: boolean
  sections: Record<string, string>
  sectionEntries: string[]
  clientKey: string
  identity: { name: string; email: string } | null
}) {
  const filledCount = sectionEntries.filter((h) => (sections[h] ?? '').trim()).length
  const branchLabel = slug || '…'
  const genesisReady = Boolean(ready && scaffold)
  return (
    <aside className="w-full shrink-0 lg:sticky lg:top-6 lg:w-[480px]">
      <div className="flex items-baseline gap-2.5 pb-[5px] font-ui text-[11.5px] text-muted">
        <span>the record this stages</span>
        <span className="ml-auto tabular-nums">
          {filledCount} of {sectionEntries.length} sections filled
        </span>
      </div>
      <div className="border-t border-ink border-b border-b-line py-[18px]">
        {/* branch line */}
        <div className="font-mono text-[12.5px] text-muted">
          new branch <span className="font-semibold text-ink">run/{branchLabel}</span> off main
        </div>

        {/* the genesis commit: hollow until the record is ready to be pressed */}
        <div className="mt-[14px]">
          <Imp tone={genesisReady ? 'fill' : 'dot'}>genesis · {genesisReady ? 'ready' : 'not ready'}</Imp>
          <div className="mt-2.5 text-[18px] font-semibold leading-[1.35] text-ink">
            {scaffold ? (
              <>
                state({slug || branchLabel}): {scaffold.message.replace(`state(${slug}): `, '')}
              </>
            ) : (
              <>state({branchLabel}): staged by …</>
            )}
          </div>
          {scaffold && <div className="font-mono text-[12px] text-muted">[client-key: {clientKey}]</div>}
          {scaffold && identity && (
            <div className="mt-2 flex flex-wrap items-baseline gap-2 text-[13px]">
              <span className="font-semibold text-ink">{identity.name}</span>
              <span className="font-mono text-[12.5px] text-muted">&lt;{identity.email}&gt;</span>
              <span className="text-[12px] text-muted">author &amp; committer</span>
            </div>
          )}
          {scaffold && !identity && <div className="mt-2 font-ui text-[13px] font-semibold text-bad">(no identity configured)</div>}
        </div>

        {/* files */}
        <div className="mt-[18px] font-ui text-[12.5px]">
          <div className="flex items-baseline gap-2.5 border-b border-dashed border-line py-[5px]">
            <span className="text-ink">runs/{branchLabel}/state.yaml</span>
            <span className="ml-auto text-[11.5px] text-muted">new</span>
          </div>
          <div className="flex items-baseline gap-2.5 border-b border-dashed border-line py-[5px]">
            <span className="text-ink">runs/{branchLabel}/intent-brief.md</span>
            <span className="ml-auto text-[11.5px] text-muted tabular-nums">
              {filledCount} of {sectionEntries.length} · new
            </span>
          </div>
          <div className="mt-1 ml-[18px] flex flex-col gap-[2px] text-[11.5px]">
            {sectionEntries.map((h) => {
              const filled = Boolean((sections[h] ?? '').trim())
              return (
                <div key={h} className={filled ? 'text-ink' : 'text-muted'}>
                  {filled ? '✓' : '·'} {h}
                </div>
              )
            })}
          </div>
          {profile === 'patch' && (
            <div className="mt-1 flex items-baseline gap-2.5 border-b border-dashed border-line py-[5px]">
              <span className="text-ink">
                runs/{branchLabel}/tasks/01-{branchLabel}.yaml
              </span>
              <span className="ml-auto text-[11.5px] text-muted">placeholder stub · new</span>
            </div>
          )}
        </div>

        {/* collapsible state.yaml */}
        {scaffold && (
          <details className="group mt-[18px] border-t border-line">
            <summary className="flex cursor-pointer list-none items-center gap-2 py-2.5 font-ui text-[12px] text-ink">
              <span className="inline-block group-open:rotate-90">▸</span>
              runs/{branchLabel}/state.yaml
              <span className="ml-auto text-[11px] text-muted tabular-nums">{(scaffold.files['state.yaml'] ?? '').split('\n').length} lines</span>
            </summary>
            <pre className="m-0 overflow-x-auto whitespace-pre bg-inset px-3.5 py-3 font-mono text-[12px] leading-[1.6] text-ink">
              {scaffold.files['state.yaml']}
            </pre>
          </details>
        )}

        {/* closing line */}
        <div className="mt-[18px] max-w-[var(--measure)] border-t border-dashed border-line pt-3 text-[12.5px] leading-[1.55] text-muted">
          <span className="text-ink">Staging commits this record.</span> No agent dispatches, no budget meters — the run rests at{' '}
          <span className="font-mono">staged</span> until you arm it.
        </div>
      </div>
    </aside>
  )
}

function Flash({ tone, children }: { tone: 'ok' | 'info' | 'bad' | 'cfg' | 'warn'; children: React.ReactNode }) {
  const cls = {
    ok: 'border-ink text-ink',
    info: 'border-line text-ink',
    bad: 'border-mark text-bad',
    cfg: 'border-mark border-dashed text-bad',
    warn: 'border-warn text-warn',
  }[tone]
  return (
    <div role={tone === 'bad' || tone === 'cfg' ? 'alert' : 'status'} className={`mb-4 border-t border-b py-3 text-[13px] leading-[1.55] ${cls}`}>
      {children}
    </div>
  )
}
