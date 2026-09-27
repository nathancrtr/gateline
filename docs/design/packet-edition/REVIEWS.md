# Reviews of the packet sketch

Two rounds of review, condensed from the reviewers' reports. Every reviewer was a
model agent working independently. None of this was tested on a human reader.

## Round 1, before the sketch: three reviews of today's G0 packet

A reading researcher, an interface designer and an art director each reviewed the
G0 packet as Gatehouse renders it today. They reached the same direction without
seeing each other's work.

**The root cause they named.** `docs/SEAM.md` marks the record's words with a
hairline box at "card scale". That assumes a quotation is the exception on a
page. On a packet the record is about nineteen words in twenty.

**What they agreed on.**

- The record is the body text: the reading face at 16px on a 26px line, in one
  column at a readable line length.
- Everything else is at the edge: addresses in a margin, captions small, the
  question and the decision pinned.
- Structure the contract defines is shown as structure. Labels hang in an
  aligned column, and are the record's own words.
- The brief is reference text. It is pinned beside the column or read in
  sequence. It is never a squeezed parallel column.
- One text style for the record, shared by packets and the Record reader.
- Precedents: Hansard, annotated statutes, court briefs, scholarly sidenotes.

**What they said to keep.** The verbatim rule and the four voices. Assumptions
leading. The requirement roster. The phase spine. Folding decided by the
contract. No radius or shadow. Colour reserved for gate state. The typefaces and
the palette.

**Where they disagreed.**

| Question | One view | The other |
|---|---|---|
| Number items in the margin | Helps scanning | "Assumption 3" is an id the record lacks |
| Address form | Line number under a named head | Full `spec.md:132` |
| Emphasis on "G0 to confirm" | Grouping only | Also the caution ink |
| Brief or assumptions first | Assumptions, what G0 vetoes | Brief, since an assumption cannot be judged without it |

**Evidence the researcher cited, with its own caveats.** Line length of 55
characters gave better comprehension than 100 (Dyson and Haselgrove 2001,
abstract only). Comprehension was lower at 10 and 12 point than at larger sizes
(Rello, Pielot and Marcos 2016, a general population reading Wikipedia). People
over-rely on automated output under load (Goddard and colleagues 2012). The
researcher marked its application of each to this reader as inference.

**Also found in the code.** A closed fold's text is absent from the page, so
find-in-page and print miss it. There are no print styles. Fifteen type sizes
are in use.

## Round 2, of the first sketch: two adversarial visual reviews

Both reviewers drove the page in Chromium with Playwright and cited captures.
Their scripts and captures were not kept in the repository.
This summary is the record.

### The cold reviewer

Told nothing about the product or the design, and forbidden from reading source
or documentation.

**First impression, unedited.** "An approval screen inside a tool called
Gatehouse… It reads like a typeset audit document, not a dashboard. I do not
know what G0 is, what 'packet' or 'the record' are, or who wrote the left
column. I do not know whether to read left or right first."

**What it could not work out.** Whether approving accepts all eight assumptions
or only the two flagged. That "G0" is the approver. What "the record" is. That
the margin addresses are links. That `verified` and `derived` are a fixed pair.

| # | Kind | Finding |
|---|---|---|
| B1 | Broken | The brief pane disappears between 1600 and 1617px wide, and below 1410px |
| B2 | Broken | With the pane gone, a left-aligned column sits beside 370 to 700px of empty page, and the brief moves to after the spec |
| B3 | Broken | The position readout names what is cut off under the bar, not what is in view |
| B4 | Broken | The pane is taller than the space it has at the top of the page |
| B5 | Broken | The brief's only code example is clipped, with no sign it scrolls |
| B6 | Broken | Print leaves folds closed |
| R1 | Harms reading | Four left edges in one column |
| R2 | Harms reading | "G0 to confirm" reads as "GO to confirm": the body face has no slashed zero |
| R3 | Harms reading | The two items needing a decision differ from the other six only by a bold lead-in and a small subheading |
| R5 | Harms reading | Four labels repeated eight times cost more than they give on short items |
| R7 | Harms reading | The pane loses its title and rule as soon as it scrolls |
| T1 | Harms trust | Straight quotes and apostrophes throughout |
| T3 | Harms trust | Bar baselines differ by 3px |
| T4 | Harms trust | At wide screens the header is full width and the content is not |

**The squint test.** Loudest: the Approve button, the two yellow G0 marks, the
two heavy rules. The two flagged items were indistinguishable from the other
six.

**What it said to leave alone.** The question as the headline. The page's own
small voice. The grouping idea. Body size, line height and line length. The
requirement rows. One accent colour. The end mark with the commit.

**Advice that collides with the verbatim rule.** Curly quotes, consistent
capital letters, and dropping the `ASSUMPTION:` label would each alter the
record's bytes. They were not taken.

### The expert reviewer

Told the verbatim rule, the four voices, the maintainer's preferences and his
decisions.

**Verdict.** "Not yet good enough to build from, though the structure is the
right one and it is clearly better than today's boxed packet."

**The decisive finding.** The record's own labels were set at 13px in muted
grey, which is exactly how the page set the cockpit's captions. Only the face
differed, and two plain sans faces at 13px are not told apart. The record's
labels read as the cockpit's field labels.

| # | Kind | Finding | Its fix |
|---|---|---|---|
| F1 | Harms trust | The record's labels wear the cockpit's caption style | Labels at reading size, in ink, still hung. 16px reading face is the record; 13px UI face is the cockpit. Keep the author's bold. |
| F2 | Broken | The margin was sized for `spec.md`. `intent-brief.md:86` does not fit | Line numbers in the margin; the file named once in the section head |
| F3 | Broken | A long path or URL escapes the column and prints over the pane | Long tokens break |
| F4 | Harms trust | Inline code laid out as a block invents line breaks the record lacks | Inline code flows inline |
| F5 | Harms reading | No pane and no link to the brief across common laptop widths | Decide the narrow layout on purpose; always show the link when the pane is absent |
| F6 | Harms reading | The brief's Constraints are never visible without scrolling the pane | A fixed index at the pane's top |
| F7 | Harms reading | Three hanging systems, six left edges | One label column and one text edge for the packet |
| F8 | Broken under stress | The label column was sized for "Resolved as:" | Size from the longest label up to a cap |
| F9 | Harms trust | A second yellow on the bar's stamp, against the design notes | The stamp in ink |
| F10 | Harms trust | "Choices the spec states" characterises the items | Name the grouping key only |
| F11 | Harms reading | A requirement's name and statement are set identically | The name in the author's heading weight |
| F12 | Needs a decision | Criteria closed by default against the seam document's fold rule | The maintainer chose closed |
| F13 | Broken | Browser-default focus, no hover | The product's yellow ring; hover on rows and buttons |
| F14 | Broken | Print gets the phone layout with folds closed | Deferred by the maintainer, except that folds open |
| F15 | Harms trust | An empty Assumptions section says nothing | Say so, in the cockpit's voice |

**On the semibold.** "G0 to confirm:" in semibold computed to the same style as
the author's own bold in the brief. The reviewer recommended plain weight and a
mark from the margin, which is the cockpit's position.

**Measurements it took at 1728px.** Type sizes in use: 11.5, 12, 13, 14, 15,
16, 18, 20px. Line length: main column median 80 characters, pane 62. Left
edges: 356, 376, 404, 436, 456, 476. Contrast: every text colour passes 4.5 to 1,
with muted grey on white at 7.65.

**What the sample text was kind about.** Both confirm items were already first
in the file. No assumption contained a path. Every label was 12 characters or
fewer. No requirement name wrapped. The brief had no table.

**Stress cases that broke the first sketch.** A long label. A long path. Long
inline code. Any address other than `spec.md`. A table, block quote or heading
in the brief. An empty section.

## What the second pass did

Every finding above marked broken, and F1 to F11, F13 and F15, are addressed in
the page `build.py` writes. The first pass is not kept as a page. The pair
`captures/before-first-pass-1440.png` and `captures/after-1440.png` shows the
same screen before and after.

Not addressed: print beyond opening folds; the stress cases, which are listed in
issue #522 for the real build; any browser other than Chromium.
