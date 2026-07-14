# FleetView hosted single-user image — see docs/DEPLOY.md.
# Build from the repository root:  docker build -f deploy/Dockerfile .
#
# The image carries the gate frontend only (server + built SPA). The
# orchestrator is deliberately absent: a hosted cockpit reads runs and records
# gate decisions; it never dispatches agents.

FROM node:24-slim AS build
WORKDIR /app
COPY frontend/ ./
RUN npm ci --no-audit --no-fund && npm run build

FROM node:24-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

# cloudflared is the optional tunnel client; the entrypoint starts it only
# when TUNNEL_TOKEN is set, so the machine can run with no public port.
ARG TARGETARCH=amd64
RUN curl -fsSL -o /usr/local/bin/cloudflared \
      "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${TARGETARCH}" \
 && chmod +x /usr/local/bin/cloudflared

# Server and core run straight from TypeScript source (Node >= 24 strip-only
# mode); only the SPA needs the build stage.
WORKDIR /app/frontend
COPY frontend/ ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --from=build /app/packages/web/dist packages/web/dist

COPY deploy/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV NODE_ENV=production
EXPOSE 4310
ENTRYPOINT ["/entrypoint.sh"]
