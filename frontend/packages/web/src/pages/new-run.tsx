// New-run staging: the web sibling of `agentic new`. genesis-preview candidate
// (state.yaml gates.G1.notes) — the organizing element is the record itself,
// previewed live via the same planRunScaffold the server commits with (ADR-6),
// so the preview cannot drift from the truth. No model/API call of any kind
// (AC2.3); the operator's own words are the only prose that lands in the brief
// (AC2.1). Outcome/flash rendering for all five submission outcomes lives
// here — decide.tsx is untouched (task 05 owns the Arm affordance only).
import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { planRunScaffold, ScaffoldError, SLUG_PATTERN, type RunScaffold } from '@agentic/core/record'
import { ApiError, PROFILE_GATES, api, type Profile, type StageOutcomeView, type StagingSourceConfig } from '../api.ts'
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
  useEffect(() => {
    if (sourceId === null && sources[0]) setSourceId(sources[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources.length])

  // A fresh draft per required-section list (only changes if the source
  // changes) — never carries stale keys from a previously selected source.
  useEffect(() => {
    if (!source) return
    setSections((prev) => {
      const next: Record<string, string> = {}
      for (const heading of source.briefSections) next[heading] = prev[heading] ?? ''
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      <header className="mb-[22px] flex items-end gap-3.5 border-b border-line pb-3.5">
        <span className="font-mono text-xl font-semibold uppercase tracking-[0.14em] text-faint">
          <Link to="/portfolio" className="hover:text-accent">
            Portfolio
          </Link>{' '}
          /
        </span>
        <h1 className="font-mono text-xl font-semibold uppercase tracking-[0.14em]">New run</h1>
        <span className="ml-auto text-xs text-muted">You author the words. Gate shows you the record they become.</span>
      </header>

      <div className="flex flex-col-reverse gap-[22px] lg:flex-row lg:items-start">
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
              <p className="mt-1.5 font-mono text-xs text-muted">{outcome.pushFailed}</p>
              <p className="mt-1.5 text-muted">
                The commit is local only — the remote never received run/{outcome.slug}. Nothing has dispatched and
                nothing is spent; retry the push from the server, then continue.
              </p>
              <Link to={`/runs/${source.id}/${outcome.slug}`} className="mt-2 inline-block font-semibold text-warn hover:underline">
                Continue to {outcome.slug}
              </Link>
            </Flash>
          )}

          {outcome?.outcome === 'exists' && (
            <Flash tone="info">
              <p className="font-semibold">Already staged — this exact request was recorded before.</p>
              <p className="mt-1 text-muted">No second commit was made; there is nothing to redo. This is not an error.</p>
              <Link to={`/runs/${source.id}/${outcome.slug}`} className="mt-2 inline-block font-semibold text-accent hover:underline">
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
              <p className="mt-1.5 text-[12px] text-faint">
                Not a slug collision — the branch could not be created as requested. Nothing was committed; review the
                details above and submit again.
              </p>
            </Flash>
          )}

          {outcome?.outcome === 'refused' && outcome.reason === 'no-identity' && (
            <Flash tone="cfg">
              <p className="font-semibold">Refused — no resolvable identity.</p>
              <p className="mt-1.5 font-mono text-xs text-muted">{outcome.message}</p>
              <p className="mt-1.5 text-muted">
                This is deployment configuration, not a form problem — no field here can cure it, and Gate will not guess or ask
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
              className="mb-4 rounded-[5px] border-2 border-bad bg-surface px-4 py-3.5"
            >
              <p className="text-sm font-bold text-bad">Staging refused — the brief is missing required sections</p>
              <p className="mt-1.5 font-mono text-xs text-muted">server: {outcome.message}</p>
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
            <div className="mb-3.5">
              <label htmlFor="source" className="mb-1.5 block font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">
                Repository
              </label>
              <select
                id="source"
                value={source.id}
                onChange={(e) => setSourceId(e.target.value)}
                className="w-full rounded-[5px] border border-line bg-inset px-2.5 py-2 text-sm"
              >
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.id}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11.5px] text-faint">
                Multiple sources are configured, so Gate asks which repo carries the record. It selects among Gate's own
                sources — never an external system.
              </p>
            </div>
          )}

          <div className="mb-3.5">
            <label htmlFor="title" className="mb-1.5 block font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">
              Title
            </label>
            <input
              id="title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-[5px] border border-line bg-inset px-2.5 py-2 text-sm"
            />
          </div>

          <div className="mb-3.5">
            <label htmlFor="slug" className="mb-1.5 block font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">
              Slug <span className="font-normal normal-case tracking-normal text-faint">— permanent after staging</span>
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
                className={`flex-1 rounded-[5px] border bg-inset px-2.5 py-2 font-mono text-[13px] ${slug && !slugValid ? 'border-bad' : 'border-line'}`}
              />
              <span className="whitespace-nowrap font-mono text-xs font-semibold text-accent">→ run/{slug || '…'}</span>
            </div>
            <p className="mt-1 text-[11.5px] text-faint">
              Suggested from the title; edit it until you stage. It names the branch and the run directory forever.
            </p>
          </div>

          <div className="mb-3.5">
            <label className="mb-1.5 block font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">
              Profile <span className="font-normal normal-case tracking-normal text-faint">— sets which gates the record carries</span>
            </label>
            <div className="flex gap-2.5">
              {PROFILES.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setProfile(p)}
                  className={`flex-1 rounded-[5px] border px-3 py-2.5 text-left transition-colors ${
                    profile === p ? 'border-accent bg-accent-soft' : 'border-line bg-inset hover:border-accent'
                  }`}
                >
                  <span className={`text-[13px] font-semibold ${profile === p ? 'text-accent' : ''}`}>{p}</span>
                  <span className="mt-1.5 flex gap-[3px]">
                    {PROFILE_GATES[p].map((g) => (
                      <span
                        key={g}
                        className="inline-flex h-[18px] items-center gap-0.5 rounded-[3px] border border-dashed border-line bg-surface px-1 font-mono text-[10px] text-faint"
                      >
                        <span className="text-[7px]">{g.slice(1)}</span>·
                      </span>
                    ))}
                  </span>
                </button>
              ))}
            </div>
            {profile === 'patch' && (
              <p className="mt-1 text-[11.5px] text-faint">
                Choosing <b className="text-muted">patch</b> also scaffolds a placeholder task stub (
                <code className="font-mono">tasks/01-{slug || '&lt;slug&gt;'}.yaml</code>) you fill in before arming — it appears
                in the record preview.
              </p>
            )}
          </div>

          <div className="mb-3.5 max-w-[220px]">
            <label htmlFor="budget" className="mb-1.5 block font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">
              Budget ceiling (USD)
            </label>
            <input
              id="budget"
              type="number"
              min="0"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              className={`w-full rounded-[5px] border bg-inset px-2.5 py-2 text-sm ${budgetInvalid ? 'border-bad' : 'border-line'}`}
            />
            <p className="mt-1 text-[11.5px] text-faint">Blank = no ceiling; the run reads as unmetered.</p>
          </div>

          <div className="mb-6.5">
            <p className="mb-3.5 border-b border-line pb-1.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">
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
                  className={`mb-2.5 overflow-hidden rounded-[5px] border bg-surface ${isServerMissing ? 'border-bad' : 'border-line'}`}
                >
                  <div className="flex items-baseline gap-2 border-b border-line bg-inset px-2.5 py-1.5">
                    <span className="font-mono text-[12.5px] font-semibold text-ink">## {heading}</span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-faint">required section</span>
                    <span className={`ml-auto font-mono text-[11px] font-semibold ${filled ? 'text-ok' : 'text-faint'}`}>{filled ? '✓' : '·'}</span>
                  </div>
                  {isServerMissing && <p className="px-2.5 pt-1.5 text-xs font-semibold text-bad">{sectionErrorText(heading)}</p>}
                  <textarea
                    value={sections[heading] ?? ''}
                    onChange={(e) => setSections((prev) => ({ ...prev, [heading]: e.target.value }))}
                    placeholder={`Your ${heading.toLowerCase()} text, in your own words. Placeholders are never submitted.`}
                    rows={3}
                    className="w-full resize-y bg-transparent px-2.5 py-2 text-sm placeholder:text-faint"
                  />
                </div>
              )
            })}
            <p className="mt-1 text-[11.5px] text-faint">
              Section headings come from the source's contract template — they are fixed chrome, not content. Gate never
              writes a word of the brief.
            </p>
          </div>

          <div className="mb-3.5">
            <p className="mb-3.5 border-b border-line pb-1.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">
              Provenance — optional, your own pointer text
            </p>
            <div className="flex gap-3">
              <div className="flex-1">
                <label htmlFor="intake-source" className="mb-1.5 block font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">
                  Source
                </label>
                <input
                  id="intake-source"
                  type="text"
                  value={intakeSource}
                  onChange={(e) => setIntakeSource(e.target.value)}
                  className="w-full rounded-[5px] border border-line bg-inset px-2.5 py-2 text-sm"
                />
              </div>
              <div className="flex-1">
                <label htmlFor="intake-ref" className="mb-1.5 block font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">
                  Ref
                </label>
                <input
                  id="intake-ref"
                  type="text"
                  value={intakeRef}
                  onChange={(e) => setIntakeRef(e.target.value)}
                  className="w-full rounded-[5px] border border-line bg-inset px-2.5 py-2 text-sm"
                />
              </div>
            </div>
            <div className="mt-3">
              <label htmlFor="intake-url" className="mb-1.5 block font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">
                URL
              </label>
              <input
                id="intake-url"
                type="text"
                value={intakeUrl}
                onChange={(e) => setIntakeUrl(e.target.value)}
                placeholder="https:// — recorded as text you vouch for"
                className="w-full rounded-[5px] border border-line bg-inset px-2.5 py-2 text-sm placeholder:text-faint"
              />
            </div>
            <p className="mt-1.5 text-[11.5px] text-faint">
              Recorded verbatim into the genesis commit's <code className="font-mono">intake:</code> block. Nothing here is
              fetched, previewed, or checked — a URL is a string you vouch for, not an object Gate retrieves.
            </p>
          </div>

          <div className="mb-3.5 flex items-baseline gap-2.5 rounded-[5px] border border-line bg-surface px-3 py-2.5">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">Recorded as</span>
            {source.identity ? (
              <span className="font-mono text-[12.5px] font-semibold text-ink">
                staged by {source.identity.name} <span className="font-normal text-faint">&lt;{source.identity.email}&gt;</span>
              </span>
            ) : (
              <span className="font-mono text-[12.5px] font-semibold text-bad">no identity configured on this source</span>
            )}
            <span className="ml-auto text-right text-[11px] leading-[1.4] text-faint">
              the server's git identity —
              <br />
              displayed, never asked
            </span>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={submit}
              disabled={!ready || mutation.isPending}
              className="rounded-full border border-accent bg-accent px-4 py-[7px] text-sm font-semibold text-on-solid shadow-[0_0_12px_var(--glow)] transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
            >
              {mutation.isPending ? 'Committing…' : 'Stage run'}
            </button>
            <p className="text-[11.5px] leading-[1.5] text-faint">{submitHint}</p>
          </div>
        </div>

        <RecordPreview
          slug={slug}
          profile={profile}
          scaffold={scaffold}
          scaffoldError={scaffoldError}
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
  scaffoldError,
  ready,
  sections,
  sectionEntries,
  clientKey,
  identity,
}: {
  slug: string
  profile: Profile
  scaffold: RunScaffold | null
  scaffoldError: string | null
  ready: boolean
  sections: Record<string, string>
  sectionEntries: string[]
  clientKey: string
  identity: { name: string; email: string } | null
}) {
  const filledCount = sectionEntries.filter((h) => (sections[h] ?? '').trim()).length
  const branchLabel = slug || '…'
  return (
    <aside className="w-full shrink-0 lg:sticky lg:top-4 lg:w-[400px]">
      <div className="rounded-[6px] border border-line border-l-[3px] border-l-accent bg-surface p-4 shadow-[0_0_0_1px_var(--color-accent-soft)]">
        <div className="mb-1 flex items-baseline gap-2 font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">
          <span>The record this stages</span>
          <span className="ml-auto text-[9.5px] normal-case tracking-normal text-accent">· live preview</span>
        </div>
        <p className="mb-3.5 text-[11.5px] leading-[1.5] text-faint">
          Rendered by the same planner the server commits with — what you see is byte-for-byte what lands in git.
        </p>

        <div className="mb-3 flex items-baseline gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-faint">new branch</span>
          <span className="font-mono text-[13.5px] font-semibold text-accent">run/{branchLabel}</span>
        </div>

        <div className="relative mb-3 pl-[22px]">
          <span
            className={`absolute top-[5px] left-[2px] block h-[10px] w-[10px] rounded-full border-2 ${
              ready && scaffold ? 'border-accent bg-accent shadow-[0_0_10px_var(--glow)]' : 'border-faint bg-inset'
            }`}
          />
          <p className="font-mono text-xs leading-[1.5] font-semibold break-words">
            {scaffold ? scaffold.message : (scaffoldError ?? `state(${branchLabel}): staged by …`)}
          </p>
          {scaffold &&
            (identity ? (
              <p className="mt-0.5 font-mono text-[11.5px] text-muted">
                <span className="font-semibold text-ink">{identity.name}</span> <span className="text-faint">&lt;{identity.email}&gt;</span>{' '}
                — author &amp; committer
              </p>
            ) : (
              <p className="mt-0.5 font-mono text-[11.5px] font-semibold text-bad">(no identity configured) — author &amp; committer</p>
            ))}
        </div>

        <div className="border-t border-line pt-2.5">
          <div className="flex items-baseline gap-2 py-[3px] font-mono text-xs">
            <span>runs/{branchLabel}/state.yaml</span>
            <span className="rounded-[3px] border border-ok px-1 py-px text-[9.5px] font-semibold tracking-[0.08em] text-ok uppercase">new</span>
          </div>
          <div className="flex items-baseline gap-2 py-[3px] font-mono text-xs">
            <span>runs/{branchLabel}/intent-brief.md</span>
            <span className="rounded-[3px] border border-ok px-1 py-px text-[9.5px] font-semibold tracking-[0.08em] text-ok uppercase">new</span>
            <span className={`ml-auto text-[11px] ${filledCount === sectionEntries.length && sectionEntries.length > 0 ? 'text-ok' : 'text-faint'}`}>
              {filledCount === sectionEntries.length && sectionEntries.length > 0 ? '✓ ' : ''}
              {filledCount} of {sectionEntries.length}
            </span>
          </div>
          <div className="mt-0.5 ml-3.5 flex flex-col gap-[1px]">
            {sectionEntries.map((h) => {
              const filled = Boolean((sections[h] ?? '').trim())
              return (
                <div key={h} className="flex gap-1.5 font-mono text-[11px] text-muted">
                  <span className={`w-3 text-center ${filled ? 'text-ok' : 'text-faint'}`}>{filled ? '✓' : '·'}</span>
                  <span>
                    {h}
                    {!filled ? ' — empty' : ''}
                  </span>
                </div>
              )
            })}
          </div>
          {profile === 'patch' && (
            <div className="flex items-baseline gap-2 py-[3px] font-mono text-xs">
              <span>
                runs/{branchLabel}/tasks/01-{branchLabel}.yaml
              </span>
              <span className="rounded-[3px] border border-ok px-1 py-px text-[9.5px] font-semibold tracking-[0.08em] text-ok uppercase">new</span>
              <span className="ml-auto text-[11px] text-faint">placeholder stub</span>
            </div>
          )}
        </div>

        {scaffold && (
          <details className="mt-2.5">
            <summary className="cursor-pointer font-mono text-[10.5px] font-semibold tracking-[0.06em] text-muted uppercase hover:text-ink">
              state.yaml — {(scaffold.files['state.yaml'] ?? '').split('\n').length} lines
            </summary>
            <pre className="mt-2 overflow-x-auto rounded-[4px] bg-inset px-3 py-2.5 font-mono text-[11px] leading-[1.6] whitespace-pre text-muted">
              {scaffold.files['state.yaml']}
            </pre>
          </details>
        )}

        <details className="mt-2">
          <summary className="cursor-pointer font-mono text-[10.5px] text-faint hover:text-ink">replay key · {clientKey}</summary>
          <p className="mt-1 font-mono text-[11px] leading-[1.5] text-muted">
            Generated for this form session. If your submit is cut off and you retry, the server recognizes the same
            request and reports "already staged" instead of failing or double-committing.
          </p>
        </details>

        <div className="mt-3 border-t border-line pt-2.5 text-[11.5px] leading-[1.55] text-muted">
          <b className="text-ink">Staging commits this record. Nothing else happens.</b> No agent dispatches, no budget
          meters — the run rests at <span className="font-mono">staged</span> until you arm it, and arming is its own
          decision on the run's page.
        </div>
      </div>
    </aside>
  )
}

function Flash({ tone, children }: { tone: 'ok' | 'info' | 'bad' | 'cfg' | 'warn'; children: React.ReactNode }) {
  const cls = {
    ok: 'bg-ok-soft text-ok',
    info: 'border border-accent bg-accent-soft text-accent',
    bad: 'bg-bad-soft text-bad',
    cfg: 'border border-dashed border-bad bg-bad-soft text-bad',
    // Same tone `decide.tsx`'s 409 conflict Flash uses (ux P6) — a third
    // class between ok and bad, for outcomes that are real but partial
    // (push failed) or need a re-present rather than an error (conflict).
    warn: 'border border-warn bg-warn-soft text-warn',
  }[tone]
  return (
    <div role={tone === 'bad' || tone === 'cfg' ? 'alert' : 'status'} className={`mb-4 rounded-[5px] px-3.5 py-3 text-[13px] leading-[1.55] ${cls}`}>
      {children}
    </div>
  )
}
