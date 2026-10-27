# Source-only independent VOX image. Public routing forbidden until staff IAM.
# Pin Node 24: Supabase Storage requires Node >=22; verified in isolated build.
ARG NODE_IMAGE=node@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d
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
