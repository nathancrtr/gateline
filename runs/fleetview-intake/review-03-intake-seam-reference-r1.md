# Review Report: 03-intake-seam-reference

**Verdict:** request-changes
**Round:** 1 of 3
**Diff reviewed:** 2352f16 (2352f16^..2352f16), branch run/fleetview-intake

## Findings

### F1 — blocking — §10's AC4.1 named check is guaranteed to fail against the document's own §2 registry proposal
- **Where:** `runs/fleetview-intake/design/seam-reference.md:858-867` vs `:148-180`
- **Failure scenario:** Follow-on implements §2 verbatim, then runs the named check `grep -rniE "issue|label|assignee|milestone" … registry/task-sources.yaml …` — the proposed file trips the pattern on at least five lines: the isolation-rule comment itself ("issue numbers, labels, assignees, milestones", :148-150), the `label:` key (:174), `GitHub Issues` (:174), and `ref_format: "owner/repo#N or issue URL"` (:175). A correct implementation reports AC4.1 failed; the follow-on either records a false violation or discards/loosens the check ad hoc — the exact "inherits tests, not open questions" purpose of this task defeated for its headline AC. (Secondary, PLAUSIBLE: if `contracts/intent-brief.md` gains §1b's comment with its example URL `…/issues/482`, that file trips "issue" too, :106-115.) The document special-cases `docs-delta.md` false positives (:863-867) but not its own §2 content.
- **Requirement:** task §10 + acceptance "AC4.1 … verification note"; spec AC4.1.

### F2 — major — Worked example 9a deviates from IC-4's literal skeleton (`cost_spent_usd: 0, ledger: []`) with no discrepancy note, against the "match IC-4 verbatim" acceptance test
- **Where:** `runs/fleetview-intake/design/seam-reference.md:732-738` vs `plan.md:174`; absent from the discrepancy summary `:911-925`
- **Failure scenario:** Plan Risks binds candidates to IC-4 as "the canonical skeleton … verbatim" (AC5.2), and reviewer-01 confirmed candidate 01 renders IC-4's `ledger: []` exactly (review-01 coverage, AC5.2). 9a instead commits `cost_spent_usd: 0.02` plus an `intake-draft` ledger entry (ADR-6's rule). Both plan clauses can't be satisfied at once for a drafted import; the doc silently picks ADR-6, so the follow-on inherits two normative artifacts (chosen candidate vs seam reference) that disagree on the staging-commit skeleton — the exact skeleton-drift risk the plan names. Fix is one indexed discrepancy note surfacing the IC-4/ADR-6 tension for the G1/G2 human (the doc's own dispatch: record, never silently resolve).
- **Requirement:** task §9 ("matching plan IC-4 exactly") + acceptance "Worked examples match plan IC-4 verbatim"; plan IC-4 vs ADR-6.

### F3 — minor — §10's AC4.2 check contradicts §2's own three-step procedure, and a registry entry with no driver module has unspecified behavior
- **Where:** `runs/fleetview-intake/design/seam-reference.md:158-168` (steps 1-3 incl. the mandatory `index.ts` barrel edit) vs `:868-872` ("zero other file touched … only the registry file")
- **Failure scenario:** Follow-on executes the check as written (registry entry, placeholder driver id, nothing else): `/api/intake/sources` lists a source whose driver cannot resolve; `GET /api/intake/item?source=<placeholder>` then hits a case §6's status table doesn't define (400 is reserved for "not in the registry", :550 — this id *is* in the registry). Also note spec AC4.2 says "a driver plus a registry entry" while §2 requires a third edit (the barrel line); worth one sentence acknowledging the delta rather than the current ":168" claim that steps 1-3 need no core edit while step 3 is one.
- **Requirement:** spec AC4.2; task §2/§10.

### F4 — minor — §8 cites the wrong lines for the bot-identity `commitTree` call
- **Where:** `runs/fleetview-intake/design/seam-reference.md:656` ("local-source.ts:28, 246-256's commitTree(…)") — the plumbing-path call is `local-source.ts:257`; 246-256 is the worktree-path push block (and coincidentally `git.ts`'s commitTree definition). §3.2 (:301) cites :257 correctly.
- **Failure scenario:** None material (the fact cited is true and correctly anchored elsewhere); listed because "every code reference verified against this checkout" is a named acceptance test.
- **Requirement:** task acceptance "Every code reference verified against this checkout".

### F5 — minor — KindChip claim: `undefined` renders as an empty badge, not "the badge text `undefined`"
- **Where:** `runs/fleetview-intake/design/seam-reference.md:491-494` vs `chips.tsx:34-44` (JSX renders an undefined child as nothing)
- **Failure scenario:** None — the remediation (add a `staged` case) is correct either way; accuracy nit only.
- **Requirement:** task acceptance "Every code reference verified against this checkout".

## Coverage

Checked clean against spec/plan/task, by number:
- **All ten required sections present** and substantively cover the task's must-cover items (not header-only): §1 both contract deltas as quotable text, justified against R10/R14; §2 registry + GitHub entry (driver id, label, ref_format, auth env var) + isolation rule + add-a-source procedure; §3 IC-3 shapes, CAS mechanism, caller enumeration (web/CLI/future triggers); §4 four-row decision table incl. merged-historical coverage via `listRuns`; §5 blast radius + arming; §6 five routes with bodies/status/error shapes incl. 501; §7 full flag table, prompt flow, $EDITOR, preview, exit codes, named refusal; §8 identity + drafting cost; §9 two worked examples; §10 ten named checks.
- **Code references:** every cited file/line/function checked against this checkout — `contracts/state.yaml` (:19 enum, :17-22 order, :23 default 50, :27-34 ledger shape, grammar block), `contracts/intent-brief.md` (quoted in full, correct), `registry/` (only `models.yaml` — §2's "no file exists" claim true), `schema.ts` (:8, :74, :106-113, :131-136, :139-145, :140), `actions.ts` (:19, :53-165, :76, :123-135, :137, :139), `derive.ts` (:9-30 table — D0-D19+DB all assigned, D20 genuinely free; :52 ROLES; :104-105; :115-120; :122-133), `readiness.ts` (:60-65, :67-216, :144-160, :164 — the zero-items fall-through for a staged run is real), `portfolio.ts` (:28, :90), `chips.tsx` (:5-14, :17, :34-40), `git.ts` (:229-244, :246-256, :262-269 — `read-tree` does accept a tree-ish, so the two-call genesis composition is sound), `local-source.ts` (:15, :22-27, :79-135 incl. :87-91/:92-97/:99-109/:112-123, :152-157, :177-183, :185-269 incl. :186-187/:205/:206/:210/:257/:258-259), `source.ts` (:41-63, :54, :63), `validate.ts` (:18-28, :34), `github.ts` (:33 RestPrProvider), `index.ts` (14 `export * from` lines, none for task-sources/), `webhook.ts` (:15-21, :66-85, :89-99 — no `issues` case), `app.ts` (:64-70, :144-196, :168, :179, :187, :191, :193), `main.ts` (:4, :35-63, :123-152, :139-141, :154-174, :160-165, :222-230; no execFile/spawn), `engine.ts` (:108), `docs/DEPLOY.md` (:17-33, :72-74, :83, :86-87, :165-171), `docs/ORCHESTRATOR.md` (:119-129, :142-146), `contracts/docs-delta.md` (:8/:18/:28 "issue" hits), `runs/fleetview-intake/state.yaml:26`. All accurate except F4/F5.
- **Claimed greps re-run and confirmed:** no `TaskItem|TaskSourceDriver|IntakeDraft|planRunScaffold|StageOutcome|stageRun` anywhere; no `EDITOR` under frontend/; `commitTree|hash-object|write-tree|updateRefCAS` in server/cli src → zero; `implements RunSource` only at local-source.ts:15.
- **AC5.1** design clean: single seam, three callers enumerated, grep target valid today. **AC6.1** table covers replay/collision/race/no-identity/invalid-draft; race-loser re-derivation is a genuine improvement over a bare `conflict`. **AC7.3** argued from three verified facts (ROLES, webhook switch, bot-identity plumbing) plus two executable greps. **AC8.1** auth mapping matches DEPLOY.md's actual model incl. the narrow webhook bypass. **AC8.2** named refusal reuses the verified `identity()` path and message shape. **AC9.2** mechanics match `local-source.ts`'s real bot-pinning behavior; the discriminating both-identities-configured fixture is the right test. **AC10.1/AC14.1** checks are executable as written. Clean.
- **§5 blast-radius enumeration is complete:** independent grep for `PHASES` consumers found nothing beyond the document's list (metrics.ts carries no phase logic). The pause→resume promotion gap (items 3-4) and the D0-mislabel (item 5) are real, verified against source, and correctly flagged rather than resolved — good adversarial work.
- **Worked example 9b** matches IC-4 exactly (nulls, client_key, empty ledger, grammar); 9a's brief matches §1b placement and validates under `extractSections` (HTML comment, no new H2). 9a's state.yaml is F2. Reviewer-01's note that task 03 should pin the literal gates block: done (:739-743 matches contracts/state.yaml:44-47).
- **Discrepancy notes** (§1b elaboration, github.ts naming collision, two-blob composition, schema rollout ordering, exit-code extension) are each verified true against source and correctly indexed — except the F2 omission.
- **Residual open question, honestly flagged, not a finding:** §8's abandoned-draft host-wide cost accounting names a real mechanism gap (hostProjectedUsd lives in the orchestrator tick loop only) and defers it; plan ADR-6 promised "task 03 specifies this," so the G1/G2 human should decide whether that deferral is acceptable or routes back as a plan amendment.
- Not assessed: whether the follow-on's actual implementation satisfies these designs (follow-on scope by definition); rendered-UI concerns (tasks 01/02 scope).

## Boundary check

Clean. The commit adds exactly one file, `runs/fleetview-intake/design/seam-reference.md` (925 lines), matching the declared `file_contact_surface`. No code, contracts/, registry/, or frontend/ files touched — the document's proposals stay quoted, as the task's scope demands.
