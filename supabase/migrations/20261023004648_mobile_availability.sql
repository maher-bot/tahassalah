-- حالة إتاحة المتنقلين: متاح الآن / مشغول الآن / خارج الخدمة، مع مدة ظهور افتراضية 3 ساعات.
-- يصلح أيضًا خللًا قديمًا: حارس الجدول كان يمسح الموقع الحي حتى لو جاء من الدالة الرسمية.

alter table public.merchants
  add column if not exists availability text not null default 'off' check (availability in ('available', 'busy', 'off')),
  add column if not exists live_until timestamptz;

create or replace function public.merchants_family_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- تحديث الموقع الحي وحالة الإتاحة يتم من الدوال الرسمية فقط
  if coalesce(current_setting('app.live_update', true), '') = '1' then return new; end if;
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
    new.availability := 'off'; new.live_until := null;
    new.cr_check := null; new.cr_checked_at := null;
  else
    new.site_verified_at := old.site_verified_at; new.site_verified_note := old.site_verified_note;
    new.live_lat := old.live_lat; new.live_lng := old.live_lng; new.live_at := old.live_at;
    new.availability := old.availability; new.live_until := old.live_until;
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

create or replace function public.set_availability(st text, la double precision default null, ln double precision default null, hrs integer default 3)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m record; t timestamptz := now(); u timestamptz;
begin
  if st not in ('available', 'busy', 'off') then raise exception 'bad_state'; end if;
  select * into m from public.merchants where id = auth.uid();
  if m is null then raise exception 'not_approved'; end if;
  if m.kind <> 'mobile' then raise exception 'live_mobile_only'; end if;
  if st = 'off' then
    perform set_config('app.live_update', '1', true);
    update public.merchants set availability = 'off', live_until = null, live_lat = null, live_lng = null, live_at = null where id = m.id;
    perform set_config('app.live_update', '', true);
    return jsonb_build_object('availability', 'off', 'live_until', null, 'live_at', null);
  end if;
  if m.status <> 'approved' then raise exception 'not_approved'; end if;
  if m.plan = 'basic' then raise exception 'plan_basic_live'; end if;
  if la is null or ln is null or la not between 16 and 33 or ln not between 34 and 56 then raise exception 'bad_location'; end if;
  u := t + make_interval(hours => greatest(1, least(coalesce(hrs, 3), 12)));
  perform set_config('app.live_update', '1', true);
  update public.merchants
    set availability = st, live_until = u, live_lat = round(la::numeric, 6), live_lng = round(ln::numeric, 6), live_at = t
    where id = m.id;
  perform set_config('app.live_update', '', true);
  return jsonb_build_object('availability', st, 'live_until', u, 'live_at', t);
end $$;
revoke all on function public.set_availability(text, double precision, double precision, integer) from public, anon;
grant execute on function public.set_availability(text, double precision, double precision, integer) to authenticated;

-- الدالة القديمة تبقى للتوافق: تُحوَّل إلى «متاح الآن» أو «خارج الخدمة»
create or replace function public.set_live_location(la double precision, ln double precision)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  r := public.set_availability(case when la is null then 'off' else 'available' end, la, ln, 3);
  return (r->>'live_at')::timestamptz;
end $$;

-- تنظيف: من انتهت مدته يصير «خارج الخدمة» ويُمسح موقعه (خصوصية)
create or replace function public.end_expired_availability()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.merchants
    set availability = 'off', live_until = null, live_lat = null, live_lng = null, live_at = null
    where availability <> 'off' and (live_until is null or live_until <= now());
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.end_expired_availability() from public, anon, authenticated;
select cron.schedule('end-live-availability', '*/10 * * * *', 'select public.end_expired_availability()');

-- العرض العام: المتنقل يظهر فقط وهو «متاح» أو «مشغول» ومدته لم تنتهِ
create or replace view public.stores_public with (security_invoker = false) as
with src as (
  select id, store_name, activity, city, district, kind, hide_location, lat, lng,
         live_lat, live_lng, live_at, availability,
         (kind = 'mobile' and plan <> 'basic' and availability in ('available', 'busy')
            and live_until > now() and live_lat is not null and live_lng is not null) as is_live
  from public.merchants
  where status = 'approved' and public.buyer_enabled()
), base as (
  select id, store_name, activity, city, district,
         case when is_live then live_lat else lat end as lat,
         case when is_live then live_lng else lng end as lng,
         is_live,
         case when is_live then live_at end as live_at,
         (kind = 'family' or hide_location) as approx,
         case when is_live then availability end as availability
  from src
  where kind <> 'mobile' or is_live
), cells as (
  select *,
    case when approx and lat is not null and lng is not null
         then round((round(lat / 0.005) * 0.005)::numeric, 3)::float8 end as clat,
    case when approx and lat is not null and lng is not null
         then round((round(lng / 0.005) * 0.005)::numeric, 3)::float8 end as clng
  from base
)
select id, store_name, activity, city, district,
  case when approx then clat else lat end as lat,
  case when approx then clng else lng end as lng,
  approx as location_approx,
  is_live,
  live_at,
  availability
from cells;
