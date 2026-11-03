#!/usr/bin/env bash
# VO7 test-only real PG17, synthetic Staff. No managed Supabase.
set -euo pipefail
ROOT="$PWD"
psql17(){
 docker run --rm --network host -v "$ROOT:/repo:ro" \
  -e PGPASSWORD=vox_disposable_only postgres:17 \
  psql -h 127.0.0.1 -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"
}
psql17 -f /repo/scripts/mvp/vox/fixtures/vox-to02e-work-minimal-pg17.sql
psql17 -f /repo/ops/vox/sql-candidates/20261015030000_vox_to02e_work_queue_atomic_candidate.sql
psql17 -f /repo/ops/vox/vo04-review-candidates/20261103020000_vox_tl_assignment_atomic_REVIEW_ONLY.sql
psql17 -f /repo/scripts/mvp/vox/fixtures/vo04-tl-assignment-assertions.pg17.sql
psql17 -f /repo/scripts/mvp/vox/fixtures/vo07-tl-progress-replay.pg17.sql
echo VO7_TL_REAL_PG17_REPLAY_PASS
