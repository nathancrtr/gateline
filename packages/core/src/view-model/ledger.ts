// The decision ledger (#268): a run's state.yaml commit subjects, read as the
// decisions and dispatches they record rather than as a commit log. Per #259 /
// FRONTEND.md §4.1, a commit log fails the host test — time, subject, author and
// short oid are the host's job — while phase transitions, gate approvals under
// the `G<N> approved by <name>` grammar, and the orchestrator's own verbs are
// concepts no git host has a representation for.
//
// Every write to state.yaml goes through one of two seams, and both spell their
// subject `state(<slug>): <rest>`:
//
//   record/actions.ts + record/scaffold.ts — the human decisions. The
//   `G<N> approved by <name>` grammar is reserved for named humans (AGENTS.md),
//   which is what makes actor attribution here a fact of the grammar rather
//   than a guess about the committer.
//
//   orchestrator/src/engine.ts — dispatched | bounced | advanced | escalated |
//   metered | harvested, committed under the bot identity. The orchestrator
//   never writes gates.*, so these two sets cannot collide.
//
// This is a pure function of one commit subject: no I/O, no clock, browser-safe,
// the same shape as the typed review parsing added for #214. It never rewords —
// `detail` is the byte-identical remainder of the subject, and every extracted
// field is a substring of it, so a renderer can satisfy "verbatim and reachable"
// (#261's standing rule) without holding the raw string separately.
//
// `readLedger` is the second reading (#426, docs/SEAM.md §8.6): the same
// entries, joined to the state.yaml each commit wrote. The subject says a gate
// was decided; the state beside it holds the approver's own `notes:`, the
// closure's `reason:`, and which escalation entry a row is about. Those are
// facts, not sentences — the words are the record's, verbatim, and History
// composes the line. Still pure: it reads only the history it is handed.
import { BURDENS, type Burden, GATE_IDS, type GateId, gateUndecided, type RunState } from '../record/schema.ts'
import { type ArtifactRef, artifactRef } from './artifact-ref.ts'
import { describeEscalation } from './escalation.ts'

/** Who the grammar attributes the entry to. Derived from the verb, not the
 * committer: a human decision is a human decision whichever identity pushed it. */
export type LedgerActor = 'human' | 'orchestrator' | 'unknown'

export type LedgerKind =
  // Human decisions — record/actions.ts, record/scaffold.ts.
  | 'gate-approved'
  | 'gate-declined'
  | 'escalation-resolved'
  | 'paused'
  | 'resumed'
  | 'armed'
  | 'staged'
  | 'closed'
  | 'reopened'
  // Orchestrator verbs — orchestrator/src/engine.ts.
  | 'dispatched'
  | 'bounced'
  | 'advanced'
  | 'escalated'
  | 'metered'
  | 'harvested'
  // A subject that does not parse: an artifact commit, a manual recovery, or a
  // grammar this version does not know. Rendered verbatim, never guessed at.
  | 'other'

/**
 * A human's own words that a commit recorded in state.yaml — SEAM.md §4's
 * Substance: a gate's `notes:`, the closure's `reason:`, an escalation's
 * `resolution:`. Byte-identical to the field; attributed by the record's own
 * `by:` / `resolved_by:`, never by the committer.
 */
export interface LedgerQuote {
  /** The gate whose `notes:` this is; null for a closure reason or a resolution. */
  gate: GateId | null
  /** The named human the entry attributes the words to, verbatim, or null when it names none. */
  by: string | null
  /** The field's value, verbatim. Never empty. */
  text: string
}

/**
 * Where a row's subject points, so a view can link to what exists. `decide`
 * names the card the inbox would open (`?decide=` — a gate id or `esc-<n>`),
 * which a view offers only while the run still has that item; `artifact` is
 * the reference the Record reader opens otherwise. Either may be null; both
 * null is never emitted (the entry carries `target: null` instead).
 */
export interface LedgerTarget {
  decide: GateId | `esc-${number}` | null
  artifact: ArtifactRef | null
}

export interface LedgerEntry {
  kind: LedgerKind
  actor: LedgerActor
  /** The run slug from the `state(<slug>)` prefix; null when the subject is not a state commit. */
  slug: string | null
  /** The verb as the record spells it — "approved", "bounced", … Empty for `other`. */
  verb: string
  /**
   * Everything after `state(<slug>): `, byte-identical. For an unparsed subject
   * this is the whole subject. A renderer that shows only `detail` is still
   * showing the record's own words.
   */
  detail: string
  /** The gate, when the entry decides one. */
  gate: GateId | null
  /** The named human, verbatim, when the grammar carries one. */
  by: string | null
  /** The burden recorded alongside an approval. */
  burden: Burden | null
  /** The disposition token an escalation resolution's subject carries, verbatim. */
  disposition: string | null
  /**
   * The human's notes this commit recorded (#426): on a gate decision, the
   * gate's `notes:`; on an escalation resolution, its `resolution:`; on a
   * commit outside the grammar (a v0 harvest, a run's first commit), the
   * `notes:` of every gate it took from undecided to decided. Empty from
   * `parseLedgerSubject`, which never reads the state.
   */
  notes: LedgerQuote[]
  /** The closure `reason:` this commit recorded, when it recorded the closure. */
  reason: LedgerQuote | null
  /**
   * The `state.escalations` index the row is about: from the subject on a
   * resolution (`escalation #<n>`), from the entry the commit appended on an
   * engine `escalated`. An address — History shows it only in raw mode.
   */
  escalationIndex: number | null
  /** Who escalated: the role the entry's reason names, else its `from_role`, verbatim. */
  escalatedBy: string | null
  /** What the escalation is about: the task id, else the gate, the entry's reason names. */
  escalatedAbout: string | null
  /** For an engine `bounced` or `escalated` row: the view its subject points at. */
  target: LedgerTarget | null
}

const STATE_SUBJECT = /^state\(([^)]*)\):\s*(.*)$/

/** `G0`–`G3` only — an unknown gate token is not coerced into the closed set. */
function asGate(token: string | undefined): GateId | null {
  return GATE_IDS.includes(token as GateId) ? (token as GateId) : null
}

function asBurden(token: string | undefined): Burden | null {
  return BURDENS.includes(token as Burden) ? (token as Burden) : null
}

/**
 * One commit subject → one typed ledger entry.
 *
 * A subject that does not match any known grammar comes back as `other` with
 * `detail` set to the subject verbatim. That is the deliberate behaviour: the
 * contracts' bounce rule turned on the UI — never guess, say so — and it is
 * also what lets a run whose state.yaml is schema-invalid still render its
 * history (the #198 precedent), since parsing here never touches the state.
 */
export function parseLedgerSubject(subject: string): LedgerEntry {
  const shell: LedgerEntry = {
    kind: 'other',
    actor: 'unknown',
    slug: null,
    verb: '',
    detail: subject,
    gate: null,
    by: null,
    burden: null,
    disposition: null,
    notes: [],
    reason: null,
    escalationIndex: null,
    escalatedBy: null,
    escalatedAbout: null,
    target: null,
  }

  const framed = STATE_SUBJECT.exec(subject)
  if (!framed) return shell

  const slug = framed[1] ?? null
  const detail = framed[2] ?? ''
  const base = { ...shell, slug, detail }

  // --- Human decisions -------------------------------------------------
  // `G1 approved by Nathan Carter [burden: confirmation] and held (reason)`
  const approved = /^(G\d+) approved by (.+?)(?: \[burden: ([^\]]*)\])?(?: and held \(.*\))?$/.exec(detail)
  if (approved) {
    return {
      ...base,
      kind: 'gate-approved',
      actor: 'human',
      verb: 'approved',
      gate: asGate(approved[1]),
      by: approved[2] ?? null,
      burden: asBurden(approved[3]),
    }
  }

  // `G1 declined by Nathan Carter`
  const declined = /^(G\d+) declined by (.+)$/.exec(detail)
  if (declined) {
    return { ...base, kind: 'gate-declined', actor: 'human', verb: 'declined', gate: asGate(declined[1]), by: declined[2] ?? null }
  }

  // `escalation #2 resolved by Nathan Carter [disposition: replan]`
  const resolved = /^escalation #(\d+) resolved by (.+?)(?: \[disposition: ([^\]]*)\])?$/.exec(detail)
  if (resolved) {
    return {
      ...base,
      kind: 'escalation-resolved',
      actor: 'human',
      verb: 'resolved',
      by: resolved[2] ?? null,
      escalationIndex: Number(resolved[1]),
      disposition: resolved[3] ?? null,
    }
  }

  // `paused by Nathan Carter (reason)` — the human pause. The orchestrator's
  // own pause rides inside `escalated (paused: …)` and is matched below.
  const paused = /^paused by (.+?) \(.*\)$/.exec(detail)
  if (paused) return { ...base, kind: 'paused', actor: 'human', verb: 'paused', by: paused[1] ?? null }

  // `resumed to implement by Nathan Carter (G2 re-opened)`
  const resumed = /^resumed to \S+ by (.+?)(?: \(.* re-opened\))?$/.exec(detail)
  if (resumed) return { ...base, kind: 'resumed', actor: 'human', verb: 'resumed', by: resumed[1] ?? null }

  // `armed by Nathan Carter`
  const armed = /^armed by (.+)$/.exec(detail)
  if (armed) return { ...base, kind: 'armed', actor: 'human', verb: 'armed', by: armed[1] ?? null }

  // `staged by Nathan Carter [client-key: …]`
  const staged = /^staged by (.+?)(?: \[client-key: [^\]]*\])?$/.exec(detail)
  if (staged) return { ...base, kind: 'staged', actor: 'human', verb: 'staged', by: staged[1] ?? null }

  // `closed by Nathan Carter [disposition: already-delivered]` (#200). The
  // disposition is not lifted into a field: `detail` is rendered verbatim, so
  // the record's own words already carry it.
  const closed = /^closed by (.+?)(?: \[disposition: [^\]]*\])?$/.exec(detail)
  if (closed) return { ...base, kind: 'closed', actor: 'human', verb: 'closed', by: closed[1] ?? null }

  // `reopened to implement by Nathan Carter (was closed as abandoned)`
  const reopened = /^reopened to \S+ by (.+?)(?: \(was closed as .*\))?$/.exec(detail)
  if (reopened) return { ...base, kind: 'reopened', actor: 'human', verb: 'reopened', by: reopened[1] ?? null }

  // --- Orchestrator verbs ----------------------------------------------
  // Checked after the human set so that a run slugged e.g. "dispatched" cannot
  // shadow a decision: the human grammars are all anchored on their own verbs.
  if (/^dispatched /.test(detail)) return { ...base, kind: 'dispatched', actor: 'orchestrator', verb: 'dispatched' }
  // `bounced <artifact> — re-dispatching <role> (missing: …)`: the artifact is
  // run-relative as the engine names it, and the Record reader can open it.
  const bounced = /^bounced (\S+)(?: —|$)/.exec(detail)
  if (bounced) {
    const artifact = artifactRef(bounced[1]!)
    return { ...base, kind: 'bounced', actor: 'orchestrator', verb: 'bounced', target: { decide: null, artifact } }
  }
  if (/^bounced /.test(detail)) return { ...base, kind: 'bounced', actor: 'orchestrator', verb: 'bounced' }
  if (/^advanced(?: |$)/.test(detail)) return { ...base, kind: 'advanced', actor: 'orchestrator', verb: 'advanced' }
  if (/^escalated(?: |$)/.test(detail)) return { ...base, kind: 'escalated', actor: 'orchestrator', verb: 'escalated' }
  if (/^metered /.test(detail)) return { ...base, kind: 'metered', actor: 'orchestrator', verb: 'metered' }
  if (/^harvested /.test(detail)) return { ...base, kind: 'harvested', actor: 'orchestrator', verb: 'harvested' }

  // A state commit in a grammar we do not know: keep the slug, render the rest verbatim.
  return base
}

/** The verbs that are decisions a human made, as opposed to the engine acting. */
export function isHumanDecision(entry: LedgerEntry): boolean {
  return entry.actor === 'human'
}

/** One state.yaml commit as `readLedger` needs it: its subject and the state it wrote. */
export interface LedgerCommit {
  subject: string
  /** The parsed state at this commit, or null when it did not parse. */
  state: RunState | null
}

/** A round-cap or landing reason names its task as `task <id>`; the escalation packet's own read comes first. */
const TASK_NAMED = /\btask\s+([A-Za-z0-9][\w.-]*?)(?=[:\s]|$)/
const GATE_NAMED = /\b(G[0-3])\b/

function escalationFacts(state: RunState, index: number, artifacts: readonly string[]) {
  const esc = state.escalations[index]
  if (!esc) return null
  const origin = describeEscalation(esc.reason, esc.from_role, artifacts)
  return {
    esc,
    origin,
    escalatedBy: origin.role ?? esc.from_role,
    escalatedAbout: origin.task ?? TASK_NAMED.exec(esc.reason)?.[1] ?? GATE_NAMED.exec(esc.reason)?.[1] ?? null,
  }
}

const quote = (gate: GateId | null, by: string | null, text: string | null): LedgerQuote | null =>
  text !== null && text.trim() !== '' ? { gate, by, text } : null

/**
 * A run's state history (newest first, as `stateHistory` returns it) → one
 * ledger entry per commit, each joined to the state that commit wrote (#426).
 *
 * `parseLedgerSubject` reads the words of the commit; this adds what the
 * commit put in the record beside them. A decision row gains the approver's
 * notes; a closure, its reason; an escalation resolution, who escalated and
 * about what; an engine `escalated`, the card it opened. A commit outside the
 * grammar gains the notes of any gate it decided and the closure reason if it
 * closed the run — the v0 runs and a fixture's first commit record decisions
 * that way. "Decided here" is read against the commit before it, and only when
 * that commit's state parsed: an unreadable predecessor is not evidence, so
 * nothing is attributed across it. `artifacts` is the run's artifact list, for
 * resolving the report an escalation reason names.
 */
export function readLedger(history: readonly LedgerCommit[], artifacts: readonly string[] = []): LedgerEntry[] {
  return history.map((commit, i) => {
    const entry = parseLedgerSubject(commit.subject)
    const state = commit.state
    if (!state) return entry
    const oldest = i === history.length - 1
    const before = oldest ? null : (history[i + 1]!.state ?? undefined)
    // `undefined`: a predecessor exists and did not parse — nothing is "new" against it.
    const known = before !== undefined

    switch (entry.kind) {
      case 'gate-approved':
      case 'gate-declined': {
        if (!entry.gate) return entry
        const g = state.gates[entry.gate]
        const q = quote(entry.gate, g.by ?? entry.by, g.notes)
        return q ? { ...entry, notes: [q] } : entry
      }
      case 'closed': {
        const c = state.closure
        return c ? { ...entry, reason: quote(null, c.by ?? entry.by, c.reason) } : entry
      }
      case 'escalation-resolved': {
        if (entry.escalationIndex === null) return entry
        const f = escalationFacts(state, entry.escalationIndex, artifacts)
        if (!f) return entry
        const q = quote(null, f.esc.resolved_by ?? entry.by, f.esc.resolution)
        return { ...entry, escalatedBy: f.escalatedBy, escalatedAbout: f.escalatedAbout, notes: q ? [q] : [] }
      }
      case 'escalated': {
        // The engine appends one entry per `escalated` commit (engine.ts), so
        // the entry this commit is about is the last one, provided the list grew.
        if (!known) return entry
        const had = before?.escalations.length ?? 0
        if (state.escalations.length <= had) return entry
        const index = state.escalations.length - 1
        const f = escalationFacts(state, index, artifacts)!
        return {
          ...entry,
          escalationIndex: index,
          escalatedBy: f.escalatedBy,
          escalatedAbout: f.escalatedAbout,
          // The report the reason names, else the run state the entry lives in.
          target: { decide: `esc-${index}`, artifact: artifactRef(f.origin.artifact ?? 'state.yaml') },
        }
      }
      case 'other': {
        if (!known) return entry
        const notes: LedgerQuote[] = []
        for (const gate of GATE_IDS) {
          const g = state.gates[gate]
          if (gateUndecided(g) || (before && !gateUndecided(before.gates[gate]))) continue
          const q = quote(gate, g.by, g.notes)
          if (q) notes.push(q)
        }
        const c = state.closure && !before?.closure ? state.closure : null
        return { ...entry, notes, reason: c ? quote(null, c.by, c.reason) : null }
      }
      default:
        return entry
    }
  })
}
