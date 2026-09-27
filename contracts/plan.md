# Technical Plan: <title>

<!-- Contract: produced by Architect; consumed by Implementers, Reviewer.
     Gate: G1. All sections required. Accompanied by tasks/*.yaml.
     GRAMMAR (normative — tooling parses this shape): decision headings
     `### ADR-<n>: <decision>`, or with an optional qualifier
     `### ADR-<n> (<qualifier>): <decision>` — e.g. an amendment note.
     A deviation is a malformed artifact.
     BUDGET: reference spec requirements by number, never re-quote them.
     Approach in a few short paragraphs; the ADRs carry the argument.
     READABILITY (normative — human-facing sections: Approach; each ADR's
     Choice, Rejected, and Consequences lines; an amending record's Context
     line; and Risks). The G1 approver reads these as prose; a breach is
     bounced like a grammar deviation, with the rule cited. (a) The opening
     sentence states the takeaway in
     plain words, naming the actor and what happens — no code spans, paths,
     literal settings, or parenthetical cites, and no compressed
     abstraction standing in for the mechanism. A coined term, or an exact
     setting cited from Interface contracts, may follow once the happening
     is stated. (b) One idea per paragraph: at most 4 sentences and 120
     words each. (c) Three or more parallel items (components, cases, call
     sites) become a bulleted list under a lead-in sentence — never a
     semicolon chain. (d) One claim per sentence; never join clauses with a
     semicolon. (e) Name before cite: give any id or file a noun phrase on
     first use ("the ordering rule (R5)"), at most one parenthetical
     file:line cite per sentence, full path at first mention only — short
     name after. The same order governs citing another run's decision: say
     what it decided, then name it ("<run> ADR-<n>") — a bare cite with
     nothing stated is a breach. (f) A Consequences line leads with the
     consequence that matters most to the approver; further, unrelated
     consequences are a list per (c), not more sentences on equal footing.
     (g) A Rejected line gives the alternative and what disqualified it, in
     the writer's own words — reusing this contract's own placeholder
     phrasing is a breach. (h) An instruction to another agent — an
     Implementer, a Reviewer — belongs in Interface contracts or the task
     files, never in Approach or a decision record, which argue to the G1
     approver alone. (i) Nothing addressed to the approver lives only in an
     HTML comment; what the approver needs to read is written into the
     body.
     AMENDMENT (normative): an amending record's heading qualifier carries
     the date — `amendment, <date>`, e.g. `### ADR-7 (amendment,
     2026-07-23): <decision>` — nothing else marks it or dates it. Its first
     bullet is `- **Context:**`, one plain sentence naming what prompted the
     amendment — a finding or escalation, named before it is cited (rule e);
     this is what carries the reason even when nothing is superseded. It
     then replaces, wherever it stood in the body (Approach, Interface
     contracts, Risks, or an earlier record's Choice, Rejected, or
     Consequences line), any text it supersedes with the text now in force,
     so the body never states what is no longer true: one bullet per passage
     replaced, after Consequences, `- **Superseded:** <a reason, or a
     pointer to Context>. <where it stood>: "<the replaced text, in full>"`
     — an amendment that adds a decision without replacing any text carries
     none. A record superseded this way keeps its own heading — its id
     still resolves — and its Choice line changes to state the decision now
     in force, or reads `Withdrawn.`; the amending record's Superseded
     bullet(s) are what quote its old lines. No amendment history is written
     to a comment. -->

## Approach
<!-- The shape of the solution and how it fits the existing codebase.
     Interface signatures and schemas allowed; function bodies are not.
     Never exceed 350 words. Human-facing: READABILITY rules govern the
     shape; the first sentence tells the G1 approver what the solution is. -->

## Interface contracts
<!-- Boundaries between components/tasks: signatures, schemas, protocols.
     These are what parallel Implementers build against. -->

## Decisions (ADRs)
<!-- Choice/Rejected/Consequences carry the human-readable why for the G1
     approver — READABILITY rules apply, not agent shorthand. Choice says
     what is being done, in words; the exact setting or signature is
     Interface contracts' province and is cited here, not restated. An
     amending record (heading qualifier) opens with Context, then Choice,
     Rejected, Consequences, and a Superseded bullet per replaced passage —
     see AMENDMENT above. Opens with a `**For G1 to decide:**` paragraph,
     before the first record: by id, each record that changes existing
     behavior for a current user or operator, settles something the spec
     left open, or departs from the spec — one line each. Say `none` when no
     record qualifies. Anything else asked of the approver (e.g. reconciling
     requirement numbers) belongs here too, never in a comment (rule i). -->

**For G1 to decide:**
- ADR-<n> — <what is being decided, in a plain phrase>

### ADR-1: <decision>
- **Choice:** <what we're doing>
- **Rejected:** <the strongest alternative>. <What disqualified it.>
- **Consequences:** <the consequence that matters most to the approver first, then any others>

## Requirement → task mapping
<!-- Every spec requirement number maps to ≥1 task. Uncovered requirement = malformed plan. -->
| Requirement | Task(s) |
|-------------|---------|
| R1 | 01-… |

## Risks
<!-- What could invalidate this plan mid-flight, and the early signal for
     each. READABILITY rules apply. -->
