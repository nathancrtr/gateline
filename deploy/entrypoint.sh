#!/bin/sh
# FleetView hosted single-user entrypoint — see docs/DEPLOY.md.
# Clones the pipeline repository onto the data volume, points the server at
# it, optionally runs the v1 orchestrator (ORCH_ENABLED=1), and — when
# TUNNEL_TOKEN is set — runs a Cloudflare tunnel so the machine needs no
# public port.
set -eu

# Stage 0 (root): own the volume, then drop privileges for everything else.
# The claude CLI refuses permission-bypass modes as root, and nothing past
# this point needs root. chown -R keeps volumes from older root-run images
# usable after an upgrade.
APP_USER="${APP_USER:-agentic}"
DATA_DIR="${DATA_DIR:-/data}"
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown -R "$APP_USER" "$DATA_DIR"
  # setpriv execs in place (unlike runuser/su, which stay resident as a root
  # parent): PID 1 ends up unprivileged and receives the platform's signals.
  exec setpriv --reuid "$APP_USER" --regid "$APP_USER" --init-groups "$0" "$@"
fi

: "${REPO_URL:?REPO_URL is required (clone URL of the pipeline repository)}"
: "${GIT_USER_NAME:?GIT_USER_NAME is required (a gate decision is a commit by a named human)}"
: "${GIT_USER_EMAIL:?GIT_USER_EMAIL is required}"

REPO_DIR="$DATA_DIR/repo"
PORT="${PORT:-4310}"
FETCH_INTERVAL="${FETCH_INTERVAL:-60}"
PUSH_DECISIONS="${PUSH_DECISIONS:-true}"
SOURCE_NAME="${SOURCE_NAME:-$(basename "$REPO_URL" .git)}"

# The token stays in the environment: the helper echoes it to git on demand,
# so it is never written to disk or embedded in the remote URL. safe.directory
# is container-wide relaxation — this is a single-purpose container and CI
# mounts seed repos owned by other uids.
if [ -n "${GIT_TOKEN:-}" ]; then
  git config --global credential.helper \
    '!f() { printf "username=%s\npassword=%s\n" "${GIT_USERNAME:-x-access-token}" "$GIT_TOKEN"; }; f'
fi
git config --global safe.directory '*'

if [ ! -d "$REPO_DIR/.git" ]; then
  git clone --quiet "$REPO_URL" "$REPO_DIR"
fi

cd "$REPO_DIR"
git remote set-url origin "$REPO_URL"
git config user.name "$GIT_USER_NAME"
git config user.email "$GIT_USER_EMAIL"
# Detached HEAD: with no branch checked out, the sync loop can fast-forward
# every local branch, including the default one.
if git symbolic-ref -q HEAD >/dev/null; then
  git switch --detach --quiet
fi

CONF_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/agentic"
mkdir -p "$CONF_DIR"
cat > "$CONF_DIR/config.yaml" <<EOF
sources:
  - name: $SOURCE_NAME
    path: $REPO_DIR
    push: $PUSH_DECISIONS
    fetch_interval: $FETCH_INTERVAL
EOF

if [ -n "${TUNNEL_TOKEN:-}" ]; then
  # All traffic arrives through the tunnel; don't listen beyond loopback.
  HOST="${HOST:-127.0.0.1}"
  cloudflared tunnel run --token "$TUNNEL_TOKEN" &
else
  HOST="${HOST:-0.0.0.0}"
fi

# The v1 orchestrator (opt-in): resident watch mode against the same clone.
# Hosted hard lines: --push (origin is the record), --require-budget (no
# ceiling, no dispatch), and an optional host-wide --spend-limit-usd. Humans
# decide gates in the frontend; the loop below restarts on any nonzero exit
# after 10s (state is in git, restart converges) — ordinary crashes today.
# It would equally absorb a deliberate self-supersede exit (75, #141, see
# docs/ORCHESTRATOR.md §13) if this process ever ran from a live git
# checkout, but it doesn't here: frontend/ is baked into the image at build
# time with no .git above it, so that code path stays inert and a hosted
# update is still `fly deploy` from a newer checkout (docs/DEPLOY.md).
if [ "${ORCH_ENABLED:-0}" = "1" ]; then
  : "${ANTHROPIC_API_KEY:?ORCH_ENABLED=1 requires ANTHROPIC_API_KEY for the claude-code adapter}"
  (
    while :; do
      node /app/frontend/packages/orchestrator/src/main.ts \
        --repo "$REPO_DIR" \
        --adapter "${ORCH_ADAPTER:-claude-code}" \
        --push --require-budget \
        ${ORCH_SPEND_LIMIT_USD:+--spend-limit-usd "$ORCH_SPEND_LIMIT_USD"} \
        watch --heartbeat "${ORCH_HEARTBEAT_SECONDS:-180}" || true
      echo "orchestrator exited; restarting in 10s" >&2
      sleep 10
    done
  ) &
fi

exec node /app/frontend/packages/server/src/main.ts --host "$HOST" --port "$PORT"
