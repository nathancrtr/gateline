# Intent Brief: commercial-boundary mechanics (`ee/` convention + license-boundary CI)

<!-- Contract: contracts/intent-brief.md. Author: the maintainer (founder
     decision, 2026-07-12). -->

## Problem

The repo's free/paid code boundary exists only as an intention. The commercial
line has been decided: everything currently in the tree ships free under
Apache-2.0, permanently; future multi-user/organization capabilities (the
Stage-C surface of `docs/FRONTEND.md` §6 and beyond) will be commercial,
source-available, living in `ee/` directories from their first commit. Today
nothing in the repo makes that line real: there is no reserved `ee/` location,
no license text distinguishing it, and no check preventing core code from
importing future commercial code — or preventing a paid-intended capability
from landing in the Apache tree, where publication makes it irrevocably free.
An accidental crossing is currently invisible; it should fail CI, the same way
`scripts/render-agents.py --check` makes agent-file drift fail CI.

## Motivation

The open-source precedent record is unambiguous about sequencing: communities
accept commercial lines that gate only what was never free, and rupture when
something already-free is taken back (GitLab vs HashiCorp/Redis/Elastic).
Same-repo, separately-licensed enterprise directories are the working pattern
(GitLab post-2019 merge, Mastra `ee/`, OpenHands `enterprise/`), and the
declare-at-birth property — the `ee/` convention and its license file existing
*before* substantial `ee/` code — is what separates the acceptance cases from
the rupture cases. This repo is still private: the boundary can be declared now
at zero rupture cost, and the go-public cut is the last moment that stays true.
If we don't do this: the first paid capability lands under license ambiguity,
core/commercial import entanglement accrues silently, and the eventual split
reads as enclosure instead of a line that was always there.

## Constraints

- **No existing file moves or is relicensed.** The current tree is Apache-2.0
  permanently; this run only reserves and fences new territory.
- **Import direction is one-way:** `ee/` code may import core; core (non-`ee/`)
  builds and published packages must fail CI if they import, require, or
  bundle anything under an `ee/` path. The check must pass trivially today (no
  `ee/` code exists) so it can merge immediately and stand guard from day zero.
- **`ee/LICENSE` placeholder ships with the convention**, stating: the
  directory is NOT Apache-2.0; intended terms are commercial source-available
  (free for internal dev/test, production requires a commercial agreement);
  the exact instrument is a pending maintainer/counsel decision. No code may
  land under `ee/` while that ambiguity note stands unresolved.
- Root `LICENSE.md`/`NOTICE.md` gain one scoping line: Apache-2.0 applies to
  everything outside `ee/` paths.
- **PR template gains a required placement line** — `Placement: Free | ee/
  (Team) | ee/ (Enterprise) | n/a (mechanical)` — with one rationale sentence:
  Free placement is affirmative, never a default; an unplaced capability is
  treated as commercial and stays out of the Apache tree.
- **DCO tripwire note** in CONTRIBUTING/CLAUDE.md: the Apache core adopts DCO
  (not CLA), and it must be in force before the first outside contribution is
  merged. Contributions are not currently accepted, so this is a recorded
  deadline, not a process change.
- Must land before the repo goes public. No dependency on the product-naming
  decision or on any paid-feature design.

## Out of scope

- Any paid feature work: authentication, approver pools, gate-duty routing,
  retention, evidence bundles — this run prepares the boundary they will land
  behind, nothing more.
- Relicensing or moving any existing file.
- The placement *decision rules* themselves (which capability belongs to which
  tier) — maintainer policy, held outside this repo.
- The public-facing tiering-policy document (belongs to the go-public cut, not
  to this run).
- Choosing the final `ee/` license instrument (pending counsel; the
  placeholder names the pendency).
