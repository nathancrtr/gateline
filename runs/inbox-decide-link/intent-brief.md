# Intent Brief: Honor the inbox decide link on the run page

## Problem

`frontend/packages/web/src/pages/inbox.tsx` already encodes exactly what the
human is being called to decide. Its `itemHref` helper writes `?decide=G2`,
`?decide=esc-<n>`, `?decide=paused`, or `?decide=staged` into each run link.

`frontend/packages/web/src/pages/run.tsx` never reads that parameter. Clicking
an inbox row lands the approver at the top of the run page, where they scroll to
find the needs-you card the inbox had just pointed directly at. The intent is
captured and then dropped on the floor.

This is issue #216.

## Motivation

This is the cheapest item in the reading-experience set and it carries no
dependency on the others, so it can land in parallel with issue #214.

The cost it removes is small per click and paid on every single inbox visit,
which is the one path a human takes into this system when it wants something
from them. Nothing about what is rendered changes; this only reorders
attention.

## Constraints

- **No render changes.** The set of cards, their content, and their order stay
  exactly as they are. This run moves focus and scroll position, and opens a
  panel that the human could already have opened by hand.
- **Silent degradation is required, not optional.** An unknown, stale, or
  already-decided `decide` value must land at the top of the run page exactly as
  today: no error banner, no empty panel, no console noise. A human hand-editing
  the URL to `?decide=G9` must not be able to produce a broken state.
- **Deterministic derivation from committed state only.** Whether a card exists
  and whether it is decidable comes from the run record, never from the URL. The
  URL selects among cards that already exist; it never conjures one.
- **All four shapes the inbox emits must be handled**: a gate id, `esc-<n>`,
  `paused`, and `staged`. If `itemHref` needs a shared parser so the writer and
  the reader cannot drift apart, extract one rather than duplicating the
  string format.
- **Test the logic where a harness already exists.** `packages/web` has no unit
  test harness today (no jsdom, no testing-library), and standing one up is
  larger than this change. Put the `decide` -> target-card resolution in a pure,
  DOM-free function testable under the existing vitest setup, and cover the
  navigation itself with one Playwright e2e in `frontend/e2e/`.
- Node >= 24; `npm test`, `npm run typecheck`, and the existing e2e specs must
  pass.

## Out of scope

- Standing up a jsdom/testing-library unit test harness for `packages/web`. If
  this change makes that look worthwhile, it is its own issue.
- Any change to which items appear in the inbox, how they are ordered, or how
  they are worded.
- Finding cards, verdict chips, or section folding (issues #214, #215, #217).
- Deep-linking to anything other than the four needs-you shapes the inbox
  already emits — no artifact anchors, no per-finding links.

## Profile

patch
