// G0's packet (#440, docs/SEAM.md §7): the spec read for the question G0
// asks — "Is this what we actually want built?" — beside the brief it answers.
//
// G0 had no packet. It is the gate where the reader most needs the concept
// view, and the gate whose approval seeds every identifier downstream, yet the
// one section the spec contract writes *for* this approver — Assumptions: "G0
// can veto a stated choice, never a hidden one" — was reachable only by
// opening the spec whole. So the packet leads with the Assumptions, quoted in
// full: each top-level list item as a passage of its own, and every run of
// prose around them (a lead-in that tees a choice up, a sub-heading, a fenced
// example) as a passage of its own too, in order, each with the line it
// starts on. Then the requirement roster: each `R<n>` and its short name, read
// by the lexicon's parse of the `### R<n> — <short name>` grammar, never
// re-parsed here. Then the brief's Problem and Constraints, quoted, so the
// approver reads the spec's choices against what was asked. The spec's Out of
// scope comes last, carrying the audience the spec contract's `AUDIENCE:` line
// gives it, which is what decides whether a view folds it.
//
// Presence only. Two artifacts sit side by side and nothing is computed
// across them: no contract grammar links a brief's sentence to a spec's
// requirement, so there is no coverage claim, no "the brief's Constraints are
// honoured", no count of what the spec left out. Every value is the record's
// own words, with the address of the line it starts on. The one count a view
// may show — how many requirements the spec heads — is within one artifact.
//
// Sections are found the way validation finds them (#442): `splitSections`
// for where a section begins and ends, the validator's `normalizeHeading` for
// which heading is which, so `## Out of Scope` or `## assumptions` — both of
// which pass validation — are read, not silently missed. A template's HTML
// comment is the contract's instruction, not the author's words: it is never
// quoted, and a section holding nothing else is present and empty.
//
// Contracts are forkable, so each part withholds itself on its own when the
// shape it reads is absent — a spec with no Assumptions section, a roster
// with a heading the grammar does not parse, a brief with no Problem — naming
// the grammar it looked for and the artifact it looked in. The rest renders
// what it can.
//
// The same packet serves two other cards. The patch profile's G1 absorbs the
// G0 question (brief and work item are approved together), so its card shows
// the brief half, including the brief's Out of scope. The staged card shows
// the brief's Problem and Constraints beside the terms arming accepts. `spec`
// is null when the run has no spec — presence, which those cards read instead
// of a withheld view.
import { FenceTracker, splitSections } from '../record/sections.ts'
import { type Audience, normalizeHeading } from '../record/validate.ts'
import { type ArtifactRef, artifactRef } from './artifact-ref.ts'
import { buildLexicon } from './lexicon.ts'
import { type WithheldReason, withheldIn } from './withheld.ts'

/** Where a quotation starts: a run-relative path and a 1-based line. */
export interface QuoteAt {
  path: string
  line: number
}

/** The record's words, verbatim, and where they start (docs/SEAM.md §7). */
export interface Quotation {
  /** A contiguous slice of the artifact, byte for byte; markdown as written. */
  text: string
  at: QuoteAt
}

/** One passage of the Assumptions section: a top-level list item, marker kept, or a run of prose around the list. */
export interface AssumptionPassage extends Quotation {
  kind: 'item' | 'prose'
}

/** A section quoted whole: its heading as written, its body, and the audience its contract gives it. */
export interface QuotedSection {
  /** The heading as the artifact spells it. */
  heading: string
  /** The heading's line. */
  at: QuoteAt
  /**
   * The body's words, blank lines and the template's HTML comments trimmed
   * from both ends — `at` is its first line of words. Null when the section
   * holds nothing else: present, and empty.
   */
  body: Quotation | null
  /** Per the contract's `AUDIENCE:` line: `audit` is what a view folds. Unlisted sections are `decide`. */
  audience: Audience
}

/** One requirement on the roster: its id and heading name, as the spec spells them. */
export interface G0Requirement {
  /** `R<n>`, from the heading. */
  id: string
  /** The heading's short name, verbatim. */
  name: string
  /** The heading's line. */
  at: QuoteAt
}

export interface G0Packet {
  /** The spec, as a reference, or null when the run has none (a patch run, a staged one). */
  spec: ArtifactRef | null
  /** The intent brief, as a reference, or null when the run has none. */
  brief: ArtifactRef | null
  /**
   * The spec's Assumptions section, every word of it, in order: each
   * top-level list item (its marker kept) and each run of prose between,
   * before or after the items. Empty when the section holds no words.
   */
  assumptions: AssumptionPassage[]
  /** The requirement roster, in the spec's order: every heading the grammar parsed. */
  requirements: G0Requirement[]
  /** The spec's Out of scope, or null when the spec has none (see `outOfScopeWithheld`). */
  outOfScope: QuotedSection | null
  /** The brief's Problem, or null. */
  problem: QuotedSection | null
  /** The brief's Constraints, or null. */
  constraints: QuotedSection | null
  /** The brief's Out of scope, or null — part of the patch profile's G1 packet. */
  briefOutOfScope: QuotedSection | null
  /** Why the Assumptions view withholds itself, or null. */
  assumptionsWithheld: WithheldReason | null
  /**
   * Why the roster withholds itself, or null: no requirement heading at all,
   * or a heading that names an `R<n>` the grammar does not parse — the roster
   * would be silently short, so it says so instead.
   */
  requirementsWithheld: WithheldReason | null
  /** Why the spec's Out of scope withholds itself — the section is missing — or null. */
  outOfScopeWithheld: WithheldReason | null
  /** Why the brief's Problem and Constraints withhold — the first missing, or no brief at all — or null. */
  briefWithheld: WithheldReason | null
  /** Why the brief's Out of scope withholds itself, or null. */
  briefOutOfScopeWithheld: WithheldReason | null
}

const SPEC = 'spec.md'
const BRIEF = 'intent-brief.md'

/** A list item at the section's own level (column 0 or 1); a deeper one is its parent's continuation. */
const TOP_ITEM = /^ ?(?:[-*+]|\d+[.)])(?:\s|$)/
/** A line indented as a list item's continuation: two spaces or more, or a tab. */
const INDENTED = /^(?: {2,}|\t)/
/** A heading that names a requirement, whatever else it says — the grammar's near misses included. */
const R_LIKE = /^ {0,3}#{1,6}\s*R\d+\b/

interface Body {
  /** The section's body lines, raw, without the heading. */
  lines: string[]
  /** The 1-based line of the first body line. */
  start: number
}

interface Located {
  heading: string
  /** The heading's 1-based line. */
  line: number
  body: Body
}

/**
 * The first H2 section whose heading matches `name` the way the validator
 * matches it, with line numbers. Sections come from `splitSections`, whose
 * sections re-join to the artifact byte for byte; the one thing it drops, an
 * empty preamble, is at the top, so the lines it held are the difference.
 */
function section(markdown: string, name: string): Located | null {
  const sections = splitSections(markdown)
  const text = sections.map((s) => (s.headingLine === null ? s.body : `${s.headingLine}\n${s.body}`))
  let line = markdown.split('\n').length - text.join('\n').split('\n').length + 1
  const key = normalizeHeading(name)
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i]!
    if (s.depth === 2 && s.heading !== null && normalizeHeading(s.heading) === key) {
      return { heading: s.heading, line, body: { lines: s.body.split('\n'), start: line + 1 } }
    }
    line += text[i]!.split('\n').length
  }
  return null
}

/**
 * Which body lines are the template's HTML comments: whole lines from one
 * that opens `<!--` to the one that closes it, outside fences. A comment is
 * the contract's instruction to the author, never the author's words.
 */
function commentLines(lines: string[]): Set<number> {
  const out = new Set<number>()
  const fences = new FenceTracker()
  let open = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (!open && fences.feed(line)) continue
    if (!open && /^\s*<!--/.test(line)) open = true
    if (open) {
      out.add(i)
      if (line.includes('-->')) open = false
    }
  }
  return out
}

/** A body as one quotation, blank and comment lines trimmed from both ends. Null when nothing is left. */
function whole(body: Body, path: string): Quotation | null {
  const comments = commentLines(body.lines)
  const skip = (i: number) => body.lines[i]!.trim() === '' || comments.has(i)
  let first = 0
  let last = body.lines.length - 1
  while (first <= last && skip(first)) first++
  while (last >= first && skip(last)) last--
  if (first > last) return null
  return { text: body.lines.slice(first, last + 1).join('\n'), at: { path, line: body.start + first } }
}

function quoted(markdown: string, name: string, path: string, audit: readonly string[]): QuotedSection | null {
  const found = section(markdown, name)
  if (found === null) return null
  const key = normalizeHeading(found.heading)
  return {
    heading: found.heading,
    at: { path, line: found.line },
    body: whole(found.body, path),
    audience: audit.some((a) => normalizeHeading(a) === key) ? 'audit' : 'decide',
  }
}

/**
 * The Assumptions section as passages, every word of it, in order (#442).
 *
 * Each top-level list item is a passage, marker kept — an item's indented
 * paragraph renders as a paragraph only inside its list, so the marker stays
 * with the bytes it governs. An item runs to the next top-level item or a
 * heading; a blank line ends it only when an unindented line follows (a tab
 * is indentation), so an indented paragraph, a nested list or a fence the item
 * opened stays with it. Everything else — a lead-in that tees a choice up for
 * G0, prose between or after the list, an H3, a column-0 fence — is a prose
 * passage of its own. A comment line ends whatever passage it interrupts and
 * is quoted by none.
 *
 * Every word lands in exactly one passage by construction; the check at the
 * end holds the construction to that, and if it ever fails, the section is
 * quoted whole rather than quoted short.
 */
function assumptionPassages(body: Body, path: string): AssumptionPassage[] {
  const out: AssumptionPassage[] = []
  const comments = commentLines(body.lines)
  const fences = new FenceTracker()
  let current: { kind: 'item' | 'prose'; lines: string[]; first: number } | null = null
  let blanks: string[] = []
  const covered = new Set<number>()
  const flush = () => {
    if (current) out.push({ kind: current.kind, text: current.lines.join('\n'), at: { path, line: body.start + current.first } })
    current = null
    blanks = []
  }
  const start = (kind: 'item' | 'prose', i: number) => {
    flush()
    current = { kind, lines: [body.lines[i]!], first: i }
    covered.add(i)
  }
  const append = (i: number) => {
    current!.lines.push(...blanks, body.lines[i]!)
    blanks = []
    covered.add(i)
  }
  for (let i = 0; i < body.lines.length; i++) {
    const line = body.lines[i]!
    if (comments.has(i)) {
      flush()
      continue
    }
    const wasOpen = fences.isOpen
    const inFence = fences.feed(line)
    if (wasOpen) {
      // Inside a fence already open, or its closer: the fence's words belong
      // to the passage that opened it.
      if (current) append(i)
      else start('prose', i)
      continue
    }
    if (!inFence && line.trim() === '') {
      if (current) blanks.push(line)
      continue
    }
    if (!inFence && TOP_ITEM.test(line)) {
      start('item', i)
      continue
    }
    if (current === null) {
      start('prose', i)
      continue
    }
    const item = (current as { kind: 'item' | 'prose' }).kind === 'item'
    if (item && (/^ {0,3}#{1,6}\s/.test(line) || (blanks.length > 0 && !INDENTED.test(line)))) {
      start('prose', i)
      continue
    }
    append(i)
  }
  flush()
  const words = body.lines.flatMap((l, i) => (!comments.has(i) && l.trim() !== '' ? [i] : []))
  if (words.some((i) => !covered.has(i))) {
    const all = whole(body, path)
    return all === null ? [] : [{ kind: 'prose', ...all }]
  }
  return out
}

/**
 * Compose G0's packet from the spec and the intent brief, each read on its
 * own. `audit` is each artifact's audit-time sections as its validation read
 * them from the contract's `AUDIENCE:` line (`Validation.audit`); a section
 * not listed is decide-time.
 */
export function buildG0Packet(input: {
  spec: string | null
  brief: string | null
  audit?: { spec?: readonly string[]; brief?: readonly string[] }
}): G0Packet {
  const { spec, brief } = input
  const specAudit = input.audit?.spec ?? []
  const briefAudit = input.audit?.brief ?? []

  // The spec half.
  let assumptions: AssumptionPassage[] = []
  let requirements: G0Requirement[] = []
  let outOfScope: QuotedSection | null = null
  let assumptionsWithheld: WithheldReason | null = null
  let requirementsWithheld: WithheldReason | null = null
  let outOfScopeWithheld: WithheldReason | null = null
  if (spec === null) {
    assumptionsWithheld = withheldIn({ grammar: 'a spec' }, null)
    requirementsWithheld = withheldIn({ grammar: 'a spec' }, null)
    outOfScopeWithheld = withheldIn({ grammar: 'a spec' }, null)
  } else {
    const found = section(spec, 'Assumptions')
    if (found === null) assumptionsWithheld = withheldIn({ grammar: 'a section headed', token: '## Assumptions' }, SPEC)
    else assumptions = assumptionPassages(found.body, SPEC)

    // The roster is the lexicon's parse of the requirement grammar — one
    // reading of `### R<n> — <short name>` in the codebase, not two.
    requirements = buildLexicon({ spec })
      .entries.filter((e) => e.kind === 'requirement')
      .map((e) => ({ id: e.id, name: e.shortName, at: { path: SPEC, line: e.line } }))
    // A heading that names a requirement but misses the grammar (`### R3 -
    // three`) is a requirement the roster would drop without a word. The
    // validator does not bounce it, so the roster says what it looked for.
    const parsed = new Set(requirements.map((r) => r.at.line))
    const fences = new FenceTracker()
    const nearMiss = spec.split('\n').some((line, i) => !fences.feed(line) && R_LIKE.test(line) && !parsed.has(i + 1))
    if (requirements.length === 0 || nearMiss) {
      requirementsWithheld = withheldIn({ grammar: 'a requirement heading', token: '### R<n> — <short name>' }, SPEC)
    }

    outOfScope = quoted(spec, 'Out of scope', SPEC, specAudit)
    if (outOfScope === null) outOfScopeWithheld = withheldIn({ grammar: 'a section headed', token: '## Out of scope' }, SPEC)
  }

  // The brief half. The first of Problem and Constraints missing is the
  // reason; the other still renders, and the brief is one click away.
  let problem: QuotedSection | null = null
  let constraints: QuotedSection | null = null
  let briefOutOfScope: QuotedSection | null = null
  let briefWithheld: WithheldReason | null = null
  let briefOutOfScopeWithheld: WithheldReason | null = null
  if (brief === null) {
    briefWithheld = withheldIn({ grammar: 'an intent brief' }, null)
    briefOutOfScopeWithheld = withheldIn({ grammar: 'an intent brief' }, null)
  } else {
    problem = quoted(brief, 'Problem', BRIEF, briefAudit)
    constraints = quoted(brief, 'Constraints', BRIEF, briefAudit)
    briefOutOfScope = quoted(brief, 'Out of scope', BRIEF, briefAudit)
    if (problem === null) briefWithheld = withheldIn({ grammar: 'a section headed', token: '## Problem' }, BRIEF)
    else if (constraints === null) briefWithheld = withheldIn({ grammar: 'a section headed', token: '## Constraints' }, BRIEF)
    if (briefOutOfScope === null) briefOutOfScopeWithheld = withheldIn({ grammar: 'a section headed', token: '## Out of scope' }, BRIEF)
  }

  return {
    spec: spec === null ? null : artifactRef(SPEC),
    brief: brief === null ? null : artifactRef(BRIEF),
    assumptions,
    requirements,
    outOfScope,
    problem,
    constraints,
    briefOutOfScope,
    assumptionsWithheld,
    requirementsWithheld,
    outOfScopeWithheld,
    briefWithheld,
    briefOutOfScopeWithheld,
  }
}
