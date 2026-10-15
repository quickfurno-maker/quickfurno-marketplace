#!/usr/bin/env bash
# Disposable PostgreSQL 17 only; no real users, no staging, no provider sends.
# Different valid work items race for one Staff capacity slot pool.
set -euo pipefail
ACTOR='00000000-0000-4000-8000-000000000001'
TEAM='00000000-0000-4000-8000-000000000201'
CITY='00000000-0000-4000-8000-000000000101'
SOURCE='00000000-0000-4000-8000-000000000301'
psql -X -v ON_ERROR_STOP=1 -q -c "
 insert into public.vox_work_items_candidate_v1
  (id,team_id,city_id,source_kind,source_id)
 select ('00000000-0000-4000-8000-' || lpad((2000+n)::text,12,'0'))::uuid,
 '$TEAM'::uuid,'$CITY'::uuid,'prospect','$SOURCE'::uuid
 from generate_series(1,50) as n;
"
BEFORE=$(psql -X -Atqc "select count(*) from public.vox_work_items_candidate_v1
 where assignee_id='$ACTOR' and state<>'DONE'")
AVAILABLE=$((24-BEFORE))
test "$AVAILABLE" -gt 0 && test "$AVAILABLE" -lt 50
printf 'Before active=%d; unfilled capacity=%d\n' "$BEFORE" "$AVAILABLE"
rm -f /tmp/vox-capacity-results
seq 1 50 | xargs -P 50 -I '{}' bash -c '
  set -u
  i="$1"
  item=$(printf "00000000-0000-4000-8000-%012d" "$((2000+i))")
  err="/tmp/vox-capacity-$i.err"
  if psql -X -v ON_ERROR_STOP=1 -Atqc "select new_revision from
    public.qf_vox_work_transition_candidate_v1(
      '\''00000000-0000-4000-8000-000000000001'\'',
      '\''$item'\'',0,gen_random_uuid(),'\''CLAIM'\'','\'''\'')"
      >"/tmp/vox-capacity-$i.out" 2>"$err"; then
    echo "OK $i"
  elif grep -q "VOX_WORK_STAFF_CAPACITY_REACHED" "$err"; then
    echo "DENIED_CAPACITY $i"
  else
    echo "UNEXPECTED_FAILURE $i" >&2
    cat "$err" >&2
    exit 1
  fi
' _ '{}' > /tmp/vox-capacity-results
WINNERS=$(grep -c '^OK ' /tmp/vox-capacity-results || true)
DENIED=$(grep -c '^DENIED_CAPACITY ' /tmp/vox-capacity-results || true)
AFTER=$(psql -X -Atqc "select count(*) from public.vox_work_items_candidate_v1
 where assignee_id='$ACTOR' and state<>'DONE'")
EVENTS=$(psql -X -Atqc "select count(*) from public.vox_work_events_candidate_v1 e
 join public.vox_work_items_candidate_v1 w on w.id=e.work_item_id
 where right(w.id::text,12)::bigint between 2001 and 2050")
REVISIONS=$(psql -X -Atqc "select coalesce(sum(revision),0) from public.vox_work_items_candidate_v1
 where right(id::text,12)::bigint between 2001 and 2050")
UNASSIGNED=$(psql -X -Atqc "select count(*) from public.vox_work_items_candidate_v1
 where right(id::text,12)::bigint between 2001 and 2050
 and state='NEW' and assignee_id is null and revision=0")
echo "MULTI_ITEM_RACE=50 BEFORE=$BEFORE AFTER=$AFTER EXPECTED_WINS=$AVAILABLE WINNERS=$WINNERS CAPACITY_DENIALS=$DENIED EVENTS=$EVENTS REVISIONS=$REVISIONS UNASSIGNED=$UNASSIGNED"
test "$WINNERS" -eq "$AVAILABLE"
test "$DENIED" -eq "$((50-AVAILABLE))"
test "$AFTER" -eq 24
test "$EVENTS" -eq "$WINNERS"
test "$REVISIONS" -eq "$WINNERS"
test "$UNASSIGNED" -eq "$DENIED"
echo "VOX_TO04F_DISTINCT_ITEM_CAPACITY_50_WAY_PG17_PASS_NOT_STAGING"
