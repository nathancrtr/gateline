# Candidate C — Design Rationale

## Typefaces

Four type families carry distinct roles. **Playfair Display** (italic 700) serves as the editorial hero — the Stripe pattern applied to Inbox, Portfolio, New Run, and Run Detail headings. **Inter** is the UI workhorse for labels, body text, tables, buttons, and chips. **JetBrains Mono** handles code, paths, slugs, OIDs, and the genesis commit message — the two-number-jobs distinction is preserved through the mono role. **Source Serif 4** renders artifact prose on the Run Detail reading surface at 16px/1.65 — the one place a serif body is justified by long-form reading comfort.

## Theme

Warm light throughout. Ground `#faf8f5` (cream), surfaces `#fffdf9`, lines `#e8e3dc`. Text uses GitHub Primer's cool near-black `#1b1f24` — never pure black. Status colors are desaturated and muted: greens read as information, reds as concern, never alarm. The palette feels like a well-lit reading room.

## Signature motif

A diamond/lozenge — an abstraction of a gate — recurs as a restrained geometric mark. It appears as the empty-state illustration (a rotated square with a centered dot), and a subtle blueprint grid overlays the New Run preview panel. Applied to exactly two surfaces; a team signature, not decoration.

## Genesis commit chip

The hero of the New Run preview: a status dot (filled accent blue when ready, hollow pending), the full commit message in mono, and a divider-separated author/committer line. The chip sits on an elevated card within the tinted preview panel — it reads as a considered page proof, not a debug output. This is the element the product owner called out as rewarding a point of view.

## Reading surface

The artifact body is where the redesign earns its keep. Source Serif 4 at 16px with 1.65 leading, capped at 76ch, padded 48px horizontally on a pure white ground with no hard border — a page, not a card. Headings return to Inter for structural clarity, creating a deliberate typographic conversation between the reading face and the labeling face. Code blocks use a warm tinted background (`#f6f4f2`); blockquotes carry a blue left-rule on a tinted ground; tables use quiet borders. The rendered spec.md exercises H1–H3, body, code, a table, a blockquote, and lists — the reading comfort is proven, not asserted.

## Reference-board details adopted

- **Stripe** — italic serif hero headlines + large editorial numbers
- **GitHub Primer** — tinted status chips (muted bg + emphasis text), cool near-black, ring+soft-drop shadows on decision cards
- **Raycast** — structured key/value metadata rail at the run header's base
- **Sentry** — left-edge 3px colored status rails on inbox rows
- **Vercel Geist** — 6/12/16 radius ladder, named type roles
- **Linear** — display/reading/mono face split, justifying the four-face strategy