-- Phase 3B-15A: READ ONLY Production FK/deletion inventory.
-- Audit only: do not confuse this report with a backup, restore or deletion.
-- This file contains SELECT statements ONLY. Never copy to a migration file.
SELECT
  con.conname AS constraint_name,
  con.conrelid::regclass::text AS referencing_table,
  con.confrelid::regclass::text AS referenced_table,
  CASE con.confdeltype
    WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT'
    WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL'
    WHEN 'd' THEN 'SET DEFAULT'
  END AS delete_action,
  pg_get_constraintdef(con.oid, true) AS definition
FROM pg_constraint con
WHERE con.contype='f'
  AND con.confrelid IN ('public.vendors'::regclass,'public.leads'::regclass,
                        'public.lead_assignments'::regclass)
ORDER BY referenced_table, referencing_table,constraint_name;

-- Foreign keys do not cover opaque text/JSON references: review all possible
-- vendor / lead / assignment key columns in public, Auth and storage schemas.
SELECT table_schema,table_name,column_name,data_type
FROM information_schema.columns
WHERE table_schema IN ('public','auth','storage')
  AND (column_name IN ('vendor_id','vendor_user_id','lead_id','assignment_id',
                       'lead_assignment_id','selected_vendor_id','target_vendor_id')
       OR column_name LIKE '%vendor%id'
       OR column_name LIKE '%lead%id')
ORDER BY table_schema,table_name,column_name;

-- Explicit table triggers may generate side effects even in transactions.
SELECT
  t.tgrelid::regclass::text AS table_name,t.tgname AS trigger_name,
  pg_get_triggerdef(t.oid,true) AS trigger_definition
FROM pg_trigger t
WHERE NOT t.tgisinternal AND t.tgrelid IN (
  'public.vendors'::regclass,'public.leads'::regclass,
  'public.lead_assignments'::regclass)
ORDER BY table_name,trigger_name;

-- Root read-only guard, including city and out-of-scope sanity.
SELECT
 (SELECT count(*) FROM public.vendors) AS all_vendor_rows,
 (SELECT count(*) FROM public.vendors WHERE city='Pune') AS pune_vendor_rows,
 (SELECT count(*) FROM public.vendors WHERE city='Mumbai') AS mumbai_vendor_rows,
 (SELECT count(*) FROM public.vendors WHERE city NOT IN ('Pune','Mumbai') OR city IS NULL)
 AS out_of_scope_city_rows,
 (SELECT count(*) FROM public.leads) AS all_lead_rows,
 (SELECT count(*) FROM public.lead_assignments) AS all_assignment_rows;
