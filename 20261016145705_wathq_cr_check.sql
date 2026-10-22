
alter table public.merchants
  add column if not exists cr_check jsonb,
  add column if not exists cr_checked_at timestamptz;

create or replace function public.merchants_family_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.kind is distinct from old.kind then
    new.hide_location := (new.kind = 'family');
  end if;
  if tg_op = 'UPDATE' and new.cr_number is distinct from old.cr_number and not (auth.uid() is null or pg_trigger_depth() > 1) then
    new.cr_check := null; new.cr_checked_at := null;
  end if;
  if public.is_admin() or auth.uid() is null or pg_trigger_depth() > 1 then return new; end if;
  if tg_op = 'INSERT' then
    new.site_verified_at := null; new.site_verified_note := null;
    new.license_verified_at := null; new.license_verified_note := null;
    new.live_lat := null; new.live_lng := null; new.live_at := null;
    new.cr_check := null; new.cr_checked_at := null;
  else
    new.site_verified_at := old.site_verified_at; new.site_verified_note := old.site_verified_note;
    new.live_lat := old.live_lat; new.live_lng := old.live_lng; new.live_at := old.live_at;
    if new.kind is not distinct from old.kind then new.hide_location := old.hide_location; end if;
    if new.kind = 'store' and new.next_plan = 'family' then new.next_plan := 'basic'; end if;
    if new.license_number is distinct from old.license_number or new.extra_docs is distinct from old.extra_docs then
      new.license_verified_at := null; new.license_verified_note := null;
    else
      new.license_verified_at := old.license_verified_at; new.license_verified_note := old.license_verified_note;
    end if;
    if new.cr_number is not distinct from old.cr_number then
      new.cr_check := old.cr_check; new.cr_checked_at := old.cr_checked_at;
    end if;
  end if;
  return new;
end $$;

-- طلب التحقق من واثق تلقائيًا عند تسجيل محل أو تغيير رقم السجل
create or replace function public.merchants_wathq_check()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare s public.notify_settings;
begin
  if new.kind <> 'store' or new.cr_number is null then return new; end if;
  if tg_op = 'UPDATE' and new.cr_number is not distinct from old.cr_number then return new; end if;
  select * into s from public.notify_settings where id;
  if s is null then return new; end if;
  perform net.http_post(
    url := replace(s.function_url, '/notify', '/wathq'),
    body := jsonb_build_object('merchant_id', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', s.webhook_secret),
    timeout_milliseconds := 45000);
  return new;
end $$;
create or replace trigger merchants_wathq_check after insert or update of cr_number on public.merchants
  for each row execute function public.merchants_wathq_check();
