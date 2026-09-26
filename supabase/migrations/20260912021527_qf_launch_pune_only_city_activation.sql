begin;

-- QuickFurno launch scope: Pune only.
-- Preserve all city rows and historical Mumbai data; only launch eligibility changes.
update public.cities
set is_active = (lower(trim(name)) = 'pune');

-- Fail closed unless Pune is the sole active launch city.
do $$
declare
  v_active_count integer;
  v_pune_active boolean;
begin
  select count(*) into v_active_count from public.cities where is_active is true;
  select coalesce(bool_or(is_active is true), false)
    into v_pune_active
    from public.cities
   where lower(trim(name)) = 'pune';

  if v_active_count <> 1 or v_pune_active is not true then
    raise exception 'QF_PUNE_ONLY_LAUNCH_CITY_POSTCONDITION_FAILED';
  end if;
end;
$$;

commit;
