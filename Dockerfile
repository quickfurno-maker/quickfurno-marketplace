# syntax=docker/dockerfile:1.7

# SCALE-P02: match the current QuickFurno production Node line exactly.
# linux/amd64 manifest for node:20.20.2-bookworm-slim.
ARG NODE_IMAGE=node@sha256:3d0f05455dea2c82e2f76e7e2543964c30f6b7d673fc1a83286736d44fe4c41c

FROM ${NODE_IMAGE} AS build-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM ${NODE_IMAGE} AS prod-deps
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM ${NODE_IMAGE} AS builder
ARG GIT_SHA=unknown
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    QF_RELEASE_SHA=${GIT_SHA} \
    NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL} \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY}
WORKDIR /app
COPY --from=build-deps /app/node_modules ./node_modules
COPY . .
RUN test -n "$NEXT_PUBLIC_SUPABASE_URL" \
 && test -n "$NEXT_PUBLIC_SUPABASE_ANON_KEY" \
 || (echo "QuickFurno image build REFUSED: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required build inputs." >&2; exit 64)
RUN npm run build:automation-worker \
 && npm run build:conversation-transport \
 && npm run build:aarohi-acquisition-worker \
 && npm run build

FROM ${NODE_IMAGE} AS runtime
ARG GIT_SHA=unknown
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    QF_RELEASE_SHA=${GIT_SHA} \
    QF_RUNTIME_ROLE=web

# The Node patch tag can outlive security updates in Debian bookworm. Refresh only
# the final runtime OS before the immutable release artifact is signed/published.
RUN apt-get update \
 && apt-get upgrade -y \
 && rm -rf /var/lib/apt/lists/*

RUN groupadd --gid 10001 quickfurno \
 && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin quickfurno

WORKDIR /app

# Workers are bundled with application code but keep package dependencies
# external, so install production dependencies once into the shared image.
COPY --from=prod-deps --chown=10001:10001 /app/node_modules ./node_modules

# Next standalone output is the web runtime. Copy it after prod dependencies so
# traced modules may tighten/overwrite the same exact dependency versions.
COPY --from=builder --chown=10001:10001 /app/.next/standalone ./
COPY --from=builder --chown=10001:10001 /app/.next/static ./.next/static
COPY --from=builder --chown=10001:10001 /app/public ./public

# Independently scalable worker entrypoints from the same certified artifact.
COPY --from=builder --chown=10001:10001 /app/dist ./dist
COPY --from=builder --chown=10001:10001 /app/ops/container/entrypoint.sh /usr/local/bin/qf-entrypoint
RUN chmod 0555 /usr/local/bin/qf-entrypoint \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /root/.npm /tmp/*

USER 10001:10001

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/livez',{cache:'no-store'}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

ENTRYPOINT ["/usr/local/bin/qf-entrypoint"]

LABEL org.opencontainers.image.title="quickfurno-marketplace" \
      org.opencontainers.image.description="QuickFurno marketplace web and governed worker runtime" \
      org.opencontainers.image.source="https://github.com/quickfurno-maker/quickfurno-marketplace" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.licenses="UNLICENSED"