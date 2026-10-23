-- مسار الباقات: 3 أشهر مفتوحة ← 3 أشهر أساسي ← اشتراك (للمتنقل: مفتوحة ← اشتراك).
-- تاريخ النهاية الفاضي = بلا نهاية (يضبطه الأدمن للشركاء).
-- + إصلاح خلل: تريقرات merchants كانت تتراجع عن أي تحديث «نظام» (cron أو SQL)، فما كانت الفترة المجانية تنتهي.

alter table public.merchants
  add column if not exists basic_until timestamptz,
  add column if not exists paid_until timestamptz;

create or replace function public.merchants_founder()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or auth.uid() is null) then
    if tg_op = 'INSERT' then new.founder := false; new.trial_months := 3; new.plan := 'free';
    else new.founder := old.founder; new.trial_months := old.trial_months; new.plan := old.plan; end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and new.status = 'approved' and old.status is distinct from 'approved' and not old.founder
     and (select count(*) from public.merchants m where m.founder and m.city = new.city
          and coalesce(m.district, '') = coalesce(new.district, '')) < 500 then
    new.founder := true;
    new.trial_months := greatest(new.trial_months, 6);
  end if;
  return new;
end $$;

create or replace function public.merchants_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if public.is_admin() or auth.uid() is null then
    if tg_op = 'UPDATE' and new.status is distinct from old.status then
      new.reviewed_at := now();
    end if;
    if new.status = 'approved' and new.plan = 'free' and new.trial_started_at is null and public.buyer_enabled() then
      new.trial_started_at := now();
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.status := 'pending';
    new.review_note := null;
    new.reviewed_at := null;
    new.submitted_at := now();
    new.trial_started_at := null;
    new.email := coalesce((select email from auth.users where id = auth.uid()), new.email);
  else
    new.id := old.id;
    new.email := old.email;
    new.created_at := old.created_at;
    new.reviewed_at := old.reviewed_at;
    new.review_note := old.review_note;
    new.trial_started_at := old.trial_started_at;
    if old.status = 'rejected' then
      new.status := 'pending';
      new.submitted_at := now();
    else
      new.status := old.status;
      new.submitted_at := old.submitted_at;
    end if;
  end if;
  return new;
end $$;

create or replace function public.merchants_family_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.live_update', true), '') = '1' then return new; end if;
  if tg_op = 'INSERT' or new.kind is distinct from old.kind then
    new.hide_location := (new.kind = 'family');
  end if;
  if tg_op = 'UPDATE' and new.cr_number is distinct from old.cr_number and not (auth.uid() is null or pg_trigger_depth() > 1) then
    new.cr_check := null; new.cr_checked_at := null;
  end if;
  if public.is_admin() or auth.uid() is null or pg_trigger_depth() > 1 then return new; end if;
  if new.kind = 'mobile' and new.next_plan = 'basic' then new.next_plan := 'family'; end if;
  if tg_op = 'INSERT' then
    new.site_verified_at := null; new.site_verified_note := null;
    new.license_verified_at := null; new.license_verified_note := null;
    new.live_lat := null; new.live_lng := null; new.live_at := null;
    new.availability := 'off'; new.live_until := null;
    new.basic_until := null; new.paid_until := null;
    new.cr_check := null; new.cr_checked_at := null;
  else
    new.site_verified_at := old.site_verified_at; new.site_verified_note := old.site_verified_note;
    new.live_lat := old.live_lat; new.live_lng := old.live_lng; new.live_at := old.live_at;
    new.availability := old.availability; new.live_until := old.live_until;
    new.basic_until := old.basic_until; new.paid_until := old.paid_until;
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

create or replace function public.is_entitled(mid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.merchants m
    where m.id = mid and (
      m.plan = 'free'
      or (m.plan = 'basic' and (m.basic_until is null or m.basic_until > now()))
      or (m.plan in ('family', 'trader', 'pro') and (m.paid_until is null or m.paid_until > now()))
    )
  );
$$;

alter policy "public reads active products" on public.products
  using (
    merchant_id = auth.uid()
    or public.is_admin()
    or public.staff_has(merchant_id, 'inventory') or public.staff_has(merchant_id, 'prices')
    or (is_active and public.is_approved_merchant(merchant_id) and public.is_entitled(merchant_id) and public.buyer_enabled())
  );
alter policy "read store settings" on public.store_settings
  using (
    public.is_admin() or public.staff_has(merchant_id, 'inventory') or public.staff_has(merchant_id, 'prices')
    or (public.is_approved_merchant(merchant_id) and public.is_entitled(merchant_id) and public.buyer_enabled())
  );

create or replace function public.end_expired_trials()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with ended as (
    update public.merchants set
      plan = case when kind = 'mobile' then (case when next_plan = 'basic' then 'family' else next_plan end) else 'basic' end,
      basic_until = case when kind = 'mobile' then null else now() + interval '3 months' end,
      paid_until = case when kind = 'mobile' then now() else null end
    where plan = 'free' and trial_started_at is not null
      and trial_started_at + make_interval(months => trial_months) <= now()
    returning id, plan
  ), basic as (select id from ended where plan = 'basic'),
  lim as (select id from ended where plan in ('basic', 'family')),
  p as (update public.products set sale_price = null, offer_ends_at = null, offer_reason = null, preorder_hours = null
        where merchant_id in (select id from basic) and (sale_price is not null or preorder_hours is not null) returning 1),
  s as (update public.store_settings set delivers = false, pickup = true
        where merchant_id in (select id from basic) and delivers returning 1),
  t as (update public.merchant_staff set status = 'suspended'
        where merchant_id in (select id from lim) and status = 'active' returning 1)
  select count(*) into n from ended;
  return n;
end $$;

create or replace function public.admin_activate_subscription(mid uuid, p text, months integer default 1, b text default 'monthly')
returns jsonb language plpgsql security definer set search_path = public as $$
declare m record; base timestamptz; u timestamptz;
begin
  if not (public.is_admin() or auth.uid() is null) then raise exception 'not_admin'; end if;
  if p not in ('family', 'trader', 'pro') then raise exception 'invalid plan'; end if;
  if months is null or months < 1 or months > 24 then raise exception 'invalid months'; end if;
  if b not in ('monthly', 'yearly') then raise exception 'invalid billing'; end if;
  select * into m from public.merchants where id = mid;
  if m is null then raise exception 'merchant_not_found'; end if;
  if p = 'family' and m.kind = 'store' then raise exception 'plan_family_kind'; end if;
  base := case when m.plan = p and m.paid_until is not null and m.paid_until > now() then m.paid_until else now() end;
  u := base + make_interval(months => months);
  update public.merchants set plan = p, next_plan = p, billing = b, paid_until = u, basic_until = null where id = mid;
  return jsonb_build_object('plan', p, 'paid_until', u);
end $$;
revoke all on function public.admin_activate_subscription(uuid, text, integer, text) from public, anon;
grant execute on function public.admin_activate_subscription(uuid, text, integer, text) to authenticated;

create or replace function public.admin_extend_basic(mid uuid, months integer default 3)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m record; u timestamptz;
begin
  if not (public.is_admin() or auth.uid() is null) then raise exception 'not_admin'; end if;
  if months is null or months < 1 or months > 12 then raise exception 'invalid months'; end if;
  select * into m from public.merchants where id = mid;
  if m is null then raise exception 'merchant_not_found'; end if;
  if m.kind = 'mobile' then raise exception 'plan_mobile_basic'; end if;
  u := greatest(coalesce(m.basic_until, now()), now()) + make_interval(months => months);
  update public.merchants set plan = 'basic', basic_until = u, paid_until = null where id = mid;
  return jsonb_build_object('plan', 'basic', 'basic_until', u);
end $$;
revoke all on function public.admin_extend_basic(uuid, integer) from public, anon;
grant execute on function public.admin_extend_basic(uuid, integer) to authenticated;

create or replace view public.stores_public with (security_invoker = false) as
with src as (
  select id, store_name, activity, city, district, kind, hide_location, lat, lng,
         live_lat, live_lng, live_at, availability,
         (kind = 'mobile' and plan <> 'basic' and availability in ('available', 'busy')
            and live_until > now() and live_lat is not null and live_lng is not null) as is_live
  from public.merchants
  where status = 'approved' and public.buyer_enabled()
    and (plan = 'free'
         or (plan = 'basic' and (basic_until is null or basic_until > now()))
         or (plan in ('family', 'trader', 'pro') and (paid_until is null or paid_until > now())))
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
