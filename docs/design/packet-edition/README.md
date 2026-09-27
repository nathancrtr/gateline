# The packet-edition sketch

A static page showing how Gatehouse could set a G0 decision packet as an
annotated edition. The G0 packet is the page an approver reads before approving
a spec at gate G0. The direction and the maintainer's decisions are in
[epic #516](https://github.com/nathancrtr/gateline/issues/516).

The sketch is a reference for layout and type. It is not a component to import,
and nothing under `packages/` reads it. The issues under #516 build the design
into Gatehouse.

The record's words on the page are real. `build.py` copies them from a run's
spec and intent brief, so none of them is typed by hand. Everything else is
sketch text written for the page: the navigation, the run header with its cost
and inbox count, the gate bar, and the captions.

## The source text

`data/spec.md` and `data/intent-brief.md` are `runs/criterion-check/spec.md`
and `runs/criterion-check/intent-brief.md` on the branch `run/criterion-check`,
read at commit `32f60ed6fb60690ca599aef74fabdc766fee5a65`. `data/COMMIT` holds
the short hash, and the page prints it at the end of the packet.

## Rebuild the page and check it

From this folder:

```bash
python3 build.py     # writes index.html from template.html and data/
open index.html      # or open it in any browser
node verify.mjs      # compares the page with data/; exits 1 on any mismatch
```

`build.py` needs only Python 3. The page loads its fonts from
`packages/web/public/fonts/` by relative path, so open it from inside a checkout.
`index.html` is not committed.

`verify.mjs` and `capture.mjs` load Playwright from the repository's `packages/`
workspace. Run `npm install` in `packages/` once, and `npx playwright install
chromium` there if Chromium is not already installed.

`verify.mjs` opens the page in Chromium, opens every fold, and compares each
assumption, criterion, requirement heading and prose passage with the source
lines its address names. It compares the brief's code block line for line. The
brief is on the page twice, in the pinned pane and in sequence, and both copies
are checked. The comparison ignores whitespace, list markers, `**` and
backticks, because the page renders those. It does not check the sketch's own
text.

## The sketch controls

A bar along the bottom of the page switches between options. It is not part of
the design. Each control sets an attribute on `<body>`, and each default is the
maintainer's decision in #516.

| Control | Default | Other options |
|---|---|---|
| The record's labels | reading size, as written: 16px, in ink, hung in one column, with the author's bold kept | small and muted: 13px grey, as the first pass set them |
| "G0 to confirm" | marked in margin: a rule beside the item and "to confirm" under its line number, with the phrase in plain weight | weight: the phrase in semibold. both: the mark and the weight |
| Criteria | closed | open |
| Brief | pinned pane | in sequence, after the spec |

The pinned pane needs a content area at least 1112px wide, which is a window of
about 1376px. In a narrower window the brief follows the spec whatever the
control says, and the gate bar carries an "Intent brief" link to it.

## The captures

`node capture.mjs` retakes them from the built page in Chromium, at a device
scale factor of 1.

| File | Window | Shows |
|---|---|---|
| `phone-390.png` | 390 × 844 | The top of the page on a phone |
| `phone-390-assumption.png` | 390 × 844 | An assumption on a phone, its labels above their text |
| `laptop-1280.png` | 1280 × 800 | A laptop window, too narrow for the pane |
| `laptop-1280-brief.png` | 1280 × 800 | The brief in sequence after the spec |
| `after-1440.png` | 1440 × 900 | The brief as a pinned pane beside the column |
| `roster-open-1440.png` | 1440 × 900 | A requirement opened, with its criteria |
| `wide-1920.png` | 1920 × 1080 | A wide window, with the page at its 1600px cap |
| `before-first-pass-1440.png` | 1440 × 900 | The first pass, as the second round of reviews saw it |

The first-pass page is not in the repository. Compare `before-first-pass-1440.png`
with `after-1440.png` to see what the second pass changed.
`node capture.mjs --before <page>` retakes that capture from a copy of it.

## The reviews

[`REVIEWS.md`](REVIEWS.md) condenses five reviews: three of the G0 packet as
Gatehouse shows it today, then two of the first sketch. Every reviewer was a
model agent, and none of it was tested on a human reader.

## Limits

- Only Chromium was tested. Line breaks differ in Safari and Firefox.
- Print is deferred. The page opens every fold when printed, and nothing more
  is specified.
- The sample text was kind to the layout. The stress cases it did not meet are
  listed in [#522](https://github.com/nathancrtr/gateline/issues/522).
