# Specification: A criterion's check is shown apart from its promise

## Context

Gatehouse and the terminal quote each acceptance criterion as one run of text, although the spec now writes its two parts on separate lines. The intent brief describes the cause. This section adds what the repository shows.

A criterion's promise is the plain sentence the approver agrees to. Its check is the indented line beneath, labelled `Check:`, that tells the verifier how to observe the promise. The lexicon is the one piece of code that reads requirement, criterion and decision ids out of a run's spec and plan and hands every view their text.

Reading the repository turned up three facts the brief does not state:

- The brief's "lexicon index" is the folded list of cited ids at the top of each artifact in the Record reader, Gatehouse's page that shows an artifact whole. No other surface lists lexicon entries.
- No spec from a finished run has a check line yet. This run's own spec is the first.
- Two views cut each quoted id to one line: that cited-ids list and the terminal footnotes. A check cannot take a line of its own there, which the first assumption settles.

## Requirements

### R1 — The lexicon hands every view a criterion's promise and check apart
Each criterion the lexicon reads carries its promise and, when the spec gives one, its check, both in the spec's own words. The brief's port example, the two-line criterion quoted in its Problem section, is the reference case. What starts a check, and whether the check keeps its label, are settled in the assumptions.
**Acceptance criteria:**
- [ ] AC1.1 — Given the brief's port example, the lexicon's promise reads `The snapshot generator never opens a network port.`
- [ ] AC1.2 — Given the brief's port example, the lexicon's check reads `Check: its script contains neither port-binding call the server makes.`
- [ ] AC1.3 — The lexicon's promise keeps every line of a promise that wraps.
  Check: a unit test with a two-line promise finds its second line ending the promise.
- [ ] AC1.4 — The lexicon's check keeps every line of a check that wraps.
  Check: a unit test on the spec contract's own example finds its third line ending the check.
- [ ] AC1.5 — The words `Check:` inside a criterion's first line do not start a check.
  Check: a unit test on a one-line criterion containing them finds no check.
- [ ] AC1.6 — A criterion's second line starting with lower-case `check:` stays part of the promise.
  Check: a unit test finds that line's words ending the promise.

### R2 — A criterion without a check reads exactly as it did before
Everything that read a criterion before this change keeps working unchanged. A criterion's full text, the single run of words every view quotes today, stays available as it is. The earlier runs' specs, meaning the specs of every run finished before this one, contain no check line and must read as they always have. The lexicon stays a leaf, a module that imports nothing and reports nothing, so the browser can receive its output as plain data.
**Acceptance criteria:**
- [ ] AC2.1 — The lexicon's full text of the brief's port example still joins its two lines, as today.
  Check: a unit test asserts the promise line, one space, then the check line.
- [ ] AC2.2 — In the earlier runs' specs, each criterion's promise equals its full text.
  Check: a unit test over those specs.
- [ ] AC2.3 — In the earlier runs' specs, no criterion has a check.
  Check: a unit test over those specs.
- [ ] AC2.4 — The lexicon still imports nothing.
  Check: the existing test that fails on any import in the lexicon passes unmodified.

### R3 — The G2 card shows a criterion's check on a line of its own
The G2 card is where the approver weighs evidence one criterion at a time, with the criterion quoted above its evidence. It must show the promise and then the check starting on a new line, in the spec's words, with the label as written.
**Acceptance criteria:**
- [ ] AC3.1 — On the G2 card, a criterion's check starts on a new line below its promise.
  Check: in a browser, the check's `Check:` label is the first text on its line.
- [ ] AC3.2 — On the G2 card, a criterion with a check reads word for word as the spec writes it.
  Check: a browser test finds the card's quotation equals the spec's, whitespace collapsed.
- [ ] AC3.3 — On the G2 card, a criterion without a check looks as it does today.
  Check: its 1280-pixel screenshot matches one taken before the change.

### R4 — A criterion id's hover card shows the check on a line of its own
Hovering or focusing a criterion id anywhere in Gatehouse opens a small card quoting that criterion. The card must show the promise and then the check starting on a new line, in the spec's words.
**Acceptance criteria:**
- [ ] AC4.1 — In a criterion id's hover card, the check starts on a new line below the promise.
  Check: in a browser, the check's `Check:` label is the first text on its line.
- [ ] AC4.2 — A criterion id's hover card quotes a checked criterion word for word as the spec writes it.
  Check: a browser test finds the card's quotation equals the spec's, whitespace collapsed.
- [ ] AC4.3 — A hover card for a criterion without a check looks as it does today.
  Check: its 1280-pixel screenshot matches one taken before the change.

### R5 — The Record reader shows a spec criterion's check on a line of its own
Reading a spec in the Record reader, a criterion's check line must start a new line, as it does in the file. Nothing else the reader renders changes.
**Acceptance criteria:**
- [ ] AC5.1 — In the Record reader, a spec criterion's check starts on a new line below its promise.
  Check: in a browser, the check's `Check:` label is the first text on its line.
- [ ] AC5.2 — The Record reader renders a spec with no check lines exactly as before.
  Check: the rendered markup of the dupefind spec is identical before and after the change.
- [ ] AC5.3 — In the Record reader, a line starting `Check:` outside a spec criterion renders as it does today.
  Check: a render test of a plan paragraph containing one matches its pre-change output.

### R6 — The cited-ids list quotes a criterion's promise without its check
Each artifact in the Record reader opens with a folded list of the ids it cites, one line per id. A criterion's entry there shows its promise alone. The check stays one click away, at the definition the entry links to.
**Acceptance criteria:**
- [ ] AC6.1 — In an artifact's cited-ids list, a checked criterion's entry shows none of its check.
  Check: in a browser, the entry's text lacks `Check:`, the check's label.
- [ ] AC6.2 — In the cited-ids list, a criterion without a check shows the same text as today.
  Check: a browser test finds the entry's text equals the criterion's full text.

### R7 — Terminal footnotes never run a check into its promise
The terminal command that prints an artifact ends with footnotes quoting each id the artifact cites. Its default mode prints one line per id and quotes a checked criterion's promise alone. Its full mode prints the check on the next line.
**Acceptance criteria:**
- [ ] AC7.1 — `gateline show <slug> plan.md` footnotes a checked criterion with its promise alone.
  Check: the footnote line lacks `Check:`, the check's label.
- [ ] AC7.2 — With `--refs full`, a checked criterion's check prints on the line after its promise.
  Check: a CLI test finds `Check:`, the check's label, opening that line.
- [ ] AC7.3 — In the default footnote mode, a criterion without a check prints as before the change.
  Check: footnotes for the dupefind verification report are byte-identical before and after.
- [ ] AC7.4 — With `--refs full`, a criterion without a check prints as before the change.
  Check: footnotes for the dupefind verification report are byte-identical before and after.

### R8 — Screenshots and failing tests show the change working
The change is accepted on browser evidence and on tests shown able to fail. The demo repository, the sample record Gatehouse generates when started with `--demo`, must offer both criterion shapes. The verification report carries one screenshot per combination of these:

- each of three views: the G2 card, the hover card and the Record reader
- each of two criterion shapes: one with a check and one without
- each of two widths: 320 pixels and 1280 pixels

**Acceptance criteria:**
- [ ] AC8.1 — In the demo repository, the run awaiting G2 shows one criterion with a check and one without.
  Check: run `gateline ui --demo` and open that run's G2 card.
- [ ] AC8.2 — The verification report carries all six screenshots the list above calls for at a 320-pixel width.
- [ ] AC8.3 — The verification report carries all six screenshots the list above calls for at a 1280-pixel width.
- [ ] AC8.4 — At a 320-pixel width, no check runs past the edge of the card or pane holding it.
  Check: the 320-pixel screenshots show each check's last word inside its container.
- [ ] AC8.5 — Each new test of new behaviour fails against the code before the change.
  Check: the verification report shows its failing output on the pre-change commit.
- [ ] AC8.6 — Each new test guarding unchanged behaviour fails when the code it guards is deliberately broken.
  Check: the verification report shows that failure, then the test passing once restored.

### R9 — The framework's rules, validator and orchestrator stay untouched
This run changes how criteria are shown and nothing that governs how they are written or accepted. The protected set is these files:

- the contracts and role specs
- the rendered agent files
- the artifact validator, which decides what the engine accepts and bounces
- the orchestrator
- every other run's record

The demo fixtures may change only as far as the screenshots in the verification requirement (R8) need.
**Acceptance criteria:**
- [ ] AC9.1 — The change edits no file in the protected set above.
  Check: `git diff --name-only main...HEAD` lists no path in it.
- [ ] AC9.2 — Only one spec template in the demo fixtures changes.
  Check: the diff of the fixture generator changes lines inside one spec template only.
- [ ] AC9.3 — The changed fixture spec differs only in its criteria.
  Check: every changed line of it lies in an acceptance-criteria list.

## Assumptions

- **ASSUMPTION:** G0 to confirm: the brief says a view never shortens a promise or a check, but two views already cut every quoted id to one line.\
  Resolved as: the cited-ids list and the default terminal footnotes show the promise alone, still cut to one line as today. The check stays one click away in the list and behind `--refs full` in the terminal.\
  Because: a check on its own line would double every entry in a one-line view, and running it into the promise is the defect this run removes.\
  Basis: verified in the code for both views, which collapse whitespace and cut each entry to one line today.
- **ASSUMPTION:** G0 to confirm: the brief asks that each new test fail against the code before the change, which a test guarding unchanged behaviour cannot do.\
  Resolved as: a test of new behaviour fails against the pre-change code. A test guarding unchanged behaviour fails against a deliberate break of the code it guards.\
  Because: both prove the test can fail, which is what the brief's rule is for.\
  Basis: derived from the brief's constraints, several of which require unchanged behaviour.
- **ASSUMPTION:** The brief's "lexicon index" names no surface by that name.\
  Resolved as: it is the folded cited-ids list at the top of each artifact in the Record reader.\
  Because: that list is the only view that lists lexicon entries one per line.\
  Basis: verified by searching the web package for every use of lexicon entries.
- **ASSUMPTION:** The brief lets a view put the check on its own line or behind a fold.\
  Resolved as: the G2 card, the hover card and the Record reader show the check on its own line, unfolded.\
  Because: on the G2 card the evidence below the criterion is the check's result, and a fold inside a hover card adds a control to a surface read at a glance.\
  Basis: derived from the brief and from how both cards lay out a criterion today.
- **ASSUMPTION:** The brief does not say which lines start a check or where it ends.\
  Resolved as: a check starts at the first line after the criterion's first whose text begins `Check:`, with a capital C. It runs to the end of the criterion.\
  Because: the spec contract labels the check that way and wraps its own example check onto a third line.\
  Basis: verified against the spec contract's rules and its example criterion.
- **ASSUMPTION:** The brief says the label belongs to the artifact but not whether the lexicon's check includes it.\
  Resolved as: the check the lexicon returns begins with its `Check:` label.\
  Because: every view then shows the label from the artifact's own bytes rather than supplying a copy.\
  Basis: derived from the brief's quotation constraint.
- **ASSUMPTION:** The brief asks for a phone width and a desktop width without numbers.\
  Resolved as: 320 pixels and 1280 pixels.\
  Because: 320 is the narrowest width the repository's recent layout fixes target, and 1280 is the width its browser tests pin.\
  Basis: verified in the browser test suite and in the layout notes of the G1 card's code.
- **ASSUMPTION:** The brief's "render check" could be read as the CI job that checks rendered agent files.\
  Resolved as: it means the browser verification, which needs a demo run showing both criterion shapes.\
  Because: that CI job renders role specs and reads no fixture.\
  Basis: derived from the repository's guidance describing the job.

## Out of scope

- Letting the lexicon accept a trailing backslash inside a criterion, which would unify the contract's two conventions (brief, Out of scope).
- The other elements the prose epic added: summary lines, the fix bullet, the not-verified line and the paragraph naming what G1 must decide (#469, #470).
- The evidence rollup's defects in reading a verification report (#467).
- Reporting criteria that nearly match the grammar, which landed in #488.
- Rewriting the demo fixtures' artifacts beyond the one spec R8 needs (#490).
- Any change to how requirements or decisions are quoted, or to the G0 and G1 cards, neither of which quotes a criterion's text today.
- Restyling the cards beyond placing the check, such as colouring or labelling it differently from the artifact.
- Requiring or validating that a criterion has a check, or showing checks in the run's pull request description.
- Editing any finished run's record, including adding check lines to its spec.
