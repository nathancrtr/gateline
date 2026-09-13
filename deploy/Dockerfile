# Gatehouse hosted single-user image — see docs/DEPLOY.md.
# Build from the repository root:  docker build -f deploy/Dockerfile .
#
# The image carries the gate frontend (server + built SPA) and, opt-in via
# ORCH_ENABLED=1, the v1 orchestrator with the claude-code adapter. Humans
# still decide every gate — the orchestrator dispatches within phases and
# structurally cannot write gates.*.

# Pinned by digest (node:24-slim multi-arch index, as of 2026-09-12) so both
# stages resolve to a known, reproducible base regardless of registry drift.
FROM node:24-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553 AS build
WORKDIR /app
COPY packages/ ./
RUN npm ci --no-audit --no-fund && npm run build

FROM node:24-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

# cloudflared is the optional tunnel client; the entrypoint starts it only
# when TUNNEL_TOKEN is set, so the machine can run with no public port.
# Pinned to a specific release and verified by checksum (not "latest", which
# has no integrity guarantee). Bump CLOUDFLARED_VERSION and the two sha256
# ARGs together when updating; both are overridable.
ARG CLOUDFLARED_VERSION=2026.9.1
ARG CLOUDFLARED_SHA256_AMD64=03f1f25d1cc93b9ad6c60569d44060bc4f17ed97075760ed8cfca4b12dcd68cc
ARG CLOUDFLARED_SHA256_ARM64=3d97437c71848bd8df68041e12436b484a661d95073ea1937f01a845ce88faa3
ARG TARGETARCH=amd64
RUN curl -fsSL -o /usr/local/bin/cloudflared \
      "https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/cloudflared-linux-${TARGETARCH}" \
 && case "${TARGETARCH}" in \
      amd64) CLOUDFLARED_SHA256="${CLOUDFLARED_SHA256_AMD64}" ;; \
      arm64) CLOUDFLARED_SHA256="${CLOUDFLARED_SHA256_ARM64}" ;; \
      *) echo "unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
 && echo "${CLOUDFLARED_SHA256}  /usr/local/bin/cloudflared" | sha256sum -c - \
 && chmod +x /usr/local/bin/cloudflared

# The claude CLI is the orchestrator's dispatch harness (adapters/claude-code).
# Pinned to the version current as of this Dockerfile's last update, for a
# reproducible image; bump deliberately (not "latest", which drifts silently).
ARG CLAUDE_CODE_VERSION=2.1.270
RUN npm install -g --no-audit --no-fund "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}"

# Unprivileged runtime user: the claude CLI refuses permission-bypass modes
# as root, and nothing here needs root past the volume chown in entrypoint.
RUN useradd --uid 10001 --create-home --home-dir /home/gateline gateline
ENV HOME=/home/gateline

# Server and core run straight from TypeScript source (Node >= 24 strip-only
# mode); only the SPA needs the build stage.
WORKDIR /app/packages
COPY packages/ ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --from=build /app/web/dist web/dist

COPY deploy/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV NODE_ENV=production
EXPOSE 4310
ENTRYPOINT ["/entrypoint.sh"]
