# DESIGN.md — Gatehouse

The token contract. Later work reads this. A value
that is not here was not decided; a value here without provenance was
chosen, which is the one forbidden move.

Produced with `~/.claude/skills/seeded-design`. The reasoning, the directions
that lost and the earlier rounds are in
[`docs/GATEHOUSE-DESIGN.md`](../../docs/GATEHOUSE-DESIGN.md); this file holds
the provenance. The tokens themselves live in [`src/styles.css`](src/styles.css),
and [`test/contrast.test.ts`](test/contrast.test.ts) recomputes the contrast
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

## The seed

| | |
|---|---|
| Artifact | A rack of Japanese *kanjō-kamoku* rubber stamps — account titles with their chart-of-accounts codes — on ruled ledger paper, one stamp face-down beside its impression |
| Source | https://commons.wikimedia.org/wiki/File:Account_title_stamp_2025-04-22.jpg |
| Licence | CC0 — may be reproduced in this repository |
| Chosen because | It is a closed vocabulary of bookkeeping categories, each one a name plus a code, colour-coded by class of account and never by judgement, and every entry in the book is the same one-ink impression of one of them. That is the shape of this product's fixed vocabulary: phases, gates, inbox kinds, burdens. |

**The dark theme is neither seeded nor derived: there is no dark theme.** A
single light theme is a decision (2026-09-04), not an omission. No
dark-ground artifact has been sampled, and a derived dark theme would be a
set of decisions nobody sourced.

**What the seed does beyond colour, and what this contract keeps of it.**
Colour lives on the stamp and never on the page: a reader of the book meets
one ink on ruled paper. Every entry is a name plus a code. A worn stamp
prints unevenly, so a state can be a texture. And the
rules do the separating — no boxes, no cards, no shadows.

## Tokens

Every row names the pixel it came from. `sampled` means a pixel on the
artifact, measured with `scripts/sample.py` at native resolution (3876×2907).
`derived` means a sampled hue with lightness moved to clear a floor. Hue is
never invented. The old semantic quartet's token *names* survive so every
consumer keeps working; what they resolve to is recorded here.

| token | value | provenance |
|---|---|---|
| `--color-ground` | `#F3F3EE` | **derived** from the lit paper, hue 60 held, lightness lifted from 91% to 94% — see *The ground, stated plainly* |
| `--color-surface` | `#F3F3EE` | the ground: one surface, nothing floats |
| `--color-inset` | `#ECECE4` | **sampled**, the lit paper, 20% of the paper crop — the shade a code block and a packet frame sit in |
| `--color-raised` | `#E4E4DC` | derived from the paper, one step down — hover and the selected row |
| `--color-reading-bg` | `#F3F3EE` | the ground |
| `--color-ink` | `#2C343C` | **sampled**, the lettering on the stamp faces |
| `--color-accent-deep` | `#1C2424` | **sampled**, the darkest impression ink — what a pressed mark and a button are filled with |
| `--color-muted` | `#5A6262` | derived from the ink, lifted to 5.6 on the ground |
| `--color-faint` | `#636B73` | derived from the rule hue, the lightest text that clears 4.5 on the inset |
| `--color-on-solid` | `#F3F3EE` | the paper — reversed type is paper showing through, not white |
| `--color-line` | `#A4ACB4` | **sampled**, the ledger's blue-grey horizontal rules, 5% of the paper crop |
| `--color-line-cool` | `#828D98` | derived from the rules, darkened to 3.0 for form-control borders |
| `--color-accent` | `#2C343C` | the ink — what used to be a hue is now weight |
| `--color-accent-tint` | `#E4E4DC` | the raised paper: a selected entry is the paper one step down, not a tint of a hue |
| `--color-accent-soft` | `rgba(44,52,60,.08)` | the ink at wash weight |
| `--color-ok`, `--color-info` | `#2C343C` | the ink: a good state is the plain mark, and the word carries it |
| `--color-mark` | `#A46C6C` | **sampled**, the ledger's red vertical column rule, 2% of the paper crop — the position a run stands at, and *over* |
| `--color-warn`, `--color-bad` | `#945B5B` | derived from the column rule, darkened to 4.5 for text |
| `--color-*-bg` | `#ECECE4` | the inset paper — no tinted fills anywhere |
| `--color-ok-line`, `-info-line`, `-pend-line` | `#A4ACB4` | the rules |
| `--color-warn-line`, `--color-bad-line` | `#A46C6C` | the column rule |
| `--color-*-soft` | ink or column rule at 8–14% | wash weight; the diff view's add and delete rows |
| `--radius-*` | `0` | the seed has ruled fields and rectangular stamp bodies |
| `--shadow-*`, `--static-ring`, `--glow` | `none` | nothing on a printed sheet floats |
| `--measure` | `640px` | one reading length, spent everywhere; never expressed in `ch` |

**Values retired with this round** (banned for this project, with the
register's): ground `#FAF7F1`, ink `#24201C`, accent `#A04423` and its tint
`#F5E9E0`, the four status tints `#EAF3E6 / #FBE9E6 / #FBF1DD / #EAF0F5`, and
the burden ramp `#E6C9A8 / #B88A4A / #7A3318`.

### The ground, stated plainly

`#F3F3EE` sits at 94% lightness, on the edge of the 94–98% near-white band
that the register flags as this author's strongest cross-project tell, and
it is five channel-units from curricle's ground `#F4F2F1`. Both flags are
accepted, and the audit will raise them on every run.

It is here on purpose, chosen by the maintainer on 2026-09-04 from a set of
five live candidates with the audit printed on each: the lit paper as
sampled (91%) read as glum at full-page scale, and every lighter step lands
nearer a value a sibling product already owns — which is the register's
aggregate finding shown live, not an argument against this value. Hue 60
and the paper's saturation are held; only lightness moved. What carries
identity here is not the ground but the impression grammar, the one ink,
the rules-not-cards structure and the absent elevation, none of which
depend on the ground being darker. The paper as sampled survives as
`--color-inset`, which is where code, packets and hover sit — so the seed's
actual pixel is on every screen, one step down from the page.

### Why there is no red text at the mark's own value

The column rule as sampled, `#A46C6C`, computes 3.8 on the ground: enough
for a mark; it is not enough for text. So the red exists twice — `--color-mark` as
sampled, for the dashed position cell, the over-budget bar and the
threshold tick, and `--color-warn` darkened along the same hue to 4.5 for
the words beside them. Hue 0 is outside every burned band.

## Type

| | family | source |
|---|---|---|
| Reading | Newsreader | held from the previous round — vendored, `public/fonts/newsreader/` |
| Chrome | Inter | held from the previous round — **a register default, not a decision** — vendored, `public/fonts/inter/` |
| Mono | JetBrains Mono | held from the previous round — vendored, `public/fonts/jetbrains-mono/` |

Type was deliberately held constant through the direction mockups so the
comparison isolated ground, structure and marks. It is the next pass, seeded
from the artifact's own lettering (a gothic with wide, lining, tabular
figures doing the code work). Vendoring shipped ahead of that pass (#358):
the three faces above are self-hosted `@font-face` rules in
[`src/styles.css`](src/styles.css) with each family's OFL license text beside
its `.woff2` files, so a self-hosted cockpit no longer phones a font CDN and
the deploy image carries what it needs with no network at build or runtime.
Until the type pass lands, this table records that the chrome face was
inherited — vendoring only changed where the bytes come from, not which
faces are chosen.

## Layout grammar

A ruled ledger page. Rows are separated by the blue-grey rule, a section
opens on a rule in the ink, and no content is boxed unless it is evidence
quoted from the record (the decide packets keep their frame, in the inset
paper). One surface: the rack and the page sit on the same paper with a rule
between them. History and Portfolio are registers — one row per event or
run, narrow fixed columns, entries in the order they happened.

## Shape and weight

Radius scale: `--r-card` 0, `--r-ctl` 0, `--r-chip` 0.
Elevation: none. Hierarchy is carried by rule weight (ink for a section,
blue-grey for a row, dashed for a preview), by fill (the pressed
impression), and by texture — never by shadow.

## Density

The inbox holds a decision row in 46px and the portfolio a run in about
56px; the metrics ledger a gate in 50px. Calibrated against the ledger
itself: one entry per rule, the kind at the left, the amount at the right.

## The signature gesture

**The impression.** Every status the product can name is a name (plus its
code) in one ink, told apart by texture: filled for a decision taken, hollow
for pending, struck for declined, hatched at the leading edge for bounced,
dotted for a state not reached or a run at rest, dashed in the red for the
position a run stands at. A human's own decision on the History ledger is
pressed — set 1.6° askew and roughened with an SVG
displacement filter — because it is the one mark on the page a person made.
There is no ok/warn/bad hue; the word and the texture carry it.

The gate sigil (two posts and a crossbar) stays as the wordmark's mark, in
the ink.

## Banned for this project

Beyond the shared register in the skill:

- The retired values listed under *Tokens*.
- Any per-phase hue, any tinted status chip, any pill radius, any shadow.
- Letterspaced uppercase labels, middot-chained metadata, trailing arrows
  on actions (the commit-subject arrows in History are the record's own
  words and stay).
- Ambient motion: the skeleton is a static block; nothing sweeps.
- A vertical rule that mimics a writing pad (retired 2026-09-04; the red
  keeps two state jobs and nothing structural).

## Settled decisions

1. **Single theme.** No dark theme until a dark-ground artifact is sampled
   (2026-09-04).
2. **The ground is `#F3F3EE`**, inside the band and near curricle's, with
   the justification above; the audit's flag does not reopen it.
3. **The semantic quartet is collapsed** to ink plus one red. `ok` and
   `info` resolve to the ink; `warn` and `bad` to the red text token. The
   product's own rule that status is carried in form is what makes this
   possible.
4. **The red vertical rule is retired.** Mimicry was the reason for it.
5. **One surface.** No page-inside-a-frame; `--color-surface` equals the
   ground.
6. **Portfolio phase chips are the plain mark**, not the red position tone:
   a column of dashed red cells read as a column of alarms (2026-09-04,
   found in the browser).
7. **The accent stays provisional.** The maintainer does not favour the
   grey-and-dusty-red pairing long term and expects "something a little
   livelier"; that is a future seeded pass, and the
   mockups were not regenerated for it.
8. **Type is inherited** — see *Type*; the next pass.

## Contrast

Recomputed by `test/contrast.test.ts` from `src/styles.css`; the suite fails
on a floor breach. Floors: 4.5 text, 3.0 large text and meaningful non-text.

| pair | ratio | floor |
|---|---|---|
| ink on ground | 11.34 | 4.5 |
| ink on inset | 10.63 | 4.5 |
| ink on raised | 9.88 | 4.5 |
| muted on ground | 5.62 | 4.5 |
| muted on inset | 5.27 | 4.5 |
| muted on raised | 4.89 | 4.5 |
| faint on ground | 4.86 | 4.5 |
| faint on inset | 4.56 | 4.5 |
| warn / bad on ground | 4.83 | 4.5 |
| warn on inset | 4.53 | 4.5 |
| paper on a filled impression | 14.21 | 4.5 |
| paper on the danger button (13px bold, judged as large) | 3.82 | 3.0 |
| mark vs ground (non-text) | 3.82 | 3.0 |
| mark vs inset (non-text) | 3.58 | 3.0 |
| control border vs ground (non-text) | 3.04 | 3.0 |
| impression border vs ground (non-text) | 11.34 | 3.0 |
| row rule vs ground (decorative, as sampled) | 2.06 | — |
| row rule vs inset (decorative, as sampled) | 1.94 | — |

## Audit

Last run: 2026-09-04
Command: `python3 ~/.claude/skills/seeded-design/scripts/audit.py --hex bg=#F3F3EE inset=#ECECE4 ink=#2C343C muted=#5A6262 mark=#A46C6C warn=#945B5B line=#A4ACB4`
Result: two flags, both accepted and answered above — the ground inside the
94–98% band, and its five-unit distance from curricle's ground. Every hue
passes the burned-band check; every text pair clears its floor.
