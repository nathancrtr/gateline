# Hosting Gatehouse: single-user deployment

This guide deploys the gate frontend (Gatehouse) as a hosted single-user
instance: a URL you can open in any browser to read runs and record gate
decisions on your pipeline repository. The v1 orchestrator can run on the
same machine as an **opt-in second process** (`ORCH_ENABLED=1`, see
[the orchestrator section](#enable-the-orchestrator-hosted-dispatch)) — off
by default, and gated by the autonomy policy in
[ORCHESTRATOR.md](ORCHESTRATOR.md) §10 regardless of where it runs.

It is written for one concrete stack (Docker image, Fly.io, Cloudflare Tunnel
+ Access) because that is the stack the recipe was proven on, but the image is
plain Docker: any host that can run a container with a persistent volume
works. Everything instance-specific stays in environment variables and an
uncommitted `fly.toml`.

This recipe clones from `REPO_URL` and legitimately requires a remote (push
decisions, the GitHub webhook); it is out of scope for the **local-only**
topology described in [TOPOLOGY.md](TOPOLOGY.md) §3.6.

## Security model — read this first

Gatehouse has **no authentication of its own**. Anyone who can reach the port
can read every run and approve gates as you. The design intends the app to sit
on `127.0.0.1`; hosting it means *you* provide the authentication layer in
front. This recipe does that with:

* **No public port.** The container starts a [Cloudflare Tunnel] when
  `TUNNEL_TOKEN` is set, and the server then binds to loopback only. The
  machine accepts no inbound connections; traffic enters through the tunnel.
* **Cloudflare Access in front of the hostname.** An Access policy
  (allow-list of your identity) authenticates every request before it reaches
  the tunnel.

Never expose the container port directly to the internet. If you swap
Cloudflare for something else, keep the same shape: an authenticating proxy in
front, and the app itself unreachable any other way.

Two more properties worth knowing:

* **The repo is the only state.** The container's volume holds a clone of
  your pipeline repository; deleting the machine and volume loses nothing
  that has been pushed. Decisions are commits, pushed back to `origin`.
* **Decisions are attributed to the git identity you configure.** Set
  `GIT_USER_NAME`/`GIT_USER_EMAIL` to the human whose decisions these are —
  gate entries must be written by a named human approver.

## How it works

The image (`deploy/Dockerfile`, entrypoint `deploy/entrypoint.sh`) contains
the server, the built SPA, git, and cloudflared. On boot it:

1. Clones `REPO_URL` onto the volume (first boot only) and detaches `HEAD`,
   so no branch is checked out and every local branch can fast-forward.
2. Configures git identity and, when `GIT_TOKEN` is set, a credential helper
   that reads the token from the environment (never written to disk).
3. Writes `~/.config/agentic/config.yaml` pointing the server at the clone
   with `push: true` and `fetch_interval` set.
4. Starts cloudflared (when `TUNNEL_TOKEN` is set) and the server.

At runtime the server polls `origin` every `FETCH_INTERVAL` seconds:
remote-tracking refs always update, and clean local branches fast-forward. A
local branch holding a decision that has not been pushed yet is never
clobbered — the decision's own push reconciles it. Every fetch that moves a
ref becomes a live update in the UI (the ref watcher feeds SSE).

If you also run Gatehouse locally against your own checkout, both instances
write through git's compare-and-swap: a conflicting decision fails loudly and
re-presents rather than corrupting state.

## Configuration reference

| Variable | Required | Default | Meaning |
| --- | --- | --- | --- |
| `REPO_URL` | yes | — | Clone URL of the pipeline repository (https). |
| `GIT_USER_NAME` | yes | — | Human name decisions are committed as. |
| `GIT_USER_EMAIL` | yes | — | Email for that identity. |
| `GIT_TOKEN` | for private repos / push | — | Token with read+write contents access to the repo. |
| `GIT_USERNAME` | no | `x-access-token` | Username paired with `GIT_TOKEN` (GitHub fine-grained PATs use the default). |
| `TUNNEL_TOKEN` | recommended | — | Cloudflare Tunnel token; when set, the server binds to loopback and cloudflared carries traffic. |
| `FETCH_INTERVAL` | no | `60` | Seconds between `git fetch`es of origin. |
| `PUSH_DECISIONS` | no | `true` | Push each decision commit back to origin. |
| `SOURCE_NAME` | no | repo basename | Display name of the source in the UI. |
| `PORT` | no | `4310` | Server port inside the container. |
| `HOST` | no | `127.0.0.1` with tunnel, else `0.0.0.0` | Bind address; leave the default. |
| `DATA_DIR` | no | `/data` | Volume mount point holding the clone. |
| `GITHUB_WEBHOOK_SECRET` | no | — | Arms `POST /api/webhooks/github`; unset → the route does not exist. |
| `GITHUB_TOKEN` | no | — | Enables PR-approval sync on review webhooks (token needs Pull requests: Read). |
| `ORCH_ENABLED` | no | `0` | `1` runs the v1 orchestrator against the same clone — the blessed topology, and the example config's default. Read the orchestrator section first. |
| `ANTHROPIC_API_KEY` | with `ORCH_ENABLED=1` | — | Model auth for the claude-code dispatch harness. |
| `ORCH_SPEND_LIMIT_USD` | recommended | — | Host-wide ceiling: refuse dispatch when projected spend across all active runs exceeds it. |
| `ORCH_NO_BUDGET_ENFORCEMENT` | no | `0` | `1` replaces `--require-budget` with `--no-budget-enforcement`: meter spend but never pause on caps (flat-rate-billed harnesses, #109). |
| `ORCH_HEARTBEAT_SECONDS` | no | `180` | Orchestrator heartbeat (stale-dispatch aging, missed-event sweep). |
| `ORCH_ADAPTER` | no | `claude-code` | Headless adapter name (`adapters/<name>/manifest.json` in your repo). |

## Try it locally

From the repository root, with Docker installed:

```sh
docker build -f deploy/Dockerfile -t gatehouse .
docker run --rm -p 4310:4310 \
  -e REPO_URL=https://github.com/OWNER/REPO.git \
  -e GIT_TOKEN=... \
  -e GIT_USER_NAME="Your Name" -e GIT_USER_EMAIL=you@example.com \
  -e PUSH_DECISIONS=false \
  -v gatehouse-data:/data \
  gatehouse
```

Open `http://localhost:4310`. (`PUSH_DECISIONS=false` makes local experiments
read-mostly: decisions commit inside the container's clone but stay there.)

## Deploy on Fly.io

Prerequisites: a Fly.io account with `flyctl` logged in, and a token for your
git host — for GitHub, a fine-grained PAT scoped to the one repository with
**Contents: Read and write**.

```sh
cp deploy/fly.example.toml fly.toml   # edit: app name, region
fly apps create <your-app-name>
fly volumes create gatehouse_data --size 1 --region <region>
fly secrets set \
  REPO_URL=https://github.com/OWNER/REPO.git \
  GIT_TOKEN=<token> \
  GIT_USER_NAME="Your Name" \
  GIT_USER_EMAIL=you@example.com \
  TUNNEL_TOKEN=<tunnel token — see next section>
fly deploy
fly scale count 1   # the clone on the volume is single-writer
```

`fly.toml` is gitignored: it names your instance and belongs to you, not to
the framework.

## Cloudflare Tunnel + Access

In the Cloudflare dashboard (Zero Trust), with a domain on your account:

1. **Create a tunnel** (Networks → Tunnels → Create). Choose *cloudflared*,
   name it, and copy the token from the install command — that string is your
   `TUNNEL_TOKEN` secret. You install nothing yourself; the container runs
   cloudflared.
2. **Route a hostname to the app.** In the tunnel's *Public hostnames*, add
   e.g. `gatehouse.example.com` → service `http://localhost:4310`.
3. **Protect it with Access** (Access → Applications → Add, self-hosted).
   Set the application domain to that hostname and add an *Allow* policy
   matching only your login (e.g. your email, verified by a one-time PIN or
   your identity provider).
4. Re-run `fly secrets set TUNNEL_TOKEN=...` if the app was already deployed
   (secrets changes restart the machine).

Order matters: create the Access application **before** you share or use the
hostname — the tunnel is reachable the moment it connects.

**Verify exactly one connector on the tunnel** (Networks → Tunnels → your
tunnel → Connectors) once the machine is up — and again after any workstation
testing. A leftover `cloudflared service install` on a laptop registers a
second connector for the same token, and Cloudflare will route a share of
requests to it; if nothing listens on that machine's port, those requests die
as intermittent 502s that look like a dead deployment while the real machine
reports perfectly healthy. (`sudo cloudflared service uninstall` removes a
stray one.)

## GitHub webhooks: push-driven freshness + PR-approval sync

Without webhooks the instance polls origin every `FETCH_INTERVAL` seconds.
With them, a push appears in the UI immediately, and a PR review approving a
run's G2 is recorded into `state.yaml` minutes-to-seconds after it happens.

1. Set the secret: generate a long random string, then
   `fly secrets set GITHUB_WEBHOOK_SECRET=...` (and `GITHUB_TOKEN=...` if you
   want review sync — add **Pull requests: Read** to the fine-grained PAT).
2. On the repository: Settings → Webhooks → Add. Payload URL
   `https://<hostname>/api/webhooks/github`, content type
   `application/json`, the same secret, events: **Pushes** and
   **Pull request reviews**.
3. **Cloudflare Access bypass for the webhook path.** GitHub's deliveries
   can't log in through Access, so add a second Access application scoped to
   `<hostname>/api/webhooks/*` with a single **Bypass** policy (Everyone).
   This is safe because the route authenticates every request itself: the
   HMAC signature over the raw body, verified in constant time, with the
   route entirely absent unless the secret is configured. Nothing else moves
   out from behind Access.
4. Verify with the webhook's "Recent deliveries": the ping should show
   `200` and `pong`.

## Enable the orchestrator (hosted dispatch)

`ORCH_ENABLED=1` runs the v1 orchestrator (`agentic-orchestrator watch`) as a
second process against the same clone. **Co-located is the blessed topology**
(one machine, one clone, one authority — [TOPOLOGY.md](TOPOLOGY.md) §3.1), and
the example config ships with it on. Hosted dispatch bills by API key
(`ANTHROPIC_API_KEY`); an operator who wants subscription-billed dispatch runs
the same co-located pair on their own machine with `agentic up` (below)
instead of splitting the orchestrator off — an orchestrator over a second
writable clone is the topology that produced #103/#104. Read this section —
and [ORCHESTRATOR.md](ORCHESTRATOR.md) §10's autonomy gate — before first
enabling it.

**Liveness.** The engine writes a machine-local heartbeat after every
reconcile pass; Gatehouse renders a banner when a heartbeat exists and goes
stale, so decisions landing with no engine consuming them read as an outage,
never as "waiting on gate". A viewer-only deployment (`ORCH_ENABLED=0`, no
engine ever run here) has no heartbeat file and gets no banner.

**Run it locally in one command.** `agentic up [--repo <path>]` serves
Gatehouse and runs the engine over the same clone — the local twin of this
hosted deployment, with the same hard lines (`--push` by default,
`--require-budget` always; add `--spend-limit-usd`). Dispatch bills through
whatever the local harness CLI is logged in as. If you previously ran an
ad-hoc orchestrator runner script with its own clone and fetch loop, retire
it in favor of `up`.

**Merge-updates (self-supersede, [ORCHESTRATOR.md](ORCHESTRATOR.md) §13).**
The engine notices a `git pull` in the checkout it runs from at its next
tick boundary and exits (`75`) rather than silently keep serving stale code.
That mechanism does not reach the hosted process on *this* recipe: the image
bakes `packages/` in at build time with no `.git` above it (the Dockerfile
copies only `packages/` and `deploy/`, and `.dockerignore` excludes `.git`),
so `resolveCodeRepo` finds nothing to watch and the code-tree monitor is
never constructed inside the container. A hosted update is still `fly
deploy` from a newer checkout (Operational notes, below), which replaces the
whole machine and needs no `git pull` inside it — the entrypoint's
while-loop restarts the orchestrator on any crash today, and would equally
absorb a self-supersede exit if this process ever ran from a live git
checkout. Where the mechanism is live end to end is the bare local twin:
`agentic up`, run directly from the blessed git checkout, notices a pull (by
hand, or `agentic upgrade`) and — having no supervisor of its own — exits
`75` and waits for the operator to restart it by hand. Gatehouse's drift
chip renders the engine's loaded commit against the checkout's on-disk
`HEAD` from the heartbeat either way, whenever one is present.

**What it does and does not do.** The orchestrator dispatches agents *within*
phases, meters their cost into each run's ledger, and escalates when things
go wrong. It structurally cannot write `gates.*` — every gate remains a named
human's decision, made in this frontend. Decisions you record here move refs;
the orchestrator's watcher picks the change up within seconds.

**Hard lines wired into the hosted invocation:**

* `--push` — every orchestrator commit goes to origin. The machine is
  disposable; origin is the record.
* `--require-budget` — a run without `budget.cost_limit_usd` escalates and
  pauses instead of dispatching. No ceiling, no dispatch.
* `--spend-limit-usd $ORCH_SPEND_LIMIT_USD` — a host-wide cap across all
  active runs, on top of the per-run caps. Set it.

If your harness bills through a flat subscription rather than per-token,
`ORCH_NO_BUDGET_ENFORCEMENT=1` swaps `--require-budget` for
`--no-budget-enforcement`: metering (the ledger, `cost_spent_usd`) continues
unconditionally, but no cap ever pauses dispatch (#109). The orchestrator
logs the opted-out state at every startup — an uncapped host should be
visible, not quiet.

**Prerequisites, in order:**

1. Your repo's `registry/models.yaml` must bind roles to **real model IDs**
   with real pricing — the orchestrator dispatches whatever the registry
   names, and template registries ship with illustrative placeholders.
2. `fly secrets set ANTHROPIC_API_KEY=...` (API billing, not a login
   session), and set `ORCH_SPEND_LIMIT_USD` in `fly.toml`'s `[env]`.
3. Prove the plumbing before real dispatch: from the machine, run the
   one-prompt live smoke (`fly ssh console`, then `ORCH_LIVE_SMOKE=1` per
   `packages/orchestrator/README.md`) — it costs cents and verifies
   auth + usage metering in the real environment.
4. First live work should be a **toy run** with humans at every gate
   (ORCHESTRATOR.md §10 M2) — not a real feature.

**Stopping it.** Pausing a run in the UI (`phase: paused`) stops new
dispatches for that run; in-flight work lands harmlessly. `ORCH_ENABLED=0` +
`fly deploy` (or `fly machine stop`) stops the process entirely — state is
in git, restart converges, kills are safe.

## Verify the deployment

1. `https://<hostname>/` from a clean browser session → Cloudflare Access
   login, then the Gatehouse inbox with your real runs.
2. Push a run branch from your workstation → it appears in the UI within
   `FETCH_INTERVAL` seconds, without a reload.
3. Approve a gate on a scratch run → the decision commit lands on `origin`
   authored by `GIT_USER_NAME`.
4. `fly logs` shows `syncing <name> from origin every 60s` and no warnings.
5. The app is unreachable except through the hostname: `fly ips list` shows
   no public IPs allocated (no `[http_service]` in fly.toml means none are).

## Operational notes

* **Upgrades:** `fly deploy` from a newer checkout. The volume (clone) is
  untouched; the entrypoint re-runs idempotently. This is the only update
  path for the hosted process — see "Merge-updates" above for why
  self-supersede doesn't apply here.
* **Recovery:** if the clone is ever wrecked, destroy and recreate the
  volume — the next boot re-clones. Nothing on the machine is canonical.
* **Rotation:** `GIT_TOKEN` and `TUNNEL_TOKEN` rotate via `fly secrets set`;
  neither is baked into the image or written to the volume.
* **One machine only.** Two machines sharing one hostname would each hold a
  clone and race pushes. This recipe is single-user, single-writer.

[Cloudflare Tunnel]: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/
