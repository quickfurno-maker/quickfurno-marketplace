-- VO11 disposable PostgreSQL17 keyset proof for immutable closed intervals.
-- Full microsecond precision plus original nonce order. Never managed Staging.
begin;
create temporary table vo11_time_cursor(
 ended_at timestamptz not null,closed_by_event_nonce uuid primary key
);
insert into vo11_time_cursor
select '2026-11-03T10:00:00.123456+00:00'::timestamptz,
 ('00000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid
from generate_series(1,25) as g;
insert into vo11_time_cursor values(
 '2026-11-03T09:59:59.999999+00:00'::timestamptz,
 '00000000-0000-4000-8000-000000000026'::uuid
);
create temporary table vo11_page1 as
 select ended_at,closed_by_event_nonce from vo11_time_cursor
 order by ended_at desc,closed_by_event_nonce desc limit 20;
create temporary table vo11_page2 as
 select ended_at,closed_by_event_nonce from vo11_time_cursor
 where (ended_at,closed_by_event_nonce)<(
  select ended_at,closed_by_event_nonce from vo11_page1
  order by ended_at asc,closed_by_event_nonce asc limit 1
 )
 order by ended_at desc,closed_by_event_nonce desc limit 20;
do $proof$
begin
 if (select count(*) from vo11_page1)<>20 or
    (select count(*) from vo11_page2)<>6 or
    (select count(*) from (
      select closed_by_event_nonce from vo11_page1
      union select closed_by_event_nonce from vo11_page2
    ) a)<>26
 then raise exception 'VO11_HISTORY_KEYSET_LOST_OR_DUPLICATED_INTERVAL';end if;
 if exists(select 1 from vo11_page1 a join vo11_page2 b
  on a.closed_by_event_nonce=b.closed_by_event_nonce)
 then raise exception 'VO11_HISTORY_KEYSET_OVERLAP';end if;
 if (select max(ended_at) from vo11_page2) <>
    '2026-11-03T10:00:00.123456+00:00'::timestamptz or
    (select min(ended_at) from vo11_page2) <>
    '2026-11-03T09:59:59.999999+00:00'::timestamptz
 then raise exception 'VO11_HISTORY_MICROSECOND_BOUNDARY_LOST';end if;
end;$proof$;
select 'VO11_IMMUTABLE_INTERVAL_KEYSET_REAL_PG17_PASS' as result;
rollback;
