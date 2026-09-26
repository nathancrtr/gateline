# The seam: the record on disk and the record on screen

How Gatehouse turns a git-committed run record into a web UI without changing a
word of it. This is the rule the three fixes of 2026-09-25 (#401, #403, #407)
should have been able to follow, written down so the fourth surface is not
another ad hoc one. It refines FRONTEND.md §4 (the principles), §4.7 (the
verbatim rule in code) and §4.8–4.10 (the three fixes), and the type rules in
`packages/web/DESIGN.md`. The companion epic is #411.

**Status (2026-09-26): proposed.** Written from three inputs — an inventory of
every surface in the web UI, a task analysis of who reads the record and for
what, and a design pass on the representation vocabulary and the layering —
and one cheap factual check. The decisions in §8 are the maintainer's to
confirm; the order of work in §9 assumes they hold.

## 1. The problem, and its cause

Gatehouse is a pure view over the record. That is what makes it trustworthy:
what you see is what was signed. The standing rule from #261 says a view may
reorder, group, fold, badge and diff, but every word shown comes byte-identical
from the committed artifact, nothing is summarised, and every word stays
reachable.

The UI has repeatedly defaulted to showing the *bytes on disk* where the reader
needed a *view of the concept* the bytes encode. The Record rail listed
`tasks/06-pages-workflow.yaml` where the reader wanted the work item (#401). The
G3 card offered a `release-plan.md` chip where the approver wanted the rollback
facts (#403). The escalation card showed `reviewer escalated task X — see
review-04.md` where the resolver wanted the reviewer's own words (#407). Each
fix was right and each was built without the parts the others had already
built: three field-row components, two folds, four withheld shapes, five copies
of the same artifact link, and task ids set in two typefaces.

The cause is not laziness and not the rule. It is that **the rule has no
stated scope.** It was written about the record's *content* — the words agents
and humans wrote at gates — and has been applied by default to the record's
*addressing* (where bytes live), its *machinery* (an engine's reason string, a
contract's filename, a YAML key) and its *container names* (a file, a section).
Under that reading, printing a path is the honest move and any label is a step
toward paraphrase. §4.8 having to argue that "labelling `spec.md` 'Spec' is a
view, not a paraphrase" is the symptom.

The mechanism in code follows from that. The record layer hands the view paths
and validations, nothing more: `artifacts: string[]`, `validations` keyed by
path, `InboxItem.packet: string[]`. What a file *is* exists only as regexes at
five leaves, re-derived by whoever needs it. Typed packets exist only where
someone built one, so where none does, the view holds a path, a validation and
a sentence core wrote for a different surface, and the rule tells it that
printing those is honest. The heuristic `restatesWhatIsShown` exists because
the card has to defend itself against a sentence it did not write.

## 2. The rule, scoped

Every string the cockpit renders is spoken in one of four voices, and the
reader must be able to tell which without a legend:

- **The record's voice** — what an agent or a human wrote: a spec's
  requirement, a finding, an option, a verdict word, a gate note. *Quoted.*
  Byte-identical, attributed to its speaker, rendered as the markup it was
  written in, reachable at its line.
- **The framework's voice** — the closed vocabulary that gives the record its
  shape: gate names, kinds of artifact, contract names, phases, profiles.
  *Named.* The framework knows what a file is; the UI says so in its own
  typeface.
- **The machine's voice** — git and the engine talking about the record: a
  commit subject, an engine verb, a parser's diagnostic, a path, an oid.
  *Cited or labelled.* Shown as what it is, never dressed as the record's word
  about the run, never standing alone.
- **The cockpit's voice** — instructions, captions, questions, form hints.
  *Marked.* Never in the record's register, never composed in core, never
  quoting the record as if the UI had said it.

The verbatim rule governs the first voice absolutely. It does not oblige the UI
to print the second, third or fourth as bytes. Two corollaries carry most of
the weight:

- **A filename is never a label.** A file's name is where its bytes live. The
  thing the reader is choosing between, deciding on, or citing is the artifact
  the framework knows it to be, and it is named by kind and by the id the
  record uses everywhere.
- **An address never stands alone.** The path, the commit, the line are
  provenance and the verification hook, and they are always reachable. They
  follow a name or a UI word, in the code face, muted, copyable in one gesture.
  An address alone reads as unfinished; an address after a name reads as
  provenance.

## 3. Who reads the record, and for what

The representation follows the task, not taste. Four readers, four questions:

| Reader | Question | Must see first | Must be able to reach | Must be able to verify is unaltered |
|---|---|---|---|---|
| Gate approver (G0–G3) | The gate's question, under time pressure | The substance that answers it: the vetoable, the uncovered, the uncited, the undoable | Every artifact whole; the source line of every quoted slice | Every token the record uses, as spelled |
| Escalation resolver | What is stuck, and which route unblocks it | The escalating role's own words and the routes as it framed them | The report, its verdict on the diff, its standing findings | That the options are the role's, unranked |
| Record reader (later, perhaps years on, perhaps not the approver) | What was decided, by whom, on what evidence, and did the evidence say what the approver believed | The decision ledger, the closure, who approved each gate and when | Every artifact whole, and the address of every byte | Everything: this is the reader the byte-identity rule exists for, the one who will diff the UI against `git show` |
| Operator (runs in flight) | Is anything stuck, spending, or waiting on me | Age, paused reasons, budget, who is in flight | The run page, the engine's ledger rows | Status truth: that "waiting on the reviewer" is derived, not guessed |

Two things fall out that the "bytes versus view" framing hides. **The address
is the record reader's need, not the approver's.** So "address on demand,
never hidden" follows from whose task it serves. And **the same field is
substance for one reader and a pointer for another.** An engine-originated
escalation's `reason` is the whole packet; a role-originated one's is a
pointer to a report. Kind is a property of the field *and* the reader's task.

## 4. Four classes of record element

The record as the contracts define it sorts into four classes, and each has
one rendering rule:

| Class | Elements | Rule |
|---|---|---|
| **Address** — a location you navigate to or paste | `runs/<slug>/<path>`; an oid; `run/<slug>`; a host URL; `file:line` in a finding's Where; `host:pid` | Always reachable; code face, muted; on demand on decision surfaces, in the open on the reader header and in History's raw mode |
| **Identifier** — the record's vocabulary | task ids; `R<n>`, `AC<n>.<m>`, `ADR-<n>`, `F<n>`, `E<k>`; `G0–G3`; phase and profile names; verdict, status, severity, burden and disposition words; ledger verbs | Verbatim, never translated (an English gloss of `request-changes` is a paraphrase of a grammar token); resolved in place where the lexicon can; one typeface everywhere |
| **Container** — a name for where substance lives | `spec.md`, `review-04.md`, `tasks/06-x.yaml`; the contract's filename; a YAML key; an H2 heading, except where the heading is grammar (`## Escalation` is a token the parser reads) | Named by kind in the UI face; the filename shown where the bytes are opened |
| **Substance** — the words being decided on | Paragraphs, table rows, list items, finding bodies, evidence blocks; a work item's `title:`, `scope:`, `notes:`; the engine's reason line when engine-originated; gate `notes:`; closure `reason:`; the resolver's disposition note | Verbatim, attributed to its speaker, rendered as the markup it was written in, at the surface's scale |

Two elements need saying twice. A reviewer's `Where:` is both an address and
the reviewer's own word, so it is quoted *and* code-faced. And `state.yaml` is
a container whose name is also the decision grammar's home; §8 records the
call on how the rail names it.

## 5. The vocabulary of representations

Eleven kinds of thing the UI renders, each with one representation. A reader
tells them apart by typeface, weight, colour and position, never by a legend.

| Kind | Voice | Right when | Must never | Signal |
|---|---|---|---|---|
| **Address** | machine | Locating the thing named beside it; provenance; something an operator pastes | Be the only name of a thing; lead a row; wear a chip border; be mid-truncated | Code face, muted (link blue only as a link); contains `/`, `:` or an extension; follows a Name or a UI word (`branch`, `read at`, `committed`) |
| **Name** | record | Naming a thing the reader will meet elsewhere on the page | Be paraphrased, reformatted, or set in the Address treatment | Code face, ink, semibold when leading a row; dotted underline when resolvable in place; never contains a slash or an extension |
| **Kind label** | framework | Captioning, grouping, attributing ("Verification states …") | Be minted per run; replace a record word that exists; be a filename | UI face, sentence case, ink |
| **Quoted word** | record | Stating a state the record states: a verdict, a status, a severity, a burden, `yes`/`no` | Be a synonym, a computed rollup, nested in another chip, tinted outside the gate-state quartet | The impression: bordered code face, texture per state; colour only where the quartet applies |
| **Quoted passage** | record | Putting the record's words on a card at card scale: a section body, a field value, a finding, an option, a step | Be truncated (fold instead); be rendered as `<pre>` when it is markdown; be reflowed into the view's own sentence; be attributed by filename | Reading face at card scale, inside a hairline box on the surface — the one boxed thing on the page — under a Kind or a Name |
| **Count** | framework | Sizing what is on the table; a ratio only where the record states the cap (`rounds 3/3`) | Become a percentage, a meter, a grade; take colour | UI face, tabular figures, adjoining its caption |
| **Fold** | framework | An audit-time section, or resolved history, reduced to heading and count | Hide a decide-time section; default-closed over what the gate asks about | One implementation: `▸`, the heading in the artifact's face, the count beside it, opens in place verbatim |
| **Link-out** | framework | A page the host owns: the branch, the PR | Be the only route; be shown when no target resolves | Link blue, `↗`, new tab; `↗` is reserved for this |
| **Withheld view** | framework | A packet half cannot be composed from the record's shape (the fork fallback) | Read as a fault; be silent; cite an issue number; link by filename | Caution field; a UI-face sentence naming the grammar looked for, the token in code face; one link, "Open the <kind>" |
| **Diagnostic** | machine | The machine's word is the fact: a YAML error with its caret, a commit subject, an engine verb | Be flowed as prose; be titled as the record's word about the run; lead a table cell | `<pre>` or code face, ink, under a UI-face label naming what produced it |
| **Instruction** | cockpit | What to do next, in the UI's own voice | Restate the record; quote it; be composed in core | UI face, unboxed, never in quotes |

Two consequences. The code face has two jobs, Address and Name, told apart by
colour, weight and shape: a Name is ink and never has a slash; an Address is
muted and always follows something. And the chip border belongs to Quoted
words alone: an id in a row is a Name, unbordered, which today's G1 coverage
tokens get wrong.

Three affordances are permitted because they never rephrase, and each carries
a trust condition. **Grouping** by a cite in the record, never by similarity.
**Reordering** by a record word or a record absence, with the key stated
("uncited lead"). **Tinting** by a record token through a fixed, inspectable
mapping; tinting by a *computed* condition is the view's opinion, defensible
only when the words beside it state the fact, and the colour must never carry
what the words do not.

## 6. What breaks trust

Paraphrase, including a friendlier verdict word. Summary: any sentence Gatehouse
composed *about* the record rather than *from* it. Computed verdicts: scores,
rollups, a recommended route. Hiding words with no path back. And, subtler,
**the cockpit's prose in the record's register**: a form hint or an instruction
a later reader could mistake for something the reviewer wrote. The Resolve
form's routes (`re-review`, `return-to-implement`, `re-plan`) are the engine's
vocabulary; the packet's options are the reviewer's; the record holds both,
and the reader must never confuse them. The "composed from the record" eyebrow
is today's marker for the cockpit's voice; it becomes universal.

## 7. The seam as layering

The rule becomes enforceable, not a convention, when each layer exposes exactly
what the next may render.

**The record layer** (`packages/core/src/record`) exposes bytes, contract
validations, and *the classification of an artifact*: one function,
`describeArtifact(path) → { kind, id, contract, family }`, replacing the five
regex sites that re-derive kind from a path today. The record layer says what
a file is; it says nothing about how it reads. A validation's contract stays a
filename here (it is one) and gains the contract's name beside it.

**The view-model layer** (`packages/core/src/view-model`) exposes typed
packets: one per gate, one per inbox item kind. Three rules for a packet:

- It carries **references, never bare paths**: `ArtifactRef { kind, id, path,
  contract }`, and for a quotation `{ text, at: { path, line } }`. A path never
  travels alone, so a component that wants to print a label has the kind and
  the id in hand and must *choose* to print the path.
- Its **withheld reasons are structured** — the grammar looked for, and the
  reference it looked in — and the sentence is composed in web. That removes
  issue numbers and `runs/<slug>/` from core strings for good.
- It states **facts, not sentences**. An inbox item's title and detail become
  the gate, its question, who it is waiting on, whether it is superseded, and
  what bounced it; the inbox row and the card each compose their own line.
  `restatesWhatIsShown` is deleted, not improved.

G0 has no packet, and that is wrong: it is the gate where the reader most needs
the concept view, the gate whose approval seeds every identifier downstream,
and the one section the spec contract writes *for* this approver (Assumptions:
"G0 can veto a stated choice, never a hidden one") is reachable only by opening
the spec whole. A G0 packet is the Assumptions list leading, the requirement
roster with each `R<n>`'s short name, the brief's Problem and Constraints
quoted beside them, Out of scope folded. Presence only: no brief-to-spec
coverage claim unless a contract grammar links them.

**The web layer** renders directly only its own voice — tabs, buttons,
captions, instructions — and the artifact body through the reader. Everything
else renders through the vocabulary components, fed from packet fields. Two
things it is forbidden: deriving a kind from a path, and printing a path
outside an Address.

**Where the rule lives.** In the wire types first (`ArtifactRef` on
`artifacts` and `packet`). In the layering test second: the existing boundary
test forbids path regexes in `packages/web/src`. In a DOM sweep third, in the
style of the geometry sweep: over the demo fixtures, no text node outside an
Address matches a filename or a run path. The third is what catches the next
ad hoc surface.

## 8. Decisions taken here

The three inputs disagreed, or reopened earlier calls, in six places. The
maintainer confirms or reverses each; the order of work in §9 assumes these.

1. **The verbatim rule's scope is the record's content.** Addresses are
   cited, framework vocabulary is named, machine output is labelled, the
   cockpit speaks marked. This is the whole document in one line.
2. **Task ids are Names and set in the code face everywhere.** #401 set them
   in the UI face in the rail while the task board, the diff group heads and
   every packet set them in mono. Consistency is the one signal a reader has
   for "this is a Name"; the rail follows the rest. This reverses a call made
   in #401.
3. **`state.yaml` is named by its kind in the rail, `Ledger`, with its filename
   as the Address in the reader header.** #401 kept the filename as the one
   deliberate exception because the decision grammar lives in it by name and
   the CLI docs cite it. Both facts stay true and both are served by the
   header. The rail's own comment calls it "the ledger that records all of
   it", which is a Kind. This reverses the other call made in #401, and is the
   one most worth the maintainer's veto.
4. **The caution tint is allowed on a record token only when its contract
   fixes a binary and one value asks for the human's attention** (`**Rollback
   exercised:** no`; a finding's severity through the fixed severity mapping).
   G2 refuses to tint `verified`; G3 tints `no`. Recorded once in
   `packages/web/DESIGN.md`, and the words beside the colour always state the
   fact.
5. **`ArtifactRef` lands additively.** `artifacts: string[]` keeps its shape
   for one release and `artifactRefs` is added beside it, so `landing.ts` and
   the `e` key loop move in their own change rather than in the wire change.
6. **Gate `notes:` and closure `reason:` render on History.** The approver's
   own words at approval are fetched today and never shown; for the record
   reader they are the most valuable human-written field in the record.

## 9. The order of work

Smallest first, each landing alone, each closing a named set of inventory
entries. The epic (#411) carries the sub-issues.

1. **Vocabulary components** (`packages/web/src/components/vocabulary.tsx`):
   the eleven kinds of §5 as components, consolidating the five artifact links,
   the three field rows, the two folds and the four withheld shapes, with no
   behaviour change. First because it is pure consolidation, every later
   change lands in it, and it closes the inconsistency among the three fixes.
2. **`describeArtifact` and `ArtifactRef`**, additive on the wire; the five
   regex sites deleted; the rail reads kinds off the payload and stops
   relabelling reviews after the reports load.
3. **Packet chips become reference rows**: kind, name, quoted verdict; the
   address on hover. The `imp` chrome is retired from paths.
4. **Enforcement**: the boundary test forbids path regexes in web; the DOM
   sweep forbids filenames outside an Address. Early, so steps 5–10 are
   checked as they land.
5. **Structured withheld reasons** in every packet, sentences composed in web,
   issue numbers gone; the contract badge and the failure notices name the
   contract by kind with the file as Address.
6. **The rail's two reversals** (§8.2, §8.3), in one change that says so.
7. **Field views for YAML**: a work item over its contract's keys, `state.yaml`
   as a run-state view (gates as Name, Quoted decision, approver and date;
   escalations; budget as Counts), both with "show bytes".
8. **Inbox and card sentences from facts**; `pausedInstruction` moves to web;
   `restatesWhatIsShown` deleted; the escalation pointer leaves the inbox row.
9. **A G0 packet** (§7), and the staged card carrying the brief, the profile
   and the budget ceiling that arming spends.
10. **History**: gate notes and closure reasons rendered; `escalation #N`
    rows named by who escalated and about what; engine `bounced` and
    `escalated` rows linked to the views that exist.

## 10. What stays exactly as it is

The artifact bytes, and every existing address of them. The reader header's
`runs/<slug>/<path>` and the `?artifact=` URL: the verification hook. History's
raw mode: the model for "bytes on demand". Every diff file and hunk header.
`file_contact_surface` entries, which are the record's own addresses, quoted.
The commit in the decision flash. The branch ref in the run header. The YAML
key in the resume form, which the human may edit by hand. The grammar token
inside a withheld notice. A parser's diagnostic with its caret. The engine's
verbs in the ledger. In every case the mark of "finished" is the same: the
address follows a name or a UI word, muted, unbordered, selectable.

## 11. Research that should run alongside

Every Gatehouse user to date is the maintainer on his own runs. A filename chip
is fast for someone who knows the layout by heart, so the evidence on file
cannot separate "irritant to the author" from "barrier to the adopter". Three
cheap observations would, and each informs a step above:

- **G0 think-aloud** on the demo fixture with two people who have not seen the
  run layout: can they say what they would be approving and name one
  Assumption they could veto without opening the Record surface? Decides
  whether step 9's packet leads with Assumptions.
- **Closed card sort** of about fifty record elements printed from one
  finished run — "I'd paste this into a terminal", "I'd say this aloud", "I
  never need to see this", "this is what I'm deciding on" — against the
  classes of §4. Disagreement is the finding.
- **Planted paraphrase**: two variants of one card, one with a single
  rephrased token ("changes requested" for `request-changes`), the artifact one
  click away. If readers cannot detect it, the byte-identity rule is doing
  work they cannot verify, and "address on demand" must become "address one
  gesture away, always".

One check needed no participants and is done. Whether the branch tip is what
the approver saw: across the orchestrated runs with per-artifact history, every
commit to `spec.md` and `plan.md` predates the gate that approved it, so the
tip is the decision's packet. Two runs were squash-merged to main and their
artifact history is one commit there, which the run branches still keep. That
belongs to #248: the record reader's verification target is the decision
commit, and a squash merge moves it off the default branch.

## 12. Definition of done

**A decision card is done when the approver can:** read the gate's question
and the substance that answers it without opening a file; tell, for every
sentence on the card, whether the record said it or Gatehouse did; see every
token the record uses exactly as spelled, and hover any id to its definition;
reach the artifact behind any quoted slice in one click, landing on the line
with its fold open; find the address when they want it, without it leading the
card; see nothing ranked, scored, recommended or tinted by a condition the
words beside it do not state; and decide, with their name, the time, the burden
and their note recorded, and that note visible again on the ledger.

**The record reader is done when someone who was not there can:** read the
run's decisions as a sequence, with the engine's work folded but reachable;
open any artifact whole, as the markup it was written in, knowing which
contract it was checked against; read a work item as fields with its ids
resolved; verify any word on any surface against `git show <oid>:runs/<slug>/
<path>` using only what the page shows; see what the approver saw, or be told
plainly that the view is the tip and the packet has moved; and never be misled
about authorship, with human, role, engine and cockpit words in four
distinguishable registers.

## Appendix: the inventory of 2026-09-25

Taken against the tree at `179d568` before #403 and #407 merged. Roughly 45
places showed bytes where a view belongs, 52 showed bytes that are the right
view, and 50 were already good views. By category among the first group:
filenames and paths 17, machine strings 14, raw YAML or markdown dumps 8, an
array index 1, a raw status token 1, a duplicated contract notice 1, and two
reachability gaps (History drops gate notes; the CLI inbox drops an item's
detail). The five worst: the G0 card with no packet; the packet chip row on
every card; the staged card with the brief, profile and budget absent;
engine-originated escalations with no packet; and the reader's raw `<pre>` for
YAML. The five best, the patterns the rest should copy: the escalation packet,
the G1 packet, the G2 criterion spine, the round-cap comparison, and the rail's
kind labelling. The full inventory with file and line references is in the
epic.
