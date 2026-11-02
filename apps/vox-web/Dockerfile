# Source-only independent VOX image. Public routing forbidden until staff IAM.
ARG NODE_IMAGE=node@sha256:3d0f05455dea2c82e2f76e7e2543964c30f6b7d673fc1a83286736d44fe4c41c
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY apps/vox-web/package.json apps/vox-web/package-lock.json ./
RUN npm ci --no-audit --no-fund
FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY apps/vox-web ./
RUN npm run build
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000 VOX_DEMO_PREVIEW=disabled
RUN groupadd -g 10001 vox && useradd -u 10001 -g 10001 -M vox
COPY --from=build --chown=10001:10001 /app/.next/standalone ./
COPY --from=build --chown=10001:10001 /app/.next/static ./.next/static
USER 10001
EXPOSE 3000
CMD ["node","server.js"]
