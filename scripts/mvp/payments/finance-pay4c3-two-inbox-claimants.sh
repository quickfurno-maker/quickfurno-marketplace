#!/bin/sh
# Two independent PG client connections, disposable network-none PG17 only.
set -u
psql -X -q -A -t -v ON_ERROR_STOP=1 -U postgres -d postgres -c "select job_id::text||'|'||token::text from public.qf_finance_v2_claim_inbox(1);" > /tmp/pay4c3-claim1.txt 2>&1 &
p1=$!
psql -X -q -A -t -v ON_ERROR_STOP=1 -U postgres -d postgres -c "select job_id::text||'|'||token::text from public.qf_finance_v2_claim_inbox(1);" > /tmp/pay4c3-claim2.txt 2>&1 &
p2=$!
wait "$p1"; c1=$?
wait "$p2"; c2=$?
if [ "$c1" -ne 0 ] || [ "$c2" -ne 0 ]; then
 echo "PAY4C3_CLAIM_QUERY_FAILED status=$c1,$c2"
 exit 1
fi
lines1=$(grep -c '|' /tmp/pay4c3-claim1.txt || true)
lines2=$(grep -c '|' /tmp/pay4c3-claim2.txt || true)
if [ "$((lines1+lines2))" -ne 1 ]; then
 echo "PAY4C3_DOUBLE_CLAIM_UNSAFE results=$lines1,$lines2"
 exit 1
fi
echo 'PAY4C3_TWO_PG_CLIENT_CLAIMS_EXACTLY_ONE_PASS'
