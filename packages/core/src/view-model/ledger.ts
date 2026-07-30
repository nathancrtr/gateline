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
import { BURDENS, GATE_IDS, type Burden, type GateId } from '../record/schema.ts'

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
  const resolved = /^escalation #\d+ resolved by (.+?)(?: \[disposition: [^\]]*\])?$/.exec(detail)
  if (resolved) {
    return { ...base, kind: 'escalation-resolved', actor: 'human', verb: 'resolved', by: resolved[1] ?? null }
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

  // --- Orchestrator verbs ----------------------------------------------
  // Checked after the human set so that a run slugged e.g. "dispatched" cannot
  // shadow a decision: the human grammars are all anchored on their own verbs.
  if (/^dispatched /.test(detail)) return { ...base, kind: 'dispatched', actor: 'orchestrator', verb: 'dispatched' }
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
