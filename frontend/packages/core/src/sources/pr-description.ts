// The pure half of draft-PR description generation (#202): run artifacts ->
// PR title and body, no git or `gh` I/O. The impure half (reading the
// artifacts off the branch, creating/editing the PR) lives in pr-ensure.ts.
//
// The generated body opens with GENERATED_MARKER. That marker is the whole
// handoff protocol: while it is present the framework owns the description and
// refreshes it as better artifacts land; once a human removes it — which any
// rewrite of the body naturally does — the description is theirs and the
// framework never touches title or body again.
import { PROFILE_GATES, type Profile } from '../record/schema.ts'

/** Present in every generated body; its absence means a human owns the text. */
export const GENERATED_MARKER = '<!-- agentic:draft-pr -->'

/** Per-section cap in the body — a PR description summarizes, the record holds the whole. */
const MAX_SECTION_CHARS = 700

export interface RunDescriptionInput {
  slug: string
  /** `runs/<slug>` as it sits in this repo's layout (prefixed hosts differ). */
  runDir: string
  profile: Profile | null
  /** `runs/<slug>/intent-brief.md`, or null when unreadable. */
  brief: string | null
  /** `runs/<slug>/spec.md` once the analyst has produced it, else null. */
  spec: string | null
}

export interface RunDescription {
  title: string
  body: string
  /** Which artifact the text was derived from — for the ensure result's note. */
  from: 'spec.md' | 'intent-brief.md' | 'slug'
}

/** True for a body the framework generated and may still refresh. */
export function isGeneratedBody(body: string | null | undefined): boolean {
  return typeof body === 'string' && body.includes(GENERATED_MARKER)
}

/** Strips HTML comments (contract guidance lives in them) and trims. */
function stripComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, '').trim()
}

const normalize = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * The prose under `## <name>`, up to the next heading of the same or higher
 * level. Fenced blocks are transparent to the scan, matching
 * `extractSections`'s handling. Returns null when the section is absent or
 * carries nothing but guidance comments.
 */
export function sectionBody(markdown: string | null, name: string): string | null {
  if (!markdown) return null
  const want = normalize(name)
  const lines = markdown.split('\n')
  let inFence = false
  let start = -1
  let end = lines.length
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence
    if (inFence) continue
    if (start < 0) {
      const m = /^##\s+(.+?)\s*$/.exec(line)
      if (m && normalize(m[1]!) === want) start = i + 1
    } else if (/^#{1,2}\s+/.test(line)) {
      end = i
      break
    }
  }
  if (start < 0) return null
  const text = stripComments(lines.slice(start, end).join('\n'))
  return text || null
}

/** The document title from `# <label>: <title>` (or plain `# <title>`). */
export function documentTitle(markdown: string | null, label: string): string | null {
  if (!markdown) return null
  for (const line of markdown.split('\n')) {
    const m = /^#\s+(.+?)\s*$/.exec(line)
    if (!m) continue
    const heading = m[1]!
    const prefix = new RegExp(`^${label}\\s*:\\s*`, 'i')
    const title = heading.replace(prefix, '').trim()
    // `<title>` is the contract template's own placeholder — never a real title.
    if (!title || /^<.*>$/.test(title)) return null
    return title
  }
  return null
}

/** Requirement names from the spec's `### R<n> — <name>` grammar. */
export function requirementNames(spec: string | null): string[] {
  if (!spec) return []
  const names: string[] = []
  let inFence = false
  for (const line of spec.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence
    if (inFence) continue
    const m = /^###\s+(R\d+)\s*[—-]\s*(.+?)\s*$/.exec(line)
    if (m && !/^<.*>$/.test(m[2]!)) names.push(`${m[1]} — ${m[2]}`)
  }
  return names
}

/** Cuts at the last line or sentence boundary that fits, so a truncated list
 * ends on a whole bullet rather than mid-word. */
function truncate(text: string): string {
  if (text.length <= MAX_SECTION_CHARS) return text
  const cut = text.slice(0, MAX_SECTION_CHARS)
  const at = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf('. '))
  return `${(at > MAX_SECTION_CHARS / 2 ? cut.slice(0, at) : cut).trimEnd()} …`
}

function section(heading: string, text: string | null): string[] {
  return text ? [`## ${heading}`, '', truncate(text), ''] : []
}

function footer(input: RunDescriptionInput, from: RunDescription['from']): string[] {
  const bits = [`Run \`${input.slug}\``]
  if (input.profile) bits.push(`profile \`${input.profile}\``, `gates ${PROFILE_GATES[input.profile].join(' ')}`)
  bits.push(`record \`${input.runDir}/\``)
  const source = from === 'slug' ? 'no readable run artifact' : `\`${input.runDir}/${from}\``
  return ['---', '', bits.join(' · '), '', `<sub>Description generated from ${source}; it refreshes as the run's artifacts land, and stops the moment anyone edits it.</sub>`]
}

/**
 * Title and body for a run's draft PR, derived from the best artifact
 * available: the spec once the analyst has produced one, else the intent
 * brief, else the branch name (today's behavior — a malformed or missing
 * artifact must never block the PR).
 */
export function describeRun(input: RunDescriptionInput): RunDescription {
  const specTitle = documentTitle(input.spec, 'Specification')
  const briefTitle = documentTitle(input.brief, 'Intent Brief')
  const requirements = requirementNames(input.spec)
  const specContext = sectionBody(input.spec, 'Context')

  // The spec is only a better source once it actually carries spec content;
  // an empty or malformed one falls back rather than producing a hollow body.
  const useSpec = Boolean(specContext || requirements.length > 0)
  const useBrief = !useSpec && Boolean(briefTitle || sectionBody(input.brief, 'Problem'))
  const from: RunDescription['from'] = useSpec ? 'spec.md' : useBrief ? 'intent-brief.md' : 'slug'
  const title = (useSpec ? (specTitle ?? briefTitle) : briefTitle) ?? `run/${input.slug}`

  const lead = `**Draft.** The run record is authoritative until this PR is marked ready for review.`
  const parts: string[] = [GENERATED_MARKER, '', lead, '']

  if (useSpec) {
    parts.push(...section('Context', specContext))
    if (requirements.length > 0) parts.push('## Requirements', '', ...requirements.map((r) => `- ${r}`), '')
    parts.push(...section('Out of scope', sectionBody(input.spec, 'Out of scope')))
  } else if (useBrief) {
    parts.push(...section('Problem', sectionBody(input.brief, 'Problem')))
    parts.push(...section('Motivation', sectionBody(input.brief, 'Motivation')))
    parts.push(...section('Constraints', sectionBody(input.brief, 'Constraints')))
    parts.push(...section('Out of scope', sectionBody(input.brief, 'Out of scope')))
  }

  parts.push(...footer(input, from))
  return { title, body: parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n', from }
}
