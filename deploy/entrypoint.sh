#!/bin/sh
# FleetView hosted single-user entrypoint — see docs/DEPLOY.md.
# Clones the pipeline repository onto the data volume, points the server at
# it, and (when TUNNEL_TOKEN is set) runs a Cloudflare tunnel so the machine
# needs no public port.
set -eu

: "${REPO_URL:?REPO_URL is required (clone URL of the pipeline repository)}"
: "${GIT_USER_NAME:?GIT_USER_NAME is required (a gate decision is a commit by a named human)}"
: "${GIT_USER_EMAIL:?GIT_USER_EMAIL is required}"

DATA_DIR="${DATA_DIR:-/data}"
REPO_DIR="$DATA_DIR/repo"
PORT="${PORT:-4310}"
FETCH_INTERVAL="${FETCH_INTERVAL:-60}"
PUSH_DECISIONS="${PUSH_DECISIONS:-true}"
SOURCE_NAME="${SOURCE_NAME:-$(basename "$REPO_URL" .git)}"

# The token stays in the environment: the helper echoes it to git on demand,
# so it is never written to disk or embedded in the remote URL.
if [ -n "${GIT_TOKEN:-}" ]; then
  git config --global credential.helper \
    '!f() { printf "username=%s\npassword=%s\n" "${GIT_USERNAME:-x-access-token}" "$GIT_TOKEN"; }; f'
fi

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

exec node /app/frontend/packages/server/src/main.ts --host "$HOST" --port "$PORT"
