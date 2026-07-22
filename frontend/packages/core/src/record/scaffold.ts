// The pure half of the run-creation seam: turns a source-agnostic staging
// request into branch/file/message content, no git or filesystem I/O. The
// impure half (the genesis commit) lives in sources/local-source.ts's
// stageRun, which is the only branch-minting path. Imports schema.ts only —
// the layering test enforces this file never reaches into sources/ or
// view-model/.
import { PROFILE_GATES, type Profile, type RunState } from './schema.ts'

/** A staging request: slug/title/profile/brief plus a nullable, source-agnostic
 * intake identity (this run's only in-scope path is free-form: all fields
 * null except an optional client key for replay detection). */
export interface RunScaffoldInput {
  slug: string // /^[a-z0-9][a-z0-9-]*$/ — branch- and path-safe
  title: string
  profile: Profile
  briefMarkdown: string // full intent-brief.md content, human-authored/confirmed
  costLimitUsd: number | null // null = omit ceiling; callers apply their own default
  intake: { source: string | null; ref: string | null; url: string | null; clientKey: string | null }
  stagedBy: string // human name echo; commit authorship stays authoritative
}

export interface RunScaffold {
  slug: string
  branch: string // `run/${slug}`
  files: Record<string, string> // run-dir-relative path -> content
  message: string // commit message (grammar below)
  clientKey: string | null // for stageRun replay detection
}

/** Invalid slug, empty title, or empty brief. */
export class ScaffoldError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScaffoldError'
  }
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/

/** YAML double-quoted scalar for any free-form string — titles, names, and
 * intake fields all come from humans or upstream systems and may contain
 * colons, `#`, leading `[`/`-`/`*`/`&`, or newlines, any of which corrupts an
 * unquoted YAML scalar (or, for `#`, silently truncates it into a comment).
 * JSON's escaping is a subset of YAML double-quoted escaping, so
 * JSON.stringify is a safe, dependency-free quoter. */
const yamlString = (v: string): string => JSON.stringify(v)

const yamlScalar = (v: string | null): string => (v === null ? 'null' : yamlString(v))

/** Pure planner: slug/title/profile/brief/intake fields -> branch/tree/message. */
export function planRunScaffold(input: RunScaffoldInput): RunScaffold {
  if (!SLUG_RE.test(input.slug)) throw new ScaffoldError(`slug "${input.slug}" must match ${SLUG_RE} (branch- and path-safe)`)
  const title = input.title.trim()
  if (!title) throw new ScaffoldError('title must not be empty')
  if (!input.briefMarkdown.trim()) throw new ScaffoldError('brief content must not be empty')
  if (input.costLimitUsd !== null && !Number.isFinite(input.costLimitUsd))
    throw new ScaffoldError(`costLimitUsd must be a finite number or null (got ${input.costLimitUsd})`)

  const branch = `run/${input.slug}`
  const gatesBlock = PROFILE_GATES[input.profile]
    .map((g) => `  ${g}: { approved: false, by: null, at: null, notes: null }`)
    .join('\n')
  const costLimitScalar = input.costLimitUsd === null ? 'null' : String(input.costLimitUsd)

  const stateYaml = `run: ${input.slug}
branch: ${branch}
phase: paused             # staged — not yet armed; \`agentic arm ${input.slug}\` starts the run
paused_reason: staged
profile: ${input.profile}        # patch | standard | full
intake:                   # source-agnostic staging provenance; free-form path: nulls + client_key
  source: ${yamlScalar(input.intake.source)}
  ref: ${yamlScalar(input.intake.ref)}
  url: ${yamlScalar(input.intake.url)}
  client_key: ${yamlScalar(input.intake.clientKey)}
  staged_by: ${yamlString(input.stagedBy)}
budget:
  cost_limit_usd: ${costLimitScalar}
  cost_spent_usd: 0
  ledger: []
gates:                    # exactly PROFILE_GATES[${input.profile}] — no others
${gatesBlock}
tasks: []
escalations: []
`

  const files: Record<string, string> = {
    'state.yaml': stateYaml,
    'intent-brief.md': input.briefMarkdown,
  }

  if (input.profile === 'patch') {
    files[`tasks/01-${input.slug}.yaml`] = `id: 01-${input.slug}
title: ${yamlString(title)}
requirements: []

scope: |
  Fill in what to build — the human author completes this stub before the run arms.

file_contact_surface: []

acceptance_tests: []

depends_on: []

status: pending

notes: ""
`
  }

  const message = `state(${input.slug}): staged by ${input.stagedBy}${input.intake.clientKey ? ` [client-key: ${input.intake.clientKey}]` : ''}`

  return {
    slug: input.slug,
    branch,
    files,
    message,
    clientKey: input.intake.clientKey,
  }
}

/** The `intake:` block of a parsed state (a passthrough key), or null when absent. */
export function readIntake(
  state: RunState,
): { source: string | null; ref: string | null; url: string | null; client_key: string | null; staged_by: string | null } | null {
  const raw = (state as { intake?: unknown }).intake
  if (raw === null || raw === undefined || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
  return {
    source: str(r.source),
    ref: str(r.ref),
    url: str(r.url),
    client_key: str(r.client_key),
    staged_by: str(r.staged_by),
  }
}
