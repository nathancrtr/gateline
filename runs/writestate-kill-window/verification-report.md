# Verification Report: writestate-kill-window

**Change verified:** `run/writestate-kill-window` @ `4ceacff` (diff confined to
`frontend/packages/core/src/sources/local-source.ts` and
`frontend/packages/core/test/write-recovery.test.ts`, per the dispatch)
**Environment:** local checkout, macOS/Darwin 25.3.0, Node v24.12.0, `frontend/`
workspace (`npm install` run fresh for this verification)

## Results

| Criterion | Verdict | Evidence |
|-----------|---------|----------|
| AC1.1 | verified | see E1 |
| AC1.2 | verified | see E2 |
| AC2.1 | verified | see E3 |
| AC2.2 | verified | see E4 |
| AC3.1 | verified | see E5 |
| AC4.1 | verified | see E6 |
| AC5.1 | verified | see E7 |

### E1 — AC1.1
```
$ npx vitest run packages/core/test/write-recovery.test.ts -t "self-heals"
 ✓ writeState kill-window recovery > AC1.1/AC1.2/AC4.1: self-heals an abandoned
   mid-write kill and leaves exactly the two calls' commits  2155ms
 Test Files  1 passed (1)
      Tests  1 passed | 4 skipped (5)
```
The test genuinely reproduces the kill window rather than asserting a canned
result: it patches `Git.prototype.run` so the checkout's `commit` invocation
throws, calls `writeState`, and — before calling `writeState` again — asserts
the mid-kill state directly: `git status --porcelain` reports exactly
` M runs/g1-pending/state.yaml` and `refs/agentic/wip/run/g1-pending` resolves
to a real commit. The recovering call then returns `ok: true` and
`git status --porcelain` is empty. I ran this test in isolation (not the full
suite) to confirm it passes standalone, and read its body to confirm the
intermediate assertions are genuine, not tautological.

### E2 — AC1.2
```
$ npx vitest run packages/core/test/write-recovery.test.ts -t "self-heals"
 ✓ ... self-heals an abandoned mid-write kill and leaves exactly the two calls'
   commits  2155ms
```
The test's own log assertion (`log.length === baseline + 2`, with `log[0]` and
`log[1]` matching the two calls' commit messages) shows no duplicate or
orphaned commit on the branch. I additionally wrote and ran an independent
probe reproducing just the kill-then-recover pair and running `git fsck
--unreachable` afterward:
```
$ npx vitest run packages/core/test/__verify_fsck.test.ts   # scratch probe, not committed
 ✓ fsck shows a dangling commit, branch has exactly baseline+1 after recovery
FSCK: "unreachable tree ...\nunreachable commit af76ef8...\nunreachable tree ...
       \nunreachable blob ...\nunreachable tree ...\nunreachable commit dc0b4fd...\n"
```
`git rev-list --count` on the branch was exactly `baseline + 1` for one
kill-then-recover pair — no duplicate or orphaned commit reaches the branch.
`git fsck` does report the abandoned intent commits as unreachable objects,
which is by design (ADR-2: recovery discards rather than finishes the
abandoned write) — see Gaps for the reading this depends on.

### E3 — AC2.1
The pre-existing `write-path.test.ts` case this criterion names asserted only
`ok: false` / `reason: 'dirty-worktree'`, not the on-disk bytes. I added one
assertion (`expect(await readFile(statePath, 'utf8')).toBe(dirtied)`) to that
existing test — a test-only change — to close that gap, and confirmed it
passes:
```
$ npx vitest run packages/core/test/write-path.test.ts -t "AC2.1"
 ✓ approve via the write path > refuses when the checked-out state file is
   dirty (AC2.1: the hand edit is byte-identical on disk afterward)  1248ms
 Test Files  1 passed (1)
      Tests  1 passed | 18 skipped (19)
```

### E4 — AC2.2
```
$ npx vitest run packages/core/test/write-recovery.test.ts -t "AC2.2"
 ✓ AC2.2: a kill reproduced, then a further hand edit that diverges from the
   intent, still refuses byte-identical  1477ms
 ✓ AC2.2: a hand edit with no intent ref (nothing to attribute) refuses
   byte-identical  1282ms
 ✓ AC2.2: a stale intent ref (parent behind the current tip) refuses rather
   than recovering  1498ms
 Test Files  1 passed (1)
      Tests  3 passed | 2 skipped (5)
```
Each of the three sub-cases reads the on-disk file after the refusal and
asserts it equals the exact bytes the human/abandoned-write left, closing the
"never silently discarded" requirement at the byte level, not just the return
value.

### E5 — AC3.1
```
$ npx vitest run packages/core/test/write-recovery.test.ts -t "AC3.1"
 ✓ AC3.1: an unattributable dirty refusal names the run and prints
   copy-pasteable remedy commands  1236ms
```
I also printed the literal message via a scratch probe to read it directly
rather than trust the regex assertions:
```
MESSAGE: run g1-pending refused: runs/g1-pending/state.yaml has uncommitted
changes in the checkout at /.../agentic-fixture-LxosRc — commit or discard
them first. Keep: git -C /.../agentic-fixture-LxosRc commit -m
"state(g1-pending): manual recovery" -- runs/g1-pending/state.yaml. Discard:
git -C /.../agentic-fixture-LxosRc checkout -- runs/g1-pending/state.yaml
```
The slug is named as the run (`run g1-pending refused:`, not only inside a
path), both the checkout path and the state-file path appear, and both a keep
and a discard remedy are present as literal `git -C <path> ... -- <path>`
commands — an operator can copy either one directly.

### E6 — AC4.1
```
$ npx vitest run packages/core/test/write-path.test.ts -t "commits through the worktree"
 ✓ approve via the write path > commits through the worktree when the branch
   is checked out (clean file)  1450ms
 Test Files  1 passed (1)
      Tests  1 passed | 18 skipped (19)
```
This is the named pre-existing test, unmodified, and it passes. The
kill-window recovery path's own HEAD-matches-branch-ref and
clean-`git status` assertions (inside the AC1.1 test, E1) additionally cover
the recovered-write half of this criterion.

### E7 — AC5.1
```
$ npm test        # in frontend/
 Test Files  53 passed | 2 skipped (55)
      Tests  567 passed | 2 skipped (569)

$ npm run typecheck
> tsc -p tsconfig.json && tsc -p packages/web/tsconfig.json
(no output, exit 0)
```
Both commands ran clean, including every pre-existing case in
`write-path.test.ts` (CAS refusal, comment-preserving edits, the clean-checkout
commit path — all 19 cases, 0 failures).

## Beyond the happy path

I probed three cases the acceptance criteria did not ask for, and the
implementation held up in all three.

- A staged copy of the abandoned write, byte-identical to the recorded intent:
  I re-created the kill window, then `git add`ed the dirty file before the
  recovering call. The predicate correctly refused (`dirty-worktree`) rather
  than recovering, because ADR-3 demands a worktree-only modification and a
  staged entry is evidence of a human hand in the checkout.
- No lingering `refs/agentic/wip/*` after an ordinary successful write: I
  confirmed `git for-each-ref refs/agentic/` returns empty once a
  checked-out-branch write completes without a kill.
- The literal refusal message, read directly rather than through the
  committed test's regexes (E5): it matches the plan's contract exactly,
  including both remedy commands.

## Gaps

- AC1.2's "no duplicate or orphaned commit" holds for branch history — the
  branch carries exactly one commit per successful call — but the abandoned
  intent commits remain as unreachable objects in the repository until
  garbage collection runs. The plan's own Risks section pre-registered this
  ambiguity and read the criterion as scoped to branch history; my
  independent `git fsck --unreachable` probe confirms that reading is
  accurate to the implementation, but a stricter reading of "orphaned commit"
  as forbidding any dangling object would not pass. I did not treat this as a
  failure, since the plan explicitly assigns that dispute back to itself, not
  to the implementation.
- The plan's own risk about a linked-worktree topology is unverified: every
  test, including mine, dirties the fixture repo's primary checkout, not a
  `git worktree add`-created linked worktree. `git worktree list` reports both
  identically per the plan, but I did not independently confirm recovery
  behaves the same way in a linked worktree.
- Concurrent writers racing on the same checkout during recovery are
  unverified, matching the plan's own acknowledgment that this is asserted,
  not proven, for this run.
- Review finding F3 (checkout paths containing spaces break the pasted remedy
  commands) is plausible and unaddressed; I did not construct a
  space-containing fixture path to confirm it, since AC3.1 does not require
  quoting and the review already logged it as non-blocking.
