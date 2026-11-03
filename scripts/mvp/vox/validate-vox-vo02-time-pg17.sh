#!/usr/bin/env bash
# Review-only SQL installed into disposable GitHub PostgreSQL 17 service.
set -euo pipefail
ROOT="$PWD"
psql17() {
 docker run --rm --network host -v "$ROOT:/repo:ro" \
  -e PGPASSWORD="vox_disposable_only" postgres:17 \
  psql -h 127.0.0.1 -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"
}
psql17 -f /repo/scripts/mvp/vox/fixtures/vox-to02e-work-minimal-pg17.sql
psql17 -f /repo/ops/vox/sql-candidates/20261015030000_vox_to02e_work_queue_atomic_candidate.sql
psql17 -f /repo/ops/vox/vo02-review-candidates/20261103010000_vox_staff_time_atomic_REVIEW_ONLY.sql
psql17 -f /repo/scripts/mvp/vox/fixtures/vo02-staff-time-atomic-assertions.pg17.sql
# Two distinct first-CLOCK_IN commands on a different synthetic Staff
# account race at revision 0: exactly one must commit, the other must be stale.
c1="select revision from public.qf_vox_staff_time_atomic_candidate_v1(
'00000000-0000-4000-8000-000000000004',
'00000000-0000-4000-8000-000000000202',
'00000000-0000-4000-8000-000000000102',
'CLOCK_IN','00000000-0000-4000-8000-000000000721',0,null);"
c2="select revision from public.qf_vox_staff_time_atomic_candidate_v1(
'00000000-0000-4000-8000-000000000004',
'00000000-0000-4000-8000-000000000202',
'00000000-0000-4000-8000-000000000102',
'CLOCK_IN','00000000-0000-4000-8000-000000000722',0,null);"
set +e
psql17 -c "$c1" >/tmp/vox-vo2-first.log 2>&1 &
a=$!
psql17 -c "$c2" >/tmp/vox-vo2-second.log 2>&1 &
b=$!
wait "$a"; ea=$?
wait "$b"; eb=$?
set -e
if ! { [ "$ea" -eq 0 ] && [ "$eb" -ne 0 ]; } &&
   ! { [ "$eb" -eq 0 ] && [ "$ea" -ne 0 ]; }; then
 echo "VO2 PG17 race must have exactly one successful command" >&2
 sed -n '1,12p' /tmp/vox-vo2-first.log
 sed -n '1,12p' /tmp/vox-vo2-second.log
 exit 1
fi
count=$(psql17 -Atc "select
 (select count(*) from public.vox_vo2_staff_time_events_candidate_v1
  where staff_id='00000000-0000-4000-8000-000000000004')::text||':'||
 (select revision from public.vox_vo2_staff_time_state_candidate_v1
  where staff_id='00000000-0000-4000-8000-000000000004')::text")
if [ "$count" != "1:1" ]; then
 echo "VO2 PG17 race failed durable 1:1 nonce/event revision" >&2
 exit 1
fi
echo "VO2_PG17_REAL_RACE_PASS_ONE_EVENT_ONE_REVISION"
