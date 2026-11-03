#!/usr/bin/env bash
# VO6 disposable Postgres 17 ONLY, no Supabase or production secrets.
set -euo pipefail
ROOT="$PWD"
psql17(){
 docker run --rm --network host -v "$ROOT:/repo:ro" \
  -e PGPASSWORD="vox_disposable_only" postgres:17 \
  psql -h 127.0.0.1 -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"
}
psql17 -f /repo/scripts/mvp/vox/fixtures/vox-to02e-work-minimal-pg17.sql
psql17 -f /repo/ops/vox/vo06-review-candidates/20261103030000_vox_presence_signal_pg17_REVIEW_ONLY.sql
psql17 -f /repo/scripts/mvp/vox/fixtures/vo06-presence-signal-assertions.pg17.sql
echo "VO6_PRESENCE_REAL_PG17_PASS"
