# Release Plan: <run slug>

<!-- Contract: produced by Ops; consumed by gate G3.
     A release plan without a tested rollback is malformed (roles/ops.md).
     Say what ships, in what order, what reverses it, what proves it landed,
     and who is hurt if it does not.
     GRAMMAR (normative — tooling parses these shapes): the preamble fields
     `**Change released:**`, `**Environment:**`, `**Rollback trigger:**` and
     `**Rollback exercised:**` appear as bold-label lines exactly as spelled
     here; Release steps is an ordered (numbered) list, one act per item. A
     deviation is a malformed artifact.
     BUDGET: one line per step; paste the command or the evidence, never a
     narrative. Reference the run's own artifacts by name rather than
     restating them — the G3 approver has spec.md and verification-report.md
     one click away. A plan whose steps a human cannot execute in order,
     unaided, is too short; one that explains why the change exists is too
     long.
     READABILITY (normative — human-facing sections: CI health, Rollback
     plan, Verification after release, Blast radius). The G3 approver reads
     these as prose and ships on them; a breach is bounced like a grammar
     deviation, with the rule cited. (a) The first sentence states the
     takeaway in plain words — no code spans, paths, or parenthetical cites.
     (b) One idea per paragraph: at most 4 sentences and 120 words each.
     (c) Three or more parallel items (steps, signals, triggers, affected
     groups) become a bulleted list under a lead-in sentence — never a
     semicolon chain. (d) One claim per sentence; never join clauses with a
     semicolon. (e) Name before cite: give any id, file, or environment a
     noun phrase on first use, at most one parenthetical file:line cite per
     sentence, full path at first mention only — short name after. -->

**Change released:** <branch/commit, and the PR if there is one>
**Environment:** <where this deploys: the versions, accounts, and regions that matter>

## CI health

<!-- Does the merged change pass the full pipeline? A G2 approval does not
     waive a red pipeline (roles/ops.md). State the pipeline's status in one
     plain sentence, then the evidence: the run you inspected or the commands
     you ran, with their concluding lines. Red for a reason unrelated to this
     change is an escalation, not a workaround — say so here and name it.
     Human-facing: READABILITY rules govern. -->

## Release steps

<!-- The ordered acts that ship the change, as a numbered list — one act per
     item, executable as written by someone who did not build it. Ordering
     constraints belong on the step they constrain (migrations before code,
     config before flags, a flag flipped only after a canary is clean).
     Name any step that is irreversible; that is what the approver is really
     being asked about. -->

1. <first act>

## Rollback plan

**Rollback trigger:** <the signal that says undo this — a metric, an error class, a report>
**Rollback exercised:** <yes, with the evidence — or no, and what that costs>

<!-- The reverse of Release steps, in the order it must happen, and what it
     cannot recover (data written under the new code, a migration already
     applied, a published artifact). Prefer reversible mechanics — flags,
     canaries, staged rollout — and say plainly when the project does not
     support them. Human-facing: READABILITY rules govern. -->

## Verification after release

<!-- What proves it landed, and the health signals to watch while it settles:
     the check to run, where to look, and how long before absence of a signal
     counts as success. One bullet per signal under a lead-in sentence is the
     proven shape. Human-facing: READABILITY rules govern. -->

## Blast radius

<!-- Who and what is affected if this goes wrong: the users, the data, the
     downstream systems, and the worst outcome that is actually reachable.
     A change that ships dark says so and says what makes it dark — that is
     the fact carrying the whole risk story. Human-facing: READABILITY rules
     govern. -->
