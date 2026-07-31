// Work items (#269): the task set an architect committed under `tasks/*.yaml`,
// read back into the view model — each item's id, status, dependencies, and the
// `file_contact_surface` it declared it would touch. Grammar per
// contracts/work-item.yaml.
//
// The record layer has always written this file (record/scaffold.ts) and
// required its keys (record/validate.ts); nothing read it. The declared surface
// is what makes the Reviewer's `Boundary check` section checkable, and what
// #259 chose as the basis of a diff no host can compute: a hunk either falls
// inside what the work item said it would touch, or it does not.
//
// Presence, not verdicts. This module reports what an item declared and which
// items a path falls under. Whether an out-of-surface change is acceptable is
// the approver's call and the Reviewer's section — nothing here judges it, and
// no field is summarized, reworded, or scored.
//
// Browser-safe leaf: zero imports, enforced by tasks.test.ts, so the web bundle
// parses task files it fetched itself rather than bundling the core runtime —
// the seam lexicon.ts and review.ts already use.
//
// The YAML read here is deliberately a subset: the flat, top-level mapping the
// contract fixes — scalars, flow and block sequences, and block scalars. A file
// needing more than that is not a work item, and says so through `withheld`
// rather than guessing. tasks.test.ts proves the subset against every
// `tasks/*.yaml` in this repository, with the `yaml` package as the oracle.
//
// One divergence from that oracle is deliberate. A sequence item here is the
// line its author wrote. The contract's sequences are lists of prose — paths,
// ids, acceptance tests — and one committed item,
// `- AC8.1 (unit half: repeated ensure never creates a second PR)`, carries a
// `: ` that a general YAML reader resolves into a nested mapping, losing the
// sentence. Keeping the line is both the more verbatim reading and the only one
// a view can render; tasks.test.ts pins the case rather than letting it drift.

/** Statuses contracts/work-item.yaml names. A fork may write another word. */
export const WORK_ITEM_STATUSES = ['pending', 'in-progress', 'in-review', 'review-approved', 'verified', 'done'] as const
export type WorkItemStatus = (typeof WORK_ITEM_STATUSES)[number]

export interface WorkItem {
  /** Run-relative path, e.g. 'tasks/01-pr-ensure.yaml'. */
  path: string
  /** The `id:` value — what `depends_on` elsewhere in the set refers to. */
  id: string
  title: string
  /** Spec requirement ids this task covers, verbatim and in declared order. */
  requirements: string[]
  scope: string
  /**
   * The declared `file_contact_surface`, verbatim and in declared order. Entries
   * are whatever the architect wrote — repo-relative paths in practice, but the
   * record also carries prose entries, and neither is normalized here.
   */
  fileContactSurface: string[]
  acceptanceTests: string[]
  /** Ids of items that must merge first, verbatim. */
  dependsOn: string[]
  /** Null when the status cell is not a word the contract names. */
  status: WorkItemStatus | null
  /** The status cell verbatim — the record's word, not this parser's. */
  statusText: string
  notes: string
  /**
   * Why a structured view of this item must withhold itself, or null when it
   * applies. Contracts are forkable, so a task file may legitimately follow a
   * grammar this parser does not know; the contracts' own bounce rule turned on
   * the UI is to say so and fall back to the raw file, never to guess. The
   * other fields still carry whatever did parse — a withheld item is not an
   * empty one, it is one no derived view may speak for.
   */
  withheld: string | null
}

export interface TaskSet {
  /** Items in the order given — filenames order display, `depends_on` orders execution. */
  items: WorkItem[]
  /** Non-null when no item in the set contributes a readable contact surface. */
  withheld: string | null
}

// --- the work-item YAML subset -------------------------------------------

const KEY = /^([A-Za-z_][A-Za-z0-9_.-]*):(?=[ \t]|$)[ \t]*(.*)$/
const SEQ_ITEM = /^([ \t]+)-(?:[ \t]+(.*))?[ \t]*$/
const BLOCK_HEADER = /^([|>])([+-]?)(\d*)([+-]?)[ \t]*$/
const COMMENT_LINE = /^[ \t]*#/
const BLANK = /^[ \t]*$/

type Raw =
  | { kind: 'scalar'; value: string }
  | { kind: 'seq'; items: string[] }
  | { kind: 'block'; value: string }
  | { kind: 'empty' }

/** Leading spaces. YAML forbids tabs for indentation, so only spaces count. */
function indentOf(line: string): number {
  let i = 0
  while (line[i] === ' ') i++
  return i
}

/**
 * A plain (unquoted) scalar: everything up to an unescaped comment. YAML starts
 * a comment only at a `#` that begins the line or follows whitespace, so
 * `a#b` is a value and `a #b` is not.
 */
function plainScalar(text: string): string {
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '#') continue
    if (i === 0 || text[i - 1] === ' ' || text[i - 1] === '\t') return text.slice(0, i).trim()
  }
  return text.trim()
}

const DOUBLE_ESCAPES: Record<string, string> = {
  n: '\n',
  t: '\t',
  r: '\r',
  b: '\b',
  f: '\f',
  '0': '\0',
  '"': '"',
  '\\': '\\',
  '/': '/',
  ' ': ' ',
}

/**
 * A quoted scalar starting at `text[0]`, returning the value and how many
 * characters it consumed. Anything after the closing quote (a trailing comment)
 * is the caller's to discard.
 */
function quotedScalar(text: string): { value: string; end: number } {
  const quote = text[0]!
  let value = ''
  for (let i = 1; i < text.length; i++) {
    const ch = text[i]!
    if (quote === '"' && ch === '\\') {
      const next = text[i + 1]
      if (next !== undefined) {
        value += DOUBLE_ESCAPES[next] ?? next
        i++
        continue
      }
    }
    if (ch === quote) {
      // In single quotes, `''` is a literal quote rather than the terminator.
      if (quote === "'" && text[i + 1] === "'") {
        value += "'"
        i++
        continue
      }
      return { value, end: i + 1 }
    }
    value += ch
  }
  return { value, end: text.length } // unterminated: take what there is
}

/** One scalar value, quoted or plain. */
function scalar(text: string): string {
  const trimmed = text.trim()
  if (trimmed.startsWith('"') || trimmed.startsWith("'")) return quotedScalar(trimmed).value
  return plainScalar(trimmed)
}

/** Entries of a flow sequence, given the text between `[` and `]`. */
function flowEntries(inner: string): string[] {
  const entries: string[] = []
  let buffer = ''
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]!
    if (ch === '"' || ch === "'") {
      const { end } = quotedScalar(inner.slice(i))
      buffer += inner.slice(i, i + end)
      i += end - 1
      continue
    }
    if (ch === ',') {
      entries.push(buffer)
      buffer = ''
      continue
    }
    buffer += ch
  }
  entries.push(buffer)
  // A trailing comma leaves a blank entry, which is punctuation rather than a
  // declaration; a quoted empty string is an entry and survives.
  return entries.filter((e) => e.trim() !== '').map(scalar)
}

/** A flow sequence beginning on `lines[start]` at `rest`, possibly wrapped. */
function readFlow(lines: string[], start: number, rest: string): { raw: Raw; next: number } {
  let text = rest
  let i = start
  let depth = 0
  const balanced = (s: string) => {
    let d = 0
    for (let j = 0; j < s.length; j++) {
      const ch = s[j]!
      if (ch === '"' || ch === "'") {
        j += quotedScalar(s.slice(j)).end - 1
        continue
      }
      if (ch === '[') d++
      if (ch === ']') d--
    }
    return d
  }
  depth = balanced(text)
  while (depth > 0 && i + 1 < lines.length) {
    i++
    text += ` ${lines[i]!.trim()}`
    depth = balanced(text)
  }
  const close = text.lastIndexOf(']')
  const inner = text.slice(text.indexOf('[') + 1, close === -1 ? text.length : close)
  return { raw: { kind: 'seq', items: inner.trim() === '' ? [] : flowEntries(inner) }, next: i + 1 }
}

/** A block sequence under a key, from the first line after it. */
function readBlockSeq(lines: string[], start: number): { items: string[]; next: number } {
  const items: string[] = []
  let i = start
  let seqIndent: number | null = null
  while (i < lines.length) {
    const line = lines[i]!
    if (BLANK.test(line) || COMMENT_LINE.test(line)) {
      i++
      continue
    }
    const item = SEQ_ITEM.exec(line)
    if (!item) break
    const at = indentOf(line)
    if (seqIndent === null) seqIndent = at
    else if (at !== seqIndent) break
    // A plain item may wrap onto lines indented past the dash; YAML folds them
    // into the value with a single space.
    let text = item[2] ?? ''
    let j = i + 1
    if (!text.trim().startsWith('"') && !text.trim().startsWith("'")) {
      while (j < lines.length && !BLANK.test(lines[j]!) && !COMMENT_LINE.test(lines[j]!) && !SEQ_ITEM.test(lines[j]!) && indentOf(lines[j]!) > at) {
        text += ` ${lines[j]!.trim()}`
        j++
      }
    }
    items.push(scalar(text))
    i = j
  }
  return { items, next: i }
}

/** A `|` or `>` block scalar under a key, from the first line after its header. */
function readBlockScalar(lines: string[], start: number, header: RegExpExecArray): { value: string; next: number } {
  const folded = header[1] === '>'
  const chomp = header[2] || header[4] || ''
  const explicit = header[3] ? Number(header[3]) : 0

  // The block runs to the first non-blank line indented less than its content.
  let first = start
  while (first < lines.length && BLANK.test(lines[first]!)) first++
  const contentIndent = explicit || (first < lines.length ? indentOf(lines[first]!) : 0)
  if (contentIndent === 0) return { value: '', next: start }

  let end = start
  while (end < lines.length && (BLANK.test(lines[end]!) || indentOf(lines[end]!) >= contentIndent)) end++

  const body = lines.slice(start, end).map((l) => (BLANK.test(l) ? '' : l.slice(contentIndent)))
  let trailing = 0
  while (body.length > 0 && body[body.length - 1] === '') {
    body.pop()
    trailing++
  }

  let value: string
  if (!folded) {
    value = body.join('\n')
  } else {
    // Folding: the break between two plain lines becomes a space, so N blank
    // lines between them read as N breaks, not N + 1. A line indented past the
    // block keeps its own breaks on both sides.
    value = ''
    let breaks = 0
    let prevMoreIndented = false
    for (const line of body) {
      if (line === '') {
        breaks++
        continue
      }
      const moreIndented = line.startsWith(' ') || line.startsWith('\t')
      if (value === '') value = line
      else if (breaks > 0) value += '\n'.repeat(breaks) + line
      else value += (moreIndented || prevMoreIndented ? '\n' : ' ') + line
      breaks = 0
      prevMoreIndented = moreIndented
    }
  }

  // The content's own final line break, then chomping: strip drops it, clip
  // keeps exactly it, keep restores the blank lines that followed as well.
  const terminator = value === '' ? '' : '\n'
  if (chomp === '+') value += terminator + '\n'.repeat(trailing)
  else if (chomp !== '-') value += terminator
  return { value, next: end }
}

/** The top-level mapping of a work-item file, in document order. */
function parseMapping(content: string): Map<string, Raw> {
  const lines = content.split('\n')
  const map = new Map<string, Raw>()
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (BLANK.test(line) || COMMENT_LINE.test(line) || indentOf(line) > 0) {
      i++
      continue
    }
    const key = KEY.exec(line)
    if (!key) {
      i++
      continue
    }
    const name = key[1]!
    const rest = key[2]!
    i++

    const block = BLOCK_HEADER.exec(rest)
    if (block) {
      const { value, next } = readBlockScalar(lines, i, block)
      if (!map.has(name)) map.set(name, { kind: 'block', value })
      i = next
      continue
    }
    if (rest.trimStart().startsWith('[')) {
      const { raw, next } = readFlow(lines, i - 1, rest)
      if (!map.has(name)) map.set(name, raw)
      i = next
      continue
    }
    if (plainScalar(rest) === '' && !rest.trim().startsWith('"') && !rest.trim().startsWith("'")) {
      const { items, next } = readBlockSeq(lines, i)
      // No sequence followed: the key is present with an empty value.
      if (!map.has(name)) map.set(name, next === i && items.length === 0 ? { kind: 'empty' } : { kind: 'seq', items })
      i = next
      continue
    }
    if (!map.has(name)) map.set(name, { kind: 'scalar', value: scalar(rest) })
  }
  return map
}

const asText = (raw: Raw | undefined): string =>
  raw === undefined || raw.kind === 'empty' ? '' : raw.kind === 'seq' ? raw.items.join(' ') : raw.value

const asList = (raw: Raw | undefined): string[] =>
  raw === undefined || raw.kind === 'empty' ? [] : raw.kind === 'seq' ? raw.items : raw.value.trim() === '' ? [] : [raw.value]

const SURFACE = 'file_contact_surface'

/**
 * Parse one work item. The two keys a derived view cannot do without are `id`
 * and `file_contact_surface`; a file missing either withholds rather than
 * letting a view speak for a record it has not read.
 */
export function parseWorkItem(path: string, content: string): WorkItem {
  const map = parseMapping(content)
  const statusText = asText(map.get('status'))
  const missing = (['id', SURFACE] as const).filter((k) => !map.has(k))

  return {
    path,
    id: asText(map.get('id')),
    title: asText(map.get('title')),
    requirements: asList(map.get('requirements')),
    scope: asText(map.get('scope')),
    fileContactSurface: asList(map.get(SURFACE)),
    acceptanceTests: asList(map.get('acceptance_tests')),
    dependsOn: asList(map.get('depends_on')),
    status: (WORK_ITEM_STATUSES as readonly string[]).includes(statusText) ? (statusText as WorkItemStatus) : null,
    statusText,
    notes: asText(map.get('notes')),
    withheld:
      missing.length === 0
        ? null
        : `${path} declares no top-level \`${missing.join('\` and \`')}\`, so it does not follow the contracts/work-item.yaml grammar this view reads.`,
  }
}

/**
 * Parse a run's whole task set. An absent set — a profile with no architect, or
 * a run that has not reached G1 — is not a malformed one, but it is equally a
 * record no surface-scoped view may speak for, so both withhold with a reason.
 */
export function buildTaskSet(files: { path: string; content: string }[]): TaskSet {
  const items = files.map((f) => parseWorkItem(f.path, f.content))
  const readable = items.filter((i) => i.withheld === null)
  return {
    items,
    withheld:
      files.length === 0
        ? 'This run commits no `tasks/*.yaml`, so no work item declares a file-contact surface.'
        : readable.length === 0
          ? `No work item in this run follows the contracts/work-item.yaml grammar this view reads (${items.length} file${items.length === 1 ? '' : 's'} checked).`
          : null,
  }
}

/**
 * Every surface entry the readable items declare, deduplicated, in the order
 * first declared. Withheld items contribute nothing — a surface this parser
 * could not read is not an empty surface.
 */
export function declaredSurface(items: WorkItem[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of items) {
    if (item.withheld !== null) continue
    for (const entry of item.fileContactSurface) {
      if (seen.has(entry)) continue
      seen.add(entry)
      out.push(entry)
    }
  }
  return out
}

/**
 * Does `file` fall under a surface entry? Exact match, or a trailing-slash
 * entry read as a directory prefix. Nothing else is inferred: no globbing, no
 * path normalization, no rename-following. A surface written against an older
 * tree layout simply does not match, which is a fact about the record and the
 * approver's to weigh.
 */
export function inSurface(item: WorkItem, file: string): boolean {
  return item.fileContactSurface.some((entry) => entry === file || (entry.endsWith('/') && file.startsWith(entry)))
}

/** The readable items declaring contact with `file`, in the order given. */
export function itemsTouching(items: WorkItem[], file: string): WorkItem[] {
  return items.filter((item) => item.withheld === null && inSurface(item, file))
}
