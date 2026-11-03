#!/usr/bin/env bash
# VO4 disposable Postgres17 only. Never connects to managed Supabase.
set -euo pipefail
ROOT="$PWD"
psql17() {
 docker run --rm --network host -v "$ROOT:/repo:ro" \
  -e PGPASSWORD="vox_disposable_only" postgres:17 \
  psql -h 127.0.0.1 -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"
}
psql17 -f /repo/scripts/mvp/vox/fixtures/vox-to02e-work-minimal-pg17.sql
psql17 -f /repo/ops/vox/sql-candidates/20261015030000_vox_to02e_work_queue_atomic_candidate.sql
psql17 -f /repo/ops/vox/vo04-review-candidates/20261103020000_vox_tl_assignment_atomic_REVIEW_ONLY.sql
psql17 -f /repo/scripts/mvp/vox/fixtures/vo04-tl-assignment-assertions.pg17.sql
actor="00000000-0000-4000-8000-000000000003"
target="00000000-0000-4000-8000-000000000001"
item="00000000-0000-4000-8000-000000000603"
call_a="select revision from public.qf_vox_tl_assign_work_candidate_v1(
'$actor','$target','$item',0,
'00000000-0000-4000-8000-000000000721','');"
call_b="select revision from public.qf_vox_tl_assign_work_candidate_v1(
'$actor','$target','$item',0,
'00000000-0000-4000-8000-000000000722','');"
set +e
psql17 -c "$call_a" >/tmp/vox4-tl-a.log 2>&1 &
pid_a=$!
psql17 -c "$call_b" >/tmp/vox4-tl-b.log 2>&1 &
pid_b=$!
wait "$pid_a"; status_a=$?
wait "$pid_b"; status_b=$?
set -e
if ! { [ "$status_a" -eq 0 ] && [ "$status_b" -ne 0 ]; } &&
   ! { [ "$status_b" -eq 0 ] && [ "$status_a" -ne 0 ]; }; then
 echo "VO4 TL atomic assignment race must accept exactly one nonce" >&2
 sed -n '1,15p' /tmp/vox4-tl-a.log
 sed -n '1,15p' /tmp/vox4-tl-b.log
 exit 1
fi
summary=$(psql17 -Atc "select
 (select count(*) from public.vox_work_events_candidate_v1
  where work_item_id='$item' and event_type='TEAM_ASSIGN')::text||':'||
 (select count(*) from public.vox_vo4_tl_assignment_receipts_candidate_v1
  where work_item_id='$item')::text||':'||
 (select revision from public.vox_work_items_candidate_v1 where id='$item')::text")
if [ "$summary" != "1:1:1" ];then
 echo "VO4 TL assignment count/revision race failed: $summary" >&2
 exit 1
fi
echo "VO4_TL_REAL_PG17_RACE_PASS_ONE_ASSIGNMENT_ONE_EVENT_ONE_REVISION"
