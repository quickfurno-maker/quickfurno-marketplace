#!/usr/bin/env bash
# Review-only SQL on disposable PostgreSQL17 service. Never connects to managed DB.
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
psql17 -f /repo/ops/vox/vo04-review-candidates/20261103020000_vox_tl_assignment_atomic_REVIEW_ONLY.sql
psql17 -f /repo/ops/vox/vo06-review-candidates/20261103030000_vox_presence_signal_pg17_REVIEW_ONLY.sql
psql17 -f /repo/ops/vox/vo07-review-candidates/20261103040000_vox_task_intervals_REVIEW_ONLY.sql
psql17 -f /repo/scripts/mvp/vox/fixtures/vo08-cross-feature.pg17.sql
echo VO8_CROSS_FEATURE_DISPOSABLE_PG17_PASS
