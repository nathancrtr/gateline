# UX Research: Frictionless run initiation for FleetView (web + CLI)

## Scope

The surface under design: how a human operator turns a task-source item (or a raw
utterance) into a queued FleetView pipeline run, from the web UI and from the CLI —
intake only, ending at "run started," not status write-back. Surveyed: agent-delegation
products (GitHub Copilot coding agent, OpenAI Codex, Devin, Cursor background agents,
Claude Code cloud), tracker task-creation UX (Linear, Jira, GitHub Issue Forms), CLI
initiation ergonomics (`gh`, Terraform plan/apply), conversational-vs-structured intake
guidance, WCAG form practice, and generic-generated-UI critique. Also read as product
surface: `frontend/packages/web/src/{app,pages/inbox,pages/portfolio,pages/run}.tsx`,
`frontend/packages/web/src/components/decide.tsx`, `frontend/packages/cli/src/main.ts`,
`frontend/packages/server/src/webhook.ts`. Confirmed directly: none of these files
contain any "create/new/queue run" affordance today — grep for
`queue|new run|create run|intake` across `frontend/packages/{web,cli,server}/src`
matches only the existing webhook-intake comments and an SSE `enqueue` call, nothing
UI-facing (frontend/packages/server/src/webhook.ts:1-4). The gap the brief describes
is real, not partially built.

## Patterns

### P1 — Delegate onto an existing tracker object, don't build a from-scratch form
GitHub Copilot's coding agent is triggered by assigning an existing issue to it —
the same gesture used to assign it to a person, via github.com, mobile, VS Code, or
the CLI. No parallel "create a task" surface exists; the tracker's own object is the
unit of delegation. Source: https://github.blog/ai-and-ml/github-copilot/assigning-and-completing-issues-with-coding-agent-in-github-copilot/

### P2 — Capture context at the point of delegation, not before it
The "Assign to Copilot" flow lets the operator pick repository, base branch, and add
free-text instructions in the same action that starts the agent — nothing is staged
in advance. Source: https://github.blog/ai-and-ml/github-copilot/assigning-and-completing-issues-with-coding-agent-in-github-copilot/

### P3 — Free text is the primary input; structure is inferred, not hand-built
Codex starts a cloud task from a typed prompt and a "Code" click. Devin's "Ask Devin"
flow explores the codebase from a loose question and auto-generates a structured
session prompt the operator reviews before launch — the operator writes prose, the
product derives the structured task. Source: https://developers.openai.com/codex/cloud ;
https://cognition.com/blog/dec-24-product-update

### P4 — One global keystroke to open create, few keystrokes to finish it
Linear opens issue creation on a single key (`C`), and setting status/priority/labels/
assignee is one keystroke each — the whole create-and-triage path is designed to stay
under keyboard focus the entire time. Source: https://linear.app/docs/creating-issues ;
https://shortcuts.design/tools/toolspage-linear/

### P5 — Same command, two entry modes: flags for scripts, prompts for humans
`gh issue create` accepts `-t/-b/-a/--label` for a fully non-interactive call, or drops
into interactive prompts (with an editor launch option for the body) when flags are
omitted — one command serves both a human at a keyboard and a script. Source:
https://cli.github.com/manual/gh_issue_create

### P6 — Preview before commit; require an explicit, typed confirmation for a costly action
`terraform apply` without a saved plan first prints the plan, then requires typing
`yes` (not `y`, not click) before anything executes — the confirmation is the one
synchronous point where a human classifies risk before an irreversible/costly action.
Source: https://developer.hashicorp.com/terraform/cli/commands/apply

### P7 — A separately reviewed plan can skip the interactive gate
`terraform plan -out=tfplan` then `terraform apply tfplan` applies without re-prompting
— because the plan was already reviewed as a discrete artifact. This is the shape for
a non-interactive/CI caller: review happens once, explicitly, not by suppressing review.
Source: https://developer.hashicorp.com/terraform/cli/commands/apply

### P8 — Structured-intake schema lives as versioned config next to the repo, not as a hidden form builder
GitHub Issue Forms define required fields, dropdowns, and per-field validation in a
YAML file under `.github/ISSUE_TEMPLATE/`, checked into the repo like any other config.
Source: https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-issue-forms

### P9 — Draft is a visibly distinct, reversible state before anything goes live
GitHub draft PRs are styled differently, suppress reviewer notifications, and require
an explicit "Ready for review" transition — nothing downstream fires until that
promotion happens. Source: https://github.blog/news-insights/product-news/introducing-draft-pull-requests/

### P10 — Saving-state feedback is explicit and never mixed with autosave in the same form
Established design-system guidance (GitLab Pajamas, GitHub Primer): a form either
autosaves with visible "Saving…/Saved" state, or uses an explicit save action — never
both in one form, because mixing them makes it ambiguous whether unsaved input is at
risk. Source: https://primer.style/product/ui-patterns/saving/ ;
https://design.gitlab.com/patterns/saving-and-feedback/

### P11 — (product surface) Conflict is re-presented to the human, never silently retried
FleetView's existing decision write path treats a stale-write (409) as a designed
refusal, not a retry: "The run moved while you were deciding — re-read and decide
again." Source: frontend/packages/web/src/components/decide.tsx:1-4, 65-67

### P12 — (product surface) Writes are refused without a resolvable human identity
The CLI's write path (`decide()`) checks `source.identity()` before any state mutation
and exits with an explicit error if git `user.name`/`user.email` are unset — the same
discipline `local-source.ts` enforces at the source layer. Source:
frontend/packages/cli/src/main.ts:126-130; frontend/packages/core/src/local-source.ts:186-187

### P13 — (product surface) One binary, symmetric verb-noun command grammar
`agentic status|inbox|approve|decline|resolve-escalation|pause|resume|sync|ui` reads
as one consistent vocabulary — read commands and write commands share a naming and
flag convention (`--source`, `--notes`) rather than each command inventing its own.
Source: frontend/packages/cli/src/main.ts:75-283

## Anti-patterns

### A1 — Generic-generated-dashboard tells: uniform card grids, gradient hero numbers, nested containers
Identical card radii/shadows regardless of semantic weight, cards nested inside cards,
purple/violet gradient accents, big-number-with-gradient-text metric tiles — the
recognizable signature of unguided AI UI generation. Detect: measure whether every
panel on the intake surface shares the same border-radius/shadow/spacing token
irrespective of what it contains, and whether any numeric readout uses a gradient
fill. Source: https://docs.bswen.com/blog/2026-03-20-ai-generated-ui-anti-patterns/ ;
https://gendesigns.ai/blog/ai-generated-ui-mistakes-how-to-fix

### A2 — Field-bloat forms: every optional field visible on first paint
Jira's create-issue screen is widely criticized for spreading required fields across
tabs, forcing "click save, discover a missed field, repeat," and presenting a "wall of
empty fields." Detect: count required-looking fields visible without scrolling or
expanding a section on first paint of the create surface; more than ~5-6 is the tell,
especially if any are split across tabs the operator must discover. Source:
https://community.atlassian.com/forums/Jira-Cloud-Admins-discussions/Rethinking-Issue-View-Field-Configuration/td-p/2916049 ;
https://confluence.atlassian.com/jirakb/how-to-assess-the-impact-of-too-many-custom-fields-in-jira-and-how-to-resolve-it-1295389999.html

### A3 — Zero-friction path from empty input straight to a running, budget-spending pipeline
Skipping any preview/confirm step before a costly, hard-to-reverse action (creating a
branch, pushing state, starting metered agent dispatch) is exactly what Terraform's
`--auto-approve` is warned against for production use. Detect: is there any keystroke
or click between "operator finishes typing" and "run is minted and dispatch can
begin"? Zero is the anti-pattern. Source:
https://medium.com/@adedoyinekong/why-you-should-never-run-terraform-auto-approve-in-production-ecad1e6e3975

### A4 — Silent retry or opaque failure on a write conflict during run creation
Swallowing a stale-write conflict and blindly reapplying (or failing with a generic
error) instead of surfacing "someone/something changed this, re-check and retry"
contradicts the discipline this codebase already committed to for gate decisions
(P11). Detect: does the create-run write path have any distinguishable conflict state
at all, or does concurrent creation (e.g., two operators, or a double-submit) fail
silently/inconsistently? Source: frontend/packages/web/src/components/decide.tsx:65-67
(the pattern this anti-pattern violates is stated explicitly in that file's own header
comment)

### A5 — Forcing every intake through free-form chat when the task is a repeatable, well-known shape
Plain language wins over a form when the input space is unenumerable (search,
open-ended generation); a form or short wizard wins when the same fields are filled
the same way every time (a new record, a config). Run creation is the latter shape
(source ref, title, constraints) even if the trigger utterance is prose. Detect: is
there any structured/field-level fallback at all, or is a single unstructured text box
the only way in? Source: https://www.shapeof.ai/patterns/open-input ;
https://www.aiuxdesign.guide/patterns/conversational-ui

### A6 — Placeholder text standing in for a real label
Using `placeholder` instead of an associated `<label>`/`aria-label` fails WCAG 3.3.2
(Labels or Instructions) because the hint disappears the moment the operator starts
typing. Detect: inspect intake inputs for a placeholder with no paired visible label.
Source: https://www.uxpin.com/studio/blog/ultimate-guide-to-accessible-form-design/ ;
https://wcagkit.com/blog/accessible-forms-guide/

### A7 — Error feedback that doesn't identify the field or move focus to it
WCAG 3.3.1/3.3.3 require errors to be specifically identified and, where possible,
suggest the fix; the common failure is a generic banner ("something went wrong")
that leaves focus wherever it was. Detect: on a failed submit, does focus move to the
first invalid field, and does the message name the field and the fix? Source:
https://www.deque.com/blog/anatomy-of-accessible-forms-error-messages/ ;
https://www.boia.org/blog/tips-for-meeting-wcags-requirement-for-error-suggestion

## Recommendations

- **REC1** (from P1, P2): Model "queue new work" as delegating onto an existing
  task-source object where one exists (e.g., a GitHub issue reference) rather than a
  from-scratch form — capture repo/branch/context in the same step as the delegation
  gesture, not as separate up-front staging.
- **REC2** (from P4, A2): Whatever fields are always visible on first paint of the
  create surface should be minimal (title/problem + task-source reference); push
  budget overrides and elaboration behind progressive disclosure. Target a small,
  fixed keystroke count for the keyboard-first path.
- **REC3** (from P3, A5): Support both a free-text entry point (matching the v0
  cockpit benchmark utterance) that the surface parses into the intent-brief shape,
  and a structured field-level fallback for the same underlying fields — free text
  is the fast path, not the only path, especially since run creation is a repeatable,
  well-known shape.
- **REC4** (from P5, P13): The CLI's create command should take fully-flagged
  non-interactive invocation (for scripting/CI parity with how `agentic approve`
  already works) and fall back to interactive prompts only when flags are omitted and
  stdin is a TTY, following the existing `promptBurden` precedent
  (frontend/packages/cli/src/main.ts:154-174) rather than inventing a new idiom.
- **REC5** (from P6, P7, A3): Before a run is actually minted (branch created, first
  commit/push happens), show a preview of what will be created — task-source ref,
  derived slug, branch name — and require one explicit confirm gesture. A
  non-interactive caller that already reviewed an equivalent preview (e.g., a
  `--yes`/piped-flags path) may skip the interactive prompt, mirroring Terraform's
  plan/apply split — but the default path must never go straight from empty input to
  a running, budget-spending pipeline.
- **REC6** (from P9, P10): Give intake a distinguishable "drafting" state versus
  "queued," with explicit save/submit feedback. Do not silently create the run branch
  or spend budget while the operator is still composing the request.
- **REC7** (from P8): If a structured form is part of the design, back it with a
  declarative, versioned schema (generic or per task-source) rather than a bespoke
  hand-coded form — this keeps the intent brief's "pluggable task sources" constraint
  honest at the UX layer, not just the architecture layer.
- **REC8** (from P11, P12, A4): Whatever write path mints a run (web POST, CLI
  command, or both) must reuse this codebase's existing conflict-handling and
  identity-attribution discipline — CAS re-presentation on conflict, refusal to write
  without a resolvable human identity — rather than a weaker bespoke version of
  either for this one surface.
- **REC9** (from A1): Whatever visual direction the Designers choose, avoid the
  generic-generated-dashboard signature explicitly — uniform card grids/shadows
  irrespective of content, gradient-filled hero numbers, cards nested in cards — since
  escaping that look is this run's stated purpose, not an incidental preference.
- **REC10** (from A6, A7): Any field-level intake surface uses real associated labels
  (not placeholder-only) and, on a failed submit, moves focus to the first invalid
  field with a message naming the field and the fix — baseline WCAG AA for the
  brief's "accessible" constraint.

## Open questions

- **Utterance-to-brief translation.** Does the free-text path (REC3) run an LLM step
  to translate the operator's utterance into `intent-brief.md` fields inside the
  intake flow itself, or does it stay a lighter-weight guided-form experience with
  prose only in the free-text fields? This changes the design space (chat-first vs.
  form-first) substantially and the brief doesn't resolve it.
- **Source-picker visibility with one source live.** The brief accepts that GitHub
  Issues may be the only implemented task source at first. Should the intake surface
  still show a source selector (signaling pluggability, per the brief's architectural
  constraint) even with a single option, or does that violate A2/REC2's "minimal
  first-paint fields" guidance until a second source actually exists? Needs a human
  call — it's a trade-off between two of this report's own recommendations.
- **Who sets the budget at intake.** `state.yaml`'s `budget.cost_limit_usd` is
  required at run creation (contracts/state.yaml / runs/fleetview-intake/state.yaml)
  but the brief never says whether the operator sets it per run at intake time or it
  inherits a fixed default. Affects whether "budget" is a first-paint field (interacts
  with A2) or hidden config.
- **Is run-creation a gate-grade write, or a lighter action?** The brief's provenance
  invariant ("no intake path may let an agent or upstream system self-initiate an
  approved run") clearly applies to gate approvals. Does the act of *minting* a run
  (pre-G0, no gate yet decided) need the same identity-attribution ceremony as a gate
  decision (REC8), or is it deliberately lighter-weight since G0 approval — the actual
  approval — still gates everything downstream? This determines how much friction
  REC5's confirm step should carry.
- **Where "queue new work" lives in the web UI.** The current nav is a fixed
  three-item list (Inbox / Portfolio / Metrics) with no create affordance
  (frontend/packages/web/src/app.tsx:38-40). Placement (new nav item vs. an action on
  Portfolio vs. a global shortcut) is a Designer decision, but is flagged here since
  none of the surveyed comparable products put "create" behind a fourth peer nav
  item — most use a persistent button or a keystroke (P4) instead.
