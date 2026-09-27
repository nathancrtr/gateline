# DESIGN.md — Gatehouse

The token contract. Later work reads this. A value that is not here was not
decided; a value here without provenance was chosen, which is the one
forbidden move.

The reasoning, the rounds that came before and the directions that lost are
in [`docs/GATEHOUSE-DESIGN.md`](../../docs/GATEHOUSE-DESIGN.md); this file
holds the provenance. The tokens themselves live in
[`src/styles.css`](src/styles.css), and
[`test/contrast.test.ts`](test/contrast.test.ts) recomputes the contrast
table below from that file on every run — a value edited there without
re-running the numbers fails the suite.

---

## The subject

Gatehouse is a ledger of human sign-offs on an agent pipeline. Every screen
is a view computed from committed git state, and the one write the product
makes is a named person approving or declining at a fixed gate, with a
timestamp and a burden category recorded as a side effect of deciding. The
approver spends most of their time reading what the agents produced, and a
small part of it pressing a decision onto the record. The record is the
authority; the cockpit renders it and keeps no state of its own.

## The source

The values here are the public documentation site's
([`site/assets/site.css`](../../site/assets/site.css), PR #392), carried
into the cockpit so that the two surfaces a visitor meets are one design.
The site's own lineage is signage — British Rail's 1965 identity through
GOV.UK's functional colour, with Stripe's frame and Go's neutrals — chosen
because that tradition's whole job is guiding people through gates
(`site/README.md` §Design). What the site settled and this contract keeps:

- **A white ground, one ink, rules instead of boxes.** Hairlines separate;
  a 2px ink rule opens a section; a 3px ink band tops the page. Nothing
  floats and nothing is rounded.
- **One signal blue** for the things a reader can go to: links, the active
  entry, the selected row — and, since settled decision 8, the ready
  decision, which is where the reader goes. Nothing else is blue.
- **Every other colour has one job, and the job is a gate state.** Green is
  approved. Red is declined, and by extension a fault: a malformed record,
  an over-spent budget. A bounced packet is not one (settled decision 8). The caution ink is for what a
  reviewer should look at without anything being wrong yet. The yellow
  means one thing on the site and one thing here: a human is wanted at
  this spot — the focus ring, and the gate on the table.
- **A state box is the site's callout:** a tint, a hairline frame, colour
  on the label. Colour never lives on the frame.

**There is no dark theme.** The site is light only (`color-scheme: light`),
and so is this — a decision carried over, not an omission.

## Tokens

`site` means the value is the site's, by name. `derived` means one step
from a site value, and says which step and why.

| token | value | provenance |
|---|---|---|
| `--color-ground` | `#FFFFFF` | site `--color-ground` |
| `--color-surface` | `#FFFFFF` | the ground: one surface, nothing floats |
| `--color-inset` | `#F2F3F4` | site `--color-surface` — the sidebar column, code panels and table heads; here the shade a code block, a packet frame and a state field sit in |
| `--color-raised` | `#E6E8EA` | **derived**, the inset one step down — hover and the selected row where no tint applies |
| `--color-reading-bg` | `#FFFFFF` | the ground |
| `--color-ink` | `#0B0C0C` | site `--color-ink` |
| `--color-muted` | `#4F5459` | site `--color-muted` |
| `--color-faint` | `#5F646A` | **derived** from muted, lifted one step; the lightest text that clears 4.5 on the raised step |
| `--color-on-solid` | `#FFFFFF` | site `--color-accent-on` — reversed type is the page showing through |
| `--color-line` | `#C8CACC` | site `--color-line`, the hairline |
| `--color-line-cool` | `#8B9095` | **derived** from the hairline, darkened to 3.0 on the ground for form-control borders |
| `--color-accent` | `#1D70B8` | site `--color-accent`, the signal blue |
| `--color-accent-hover` | `#0B3D78` | site `--color-accent-hover` |
| `--color-accent-deep` | `#0B3D78` | the hover blue — the selected record entry's own text and the phase-transition arrows in History |
| `--color-accent-tint` | `#EAF2FA` | site `--color-note-bg` — the selected entry and the note field |
| `--color-accent-soft` | `rgba(29,112,184,.08)` | the blue at wash weight: the diff view's file rows, the chosen closure |
| `--color-accent-underline` | `#9CC1E3` | site `--color-accent-underline`, under prose links |
| `--color-ok` | `#0F7A52` | site `--color-approved` |
| `--color-info` | `#1D70B8` | site `--color-note-label`, which is the accent |
| `--color-warn` | `#7A6400` | site `--color-caution-label` |
| `--color-bad` | `#C03030` | site `--color-declined` |
| `--color-mark` | `#C03030` | the declined red where a mark and not a word carries it: the danger button, the over-budget bar, the alert rule, an error border |
| `--color-focus` | `#FFDD00` | site `--color-focus` — the focus ring, and the gate on the table |
| `--color-ok-bg` | `#E6F4EE` | **derived**, the approved green at the tint weight of the site's other three fields |
| `--color-info-bg` | `#EAF2FA` | site `--color-note-bg` |
| `--color-pend-bg` | `#F2F3F4` | the inset |
| `--color-warn-bg` | `#FFF8D6` | site `--color-caution-bg` |
| `--color-bad-bg` | `#FBECEB` | site `--color-danger-bg` |
| `--color-*-line` | `#C8CACC` | the hairline, for every state: a callout's frame is never coloured |
| `--color-pend-ink` | `#4F5459` | muted |
| `--color-*-soft` | the state colour at 10–12% | wash weight; the diff view's add and delete rows |
| `--radius-*` | `0` | the site allows 3px at most; the cockpit's marks are rectangular |
| `--shadow-*`, `--static-ring`, `--glow` | `none` | nothing floats |
| `--measure` | `640px` | one reading length, spent everywhere; never expressed in `ch`. Kept at this value for packets by #516 (2026-09-26); see below |

**The measure and the packet (#516, decided 2026-09-26, not yet built).**
`--measure` stays 640px. A width in pixels is a line length at one type size
only. At the Record reader's 16px, 640px holds a median of about 87
characters of spec prose (79 to 93, over 24 full lines of the
`criterion-check` spec, measured in Chromium). Packets set the same words at
12.5px today, where the same width would hold about 111, and the grid sizes
their columns without this token. Once packet text is 16px, one width gives
one line length on the reader and the packet, so the token can stay in
pixels. The epic's sketch (#517, a static G0 packet built from the
`criterion-check` run's text) sets the record's text column at 600px, inside
the measure, with the hung labels and the margin outside it. A reviewer of
the sketch who was told nothing about the product listed body size, line
height and line length among the things to leave alone.

**Values retired with this round**: the hue-60 paper `#F3F3EE` / `#ECECE4`
/ `#E4E4DC`, the slate ink `#2C343C` / `#1C2424`, the dusty red `#A46C6C` /
`#945B5B`, and the collapsed quartet (`ok` and `info` as the ink, `warn` and
`bad` as one red). The earlier terracotta round's values stay retired.

## Type

The site's four faces, by job, vendored under `public/fonts/` from the same
binaries the site serves (`public/fonts/README.md` records versions and
sources). The cockpit's split follows the site's rule — a face per job, not
per surface — with one addition the site does not need: a code face for
the impression grammar, which is where the cockpit's identifiers live.

| token | family | job |
|---|---|---|
| `--font-sans` | Public Sans | page and section headings, running text, and the rendered artifacts on Record (`--font-read` resolves to the same face) |
| `--font-ui` | Atkinson Hyperlegible Next | the rack, tabs, buttons, table text and column heads, captions, labels, helper text, key hints |
| `--font-mono` | IBM Plex Mono, ligatures off | everything code-shaped: ids, paths, slugs, refs, commit subjects, quoted verdicts, the status chips, `<pre>` |
| `--font-mark` | Overpass 700 | the wordmark only |

The line between the UI face and the code face: a string a person would
copy — an id, a path, a ref, an amount the record states — is code; a string
that tells the reader what they are looking at is UI. Where the two meet in
one line (a label followed by a path), the label is UI and the path is code.

Retired with this round: Newsreader (the serif reading face), Inter and
JetBrains Mono.

**Size: the record and the cockpit (#516, decided 2026-09-27, not yet
built).** Today the components use 15 type sizes, ten of them between 10 and
14.5px, and a packet sets the record's words at 12.5px, smaller than the
cockpit's own instructions beside them. The decided rule separates the two
voices by face and size. **Text in the reading face at 16px is the record.
Text in the UI face at 13px is the cockpit.** The record's own labels
(`ASSUMPTION:`, `Resolved as:`) are the record, so they are set at 16px in
ink, hung in one column, with the author's bold kept. A first sketch set them
at 13px in muted grey, and a reviewer read them as the cockpit's field labels.

The scale drops to five sizes (#520). The rule fixes two of them. The epic
does not name the other three, and the sketch uses five others, so the scale
is not settled here. The sketch's sizes:

| size | face | job in the sketch |
|---|---|---|
| 20px | UI, bold | the run's name and the gate's question |
| 16px on 26px | reading | the record, its labels and headings included (fixed by the rule) |
| 15px | reading; UI | tables in the record; the navigation |
| 14px | UI, bold or medium; code, medium | a section head and the buttons; a Name and the gate's stamp |
| 13px on 20px | UI | the cockpit: captions, counts, hints, the position readout (fixed by the rule) |
| 12px | code | an Address |
| 11.5px | UI, medium | the "to confirm" mark in the margin |

Fenced code in the record is 13px in the code face. #520 fixes the five and
says where the others go.

## Layout grammar

A ruled page. Rows are separated by the hairline, a section opens on a rule
in the ink, and no content is boxed unless it is evidence quoted from the
record (the decide packets keep their frame, in the inset). One surface: the
rack and the page share the ground with a rule between them, under the ink
band. History and Portfolio are registers — one row per event or run,
narrow fixed columns, entries in the order they happened.

**Packets are ruled, not boxed (#516, decided 2026-09-26, not yet built).**
Today a packet sits in a frame on the inset, and each quoted passage in it
has its own hairline box. On a packet the record is about nineteen words in
twenty, so the box marks nearly every passage and distinguishes none. The
decided packet has no frame and no boxes. A section opens on the ink rule
under its head, items are separated by the hairline, and the packet ends on
an ink rule. The record's text runs in one column with one text edge, its
labels hung to the left, and each item's line number in a margin to the left
of those. Cards outside packets, where a quotation is the exception, keep the
box (`docs/SEAM.md` §5).

## Shape and weight

Radius: 0 everywhere. Elevation: none. Hierarchy is carried by rule weight
(ink for a section, hairline for a row, dotted for a preview), by fill (the
pressed impression), and by texture — never by shadow.

## Density

The inbox holds a decision row in 46px and the portfolio a run in about
56px; the metrics ledger a gate in 50px.

## The signature gesture

**The impression.** Every status the product can name is a name (plus its
code) in one ink, told apart by texture: filled for a decision taken,
hollow for pending, struck for declined, hatched at the leading edge for
bounced, dotted for a state not reached or a run at rest, doubled for the
phase the machine is in, and filled in the yellow for the gate on the table
— the one cell on the page waiting on a person. A human's own decision on
the History ledger is pressed — set 1.6° askew and roughened with an SVG
displacement filter — because it is the one mark on the page a person made.

Colour on an impression means **health, plus the one ready decision**
(settled decision 8). It is spent on trouble and on the happy-path decision,
and on nothing else. A gate state the record names keeps its colour too: a
green `approve`, a red `blocking`, a caution `major`.

| the cockpit's state | tone | where |
|---|---|---|
| A decision is ready to take | `go` — the signal blue, hollow (blue text and border) | inbox `KindChip` for a reviewable gate; the decide card's `needs you · G<n>` eyebrow; the portfolio's needs-you mark (#452) |
| Stuck; a person is needed to unblock | `warn` — the caution ink, hollow | `escalation` and `round-cap`, inbox, card and the portfolio's needs-you mark; the glyphs ⚑ / ⟲ tell them apart |
| The record cannot be read | `hatch mark` — hatched, in the declined red | `malformed`, on the inbox chip and the needs-you mark; the `unknown` phase |
| The machine's turn, or at rest | `dot` — dotted, muted | a bounced packet (the engine re-dispatches; no approval is offered), a superseded in-flight gate, `staged`, `paused` — on the inbox chip and the needs-you mark |
| Approved | `ok` — the approved green, filled, reversed type | `GateChip` ✓ in the gate ledger (portfolio, metrics); the spine's approved gate cells |
| Declined | `struck mark` — struck, in the declined red | `GateChip` ✕; the spine's declined gate cells |
| The gate on the table | `cur` — the yellow | the one spine cell in the run header, and the focus ring; nowhere else |
| Done, or a decision taken | `fill` — the ink | the `done` phase chip, History stamps |

Red is never on a bounced packet, and yellow is never in the inbox or on a
card. A card whose kind is not a gate says `needs you` in the plain mark and
lets its kind chip carry the colour.

This is the cockpit tinting by a *computed* condition — the third affordance
in [`docs/SEAM.md`](../../docs/SEAM.md) §5 — and it holds to that
affordance's trust condition: the words inside and beside the mark always
state the fact (`G1 · gate`, `⚑ escalation`, `bounced · G2`), and the colour
never carries what the words do not. It is distinct from tinting a *record
token* (SEAM.md §8.4), which stays as written.

The gate sigil (two posts and a crossbar) stays as the wordmark's mark, in
the ink.

## Banned for this project

- The retired values listed under *Tokens*.
- Any per-phase hue, any coloured frame on a state box, any pill radius,
  any shadow or gradient.
- Blue on anything that cannot be followed; yellow on anything that is not
  waiting on a person. *Amended by settled decision 8:* the ready decision's
  `go` impression is blue — it is where the reader goes, and the inbox row
  that carries it is a link. The yellow keeps its one cell: the spine's gate
  on the table, and the focus ring.
- Letterspaced uppercase labels, middot-chained metadata, trailing arrows
  on actions (the commit-subject arrows in History are the record's own
  words and stay).
- Ambient motion: the skeleton is a static block; nothing sweeps.
- A vertical rule that mimics a writing pad.
- A global element, such as the navigation, that changes by surface to solve
  one surface's layout (settled decision 13, 2026-09-27).

## Settled decisions

1. **Single theme**, light only, with the site (2026-09-25).
2. **The values are the site's.** A cockpit colour that is not on the site
   is a derivation from one that is, recorded above; a new hue is a change
   to both.
3. **The quartet has its jobs back**: `ok` approved, `bad` declined and
   fault, `warn` caution, `info` the note blue. `mark` is `bad` where a
   mark carries it.
4. **The yellow is for a person.** The gate on the table and the focus ring
   take it; the current phase does not, and a finished run has no yellow
   anywhere (2026-09-25, found in the browser: `done` lit up on a merged
   run).
5. **One surface.** No page-inside-a-frame; `--color-surface` equals the
   ground.
6. **Portfolio phase chips are the plain mark**, not the position tone: a
   column of positions is a column of alarms (2026-09-04, found in the
   browser).
7. **Type is the site's** (#358, 2026-09-25): Public Sans for reading and
   headings, Atkinson Hyperlegible Next for the UI, IBM Plex Mono for code,
   Overpass for the wordmark. The serif reading face retires with the
   site's own choice to set long pages in the sans.
8. **Colour carries state: health, plus the one ready decision** (#419,
   2026-09-26). Every inbox row used to look the same whether it was a gate
   ready to decide, a bounced packet, a stuck escalation or a run at rest;
   the maintainer's call was to let a little more colour in, with the quartet
   and the existing yellow only, no new hue and no per-phase hue. The mapping
   is the table under *The signature gesture*. A first mapping was built and
   rejected in review the same day: it put the yellow on every ready gate and
   the declined red on a bounced packet. Both read as warning and error, and
   misstated both the run's state and what the reader could do — the cause
   was mapping hue to the cockpit's *urgency* with tokens whose meaning is
   *verdict* and *warning*, and in an inbox where every row wants a person
   only the warning reading survives. The revised mapping gives the ready
   decision the signal blue, which amends the blue ban (see *Banned*),
   leaves a bounced packet dotted as the machine's turn, and keeps the yellow
   on the spine's one cell.

Decisions 9 to 13 come from epic #516, which sets a decision packet as an
annotated edition, with the record's words as the body text and everything
else at the edge. They are decided and not yet built, and the code still does what
the sections above say it does today. The full list, with the decisions about
the record's labels, addresses and the brief, is in `docs/SEAM.md` §13.

9. **The record is 16px in the reading face; the cockpit is 13px in the UI
   face** (2026-09-27). See *Type*.
10. **Packets are ruled, not boxed** (2026-09-26). See *Layout grammar*.
11. **The measure stays 640px** (2026-09-26). It is the right width once
    packet text is 16px. See *Tokens*.
12. **The Decide surface may be wider than today's page cap, and the run
    header is condensed** (2026-09-26), so the intent brief can sit in a
    pinned pane beside the packet's column.
13. **Navigation is unchanged, and the same on every surface** (2026-09-27).
    A sketch had turned the navigation into a top strip on the Decide
    surface, only to give the brief's pane 200px. That was rejected, and
    the rule it leaves is under *Banned*.

## Contrast

Recomputed by `test/contrast.test.ts` from `src/styles.css`; the suite fails
on a floor breach. Floors: 4.5 text, 3.0 large text and meaningful non-text.

| pair | ratio | floor |
|---|---|---|
| ink on ground | 19.59 | 4.5 |
| ink on inset | 17.63 | 4.5 |
| ink on raised | 15.95 | 4.5 |
| muted on ground | 7.65 | 4.5 |
| muted on inset | 6.89 | 4.5 |
| muted on raised | 6.23 | 4.5 |
| faint on ground | 5.97 | 4.5 |
| faint on inset | 5.37 | 4.5 |
| faint on raised | 4.86 | 4.5 |
| accent on ground | 5.17 | 4.5 |
| accent on inset | 4.65 | 4.5 |
| accent on accent-tint | 4.57 | 4.5 |
| accent-deep on accent-tint | 9.51 | 4.5 |
| accent-hover on ground | 10.75 | 4.5 |
| ok on ground | 5.35 | 4.5 |
| ok on inset | 4.81 | 4.5 |
| ok on ok-bg | 4.72 | 4.5 |
| info on info-bg | 4.57 | 4.5 |
| warn on ground | 5.75 | 4.5 |
| warn on inset | 5.18 | 4.5 |
| warn on accent-tint | 5.09 | 4.5 |
| warn on warn-bg | 5.38 | 4.5 |
| bad on ground | 5.67 | 4.5 |
| bad on inset | 5.1 | 4.5 |
| bad on accent-tint | 5.01 | 4.5 |
| bad on bad-bg | 4.94 | 4.5 |
| ink on focus | 14.55 | 4.5 |
| on-solid on ink | 19.59 | 4.5 |
| on-solid on mark | 5.67 | 4.5 |
| on-solid on ok | 5.35 | 4.5 |
| mark vs ground (non-text) | 5.67 | 3.0 |
| mark vs inset (non-text) | 5.1 | 3.0 |
| line-cool vs ground (non-text) | 3.22 | 3.0 |
| ink vs ground (non-text) | 19.59 | 3.0 |
| accent vs ground (non-text) | 5.17 | 3.0 |
| accent vs accent-tint (non-text) | 4.57 | 3.0 |
| warn vs ground (non-text) | 5.75 | 3.0 |
| warn vs accent-tint (non-text) | 5.09 | 3.0 |
| mark vs accent-tint (non-text) | 5.01 | 3.0 |
| ok vs ground (non-text) | 5.35 | 3.0 |
| line vs ground (decorative) | 1.64 | — |
| line vs inset (decorative) | 1.48 | — |
| focus vs ground (decorative) | 1.35 | — |
