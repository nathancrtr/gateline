# Gatehouse — design rationale

The visual design of Gatehouse, gateline's cockpit, and where each decision
came from. This document holds the *reasoning*; the token contract with
per-token provenance lives beside the code in
[`packages/web/DESIGN.md`](../packages/web/DESIGN.md) once a direction is
built. Earlier rounds are kept at the end as history.

**Status (2026-09-26): round 4 — the site's direction, carried in — with
round 5's colour-for-state pass on top (below).** The
public documentation site took its design first (`site/`, PR #392, lineage
in `site/README.md` §Design: British Rail 1965, GOV.UK's functional colour,
Stripe's frame, Go's neutrals), with the decision that Gatehouse follows.
Round 4 is that follow: the cockpit's tokens now resolve to the site's
values, and colour is spent only where the site spends it — one signal blue
for navigation and links, and a green, a red and a yellow each reserved for
a gate state. The token contract with per-token provenance and the contrast
table is [`packages/web/DESIGN.md`](../packages/web/DESIGN.md), held to its
floors by `packages/web/test/contrast.test.ts`. What survives from round 3
is its structure: one surface, rules not cards, no elevation, and the
impression grammar for status. Round 3's seeded process and the three
directions below are kept as the record of how that structure was reached.

### Round 5 — colour carries state (2026-09-26)

Round 4 spent colour only where a gate state is named, and the inbox paid
for it: a gate ready to decide, a bounced packet, a stuck escalation and a
run at rest were four rows in one ink. Round 5 (#419) lets a little more
colour in, with no new hue: on an impression, colour now means **health,
plus the one ready decision**. The ready gate is the signal blue, hollow; a
stuck escalation or round cap is the caution ink; an unreadable record is
hatched in the red; a bounced or superseded packet, a staged run and a
paused one stay dotted, the machine's turn; the ledger's approved and
declined gates are the green and the red; the yellow keeps the spine's one
gate on the table.

The first cut of the round put the yellow on every ready gate and the red on
a bounced packet, and was rejected in review: they read as warning and
error, and misstated what the reader could do. Hue had been mapped to the
cockpit's urgency with tokens that mean verdict and warning. The mapping,
the amendment to the blue ban it needed, and the record of the rejected cut
are settled decision 8 in [`packages/web/DESIGN.md`](../packages/web/DESIGN.md).

### What round 4 changed (2026-09-25)

- **The ground is white** and the ink is the site's near-black; the panel
  grey the site uses for its sidebar and code panels is the inset.
- **The accent is the signal blue**, doing on the cockpit what it does on
  the site: links, the active entry in the rack, the selected record entry.
  Nothing else is blue.
- **The semantic quartet gets its jobs back.** Round 3 collapsed `ok` and
  `info` into the ink and `warn` and `bad` into one dusty red. Now `ok` is
  the approved green, `bad` the declined red, `warn` the caution ink and
  `info` the note blue — the site's own state vocabulary, which it reserves
  for gate states. A state box is the site's callout: a tint, a hairline
  frame, colour on the label.
- **The gate on the table is the yellow.** On the site the GOV.UK yellow
  means one thing: a human is wanted here — the focus ring, and "awaiting a
  human". The spine's pending gate is filled with it, and the focus ring
  takes it. The phase the machine is working in is a doubled rule with no
  colour, because nobody is wanted there yet; a first cut gave it the
  yellow too, and a merged run lit up on `done`. Round 3 marked both in a
  dashed red, which said *alarm*; the position is not an alarm, it is an
  invitation.
- **The 3px ink band** runs across the top of the page, as on the site.
- **The provisional accent is retired.** The grey-and-dusty-red pairing
  recorded as "not favoured long term" at the round 3 build is gone, and
  with it the seeded process that produced it: round 4 takes its values
  from a designed sibling surface in this repository, not from a sampled
  photograph.
- **Type is the site's** (#358, in the second PR of the round): Public
  Sans for reading and headings, Atkinson Hyperlegible Next for the UI —
  the rack, tabs, tables, labels, captions — IBM Plex Mono with ligatures
  off for everything code-shaped, Overpass for the wordmark. The serif
  reading face retires with it; the site sets its long pages in the sans,
  and the cockpit's artifacts are the same kind of page. Some eighty
  labels, captions and table cells that were set in the mono face move to
  the UI face; the mono keeps what a person would copy.
- Held: a single light theme; the impression grammar; radius 0; no shadows.

### What was settled at the round 3 build (2026-09-04)

- **Ground `#F3F3EE`** — the lightest of the five candidates, chosen with the
  register's collision flags in view; the justification is in the contract.
- **Accent provisional.** The grey-and-dusty-red pairing is not favoured long
  term; something livelier is expected, from a seed, in a later pass. The
  mockups were not regenerated for it.
- **Single theme**, **type inherited** (Inter / Newsreader / JetBrains Mono,
  vendoring in scope), **copy tics only** — the deep rewrite waits.
- Found in the real app and fixed before the commit: a column of red dashed
  phase cells in the portfolio (now the plain mark), an in-flight gate chip
  hatched like a bounce (now dotted), a skeleton invisible on the inset
  frame, and the full profile's four gate marks overflowing their button.

### The pick, and the pushback

A1 was chosen over A2 and B on 2026-09-04 with three corrections, all
applied in the iteration page:

1. **The ground was too dark.** The 85% paper-in-shade read as glum. The
   iteration offers the lit paper as sampled (`#ECECE4`, 91%) and three
   derivations along the same hue — 92%, 93%, 94% — plus a chroma-halved
   91%. Every lighter step lands nearer a value a sibling product already
   shipped, and the page prints which; that is the register's aggregate
   finding in miniature, and the choice is made with it in view.
2. **The red vertical rule is retired.** It mimicked a writing pad, and the
   mimicry was the point of it — which is the wrong reason. Red keeps two
   jobs only, both states: the position a run is standing at, and *over*
   (budget, threshold).
3. **One surface, fewer boxes.** The page-inside-a-darker-frame shell is
   gone; rack and content sit on the same paper, separated by a rule. Nav
   counts and filters are plain type; impressions are reserved for states
   and kinds. The lead paragraphs under each title are cut to a line.

Reviewed screen by screen in a browser before republishing. Two defects
found that way and fixed: portfolio slugs wrapping in a narrow column, and
the New-run preview's ruled-paper background cutting through its own text
— an over-literal use of the artifact, removed.

---

## The subject

Gatehouse is a ledger of human sign-offs on an agent pipeline. Every screen
is a view computed from committed git state, and the one write the product
makes is a named person approving or declining at a fixed gate, with a
timestamp and a burden category recorded as a side effect of deciding. The
approver spends most of their time reading what the agents produced — specs,
plans, reviews, diffs — and a small part of it stamping a decision onto the
record. The record is the authority; the cockpit renders it and never keeps
state of its own.

Audience: one senior engineer acting as named approver today, and anyone who
lands on the public README and its screenshots once the repository is public.

Screens and their jobs:

| screen | job |
|---|---|
| Inbox | everything waiting on a human, oldest first; decide what to open |
| Run | read the packet, then decide; three surfaces: Decide, Record, History |
| Portfolio | every run's gate ledger, phase and budget at a glance |
| New run | author the intent brief while the record it will commit assembles itself |
| Metrics | approval rate per gate against the over-triggering threshold, burden mix, budget honesty |

## The seeds

Three artifacts, supplied by the maintainer on 2026-09-04, sampled with
`scripts/sample.py` at native resolution. Local copies and the full candidate
set are in `~/Downloads/gatehouse-seeds/` (not in the repository).

### Seed A — account-title stamps on ledger paper

| | |
|---|---|
| Artifact | A rack of Japanese *kanjō-kamoku* rubber stamps (account titles with their chart-of-accounts codes) on ruled ledger paper, one stamp face-down beside its impression |
| Source | https://commons.wikimedia.org/wiki/File:Account_title_stamp_2025-04-22.jpg |
| Licence | CC0 — may be reproduced in this repository |
| Chosen because | It is a closed vocabulary of bookkeeping categories, each one a name plus a code, colour-coded **by class of account, never by judgement**, and every entry in the book is the same one-ink impression of one of them. That is the shape of this product's fixed vocabulary: phases, gates, inbox kinds, burdens. |

What was measured (native, 3876×2907):

| role | seen | ink | share | note |
|---|---|---|---|---|
| ledger paper, lit | `#ECECE4` | | 20% of paper crop | hue 60, sat 17, **91%** |
| ledger paper, in shade | `#DCDCD4` | | 34% of paper crop | hue 60, sat 10, **85%** |
| horizontal rules | | `#A4ACB4` | 5% of paper crop | blue-grey, hue 210 |
| vertical column rule | | `#A46C6C` / `#BC9494` | 2% of paper crop | the red double rule |
| impression ink (type on the page and on stamp faces) | | `#1C2424` / `#2C343C` | | one black-slate ink everywhere |
| stamp body, expenses (7xx) | `#F4BCC4` | `#946C74` | 37% of that stack | pink, hue 351 |
| stamp body, assets (2xx) | `#8CA4C4` | `#3C4C5C` | 19% of that stack | slate, hue 210–214 |
| stamp body, special items (9xx) | `#BCBCAC` | `#9C9C8C` | 41% of that stack | cream, hue 60, sat 11 |
| stamp body, revenue and special gains | `#CC4434` | `#A43424` | 34% of that stack | vermilion, hue 6 |

What the artifact does beyond colour:

1. **Colour lives on the stamp, not on the page.** The body of each stamp
   says which class of thing it is; the impression it leaves is one ink. A
   reader of the book never meets pink or slate — they meet a name and a
   number in black on ruled paper. Colour is an index for picking.
2. **Every entry is name + code.** `減価償却費 · 766`. Nothing on the page is
   a bare word. That is the `G2 — Does the evidence support merging?` habit
   this product already has, made typographic.
3. **State as texture.** A worn stamp prints unevenly. An impression is
   visibly a *stamped* thing, distinct from the ruled structure of the page
   and from handwriting. A fourth state needs a texture.
4. **The rules do the separating.** Blue-grey horizontals, one red vertical.
   No boxes, no cards, no shadows.

### Seed B — Nansen passport with revenue stamps, 1930

| | |
|---|---|
| Artifact | A specimen French Nansen passport (certificate of identity and travel for stateless refugees), cover and visa pages 7–9 with International Nansen Office revenue stamps affixed |
| Source | https://www.loc.gov/item/2021667890/ (World Digital Library; original at the UN Office at Geneva Library) |
| Licence | Library of Congress: no known restrictions, free to use and reuse |
| Chosen because | It is a document whose whole job is to be stamped at gates by named officials, and its pages are designed as empty ledgers for those stamps to accumulate on, each stamp a fee paid and a passage recorded. The green band is a category mark. |

What was measured (native, 5743×1991):

| role | seen | ink | share | note |
|---|---|---|---|---|
| card stock, the ground | `#D4B48C` – `#DCB48C` | | 35% of image | hue 30–33, sat 46–56, **69–71%** |
| card stock, deeper | `#C49C6C` | | 9% of cover | hue 33, 60% |
| green diagonal band | `#243C04` / `#2C4404` | `#243C04` | 39% of band crop | hue 86, sat 88, 13% |
| type | | `#242424` | | black letterpress |
| stamp paper | `#D4D4D4` – `#DCDCDC` | | 17% of stamp crop | neutral, 83–86% |
| stamp ink, Russian refugees | `#0444B4` | `#043C9C` | 6.5% of stamp crop | **hue 218** |
| stamp ink, Armenian refugees | `#C4BCA4` | `#443C04` | 1.6% of cover crop | olive-ochre, hue 52 |

What the artifact does beyond colour:

1. **A page is a heading, an instruction and room for stamps.** *Visas*, in
   italic. "Reproduce in each visa the name of the holder." Then nothing,
   until an official adds something. The empty page is the design.
2. **A decision is an affixed object**, on its own white paper, in one ink,
   with its value and its issuer printed on it. It is never drawn *into*
   the page; it sits *on* it.
3. **Category is a band across the corner**, one colour, cut on the
   diagonal. Everything else on the cover is type.
4. **The typography carries the authority.** Condensed grotesque capitals
   for the title, an italic for the headings, a geometric sans on the
   stamps, letterspaced small capitals for the field labels.

### Seed C — a train register on the signalman's desk, Wössingen

| | |
|---|---|
| Artifact | Colour slide, Harald Knauer collection: the *Zugmeldebuch* (train register) open on the desk of Wössingen signal box, in front of the block instrument and command console |
| Source | https://www.landesarchiv-bw.de/plink/?f=2-5739856 (Landesarchiv Baden-Württemberg, PL 734) |
| Licence | CC BY 3.0 — may be reproduced with attribution |
| Chosen because | It is the working record of a gatekeeper: every train that passed, in a ruled book with narrow time columns, kept by the person who threw the levers. The console beside it has exactly one kind of saturated mark: the red buttons. |

What was measured (native, 1000×675 — the slide is published at this size):

| role | seen | share | note |
|---|---|---|---|
| desk and shadow | `#141414` | 22% | 8% lightness |
| register page | `#8CA49C` – `#94ACA4` | ~30% of page crop | hue 150–180, sat 7–13, 55–63% |
| rules on the page | `#7C8C7C` | | |
| console | `#343C3C` – `#5C6C74` | | hue 180–200 |
| pen | `#84ACD4` | 0.7% | hue 210 |

**This seed is not a colour source.** The slide is underexposed and its
page reads at 60% lightness with a green-teal cast (hue 160) that is the
film, not the paper; the audit flags every value from it. It is kept as a
**structure** source: the register's grammar (one row per event, narrow
fixed columns for times and identities, entries in the order they happened,
no prose) is the right shape for the History surface and the Portfolio, and
the one-red-button console is the right proportion for the decision
affordance. Both directions below borrow that grammar; neither takes a hue
from it.

## Where the current skin stands

For the record, the palette shipping today (`packages/web/src/styles.css`,
Candidate A of `runs/gate-redesign/`) run through the same gates:

- ground `#FAF7F1` at 96% is inside the near-white band and 6 units from
  curricle's retired warm ground `#FDF6EF`;
- ink `#24201C` is 4 units from curricle's ink and inside the amber band;
- accent `#A04423` at hue 16 is the terracotta default;
- muted `#7A726A` on the ground computes 4.42, below the 4.5 floor.

---

## Directions

Prose and hex only. Type is **held constant** across the three for the
mockups (the current Inter / Newsreader / JetBrains Mono stack) so the
comparison isolates ground, structure and marks; each direction names the
type its seed argues for, and type is seeded in its own pass afterwards,
with vendoring.

Shared, from seed C: History and Portfolio are registers — one row per
event, narrow fixed columns, rules not cards — in every direction.

### Direction A1 — The impression

**Seed.** Seed A, taken as the *page*: the ledger paper, its rules, and the
one-ink impression a stamp leaves.

**Why this, for this product.** The record is what an approver reads and
what the product renders; colour that only exists on the picker and never on
the page is the honest rendering of "the repo is the database".

**Palette.**

| role | hex | provenance |
|---|---|---|
| ground | `#DCDCD4` | sampled, the paper in shade, 34% of the paper crop, 85% lightness |
| reading surface / panel | `#ECECE4` | sampled, the paper under the lamp, 91% — a panel is a *lit* page, so it steps up |
| ink | `#2C343C` | sampled, the lettering on the stamp faces — 9.2 on the ground, 10.6 on the panel |
| impression | `#1C2424` | sampled, the darkest impression ink; what a stamped mark is drawn in |
| muted | `#4C5454` | derived from ink, 5.6 on the ground and 6.5 on the panel |
| rule | `#A4ACB4` | sampled, the horizontal rules |
| rule, red | `#A46C6C` | sampled, the vertical column rule — the *one* saturated line on the page; 3.1 on the ground, 3.6 on the panel |
| accent | `#A46C6C` | the red rule, doing double duty: the gate on the table |

The audit reads `#1C2424` as hue 180 at saturation 12 and flags the teal
band; it is the measured impression under the photograph's cool light rather
than a chosen teal, and it is never used for text — `#2C343C` is.

**Type.** The artifact's own lettering is a Japanese gothic with wide,
lining, tabular Latin numerals doing the code work. What that argues for in
Latin is a grotesque with real tabular figures and a text weight that holds
at 12px, and *no* second family: the name and the number are the same
voice. Candidate for the type pass: Archivo, or Public Sans, vendored.

**Layout concept.** Every screen is a ruled page: rows separated by the
blue-grey rule, the red rule marking the column where decisions are posted,
and no boxes anywhere.

**What it would feel like to use.** The inbox is a ledger of open entries,
each row `kind · code · run · what · age`; the gate on the table is the row
whose left edge sits on the red rule. On the run page the decision panel is
not a card but the posting column: the question, the packet, and a space
where the impression will land. Approving stamps `G2 · approved · <name> ·
<date>` onto the History register in the impression ink, slightly uneven.

**Honesty flag.** *Would I have produced any part of this for any brief
whatsoever?*
> The sidebar-plus-main shell, yes — deleted; the nav becomes the rack of
> stamps down the left rule, name + code, and the active one is the one with
> its impression showing. The big-number hero ("Inbox 4"), yes — deleted; the
> count is the footing of the column. The tinted chip with a dot, yes —
> deleted; a status is an impression, name + code, in one ink. The 85% grey
> ground, no: I would not have reached for that, and it is the seed's.

**What it costs.** It is quiet to the point of severity. With one ink and one
red line, a bounced packet, an over-budget run and an escalation must all be
told apart by glyph, texture and words, and the Metrics charts have to work in
tints of one ink plus hatching. A first-time visitor may read the grey as
unfinished before they read it as paper.

### Direction A2 — The stamp rack

**Seed.** Seed A, taken as the *rack*: the four stamp-body colours as the
index to the closed vocabulary, on the same paper as A1.

**Why this, for this product.** The vocabulary is closed (DESIGN.md §4.2,
"open table, closed gates") and the seed already colour-codes a closed
vocabulary by *class* — assets, expenses, special items, revenue — never by
good or bad. Phases, inbox kinds, rest states and the gate on the table are
four classes.

**Palette.** A1's page plus:

| role | hex | provenance |
|---|---|---|
| class: phases | `#8CA4C4` | sampled, the assets (2xx) stack; ink on it 4.9 |
| class: things waiting on a human | `#F4BCC4` | sampled, the expenses (7xx) stack; ink on it 7.7 |
| class: at rest — staged, paused, closed | `#BCBCAC` | sampled, the special-items (9xx) stack; ink on it 6.6 |
| class: the gate on the table | `#CC4434` | sampled, the revenue stack; the only fully saturated mark, used once per screen |
| text on the gate stamp | `#FDFBFB` | derived — the ink computes 2.7 on vermilion, so this stamp alone carries light type |

The text on every stamp body is the one ink, `#2C343C`, because the seed
prints every stamp face in the same black; the vermilion one is the
exception the numbers force. None of the three light fills clears 3.0
against the page (1.2–2.2) and they are not asked to: a stamp is a block
with a dark edge, and the edge — drawn in the impression ink — is the
boundary the non-text floor applies to. The chip-inside-a-panel trap
therefore does not arise; the fill is decoration on an object whose edge is
what separates it.

There is no ok / warn / bad. Approved, declined, bounced and over are
glyphs and textures on an impression, as the seed leaves only one ink on the
page.

**Type.** As A1.

**Layout concept.** A1's ruled page, with the pickers — nav, filters, phase
spine, kind chips — drawn as the stamp bodies they are: flat, rectangular,
edge-on, class-coloured, and the record they produce drawn in one ink.

**What it would feel like to use.** The phase spine is a row of slate
stamps with the current one turned face-up; the inbox's kind filters are
pink stamps; a staged run's chip is cream. Once a decision is made the
colour is gone: the History register shows the black impression and nothing
else.

**Honesty flag.**
> The tinted-chip kit, yes — this is the direction most at risk of
> reproducing it, because pastel filled chips are on the register. What
> survives is not a chip: it is a flat rectangle with no radius, no border
> and no dot, whose colour is the stamp's body and never appears on any
> record surface, and whose text is always name + code. If in the mockups it
> still reads as the Primer chip, this direction is cut and A1 stands.

**What it costs.** Four class colours are four decisions to keep straight,
and the pink at 85% lightness has to clear 3.0 against *both* the ground and
the lit panel, which the audit will police. It is also the direction closest
to what shipped, structurally, so it is the one that can slide back.

### Direction B — The visa page

**Seed.** Seed B: the card stock, the green band, the italic heading, and
decisions as affixed stamps in one blue on white.

**Why this, for this product.** A gate is a checkpoint where a named person
stamps a document and the document carries the stamps forward. The Nansen
page is designed to be empty until that happens; so is a run's Decide
surface.

**Palette.**

| role | hex | provenance |
|---|---|---|
| ground | `#D4B48C` | sampled, the card stock, 35% of the image, **69%** lightness |
| reading surface | `#DCDCDC` | sampled, the stamp paper, 86% — long text is read on the affixed sheet; it computes 1.4 against the card and is bounded by its perforated edge, not by contrast |
| ink | `#242424` | sampled, the letterpress; 7.9 on the card, 11.3 on the sheet |
| muted | `#4C3C2C` | derived from ink along the card's hue; 5.4 on the card, 7.7 on the sheet |
| band | `#243C04` | sampled, the green diagonal, 39% of its crop — a source/category mark; 6.2 on the card |
| stamp ink | `#0444B4` | sampled, the Russian-refugee stamps, 6.5% of the stamp crop; 6.2 on the sheet, and it never sits on the card (4.3 there) |
| second ink | `#443C04` | sampled, the Armenian-refugee stamps' olive; 5.7 on the card |

Two values need writing down now. The ground's hue (30)
is inside the register's amber band and the stamp blue (218) is inside its
cobalt band. Both are **sampled**, at the proportions above, and neither
is the default the band was written for — the band catches terracotta
*accents* on near-white, and this is a 69% card with a blue *stamp*. The
audit will flag them on every run and this paragraph is the answer, unless
the maintainer prefers the olive as the stamp ink, which is also sampled.

**Type.** The cover argues for itself: condensed grotesque capitals for
titles, a true italic for the page headings, a geometric sans on the
stamps, letterspaced small caps for field labels. Candidates for the type
pass: Archivo Narrow / Archivo for the first two, Jost for the stamps.

**Layout concept.** A run is a passport: the header is the cover (slug in
condensed caps, the source as the corner band), and each pending decision
is a numbered page with its question in italic and its instruction line,
empty until the stamp goes on.

**What it would feel like to use.** The Decide surface is a page that says
*G2 — Does the evidence support merging?* in italic with the packet listed
beneath, and approving affixes a white block reading `G2 · APPROVED · 2026-
09-04 · <name>` in the blue, perforated edge and all. The History register
is the run's back pages: stamps in the order they were affixed. The artifact
reader is a white sheet on the card, which is what keeps the 69% ground
from being read for an hour.

**Honesty flag.**
> The warm ground, yes — I would have reached for warm. But not *this* warm:
> 69% with saturation 46 is not the cream cluster and reads as card, not as
> "clean". The blue accent, yes — cobalt is the third default; here it is the
> one ink the stamps were printed in and it lives only on the stamp. The
> italic display heading is a Stripe-era reflex and it is also the seed's own
> convention; it stays, and it is the one place italic appears.

**What it costs.** A dark warm ground is the boldest move available and the
easiest to tire of; every chip and every rule has to be re-measured against
the new 69% ground, and most of what shipped will not survive that. The
white reading sheet on card is a two-surface system, so anything that
straddles both (the lexicon hover card, the packet chips) is designed
twice. And it gives the public README a look that is unmistakable, which is
either the point or the problem.

---

## For the human

- Killing all three is a valid outcome and means the seeds were wrong.
- Mix structure: A1's page with B's "decision as an affixed
  object" is a legitimate mix; A2's stamp colours on B's card is not.
- The question to ask of each: *could a competitor ship this?*

---

## History

### Round 1 — the instrument panel (2026-07, retired)

Cold near-black ground `#0A0E11`, mono readouts, keyboard-first. Retired by
the gate-redesign brief, which reframed the product as a reading environment.

### Round 2 — Candidate A, warm paper (2026-07-25, retired)

`runs/gate-redesign/` (PR #197): warm paper `#FAF7F1`, terracotta
`#A04423`, Inter chrome, Newsreader reading body, JetBrains Mono, Primer
tinted chips, gate sigil. Reference board: Stripe, Primer, Raycast, Vercel,
Linear, Sentry. Judged against the seeded-design register on 2026-09-04: it lands in the
Anthropic cream-and-terracotta cluster almost exactly, with a ground shared
to within a few units by the maintainer's other two products. The run record
is historical and is not edited; this document supersedes its rationale.

### Round 3 — the impression (2026-09-04, structure kept; palette retired)

PR #357, the seeded pass: hue-60 paper `#F3F3EE`, one slate ink `#2C343C`,
the ledger's dusty red `#A46C6C` as both position and warning, `ok` and
`info` collapsed into the ink. It gave the cockpit its structure — one
surface, rules not cards, no elevation, status as texture — and that
structure stands. Its palette was recorded as provisional at the build and
read, at full-page scale, as nearly black and white; the maintainer
rejected the seeded process on 2026-09-18. Retired by round 4.

### Round 4 — the site's direction (2026-09-25, shipping)

The public site's palette and grammar (PR #392) carried into the cockpit:
white ground, ink, one signal blue, approved green, declined red, the
yellow for a human's attention, hairlines and the 3px band. See *What
round 4 changed* at the top.

### Round 5 — colour carries state (2026-09-26, shipping)

Round 4's palette and grammar, unchanged, with colour on the impression now
carrying health and the one ready decision (#419). See *Round 5* at the top.
