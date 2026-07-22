# Review Report: 03-shell-masthead

**Verdict:** approve
**Round:** 1 of 3
**Diff reviewed:** a04cf257dca4219100542635750f2017649ded9e (branch `run/fleetview-design`)

## Findings

### F1 — minor — rail width stays `w-48` (192px) vs mockup's 200px spine column (PLAUSIBLE)
- **Where:** `frontend/packages/web/src/app.tsx:43`
- **Failure scenario:** PLAUSIBLE — AC6.1 fidelity compare against `inbox.html`
  (`.deck` grid `200px 1fr`, line 45) records an 8px width deviation; the task's
  "rail structure stays" wording arguably sanctions keeping the pre-existing width,
  so this is a judgment call for the task-11 coherence pass, not a defect.
- **Requirement:** plan ADR-4 / spec AC6.1

### F2 — minor — nav rows keep `text-xs` default leading vs mockup's `font:12px/1` (PLAUSIBLE)
- **Where:** `frontend/packages/web/src/app.tsx:12`
- **Failure scenario:** PLAUSIBLE — with padding matched at 7px/9px, default
  text-xs line-height (1rem) renders each nav row ~4px taller than the mockup's
  line-height 1 (`.nav`, inbox.html:51); visible only in a side-by-side pixel
  compare, no functional effect.
- **Requirement:** spec AC6.1 (fidelity baseline)

## Coverage

- **Requirement coverage (R5 via task scope)** ✓ — every restyle item in the task's
  scope block is present and checked class-by-class against `candidate-b/inbox.html`
  CSS, not the implementer's notes: rail `bg-surface` + 1px `border-line` right
  border, `gap-[22px]` / 16px-12px padding (app.tsx:43 vs `.rail`:46); brand mono
  600 15px `tracking-[0.16em]` uppercase-via-CSS with DOM text "Gate" intact,
  sans 10.5px/1.35 faint tagline at 6px offset (:44-46 vs `.brand`:47-49); nav rows
  `rounded-[4px]`, `px-[9px] py-[7px]`, `gap-[9px]`, 12px text,
  `transition-colors duration-[140ms]`, active = `bg-accent-soft text-accent`
  with the old active `font-semibold` correctly dropped, inactive =
  muted + `hover:bg-raised hover:text-ink` (:12-14 vs `.nav`:51-55); 6px
  (`h-1.5 w-1.5`) rounded-full LED dot, `bg-faint` idle, active `bg-accent` +
  static `shadow-[0_0_8px_var(--glow)]` (:19-22 vs `.dot`:52,55); count pill
  fully-round solid-accent `font-mono text-[11px] font-semibold tabular-nums
  text-on-solid` carrying `.pulse-glow`, right-pushed via `flex-1` label ≡ mockup
  `margin-left:auto` (:25-28 vs `.count`:56); rail-foot motto mono 10px/1.6 faint
  p-2 with DOM text verbatim (:53-57 vs `.railfoot`:57 — mockup copy differs but
  the task pins "text verbatim"); mobile top bar gets the same wordmark recipe and
  shares NavItem, its container chrome untouched (:60-66).
- **Structure preservation** ✓ — NavLink targets `/`, `/portfolio`, `/metrics` and
  `end` props unchanged; `useQuery`/`needs` badge logic and the `badge > 0` guard
  unchanged; `<main>` still renders `<Outlet/>`; `main.tsx` untouched; no route
  added (AC6.3); stack pins unchanged in package.json (AC6.2).
- **Motion policy (ADR-6)** ✓ — grep of post-commit app.tsx: no `@keyframes`, no
  `animation` property; motion enters only via `.pulse-glow` (defined in
  styles.css:72, untouched by this diff); the active-dot glow and the render-props
  API are valid for react-router-dom ^7 (children-as-function), so the typecheck
  claim is structurally credible.
- **AC5.1/AC5.2 not executed by this reviewer** — the working tree carries
  unrelated uncommitted edits reverting tasks 03/04, so any test run would exercise
  the wrong code; review is static against the commit. Implementer evidence
  assessed instead: the 10 `npm test` failures are orchestrator-package timeouts,
  and `packages/orchestrator/package.json` declares no dependency on
  `packages/web` (deps: `@agentic/core`, `commander`, `yaml`), so this diff cannot
  cause them; the 5 playwright failures are attributed to unlanded parallel tasks
  06–09 with a stash-baseline check, consistent with app.tsx containing none of
  the `data-inbox-row`/`data-needs-card`/`data-decide` hooks. G2/verifier should
  re-run both suites on a clean integrated tree.
- Not assessed: rendered visual output (no browser run); reduced-motion behavior
  (owned by task 02's styles.css, unchanged here).

## Boundary check

Commit touches `frontend/packages/web/src/app.tsx` (the declared
`file_contact_surface`) plus an append-only implementer-notes block in
`runs/fleetview-design/tasks/03-shell-masthead.yaml` — the sanctioned report-back
channel, consistent with prior tasks in this run. No other files; `styles.css`
consumed read-only per ADR-3. In bounds.
