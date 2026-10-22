
alter table public.merchants
  add column if not exists license_verified_at timestamptz,
  add column if not exists license_verified_note text;

create or replace function public.merchants_family_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.kind is distinct from old.kind then
    new.hide_location := (new.kind = 'family');
  end if;
  if public.is_admin() or auth.uid() is null or pg_trigger_depth() > 1 then return new; end if;
  if tg_op = 'INSERT' then
    new.site_verified_at := null; new.site_verified_note := null;
    new.license_verified_at := null; new.license_verified_note := null;
    new.live_lat := null; new.live_lng := null; new.live_at := null;
  else
    new.site_verified_at := old.site_verified_at; new.site_verified_note := old.site_verified_note;
    new.live_lat := old.live_lat; new.live_lng := old.live_lng; new.live_at := old.live_at;
    if new.kind is not distinct from old.kind then new.hide_location := old.hide_location; end if;
    if new.kind = 'store' and new.next_plan = 'family' then new.next_plan := 'basic'; end if;
    -- تغيير الرخصة أو المستندات يسقط الشارة لين نراجعها من جديد
    if new.license_number is distinct from old.license_number or new.extra_docs is distinct from old.extra_docs then
      new.license_verified_at := null; new.license_verified_note := null;
    else
      new.license_verified_at := old.license_verified_at; new.license_verified_note := old.license_verified_note;
    end if;
  end if;
  return new;
end $$;

create or replace function public.set_license_verified(mid uuid, verified boolean, note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  update public.merchants set
    license_verified_at = case when verified then now() else null end,
    license_verified_note = case when verified then nullif(trim(note), '') else null end
  where id = mid;
end $$;
revoke all on function public.set_license_verified(uuid, boolean, text) from public, anon;
grant execute on function public.set_license_verified(uuid, boolean, text) to authenticated;
