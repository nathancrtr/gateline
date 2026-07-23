<!-- Designer candidate B (in-run prototype role, hand-dispatched v0 style).
     Candidate name: two-voices. Judged against R1–R8 at G1. -->

# Design candidate: two-voices

## Thesis

Staging and arming are not new interactions — they are two members of the interaction
family FleetView already speaks: **acts that land as attributable commits, with
refusals treated as first-class outcomes.** The whole design is one grammar carried in
two voices. Staging speaks in the **record voice** — an accent *outline* button, no
glow, no confirm beyond a valid form; it writes down what we intend and spends nothing.
Arming speaks in the **gate voice** — the app's filled-accent, glowing, confirm-gated
idiom borrowed straight from `DecidePanel`'s approve; it starts metered dispatch. The
visible weight gap between an outline and a glowing fill *is* the safety mechanism the
two-phase seam is built around (P2): the operator can never arm by reflex on the form,
because arming is a different-looking act on a different surface, later.

The second load-bearing move is that the **staged rest state is its own state, never a
broken paused one** (P3). Today a staged run renders as a `paused` card whose "Resume"
button calls `planDecision('resume')` and throws — the defect R6 names. Candidate
two-voices gives staged its own readiness kind and its own *form-not-color* vocabulary
(P8): a **hollow ring** phase-chip marker where paused uses a filled glowing dot; an
**outline** STAGED inbox pill where PAUSE is a solid fill; an eyebrow ribbon that reads
"staged · awaiting arm." The only affordance anywhere on a staged run is **Arm** — the
`resume` verb is never issued for it. Distinctness is carried by shape, so it survives
grayscale, reduced-motion, and the theme toggle.

Third, **outcomes are a taxonomy, not a boolean** (P4, P6). A submission lands in one of
four visibly different shapes: a *fresh success* (ok tone, names `run/<slug>` and the
genesis oid, lands on the run); a *benign replay* ("already staged," accent/info tone —
deliberately not red — offering Arm); a *collision* (refusal naming the branch it hit);
and a *no-identity* refusal (framed as deployment config, dashed, because no form field
can cure it). This extends the existing `Flash` ok/conflict/error triad with one
informational tone rather than inventing a parallel system. I follow the seed direction
without deviation; it is the honest reading of this surface.

## Mockups

- **01-new-run-entry-and-form.html** — The "New run" entry point on the Portfolio header
  and empty state (no nav change), then the full pristine staging form: title→slug
  auto-derivation with the `run/<slug>` ref shown and marked permanent, profile radios,
  budget, one empty textarea per required brief section (instructive placeholders only),
  three plain provenance inputs + an auto client key, read-only attribution, and the
  single legitimate source picker. *States: entry point, empty-state entry, form
  pristine. Serves AC7.1, AC1.3, AC2.1, AC3.1, AC4.2; R2, R3, R4.*
- **02-outcomes.html** — The four distinct submission landings as switchable panels:
  missing-sections refusal (GOV.UK error-summary + identical inline wording),
  no-identity refusal (config-framed, dashed), slug collision (names the branch), and
  already-staged replay (info tone, offers Arm). *States: 4. Serves AC2.2, AC4.1, AC8.1,
  AC8.2; REC6, REC7.*
- **03-staged-rest-state.html** — Staged vs mid-flight-paused compared on all four
  surfaces: phase chip, portfolio row, inbox card/kind chip, run-detail header — each a
  form difference, plus the defect note. *States: staged & paused across 4 surfaces.
  Serves AC6.1, AC6.2; R6, R7; A1.*
- **04-arm.html** — The arm act through its lifecycle: idle → confirm (consequences
  enumerated) → "Arming…" busy → armed aftermath (eyebrow flips, chip fills, budget
  meter opens, history spine shows staged→armed), plus the arm-refused state. *States:
  5. Serves AC5.1, AC5.2; R5; REC4, REC11, REC12.*
- **05-two-voices-specimen.html** — The thesis plate: record voice vs gate voice named
  side by side with their shapes/weights, the shared-grammar list, then the
  fresh-success flash landing on the run with Arm held as the next decision. *States:
  specimen + success landing. Serves AC1.2; R5, R6; REC4, REC12, P2, P10.*

## Look-and-feel spec

- **Type.** Signal Deck as-is: `--font-sans` for prose and controls, `--font-mono` for
  every durable identifier (slug, `run/<slug>`, oids, gate ids, client key) and for
  section/legend eyebrows in uppercase `tracking-[0.08–0.14em]`. Page titles are the
  existing mono-uppercase `text-xl`. Body 13–13.5px, hints 11.5px, measure capped near
  70–76ch — the reading voice already in `styles.css`.
- **Tokens.** Only the `--color-*` tokens and `--glow`; no new colors. Accent =
  staging/arming/live signal; `--ok` = armed/success; `--warn` = mid-flight pause;
  `--bad` = refusal; `*-soft` variants for fills. `light-dark()` throughout, so both
  themes render from one declaration.
- **Buttons carry the thesis.** *Record voice* (Stage) = `border-accent` + `text-accent`
  on `surface`, **no shadow** — the calm, weightless commit. *Gate voice* (Arm) =
  `bg-accent` + `text-on-solid` + `shadow-[0_0_12px_var(--glow)]`, the exact `Button
  primary` from `decide.tsx`, plus a required confirm step. The outline↔fill gap is the
  weight difference (P2) made legible; the glow says "this one spends."
- **Chips are shapes, not hues.** Staged phase marker = a **hollow ring** (1.5px border,
  transparent center, no glow) = minted-and-idle; paused = **filled glowing dot** =
  halted-mid-run. Staged inbox kind = **outline pill** with a hollow marker; PAUSE stays
  a **solid fill** (P8). Radii stay on the house scale (chips 3px, cards 6–8px, pills
  full). The arm card reuses the `.pulse-panel` static glow ring so the live decision
  reads as the page's one hot object — matching `NeedsYouCard`.
- **Spacing.** Card padding 16–22px; form groups ~20px apart; a two-column section grid
  for the four brief inputs so the whole brief is visible without scrolling. Refusal
  summaries sit at the top of the form (focus moves to them), with identical wording
  echoed inline at each field.

## Research traceability

- **P1 / REC2 →** brief editor = one input per contract section, headings fixed chrome,
  empty inputs, placeholders describe (never draft). **P1/P7 / REC10 →** provenance is
  three plain text inputs + caption; the only dropdown is the source picker (REC10,
  AC1.3). *(mockup 01)*
- **REC3 →** title→slug auto-suggest, editable, `run/<slug>` shown, marked permanent.
  **P10 / REC7a, REC12 →** success names the ref + genesis oid and lands on the run.
  *(01, 05)*
- **P4 / REC6, A8 →** error-summary at top, focus moves, links to fields, wording
  identical inline; server's `missingBriefSections` is the displayed truth, client
  pre-check only disables submit. **P5 →** prevent client-knowable, refuse server-only.
  *(02)*
- **P6 / REC7, REC8, A5 →** four outcomes; replay is information in the info tone, not
  red; collision names the branch; same-key-different-content ⇒ collision, never silent
  overwrite. *(02)*
- **P7 / REC9, A4 →** attribution read-only ("staged by <identity>"); no typed name
  field anywhere. **REC7d →** no-identity is a config refusal, not a field error. *(01,
  02)*
- **P3 / P8 / REC5, A1 →** staged is its own kind; form-difference chips; only affordance
  Arm; never issues `resume`. *(03, 04)*
- **P2 / REC4, A6 →** two controls, never one; record voice vs gate voice; arm confirmed.
  **REC11 →** arm refusal surfaced verbatim; 409 re-presents. *(04, 05)*
- **P9 / REC1, A7 →** entry point on Portfolio (header + empty state), no nav route, no
  parallel queue app. *(01)*
- **Conscious non-deviation:** the seed's decision-grammar framing is adopted whole; I
  found no argument to depart from it. The one interpretive choice is rendering *Stage*
  as an accent **outline** rather than a muted/ghost button — REC4 only says "record
  voice," and an outline keeps staging legible as a deliberate primary act while still
  reading lighter than the glowing Arm; a fully muted button risked under-selling a real
  commit.

## Build notes

Maps onto the existing tree with no new top-level route (AC7.1):

- **Entry point + form.** Add a `StageRunForm` panel opened from a `+ New run` button in
  `pages/portfolio.tsx`'s header and a "Stage the first run" link in its empty state.
  Open it as a Portfolio sub-route/panel (e.g. `/portfolio?new=1`), not a nav item.
  Reuse `decide.tsx`'s `Button`, `NotesField`-style textareas, and `Flash`.
- **Brief sections.** Drive the section inputs from
  `source.templates.read('intent-brief.md')` with `BUILTIN_SECTIONS['intent-brief.md']`
  (`core/record/validate.ts`) as fallback — the same list the server validates against.
  Client pre-check may disable submit; **displayed** refusal text is the server's
  `missingBriefSections`/`extractSections` output verbatim (AC2.2, A8).
- **Server route.** One new thin route in `packages/server/src/app.ts` (e.g. `POST
  /api/runs`) that calls `planRunScaffold` + `RunSource.stageRun`
  (`core/record/scaffold.ts`, `core/sources/*`) — no direct git primitives (AC1.1).
  Client key generated per form session (REC8); identity from `source.identity()`,
  no-identity refusal reuses `stageRun`'s message shape (AC4.1/4.2).
- **Arm.** Reuse `POST /api/decisions` with `{action:'arm'}` and the existing
  `api.decide` mutation; no new endpoint (AC5.1). Refusals flow through the existing
  `ApiError`→`Flash` path; 409 keeps the conflict posture (AC5.2, REC11).
- **Staged rest state (R6).** In `core/view-model/readiness.ts`, split the staged case
  out of the `phase === 'paused'` branch into a new `InboxKind` (e.g. `'staged'`) — or a
  distinguished variant — carrying `title`/`detail` about arming and **only** an Arm
  affordance; never emit a `resume`-driving item for `paused_reason === 'staged'`. Add a
  `staged` arm branch to `DecidePanel` in `components/decide.tsx` (confirm + `Arming…`
  busy state mirroring approve). Add the staged phase-chip marker and STAGED kind chip to
  `components/chips.tsx` (`PhaseChip` hollow-ring variant; `KindChip` outline pill) using
  the existing token set only (AC6.2). Portfolio row (`pages/portfolio.tsx`) and
  run-detail header (`pages/run.tsx`) then render the staged treatment for free via those
  components (AC7.2). The `InboxKind` union, `itemHref` (`pages/inbox.tsx`, add a
  `staged` decide param), and `PhaseChip` are the only type-touch points.
