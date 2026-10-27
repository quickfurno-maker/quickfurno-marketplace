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
FROM gcr.io/distroless/nodejs24-debian13@sha256:cb606325b7ec4af55462cb0b424a53b452a5b4a894ffe841fcf1048d216fb9f8 AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000 VOX_DEMO_PREVIEW=disabled
# Runtime contains Node.js only, without npm, perl, apt or a shell; nonroot UID/GID 65532.
COPY --from=build --chown=65532:65532 /app/.next/standalone ./
COPY --from=build --chown=65532:65532 /app/.next/static ./.next/static
USER 65532
EXPOSE 3000
CMD ["server.js"]
