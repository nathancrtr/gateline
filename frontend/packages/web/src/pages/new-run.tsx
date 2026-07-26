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
      <div className="font-mono text-[12px] tracking-[0.14em] uppercase text-accent-deep mb-2.5">Stage a run · the record assembles itself</div>
      <header className="mb-[26px] border-b border-line pb-5">
        <h1 className="font-sans text-[56px] font-semibold leading-[1.04] tracking-[-0.025em]">Stage a run.</h1>
        <p className="mt-3 max-w-[60ch] text-[15.5px] text-[#4d4742] leading-[1.6]">
          Author an intent brief, choose a profile and a budget. On the right, the <em>state.yaml</em> the server commits assembles itself as you write — a page proof, not a debug log. Staging commits this record and nothing more.
        </p>
      </header>

      <div className="grid grid-cols-[1fr_520px] gap-12 mt-9 items-start max-lg:flex max-lg:flex-col-reverse">
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
              className="mb-4 rounded-md border border-bad-line bg-bad-bg px-4 py-3.5"
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
            <div className="mb-[22px]">
              <label htmlFor="source" className="block text-[13px] font-semibold text-[#4d4742] mb-[7px] tracking-[0.01em]">
                Repository
              </label>
              <select
                id="source"
                value={source.id}
                onChange={(e) => setSourceId(e.target.value)}
                className="input-well w-full px-3 py-[10px] text-[15px]"
              >
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.id}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11.5px] text-faint">
                Multiple sources are configured, so Gatehouse asks which repo carries the record. It selects among Gatehouse's own
                sources — never an external system.
              </p>
            </div>
          )}

          <div className="mb-[22px]">
            <label htmlFor="title" className="block text-[13px] font-semibold text-[#4d4742] mb-[7px] tracking-[0.01em]">
              Title
            </label>
            <input
              id="title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="input-well w-full px-3 py-[10px] text-[15px]"
            />
          </div>

          <div className="mb-[22px]">
            <label htmlFor="slug" className="block text-[13px] font-semibold text-[#4d4742] mb-[7px] tracking-[0.01em]">
              Slug <span className="font-normal tracking-normal text-muted">— permanent after staging</span>
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
                className={`flex-1 input-well font-mono text-[13.5px] px-3 py-[10px] ${slug && !slugValid ? 'err' : ''}`}
              />
              <span className="whitespace-nowrap font-mono text-[12.5px] text-accent-deep">
                <span className="text-accent mr-1.5">→</span>run/{slug || '…'}
              </span>
            </div>
            <p className="mt-1.5 text-[12px] text-muted font-mono">
              Suggested from the title; edit it until you stage. It names the branch and the run directory forever.
            </p>
          </div>

          <div className="mb-[22px]">
            <label className="block text-[13px] font-semibold text-[#4d4742] mb-[9px] tracking-[0.01em]">
              Profile · which gates the run carries
            </label>
            <div className="grid grid-cols-3 gap-2.5">
              {PROFILES.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setProfile(p)}
                  className={`flex flex-col gap-2 text-left rounded-md border px-3.5 py-3 transition-all shadow-[inset_0_1px_2px_rgba(36,32,28,0.03)] ${
                    profile === p
                      ? 'bg-accent-tint border-accent shadow-[0_0_0_2px_var(--color-accent-tint),inset_0_0_0_1px_var(--color-accent)]'
                      : 'border-line-cool bg-surface hover:border-accent'
                  }`}
                >
                  <span className={`text-[14px] font-semibold ${profile === p ? 'text-accent-deep' : 'text-ink'}`}>{p}</span>
                  <span className="flex gap-[5px]">
                    {PROFILE_GATES[p].map((g) => (
                      <span
                        key={g}
                        className={`font-mono text-[10.5px] font-semibold px-1.5 py-0.5 rounded-xs border ${
                          profile === p
                            ? 'bg-surface border-[#e9d3c4] text-accent-deep'
                            : 'border-line-cool bg-inset text-muted'
                        }`}
                      >
                        {g}
                      </span>
                    ))}
                  </span>
                </button>
              ))}
            </div>
            {profile === 'patch' && (
              <p className="mt-1.5 text-[12px] text-muted">
                Choosing <span className="font-semibold text-[#4d4742]">patch</span> also scaffolds a placeholder task stub (
                <code className="font-mono">tasks/01-{slug || '&lt;slug&gt;'}.yaml</code>) you fill in before arming — it appears
                in the record preview.
              </p>
            )}
          </div>

          <div className="mb-[22px] max-w-[220px]">
            <label htmlFor="budget" className="block text-[13px] font-semibold text-[#4d4742] mb-[7px] tracking-[0.01em]">
              Budget ceiling (USD)
            </label>
            <input
              id="budget"
              type="number"
              min="0"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              className={`input-well w-full px-3 py-[10px] text-[15px] ${budgetInvalid ? 'err' : ''}`}
            />
            <p className="mt-1.5 text-[12px] text-muted font-mono">Blank = no ceiling; the run reads as unmetered.</p>
          </div>

          <div className="mb-6">
            <p className="mb-[14px] border-b border-line pb-2 text-[13px] font-semibold text-[#4d4742] tracking-[0.01em]">
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
                  className={`mb-3 overflow-hidden rounded-md border bg-surface ${isServerMissing ? 'border-bad' : 'border-line'}`}
                >
                  <div className="flex items-center gap-2.5 px-3.5 py-[11px] bg-inset border-b border-line">
                    <span className="font-mono text-[13px] font-semibold text-accent">##</span>
                    <span className="font-sans font-semibold text-[18px] text-ink tracking-[-0.005em]">{heading}</span>
                    <span className="ml-auto font-mono text-[10.5px] tracking-[0.08em] uppercase text-muted">required</span>
                    <span
                      className={`inline-flex items-center justify-center w-[18px] h-[18px] rounded-full text-[11px] font-bold border ${
                        filled
                          ? 'bg-ok-bg text-ok border-ok-line'
                          : 'bg-pend-bg text-pend-ink border-pend-line border-dashed'
                      }`}
                    >
                      {filled ? '✓' : '·'}
                    </span>
                  </div>
                  {isServerMissing && <p className="px-3.5 pt-1.5 text-xs font-semibold text-bad">{sectionErrorText(heading)}</p>}
                  <textarea
                    value={sections[heading] ?? ''}
                    onChange={(e) => setSections((prev) => ({ ...prev, [heading]: e.target.value }))}
                    placeholder={`Your ${heading.toLowerCase()} text, in your own words. Placeholders are never submitted.`}
                    rows={3}
                    className="w-full resize-y bg-transparent border-none rounded-none shadow-none px-3.5 py-3 text-[15px] placeholder:text-faint min-h-[96px]"
                  />
                </div>
              )
            })}
            <p className="mt-1 text-[12px] text-muted font-mono">
              Section headings come from the source's contract template — they are fixed chrome, not content. Gatehouse never
              writes a word of the brief.
            </p>
          </div>

          <div className="mb-[22px]">
            <p className="mb-[14px] border-b border-line pb-2 text-[13px] font-semibold text-[#4d4742] tracking-[0.01em]">
              Provenance — optional, your own pointer text
            </p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label htmlFor="intake-source" className="block font-mono text-[11.5px] text-muted mb-1.5">
                  source
                </label>
                <input
                  id="intake-source"
                  type="text"
                  value={intakeSource}
                  onChange={(e) => setIntakeSource(e.target.value)}
                  className="input-well w-full px-3 py-[10px] font-mono text-[13.5px]"
                />
              </div>
              <div>
                <label htmlFor="intake-ref" className="block font-mono text-[11.5px] text-muted mb-1.5">
                  ref
                </label>
                <input
                  id="intake-ref"
                  type="text"
                  value={intakeRef}
                  onChange={(e) => setIntakeRef(e.target.value)}
                  className="input-well w-full px-3 py-[10px] font-mono text-[13.5px]"
                />
              </div>
              <div>
                <label htmlFor="intake-url" className="block font-mono text-[11.5px] text-muted mb-1.5">
                  url
                </label>
                <input
                  id="intake-url"
                  type="text"
                  value={intakeUrl}
                  onChange={(e) => setIntakeUrl(e.target.value)}
                  placeholder="—"
                  className="input-well w-full px-3 py-[10px] font-mono text-[13.5px] placeholder:text-faint"
                />
              </div>
            </div>
            <p className="mt-1.5 text-[12px] text-muted font-mono">
              Recorded verbatim into the genesis commit's <code>intake:</code> block. Nothing here is
              fetched, previewed, or checked — a URL is a string you vouch for, not an object Gatehouse retrieves.
            </p>
          </div>

          <div className="mb-[22px] flex items-center gap-2.5 rounded-md border border-dashed border-line-cool bg-inset px-3.5 py-3 text-[13px] text-[#4d4742]">
            <span className="font-mono text-[11px] tracking-[0.08em] uppercase text-muted">Recorded as</span>
            {source.identity ? (
              <>
                <span className="font-semibold text-ink">{source.identity.name}</span>
                <span className="font-mono text-[12.5px] text-muted">&lt;{source.identity.email}&gt;</span>
              </>
            ) : (
              <span className="font-mono text-[12.5px] font-semibold text-bad">no identity configured on this source</span>
            )}
            <span className="ml-auto text-right font-mono text-[11px] text-faint">
              — author &amp; committer · displayed, never asked
            </span>
          </div>

          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={submit}
              disabled={!ready || mutation.isPending}
              className="rounded-sm border border-[#8a3a1e] bg-accent px-5 py-[11px] text-[14px] font-semibold text-white shadow-[var(--shadow-soft)] transition-all hover:bg-[#8e3d20] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
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
    <aside className="w-full shrink-0 lg:sticky lg:top-6 lg:w-[520px]">
      <div className="rounded-xl border border-line bg-surface overflow-hidden shadow-[var(--shadow-lift)]">
        {/* ptop header bar */}
        <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-line bg-inset">
          <span className="font-mono text-[11px] tracking-[0.12em] uppercase text-muted">The record this stages</span>
          <span className="ml-auto inline-flex items-center gap-[7px] text-[12px] font-semibold text-ok">
            <span className="inline-block w-2 h-2 rounded-full bg-ok" />
            live preview
          </span>
        </div>

        {/* pbody — blueprint grid */}
        <div className="blueprint-grid relative px-7 py-7">
          {/* branch line */}
          <div className="flex items-center gap-2 font-mono text-[12.5px] text-muted relative">
            <span className="text-accent">⎇</span>
            new branch <span className="font-semibold text-ink">run/{branchLabel}</span> off{' '}
            <span className="font-mono">main</span>
          </div>

          {/* genesis commit chip — the hero */}
          <div className="mt-[22px] p-5 rounded-lg bg-surface border border-line shadow-[var(--shadow-soft)] relative">
            <div className="flex items-center gap-3">
              <span
                className={`inline-block w-[13px] h-[13px] rounded-full flex-none ${
                  ready && scaffold
                    ? 'bg-accent shadow-[0_0_0_4px_var(--color-accent-tint)]'
                    : 'bg-surface border-2 border-faint shadow-none'
                }`}
              />
              <span className={`font-mono text-[10.5px] tracking-[0.1em] uppercase px-1.5 py-0.5 rounded-xs border ${
                ready && scaffold
                  ? 'text-accent-deep bg-accent-tint border-[#e9d3c4]'
                  : 'text-muted bg-inset border-line'
              }`}>
                genesis{ready && scaffold ? ' · ready' : ' · not ready'}
              </span>
            </div>
            <div className="mt-3.5 font-sans font-semibold text-[21px] leading-[1.3] tracking-[-0.012em] text-ink font-[tabular-nums]">
              {scaffold ? (
                <>
                  <span className="text-accent">state(</span>{slug || branchLabel}<span className="text-accent">):</span>{' '}
                  {scaffold.message.replace(`state(${slug}): `, '').replace(/^staged by /, 'staged by ')}
                </>
              ) : (
                <>
                  <span className="text-accent">state(</span>{branchLabel}<span className="text-accent">):</span> staged by …
                </>
              )}
              {scaffold && (
                <>
                  <br />
                  <span className="font-mono font-normal text-[12px] text-muted">[client-key: {clientKey}]</span>
                </>
              )}
            </div>
            {scaffold && identity && (
              <div className="mt-2.5 text-[13px] text-[#4d4742] flex items-center gap-2">
                <span className="font-semibold text-ink">{identity.name}</span>
                <span className="font-mono text-[12.5px] text-muted">&lt;{identity.email}&gt;</span>
                <span className="font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted bg-inset px-1.5 py-0.5 rounded-xs border border-line">
                  author &amp; committer
                </span>
              </div>
            )}
            {scaffold && !identity && (
              <div className="mt-2.5 text-[13px] font-mono font-semibold text-bad">(no identity configured)</div>
            )}
          </div>

          {/* file tree */}
          <div className="mt-[22px] relative">
            <div className="font-mono text-[11px] tracking-[0.12em] uppercase text-muted mb-2.5">Files this commit adds</div>
            <div className="flex items-center gap-2.5 py-2 border-b border-dashed border-line">
              <span className="text-muted text-[14px]">▤</span>
              <span className="font-mono text-[12.5px] text-ink">runs/{branchLabel}/state.yaml</span>
              <span className="ml-auto font-mono text-[10px] tracking-[0.08em] uppercase text-accent-deep bg-accent-tint border border-[#e9d3c4] px-1.5 py-0.5 rounded-xs">
                new
              </span>
            </div>
            <div className="flex items-center gap-2.5 py-2 border-b border-dashed border-line">
              <span className="text-muted text-[14px]">▤</span>
              <span className="font-mono text-[12.5px] text-ink">runs/{branchLabel}/intent-brief.md</span>
              <span className="ml-auto font-mono text-[10px] tracking-[0.08em] uppercase text-accent-deep bg-accent-tint border border-[#e9d3c4] px-1.5 py-0.5 rounded-xs">
                new
              </span>
              <span className="ml-2 font-mono text-[11px] font-semibold text-accent-deep">
                {filledCount} of {sectionEntries.length}
              </span>
            </div>
            <div className="mt-1.5 ml-[22px] flex flex-col gap-1">
              {sectionEntries.map((h) => {
                const filled = Boolean((sections[h] ?? '').trim())
                return (
                  <div key={h} className={`flex items-center gap-2 font-mono text-[11.5px] ${filled ? 'text-[#4d4742]' : 'text-muted'}`}>
                    <span className={`w-3.5 ${filled ? 'text-ok' : 'text-faint'}`}>{filled ? '✓' : '·'}</span>
                    <span>{h}</span>
                  </div>
                )
              })}
            </div>
            {profile === 'patch' && (
              <div className="flex items-center gap-2.5 py-2 border-b border-dashed border-line">
                <span className="text-muted text-[14px]">▤</span>
                <span className="font-mono text-[12.5px] text-ink">
                  runs/{branchLabel}/tasks/01-{branchLabel}.yaml
                </span>
                <span className="ml-auto font-mono text-[10px] tracking-[0.08em] uppercase text-accent-deep bg-accent-tint border border-[#e9d3c4] px-1.5 py-0.5 rounded-xs">
                  new
                </span>
                <span className="ml-2 font-mono text-[11px] text-faint">placeholder stub</span>
              </div>
            )}
          </div>

          {/* collapsible state.yaml */}
          {scaffold && (
            <details className="mt-[22px] border border-line rounded-md bg-inset overflow-hidden group relative">
              <summary className="list-none cursor-pointer px-3.5 py-2.5 flex items-center gap-2 font-mono text-[12px] text-[#4d4742]">
                <span className="inline-block transition-transform group-open:rotate-90">▸</span>
                runs/{branchLabel}/state.yaml
                <span className="ml-auto text-muted text-[11px]">{(scaffold.files['state.yaml'] ?? '').split('\n').length} lines</span>
              </summary>
              <pre className="m-0 px-3.5 py-3 border-t border-line font-mono text-[12px] leading-[1.6] whitespace-pre overflow-x-auto bg-surface text-ink">
                {scaffold.files['state.yaml']}
              </pre>
            </details>
          )}

          {/* closing line */}
          <div className="mt-[22px] border-t border-dashed border-line pt-3.5 text-[12.5px] text-muted leading-[1.55] max-w-[42ch] relative">
            <span className="text-[#4d4742] italic">Staging commits this record.</span> No agent dispatches, no budget
            meters — the run rests at <span className="font-mono">staged</span> until you arm it.
          </div>
        </div>
      </div>
    </aside>
  )
}

function Flash({ tone, children }: { tone: 'ok' | 'info' | 'bad' | 'cfg' | 'warn'; children: React.ReactNode }) {
  const cls = {
    ok: 'bg-ok-bg text-ok border border-ok-line',
    info: 'bg-accent-tint text-accent-deep border border-[#e9d3c4]',
    bad: 'bg-bad-bg text-bad border border-bad-line',
    cfg: 'bg-bad-bg text-bad border border-dashed border-bad-line',
    warn: 'bg-warn-bg text-warn border border-warn-line',
  }[tone]
  return (
    <div role={tone === 'bad' || tone === 'cfg' ? 'alert' : 'status'} className={`mb-4 rounded-md px-3.5 py-3 text-[13px] leading-[1.55] ${cls}`}>
      {children}
    </div>
  )
}
