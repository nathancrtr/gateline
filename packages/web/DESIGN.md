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
  entry, the selected row. Nothing else is blue.
- **Every other colour has one job, and the job is a gate state.** Green is
  approved. Red is declined, and by extension a fault: a malformed record,
  a bounced packet, an over-spent budget. The caution ink is for what a
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
| `--measure` | `640px` | one reading length, spent everywhere; never expressed in `ch` |

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

## Layout grammar

A ruled page. Rows are separated by the hairline, a section opens on a rule
in the ink, and no content is boxed unless it is evidence quoted from the
record (the decide packets keep their frame, in the inset). One surface: the
rack and the page share the ground with a rule between them, under the ink
band. History and Portfolio are registers — one row per event or run,
narrow fixed columns, entries in the order they happened.

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
Colour is spent only where a gate state is named: a green `approve`, a red
`blocking`, a caution `major`.

The gate sigil (two posts and a crossbar) stays as the wordmark's mark, in
the ink.

## Banned for this project

- The retired values listed under *Tokens*.
- Any per-phase hue, any coloured frame on a state box, any pill radius,
  any shadow or gradient.
- Blue on anything that cannot be followed; yellow on anything that is not
  waiting on a person.
- Letterspaced uppercase labels, middot-chained metadata, trailing arrows
  on actions (the commit-subject arrows in History are the record's own
  words and stay).
- Ambient motion: the skeleton is a static block; nothing sweeps.
- A vertical rule that mimics a writing pad.

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
| warn on warn-bg | 5.38 | 4.5 |
| bad on ground | 5.67 | 4.5 |
| bad on inset | 5.1 | 4.5 |
| bad on bad-bg | 4.94 | 4.5 |
| ink on focus | 14.55 | 4.5 |
| on-solid on ink | 19.59 | 4.5 |
| on-solid on mark | 5.67 | 4.5 |
| mark vs ground (non-text) | 5.67 | 3.0 |
| mark vs inset (non-text) | 5.1 | 3.0 |
| line-cool vs ground (non-text) | 3.22 | 3.0 |
| ink vs ground (non-text) | 19.59 | 3.0 |
| accent vs ground (non-text) | 5.17 | 3.0 |
| line vs ground (decorative) | 1.64 | — |
| line vs inset (decorative) | 1.48 | — |
| focus vs ground (decorative) | 1.35 | — |
