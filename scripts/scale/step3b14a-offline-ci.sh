#!/usr/bin/env bash
# GitHub Actions Ubuntu ONLY: offline, network-none PostgreSQL17 synthetic purge rehearsal.
# No production endpoint, credentials, external delivery, Supabase URL or real PII.
set -euo pipefail
name="qf-step3b14-pg17-$$"
cleanup(){ docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
test -f scripts/scale/step3b14a-purge-rehearsal.sql
docker run --rm -d --name "$name" --network none \
  --env POSTGRES_PASSWORD="local-scratch-only-$$" postgres:17 \
  -c listen_addresses='' >/dev/null
[ "$(docker inspect --format '{{.HostConfig.NetworkMode}}' "$name")" = none ]
[ "$(docker inspect --format '{{len .HostConfig.PortBindings}}' "$name")" = 0 ]
ready=0
for _ in $(seq 1 45); do
  if docker exec -u postgres "$name" pg_isready -q -U postgres -d postgres; then ready=1; break; fi
  sleep 1
done
[ "$ready" = 1 ] || { docker logs "$name" >&2; echo SCRATCH_SERVER_NOT_READY >&2; exit 1; }
docker cp scripts/scale/step3b14a-purge-rehearsal.sql "$name":/tmp/step3b14a.sql
docker exec -u postgres "$name" psql -X -q -U postgres -d postgres \
  -v ON_ERROR_STOP=1 -f /tmp/step3b14a.sql | tail -n 7
echo "STEP3B14A_DOCKER_PG17_NETWORK_NONE_REHEARSAL_PASS"
