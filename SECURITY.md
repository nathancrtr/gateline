# Security Policy

## Reporting a vulnerability

Please report suspected vulnerabilities privately through GitHub's security
advisory form on this repository ("Report a vulnerability" under the Security
tab). You will get an acknowledgment within a week; fixes for confirmed issues
in the framework's tooling are prioritized ahead of all other work.

Please do not open public issues for suspected vulnerabilities.

## Scope

The security-relevant surfaces of gateline are:

- **`scripts/integrate.py` and `scripts/render-agents.py`** — these run on
  operator machines against operator repos. Anything that could make them
  write outside the target repo, execute unexpected code, or misrepresent
  provenance is in scope.
- **Gatehouse (`packages/`)** — the server binds to localhost by design;
  anything that widens that exposure, bypasses the single write path, or lets
  a non-human author a gate entry is in scope.
- **Role and contract text** — prompt-injection vectors that would cause a
  pipeline agent to exceed its contract are in scope; reports should include
  the artifact that carried the injection.

## Supported versions

Pre-1.0: fixes land on `main` only. Once tagged releases exist, this policy
will name the supported tags.

## What gateline does not do

gateline ships no hosted service and collects no telemetry. The network calls
it does make are to your own repository: `git push`/`fetch` to your own
origin, and, when you configure a token, GitHub API and webhook traffic
(`gateline sync`, PR-review import, the server's `/api/webhooks/github`
endpoint, which is HMAC-verified) scoped to that one repository. The agents
you dispatch use whatever runtime and credentials you already have. Your
model vendors' security posture is governed by your agreements with them, not
by this project.
