#!/bin/sh
# PAY-4C1 two real, distinct PostgreSQL 17 client processes inside network-none Docker.
# Only synthetic isolated fixture values. No managed database network.
set +e
psql -X -q -A -t -v ON_ERROR_STOP=1 -U postgres -d postgres -c "select public.qf_finance_v2_reserve_refund('20000000-0000-4000-8000-000000000070',7000,'00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000071');" > /tmp/pay4c1-race1.log 2>&1 &
pid1=$!
psql -X -q -A -t -v ON_ERROR_STOP=1 -U postgres -d postgres -c "select public.qf_finance_v2_reserve_refund('20000000-0000-4000-8000-000000000070',7000,'00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000072');" > /tmp/pay4c1-race2.log 2>&1 &
pid2=$!
wait "$pid1"
code1=$?
wait "$pid2"
code2=$?
if [ "$code1" -eq 0 ] && [ "$code2" -ne 0 ]; then
  echo PAY4C1_TWO_PG_CLIENTS_EXACTLY_ONE_PASS
  exit 0
fi
if [ "$code1" -ne 0 ] && [ "$code2" -eq 0 ]; then
  echo PAY4C1_TWO_PG_CLIENTS_EXACTLY_ONE_PASS
  exit 0
fi
echo "PAY4C1_TWO_PG_CLIENTS_FAIL codes=$code1,$code2"
exit 1
