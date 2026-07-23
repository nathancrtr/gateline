<!-- Candidate A · in-run prototype designer artifact for runs/web-staging.
     Consumed by the G1 human alongside candidate B. Mockups in this directory
     open from disk and honor light/dark via the same light-dark() tokens as
     frontend/packages/web/src/styles.css. -->

# Design candidate: genesis-preview

## Thesis

Staging a run *is* authoring a git record — so the screen's organizing element is the
record itself, previewed as it takes shape. Beside the form sits a panel titled "The
record this stages": the `run/<slug>` branch name, the commit message in the real
grammar (`state(<slug>): staged by <name> [client-key: …]`), the author line from the
server's git identity, the file tree, and the `state.yaml` scaffold — rendered by the
same pure `planRunScaffold` the server commits with, so the preview cannot drift from
the truth. Everything the spec demands falls out of this one argument: identity is
displayed because the author line is part of the record (never asked, AC4.2);
provenance inputs are plain text because they are recorded, not fetched (AC3.1); the
brief editor is structure-only because the contract, not the operator, owns the
record's shape (AC2.1).

The same panel is the outcome display. Each of the five submission outcomes maps onto
the part of the record it concerns: fresh success fills the commit node and names the
oid; a replay points at the existing commit in an informational accent voice ("the
record you asked for already stands"); a slug collision strikes the *branch* line; a
missing-section refusal marks the *brief file's* section checklist; a no-identity
refusal breaks the *author* line. The operator never meets a generic error — they see
which part of the record refused to come into being, and the fix path follows from
the anatomy.

The two-phase lifecycle reads as two records. Staged is a rest state with its own
form vocabulary — hollow un-glowing dot, outlined STAGED pill, its own phase label —
against mid-flight paused's filled glowing dot and solid PAUSE pill. Its only
affordance is Arm, a separate weighted act whose confirm step previews *its* commit
(`state(<slug>): armed by <name>`) before the operator signs it, and whose aftermath
is the two-commit history: staged, then armed. Deviation from the seed: none of
substance; the one argued extension is that identity display is mandatory rather than
REC9's "if available" (rationale under Research traceability).

## Mockups

One running example threads all files: staging `budget-alerts` — "Budget threshold
alerts on the portfolio surface", standard profile, $150 ceiling, staged by the
server identity Nathan Carter. Each file has in-page state tabs and visible state
labels; annotations (amber callouts) are mockup chrome, not product UI.

- `01-portfolio-entry.html` — entry point on the Portfolio header (quiet button) and
  in the empty state (primary button + record-voice caption); nav unchanged. States:
  populated, empty. [AC7.1; P2, P9, REC1]
- `02-staging-form.html` — the form + live genesis preview. Repository picker
  (multi-source case), title→slug suggestion with permanent `run/<slug>` ref, profile
  cards showing each profile's gate ledger, budget, one input per required brief
  section with fixed contract headings, provenance as three plain text inputs,
  read-only identity strip, disabled-with-reason submit. States: authoring
  (incomplete — hollow commit node, "2 of 4" sections), ready (filled glowing node).
  [AC1.2, AC1.3, AC2.1, AC3.1, AC4.2; P1, P5, P7, P10, REC2, REC3, REC8, REC9, REC10]
- `03-staging-outcomes.html` — five distinct outcomes, each mapped onto the record's
  anatomy: fresh success (ok, oid named), already-staged replay (informational accent
  tone + Arm offer), slug collision (bad, struck branch line, links existing run),
  missing sections (GOV.UK error summary, server wording verbatim, identical inline),
  no identity (dashed-border deployment-config voice, core message verbatim).
  [AC2.2, AC4.1, AC8.1, AC8.2; P4, P5, P6, REC6, REC7]
- `04-staged-rest.html` — staged vs mid-flight paused, side by side: chip anatomy
  (three form differences, zero new colors), portfolio rows, inbox rows, run-detail
  headers with the staged header's genesis line. [AC6.1, AC6.2, AC7.2; P3, P8, REC5]
- `05-arm.html` — the arm act on the run page. States: staged idle (only affordance
  "Arm…"), confirm (consequence copy + arm-commit preview + "Committing…" pattern),
  armed aftermath (planDecision's own summary + two-commit history spine), arm
  refused (DecisionError verbatim + 409 conflict posture). [AC5.1, AC5.2, AC6.1;
  P2, P4, P10, REC4, REC11, REC12]

## Look-and-feel spec

**Tokens.** Exclusively the Signal Deck set from `styles.css` — every color in the
mockups is one of `--color-{ground,surface,inset,raised,ink,muted,faint,line,accent,
accent-deep,ok,warn,bad,on-solid}` or their `-soft` variants plus `--glow`; all via
`light-dark()`, `color-scheme: light dark`. No new colors, no new keyframes (the
staged card reuses `.pulse-panel`'s existing ring/pulse; everything else is static).

**Type.** The existing two-voice split, applied as *record voice vs authoring voice*:
everything that is or will be a git fact — branch refs, commit messages, oids,
section headings, identity, YAML — is mono; everything the human is composing or
reading is sans. This makes "what gets committed" scannable by typeface alone.

**Component shapes and why they carry the weight:**

- *Record preview panel* — `bg-surface`, accent left rail (3px) + `accent-soft`
  ring: the NeedsYouCard "live object" shape, because the record-in-formation is the
  page's one live object. Its commit node borrows HistoryTab's spine-dot idiom:
  hollow/faint while the record is incomplete, filled + `--glow` when it is ready or
  committed, dashed-bad when refused — the same three-way form grammar GateCell uses
  (dashed-pending / solid-decided).
- *Staged status* — hollow dot, no glow (nothing is burning energy), accent tone (a
  decision is wanted), outlined pill labeled STAGED. Mid-flight paused keeps its
  filled glowing dot and solid PAUSE pill untouched. Three simultaneous form
  differences; recoloring alone is banned per chips.tsx's opening rule.
- *Buttons* — pill shape from decide.tsx. "New run" is the quiet secondary shape
  (staging is cheap); "Stage run" is primary within its own page; "Arm…" carries the
  ellipsis-then-confirm two-step and the primary glow (arming spends). The pending
  verb is always "Committing…" — every mutation is a commit and says so.
- *Flash tones* — the existing ok/conflict/error triad plus one new **informational**
  tone (`accent-soft` + accent border) for the already-staged replay: visually
  disjoint from both success (ok-soft, borderless) and refusal (bad-soft). The
  no-identity refusal alone takes a *dashed* bad border — the deployment-config
  voice, cousin to the engine-outage banner, signaling "the fix is outside this
  form."
- *Error summary* — 2px solid bad border box atop the form, focus target, entries
  link to fields, inline messages repeat the summary wording character-for-character,
  and the server's `missingBriefSections` line is quoted in mono as the source of
  truth.

**Spacing.** The app's existing rhythm: 22px page-section gaps, 14–18px card padding,
5–6px radii on cards/inputs, 999px on pills, mono uppercase 10–10.5px
`tracking 0.08em` zone/legend headers (the DecidePanel legend voice).

## Research traceability

- **P1/REC2** → section editors: headings are fixed chrome fetched from the contract
  template, textareas start empty, placeholders are instructive-only (A3 respected).
- **P2/REC4, A6** → staging and arming never collapse: quiet New-run button, "Stage
  run — nothing dispatches" caption, Arm as a separate confirm-stepped act with spend
  language. No stage-and-arm control exists anywhere.
- **P3/REC5, A1** → staged is its own kind (04): never the paused card, never Resume;
  05's idle card even says "there is no Resume here."
- **P4/P5/REC6, A8** → 03's missing-sections state: summary at top, focus moved,
  linked fields, identical wording, server text verbatim; 02's client pre-check only
  disables and openly defers to the server's wording.
- **P6/REC7/REC8, A5** → the four-way outcome taxonomy plus fresh success, each in a
  distinct voice; replay is explicitly "not an error"; the client key is
  session-generated and collapsed by default.
- **P7/REC9/REC10, A4, A2** → identity displayed in the record's author line, no name
  field anywhere; provenance is three plain text inputs captioned "text you vouch
  for"; the only dropdown selects among Gate's own configured repositories (AC1.3).
- **P8** → the chip anatomy in 04: form differences (hollow/outline/label), tokens
  only.
- **P9/REC1, A7** → entry point on Portfolio; nav untouched; no queue surface.
- **P10/REC12** → success names branch + oid and lands on the run page where Arm is
  the next decision; the armed aftermath re-reads the record as a two-commit history.

**Argued deviations.**
1. *REC9 (identity "if already available")* — I make identity display unconditional:
   the author line is part of the previewed record, and a record preview without an
   author would undercut the thesis. Cost: one tiny read-only config endpoint (Build
   notes). The REC7(d) refusal path still covers the unset case.
2. *REC8 (client key "invisible by default")* — kept collapsed, but it appears
   verbatim inside the previewed commit message, because `planRunScaffold` really
   does append `[client-key: …]` to the message; hiding it there would make the
   preview lie about the very record it claims to show honestly.

## Build notes

- **Preview honesty is free**: `planRunScaffold`
  (`frontend/packages/core/src/record/scaffold.ts`) is pure and browser-safe — the
  web form calls it directly (via `@agentic/core`) on each keystroke and renders
  `scaffold.branch`, `scaffold.message`, and `scaffold.files` as the preview. One
  planner, two consumers; the preview and the commit cannot diverge. Section
  presence reuses `extractSections`/`BUILTIN_SECTIONS`
  (`frontend/packages/core/src/record/validate.ts`) for the client pre-check; the
  server's refusal text is still the displayed wording on refusal.
- **Route**: form lives at `/portfolio/new` — a child route beside the existing ones
  in `frontend/packages/web/src/main.tsx`; `app.tsx` nav untouched (AC7.1). Entry
  button + empty-state edit in `pages/portfolio.tsx`.
- **Server**: one new route in `frontend/packages/server/src/app.ts` calling
  `planRunScaffold` + `RunSource.stageRun` (AC1.1) and returning the
  `StageRefusal`/success union; plus a small read-only config read (sources +
  `source.identity()` + brief template sections) to feed the form — extend the
  existing config/health surface rather than minting a parallel one. `api.ts` gains
  `api.stage`, `api.stagingConfig`, and the `arm` decision action on the existing
  `DecisionRequest`.
- **Readiness**: `view-model/readiness.ts` (core) emits the staged item as a
  distinguished variant (e.g. `kind: 'paused'` + `stagedRest: true`, or a new
  `'staged'` kind if the InboxItem union is cheap to extend) so `decide.tsx` can
  branch: staged renders the Arm flow (idle → confirm → `POST /api/decisions
  {action:'arm'}`), and `submitResume` becomes unreachable for staged items — the
  R6 defect fix. `KindChip`/`PhaseChip` in `components/chips.tsx` gain the staged
  variants from mockup 04 (hollow dot, outlined STAGED pill, `staged` label).
- **Flash**: `decide.tsx`'s `Flash` gains the fourth `info` tone; the staging form
  reuses it for the replay outcome. Arm refusals pipe `DecisionError`/`ApiError`
  messages through the existing error/conflict paths (REC11) — no new plumbing.
- **Run header**: the genesis line in `pages/run.tsx` renders from
  `readIntake(state)` (`scaffold.ts`) + the genesis commit already present in
  `detail.history` — display-only, no new server data.
