#!/usr/bin/env bash
# OFFLINE synthetic PostgreSQL17: actual immutable migration trigger functions.
# Container has --network none. No managed project credentials.
set -euo pipefail
name="qf-step3b17-immutable-$$"
workdir="${RUNNER_TEMP:-/tmp}/qf-step3b17-$$"
cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  rm -rf "$workdir"
}
trap cleanup EXIT
mkdir -p "$workdir"
node scripts/scale/step3b17-immutable-negative-generate.mjs > "$workdir/rehearsal.sql"
grep -q 'STEP3B17_REAL_MIGRATION_IMMUTABLE_EVENT_RESTRICT_NEGATIVE_TEST_PASS' "$workdir/rehearsal.sql"
docker run --rm -d --name "$name" --network none \
  --env POSTGRES_PASSWORD="synthetic-only-$$" postgres:17 \
  -c listen_addresses='' >/dev/null
[ "$(docker inspect --format '{{.HostConfig.NetworkMode}}' "$name")" = none ]
[ "$(docker inspect --format '{{len .HostConfig.PortBindings}}' "$name")" = 0 ]
ready=0
for _ in $(seq 1 45); do
  if docker exec -u postgres "$name" pg_isready -q -U postgres -d postgres; then ready=1; break; fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then echo PG17_LOCAL_NOT_READY >&2; exit 1; fi
docker cp "$workdir/rehearsal.sql" "$name":/tmp/rehearsal.sql
docker exec -u postgres "$name" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres -f /tmp/rehearsal.sql \
  | tee "$workdir/pg.out"
grep -Fxq 'STEP3B17_REAL_MIGRATION_IMMUTABLE_EVENT_RESTRICT_NEGATIVE_TEST_PASS' "$workdir/pg.out"
echo "STEP3B17_NETWORK_NONE_REAL_MIGRATION_NEGATIVE_TEST_PASS"
