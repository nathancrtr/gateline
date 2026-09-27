# Intent Brief: A criterion's check is shown apart from its promise

<!-- Drafted from issue #491 (background session, 2026-09-26) at Nathan
     Carter's direction; staging is the draft act — arming is the human
     confirmation. Source survey: the #491 issue body and the parser findings
     recorded in #481 and #486. -->

## Profile

standard

## Problem

An acceptance criterion now has two parts, and Gatehouse shows them as one run
of text.

Since #486 the spec contract asks for a criterion on two lines. The first
states the promise in plain words. The second, indented and labelled `Check:`,
says how the verifier will observe it:

```
- [ ] AC1.1 — The snapshot generator never opens a network port.
  Check: its script contains neither port-binding call the server makes.
```

The lexicon, which is the one reader of the criterion grammar, joins a
criterion's lines with spaces. Its body for the example reads "The snapshot
generator never opens a network port. Check: its script contains…". Every view
that shows a criterion quotes that body:

- the G2 card, above each criterion's evidence
- the hover card on a criterion id
- the lexicon index
- `gateline show`, in its footnotes

The Record reader renders the spec itself, where the second line is a soft
break, so it shows one paragraph too.

Assumptions had the same problem and solved it in the contract with a trailing
backslash, which markdown renders as a line break. A criterion cannot use it.
The lexicon keeps the backslash as text, and the G2 card would show
"port.\ Check:". The contract forbids it for that reason, so one contract now
carries two conventions.

The GitHub issue tracking this is #491.

## Motivation

The promise is what the approver agrees to at G0 and checks evidence against at
G2. The check is for the verifier. Separating them was the point of #474, and
today the separation exists in the file and nowhere on screen.

This run is also a measurement. It is the first run written under the prose
rules that epic #471 added to the contracts and role specs. Its spec, plan,
reviews, verification report and implementer notes will be measured against
the figures the epic records, to learn whether the rules change what agents
write. The change was chosen because it is small and produces every kind of
artifact the rules cover.

## Constraints

- **The lexicon stays a leaf.** It imports nothing and reports nothing. It
  reads the grammar and returns entries.
- **Nothing that reads a criterion's body today breaks.** The body stays
  available as it is now. The promise and the check are added beside it.
- **A spec written before #486 reads exactly as it does today.** A criterion
  with no `Check:` line has a promise and no check. Finished runs are
  historical records and are not edited.
- **Quotation only.** A view shows the promise and the check in the
  artifact's own words. It may place them on separate lines or put the check
  behind a fold. It never rewords, shortens or relabels either one. The
  `Check:` label is the artifact's and is shown as written.
- **The criterion grammar in the contract does not change.** Nothing under
  `contracts/` or `roles/` is edited, and no rendered agent file changes.
- **Validation and the orchestrator are untouched.** What the engine accepts
  and bounces stays as it is.
- **Fixture changes are the minimum the render check needs.** One fixture
  spec may gain criteria in the new shape. Rewriting the fixture's artifacts
  more widely is #490.
- **Verified in a browser.** The G2 card, the hover card and the Record
  reader are checked at a phone width and a desktop width, with screenshots,
  for a criterion with a check and one without.
- **Tests must be able to fail.** Each new test is shown failing against the
  code as it stands before the change.

## Out of scope

- Whether the lexicon accepts a trailing backslash inside a criterion. That
  would let the contract's two conventions become one, and it changes what
  the contract may say, so it is a separate decision.
- Showing the other elements the prose epic added: the summary lines, the fix
  bullet, the not-verified line, the paragraph naming what G1 must decide.
  Those are #469 and #470.
- The defects in how the evidence rollup reads a verification report (#467).
- Reporting a criterion that nearly matches the grammar. That landed in #488.
