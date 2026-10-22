
create or replace function public.merchants_family_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.kind is distinct from old.kind then
    new.hide_location := (new.kind = 'family');
  end if;
  if public.is_admin() or auth.uid() is null or pg_trigger_depth() > 1 then return new; end if;
  if tg_op = 'INSERT' then
    new.site_verified_at := null; new.site_verified_note := null;
    new.live_lat := null; new.live_lng := null; new.live_at := null;
  else
    new.site_verified_at := old.site_verified_at; new.site_verified_note := old.site_verified_note;
    new.live_lat := old.live_lat; new.live_lng := old.live_lng; new.live_at := old.live_at;
    if new.kind is not distinct from old.kind then new.hide_location := old.hide_location; end if;
    if new.kind = 'store' and new.next_plan = 'family' then new.next_plan := 'basic'; end if;
  end if;
  return new;
end $$;
