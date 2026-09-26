// Field views for the record's YAML (#434, docs/SEAM.md §3, §4, §9 step 7).
//
// The Record reader used to print a work item and `state.yaml` as a raw
// `<pre>`. Both are mappings whose keys the contracts fix, so both can read as
// fields: a work item over its contract's keys, in the contract's order; the
// run state as the decision grammar's home — gates, escalations, the pause,
// the budget, the closure. The bytes stay beside them in the reader; this
// module never replaces them, it names what is in them.
//
// Facts, not sentences (§7). A field is the record's key, the contract's word
// for it, which representation it takes (§5), and the value as the file wrote
// it. Nothing is summarized, reworded, inferred or scored: a status is the
// token the file wrote, a gate's `approved:` is its `true` or `false`, a
// figure is its source text, a note is the approver's markdown. Words parsed
// out of prose (who an escalation's reason line names) are not fields; the
// prose is.
//
// What stays bytes, and is said to. The dispatch ledger (`budget.ledger`) is
// the machine's bookkeeping, one row per model invocation. Anything the
// schema passes through untyped — `intake:`, a fork's own key, and the keys a
// flow mapping splits off an unquoted note at its comma — has no
// representation to choose, and a key written in a shape the reader cannot
// read is not a key written empty. Every one of them is listed by its path in
// `rawKeys`, and YAML comments outside the file's header by `comments`, so the
// view says what it did not type rather than dropping it.
//
// Pure over the committed text: the work item through `parseWorkItem` (the
// one work-item reader), the run state through `parseRunState`'s output plus
// the same text read once more as a YAML document, for what the typed shape
// cannot keep — which keys were written, and how a scalar was spelled.
import { isMap, isScalar, Lexer, parseDocument } from 'yaml'
import { GATE_IDS, PROFILE_GATES, ROUND_CAP, type RunState } from '../record/schema.ts'
import type { Audience } from '../record/validate.ts'
import { BUILTIN_WORK_ITEM_KEYS } from '../record/validate.ts'
import { parseWorkItem, workItemKeys } from './tasks.ts'
import { type WithheldReason, withheldIn } from './withheld.ts'

/** A figure the record states: rounds against the framework's cap, entries in a list. */
export interface FieldCount {
  n: number
  unit: 'rounds' | 'entries'
  /** The cap, where the framework states one (`rounds 3/3`). Never a divisor for a percentage. */
  of?: number
}

/** One entry of a list, set in the face its own shape asks for. */
export interface ListEntry {
  /** The entry as written. */
  text: string
  /** `name` for an identifier (`AC1.1`, a task id); `text` for anything else, printed literally. */
  face: 'name' | 'text'
}

/**
 * One field's value, by the representation it takes (docs/SEAM.md §5):
 *
 * - `name` — an identifier the record uses elsewhere: a task id, a gate, a
 *   role, the named human, the profile. Code face; ids resolve in place.
 * - `word` — a state the record states, as spelled: a status, `true`/`false`,
 *   a burden, a paused reason, a disposition. The impression.
 * - `passage` — the record's prose, written in markdown: `title:`, `scope:`,
 *   `notes:`, a reason, a resolution. Verbatim, never truncated.
 * - `entries` — a YAML list, each entry in its own face: an id is a Name, a
 *   sentence is literal text. A list entry is not written in markdown.
 * - `count` — a figure the framework counts.
 * - `amount` — a dollar figure, as the file spelled it (`10.10`, `null`).
 * - `time` — the record's timestamp, verbatim.
 * - `addresses` — locations: `file_contact_surface` entries, the branch. The
 *   record's own addresses, quoted (§10).
 * - `diagnostic` — the machine's word where it is the fact: a parse error.
 */
export type FieldValue =
  | { kind: 'name'; value: string }
  | { kind: 'word'; value: string }
  | { kind: 'passage'; value: string }
  | { kind: 'entries'; value: ListEntry[] }
  | { kind: 'count'; value: FieldCount }
  | { kind: 'amount'; value: { text: string; isNull: boolean } }
  | { kind: 'time'; value: string }
  | { kind: 'addresses'; value: string[] }
  | { kind: 'diagnostic'; value: string }

export type FieldKind = FieldValue['kind']

export type Field = FieldValue & {
  /** The record's key, as the file spells it. */
  key: string
  /** The contract's word for the key — `File-contact surface`, not `file_contact_surface`. */
  label: string
  /** Audit-time, or resolved history: a view folds it. Absent → decide-time. */
  audience?: Audience
  /** The file does not write this key; the value is the contract's default for its absence. */
  defaulted?: true
}

/** One entry of a repeated block — a gate, a task, an escalation — or a mapping's one entry (the closure). */
export interface FieldEntry {
  /** The entry's own name in the record (`G1`, a task id), or null when the record gives it none. */
  name: string | null
  fields: Field[]
  audience?: Audience
}

export interface FieldGroup {
  key: string
  label: string
  entries: FieldEntry[]
}

export interface FieldView {
  kind: 'work-item' | 'state'
  /** Top-level fields, in the contract's order. */
  fields: Field[]
  /** Blocks of entries, in the contract's order. A work item has none. */
  groups: FieldGroup[]
  /**
   * What the file writes that this view does not type, by its path in the
   * document (`budget.ledger`, `intake`, `gates.G1.<key>`, `escalations[0].<key>`)
   * — in the bytes, and only there.
   */
  rawKeys: string[]
  /** True when the file carries YAML comments outside its header — in the bytes, and only there. */
  comments: boolean
  /**
   * Why no field view may speak for this file (a work item whose surface is
   * not a list, say), or null. A view that honours this shows the bytes and
   * nothing in their place.
   */
  withheld: WithheldReason | null
}

// --- helpers ---------------------------------------------------------------

/** The shape `Name` accepts in web: one token, no slash, no trailing extension. */
const EXTENSION = /\.[A-Za-z][A-Za-z0-9]{0,4}$/
const isNameToken = (s: string) => /^[^\s/]+$/.test(s) && !EXTENSION.test(s)

const entries = (key: string, label: string, list: string[]): Field => ({
  key,
  label,
  kind: 'entries',
  value: list.map((text) => ({ text, face: isNameToken(text) ? 'name' : 'text' })),
})

const nameOrPassage = (key: string, label: string, value: string): Field =>
  isNameToken(value) ? { key, label, kind: 'name', value } : { key, label, kind: 'passage', value }

/**
 * A person or role the record names (`operator`, `Nathan Carter`,
 * `reviewer`): a Name, spaces and all, unless it has the shape of a path.
 */
const who = (key: string, label: string, value: string): Field =>
  !value.includes('/') && !EXTENSION.test(value) ? { key, label, kind: 'name', value } : { key, label, kind: 'passage', value }

/**
 * Does the file carry a YAML comment after its header? The header is the
 * comment block before the first key — the contract's own preamble a
 * template copies — and says nothing about this run. Read with the YAML
 * lexer, so a `#` inside a quoted scalar is not a comment.
 */
function hasBodyComments(content: string): boolean {
  let started = false
  for (const token of new Lexer().lex(content)) {
    if (token.startsWith('#')) {
      if (started) return true
      continue
    }
    // Control codes, indentation and line breaks are structure, not content.
    if (token.trim() === '' || (token.length === 1 && token.charCodeAt(0) < 0x20)) continue
    started = true
  }
  return false
}

// --- work items ------------------------------------------------------------

/**
 * The contract's words for the keys `contracts/work-item.yaml` defines — the
 * framework's own terms (`file-contact surface` is DESIGN.md's and the
 * architect's and implementer's roles').
 */
const WORK_ITEM_LABELS: Record<string, string> = {
  id: 'Id',
  title: 'Title',
  requirements: 'Requirements',
  scope: 'Scope',
  file_contact_surface: 'File-contact surface',
  acceptance_tests: 'Acceptance tests',
  depends_on: 'Depends on',
  status: 'Status',
  notes: 'Notes',
}

/** What the work-item contract says: its keys, in its order. */
export interface WorkItemContract {
  keys: string[]
}

/**
 * Read the work-item contract template: its keys in the template's order. No
 * template → the built-in keys. No field folds: the markdown contracts mark
 * audit-time sections in a header comment, and no YAML contract defines an
 * audience line yet — folds here wait on a contract that does.
 */
export function workItemContract(template: string | null): WorkItemContract {
  const keys = template === null ? [] : workItemKeys(template).map((k) => k.key)
  return { keys: keys.length > 0 ? keys : [...BUILTIN_WORK_ITEM_KEYS] }
}

/**
 * A work item as fields: every key the contract names that the file writes
 * in a shape it can read, in the contract's order, labelled in the
 * contract's words. A key the file does not write has no field (the contract
 * badge names it missing); a key the contract does not name, or one written
 * in a shape the reader cannot read, is in `rawKeys` — never a field reading
 * "none", which would turn "cannot read" into "nothing declared".
 */
export function workItemView(path: string, content: string, contract: WorkItemContract = workItemContract(null)): FieldView {
  const item = parseWorkItem(path, content)
  const written = workItemKeys(content)
  const readable = new Set(written.filter((k) => k.readable).map((k) => k.key))
  const typed = (key: string): Field | null => {
    const label = WORK_ITEM_LABELS[key]
    if (label === undefined) return null
    switch (key) {
      case 'id':
        return nameOrPassage(key, label, item.id)
      case 'title':
        return { key, label, kind: 'passage', value: item.title }
      case 'requirements':
        return entries(key, label, item.requirements)
      case 'scope':
        return { key, label, kind: 'passage', value: item.scope }
      case 'file_contact_surface':
        return { key, label, kind: 'addresses', value: item.fileContactSurface }
      case 'acceptance_tests':
        return entries(key, label, item.acceptanceTests)
      case 'depends_on':
        return entries(key, label, item.dependsOn)
      case 'status':
        return { key, label, kind: 'word', value: item.statusText }
      case 'notes':
        return { key, label, kind: 'passage', value: item.notes }
      default:
        return null
    }
  }
  const fields: Field[] = []
  const shown = new Set<string>()
  for (const key of contract.keys) {
    if (!readable.has(key)) continue
    const field = typed(key)
    if (field === null) continue
    fields.push(field)
    shown.add(key)
  }
  return {
    kind: 'work-item',
    fields,
    groups: [],
    rawKeys: written.map((k) => k.key).filter((k) => !shown.has(k)),
    comments: hasBodyComments(content),
    withheld: withheldIn(item.withheld, path),
  }
}

// --- the run state ---------------------------------------------------------

/** The keys `runStateView` types, per block; everything else the file writes is bytes. */
const TYPED = {
  top: new Set(['run', 'branch', 'phase', 'profile', 'paused_reason', 'closure', 'budget', 'gates', 'tasks', 'escalations']),
  budget: new Set(['cost_limit_usd', 'cost_spent_usd']),
  gate: new Set(['approved', 'by', 'at', 'notes', 'burden']),
  closure: new Set(['as', 'by', 'at', 'reason']),
  task: new Set(['id', 'status', 'review_rounds']),
  escalation: new Set(['at', 'from_role', 'reason', 'resolved', 'resolved_by', 'resolved_at', 'resolution', 'disposition']),
}

type Doc = ReturnType<typeof parseDocument>

/** The keys a mapping node writes, as strings; empty for anything that is not a mapping. */
function mapKeys(node: unknown): string[] {
  if (!isMap(node)) return []
  return node.items.map((pair) => (isScalar(pair.key) ? String(pair.key.value) : String(pair.key)))
}

/** Every key path the file writes that `runStateView` does not type. */
function untypedPaths(doc: Doc, state: RunState): string[] {
  const out: string[] = []
  const extra = (prefix: string, node: unknown, typed: Set<string>) => {
    for (const k of mapKeys(node)) if (!typed.has(k)) out.push(`${prefix}${k}`)
  }
  extra('', doc.contents, TYPED.top)
  extra('budget.', doc.getIn(['budget'], true), TYPED.budget)
  const gates = doc.getIn(['gates'], true)
  const inProfile = new Set<string>(PROFILE_GATES[state.profile])
  for (const k of mapKeys(gates)) {
    // A gate the profile does not have, or a key that is no gate at all, is
    // not one of the entries this view draws.
    if (!inProfile.has(k) || !(GATE_IDS as readonly string[]).includes(k)) out.push(`gates.${k}`)
    else extra(`gates.${k}.`, doc.getIn(['gates', k], true), TYPED.gate)
  }
  extra('closure.', doc.getIn(['closure'], true), TYPED.closure)
  for (let i = 0; i < state.tasks.length; i++) extra(`tasks[${i}].`, doc.getIn(['tasks', i], true), TYPED.task)
  for (let i = 0; i < state.escalations.length; i++) extra(`escalations[${i}].`, doc.getIn(['escalations', i], true), TYPED.escalation)
  return out
}

/** A scalar's source text, as the file spelled it, or null when the path holds no scalar. */
function source(doc: Doc, path: (string | number)[]): string | null {
  const node = doc.getIn(path, true)
  if (!isScalar(node)) return null
  return node.srcToken && 'source' in node.srcToken ? node.srcToken.source : String(node.value)
}

/**
 * `state.yaml` as the run's ledger (docs/SEAM.md §8.3): the run's position,
 * its closure, its budget, each of the profile's gates, each task's status and
 * rounds, each escalation. `state` is `parseRunState`'s reading of `content`;
 * the text is read again only for what that typed shape cannot keep.
 *
 * A resolved escalation is history, and folds (§5 Fold: "resolved history").
 * An open one never does: it is what the run is waiting on.
 */
export function runStateView(state: RunState, content: string): FieldView {
  const doc = parseDocument(content, { keepSourceTokens: true })
  const written = (path: (string | number)[]) => doc.hasIn(path)
  const spelled = (path: (string | number)[], fallback: string) => source(doc, path) ?? fallback

  const profile: Field = { key: 'profile', label: 'Profile', kind: 'name', value: state.profile }
  // A file with no `profile:` is a `full` run by the contract's rule; the
  // view says so rather than showing a key the file never wrote.
  if (!written(['profile'])) profile.defaulted = true
  const fields: Field[] = [
    nameOrPassage('run', 'Run', state.run),
    { key: 'branch', label: 'Branch', kind: 'addresses', value: [state.branch] },
    { key: 'phase', label: 'Phase', kind: 'word', value: state.phase },
    profile,
  ]
  if (state.paused_reason !== null) fields.push({ key: 'paused_reason', label: 'Paused reason', kind: 'word', value: state.paused_reason })

  const groups: FieldGroup[] = []

  const closure = state.closure
  if (closure) {
    const f: Field[] = [{ key: 'as', label: 'Disposition', kind: 'word', value: closure.as }]
    if (closure.by !== null) f.push(who('by', 'Closed by', closure.by))
    if (closure.at !== null) f.push({ key: 'at', label: 'Closed at', kind: 'time', value: closure.at })
    if (closure.reason !== null) f.push({ key: 'reason', label: 'Reason', kind: 'passage', value: closure.reason })
    groups.push({ key: 'closure', label: 'Closure', entries: [{ name: null, fields: f }] })
  }

  if (state.budget) {
    const f: Field[] = []
    // Figures as the file spelled them — `10.10` stays `10.10`, and a written
    // `null` is shown as written rather than vanishing.
    for (const [key, label] of [
      ['cost_limit_usd', 'Cost limit'],
      ['cost_spent_usd', 'Cost spent'],
    ] as const) {
      if (!written(['budget', key])) continue
      const value = state.budget[key]
      f.push({ key, label, kind: 'amount', value: { text: spelled(['budget', key], String(value)), isNull: value === null } })
    }
    const ledger = (state.budget as Record<string, unknown>).ledger
    // The dispatch ledger is sized, never read here: its rows are the
    // engine's, and they are in the bytes.
    if (Array.isArray(ledger)) f.push({ key: 'ledger', label: 'Ledger', kind: 'count', value: { n: ledger.length, unit: 'entries' } })
    groups.push({ key: 'budget', label: 'Budget', entries: [{ name: null, fields: f }] })
  }

  groups.push({
    key: 'gates',
    label: 'Gates',
    // Exactly the profile's gates: a gate outside the profile is absent from
    // the record, and the parsed shape's filler entry is not the record's.
    entries: PROFILE_GATES[state.profile].map((gate) => {
      const g = state.gates[gate]
      // The file's own token for the decision, as spelled. "declined" is the
      // commit grammar's word for a `false` with a name beside it, and it is
      // History's to print, on the commit row that says it.
      const f: Field[] = [{ key: 'approved', label: 'Approved', kind: 'word', value: spelled(['gates', gate, 'approved'], String(g.approved)) }]
      if (g.by !== null) f.push(who('by', 'By', g.by))
      if (g.at !== null) f.push({ key: 'at', label: 'At', kind: 'time', value: g.at })
      if (g.burden !== null) f.push({ key: 'burden', label: 'Burden', kind: 'word', value: g.burden })
      if (g.notes !== null) f.push({ key: 'notes', label: 'Notes', kind: 'passage', value: g.notes })
      return { name: gate, fields: f }
    }),
  })

  if (state.tasks.length > 0) {
    groups.push({
      key: 'tasks',
      label: 'Tasks',
      entries: state.tasks.map((t, i) => {
        const rounds: Field = { key: 'review_rounds', label: 'Review rounds', kind: 'count', value: { n: t.review_rounds, unit: 'rounds', of: ROUND_CAP } }
        if (!written(['tasks', i, 'review_rounds'])) rounds.defaulted = true
        return { name: t.id, fields: [{ key: 'status', label: 'Status', kind: 'word', value: t.status }, rounds] }
      }),
    })
  }

  if (state.escalations.length > 0) {
    groups.push({
      key: 'escalations',
      label: 'Escalations',
      entries: state.escalations.map((e, i) => {
        const f: Field[] = []
        if (e.from_role !== null) f.push(who('from_role', 'From role', e.from_role))
        if (e.at !== null) f.push({ key: 'at', label: 'Raised at', kind: 'time', value: e.at })
        f.push({ key: 'reason', label: 'Reason', kind: 'passage', value: e.reason })
        f.push({ key: 'resolved', label: 'Resolved', kind: 'word', value: spelled(['escalations', i, 'resolved'], String(e.resolved)) })
        if (e.resolved_by !== null) f.push(who('resolved_by', 'Resolved by', e.resolved_by))
        if (e.resolved_at !== null) f.push({ key: 'resolved_at', label: 'Resolved at', kind: 'time', value: e.resolved_at })
        if (e.resolution !== null) f.push({ key: 'resolution', label: 'Resolution', kind: 'passage', value: e.resolution })
        if (e.disposition !== null) f.push({ key: 'disposition', label: 'Disposition', kind: 'word', value: e.disposition })
        const entry: FieldEntry = { name: null, fields: f }
        if (e.resolved) entry.audience = 'audit'
        return entry
      }),
    })
  }

  return { kind: 'state', fields, groups, rawKeys: untypedPaths(doc, state), comments: hasBodyComments(content), withheld: null }
}

/**
 * A `state.yaml` no run-state view can read — invalid YAML, or a shape the
 * schema refuses — as the one field there is: the parser's own words.
 */
export function unreadableStateView(error: string): FieldView {
  return {
    kind: 'state',
    fields: [{ key: 'error', label: 'Run state parser', kind: 'diagnostic', value: error }],
    groups: [],
    rawKeys: [],
    comments: false,
    withheld: null,
  }
}
