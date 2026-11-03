#!/usr/bin/env bash
# VO7 test only: disposable PostgreSQL 17. Never use managed database secrets.
set -euo pipefail
ROOT="$PWD"
psql17(){
 docker run --rm --network host -v "$ROOT:/repo:ro" \
  -e PGPASSWORD=vox_disposable_only postgres:17 \
  psql -h 127.0.0.1 -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"
}
psql17 -f /repo/scripts/mvp/vox/fixtures/vox-to02e-work-minimal-pg17.sql
psql17 -f /repo/ops/vox/sql-candidates/20261015030000_vox_to02e_work_queue_atomic_candidate.sql
psql17 -f /repo/ops/vox/vo02-review-candidates/20261103010000_vox_staff_time_atomic_REVIEW_ONLY.sql
psql17 -f /repo/ops/vox/vo07-review-candidates/20261103040000_vox_task_intervals_REVIEW_ONLY.sql
psql17 -f /repo/scripts/mvp/vox/fixtures/vo07-task-intervals-assertions.pg17.sql
echo VO7_TASK_INTERVALS_REAL_PG17_PASS
