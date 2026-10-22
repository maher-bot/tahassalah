
alter table public.merchants
  add column if not exists kind text not null default 'store',
  add column if not exists id_number text,
  add column if not exists id_path text,
  add column if not exists license_number text,
  add column if not exists extra_docs text[] not null default '{}',
  add column if not exists hide_location boolean not null default false,
  add column if not exists site_verified_at timestamptz,
  add column if not exists site_verified_note text,
  add column if not exists live_lat double precision,
  add column if not exists live_lng double precision,
  add column if not exists live_at timestamptz;

alter table public.merchants add constraint merchants_kind_check check (kind in ('store','family','mobile'));
alter table public.merchants add constraint merchants_id_number_check check (id_number is null or id_number ~ '^[12][0-9]{9}$');
alter table public.merchants add constraint merchants_extra_docs_check check (cardinality(extra_docs) <= 5);

alter table public.products add column if not exists preorder_hours integer;
alter table public.products add constraint products_preorder_check check (preorder_hours is null or preorder_hours between 1 and 168);

create or replace function public.merchants_family_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.hide_location := (new.kind = 'family');
  end if;
  if public.is_admin() or auth.uid() is null or pg_trigger_depth() > 1 then return new; end if;
  if tg_op = 'INSERT' then
    new.site_verified_at := null; new.site_verified_note := null;
    new.live_lat := null; new.live_lng := null; new.live_at := null;
  else
    new.site_verified_at := old.site_verified_at; new.site_verified_note := old.site_verified_note;
    new.live_lat := old.live_lat; new.live_lng := old.live_lng; new.live_at := old.live_at;
    new.hide_location := old.hide_location;
    if new.kind is distinct from old.kind then
      new.hide_location := (new.kind = 'family');
      if new.kind = 'store' and new.next_plan = 'family' then new.next_plan := 'basic'; end if;
    end if;
  end if;
  return new;
end $$;
create or replace trigger merchants_family_guard before insert or update on public.merchants
  for each row execute function public.merchants_family_guard();

create or replace function public.set_plan_choice(p text, b text default 'monthly')
returns void language plpgsql security definer set search_path = public as $$
declare k text;
begin
  if p not in ('basic','trader','pro','family') then raise exception 'invalid plan'; end if;
  if b not in ('monthly','yearly') then raise exception 'invalid billing'; end if;
  select kind into k from public.merchants where id = auth.uid();
  if p = 'family' and coalesce(k,'store') = 'store' then raise exception 'plan_family_kind'; end if;
  update public.merchants set next_plan = p, billing = b where id = auth.uid();
end $$;

create or replace function public.products_plan_limits()
returns trigger language plpgsql security definer set search_path = public as $$
declare pl text; lim int;
begin
  if auth.uid() is null or public.is_admin() then return new; end if;
  pl := public.merchant_plan(new.merchant_id);
  if pl not in ('basic','family') then return new; end if;
  if pl = 'basic' then
    if new.sale_price is not null and (tg_op = 'INSERT' or old.sale_price is distinct from new.sale_price) then
      raise exception 'plan_basic_offers';
    end if;
    if new.preorder_hours is not null and (tg_op = 'INSERT' or old.preorder_hours is distinct from new.preorder_hours) then
      raise exception 'plan_basic_preorder';
    end if;
  end if;
  lim := case pl when 'basic' then 30 else 60 end;
  if new.is_active and (tg_op = 'INSERT' or not old.is_active)
     and (select count(*) from public.products where merchant_id = new.merchant_id and is_active and id <> new.id) >= lim then
    raise exception '%', case pl when 'basic' then 'plan_basic_products' else 'plan_family_products' end;
  end if;
  return new;
end $$;

create or replace function public.merchant_staff_plan_limits()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() and public.merchant_plan(new.merchant_id) in ('basic','family') then
    raise exception 'plan_basic_staff';
  end if;
  return new;
end $$;

create or replace function public.set_live_location(la double precision, ln double precision)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare m record; t timestamptz := now();
begin
  select * into m from public.merchants where id = auth.uid();
  if m is null or m.status <> 'approved' then raise exception 'not_approved'; end if;
  if m.kind <> 'mobile' then raise exception 'live_mobile_only'; end if;
  if m.plan = 'basic' then raise exception 'plan_basic_live'; end if;
  if la is null then
    update public.merchants set live_lat = null, live_lng = null, live_at = null where id = m.id;
    return null;
  end if;
  if la not between 16 and 33 or ln not between 34 and 56 then raise exception 'bad_location'; end if;
  update public.merchants set live_lat = round(la::numeric, 6), live_lng = round(ln::numeric, 6), live_at = t where id = m.id;
  return t;
end $$;
revoke all on function public.set_live_location(double precision, double precision) from public, anon;
grant execute on function public.set_live_location(double precision, double precision) to authenticated;

create or replace function public.end_expired_trials()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with ended as (
    update public.merchants set plan = next_plan
    where plan = 'free' and trial_started_at is not null
      and trial_started_at + make_interval(months => trial_months) <= now()
    returning id, plan
  ), basic as (select id from ended where plan = 'basic'),
  lim as (select id from ended where plan in ('basic','family')),
  p as (update public.products set sale_price = null, offer_ends_at = null, offer_reason = null, preorder_hours = null
        where merchant_id in (select id from basic) and (sale_price is not null or preorder_hours is not null) returning 1),
  s as (update public.store_settings set delivers = false, pickup = true
        where merchant_id in (select id from basic) and delivers returning 1),
  l as (update public.merchants set live_lat = null, live_lng = null, live_at = null
        where id in (select id from basic) and live_at is not null returning 1),
  t as (update public.merchant_staff set status = 'suspended'
        where merchant_id in (select id from lim) and status = 'active' returning 1)
  select count(*) into n from ended;
  return n;
end $$;

create or replace function public.mark_site_verified(mid uuid, note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  update public.merchants set site_verified_at = now(), site_verified_note = nullif(trim(note), '') where id = mid;
end $$;
revoke all on function public.mark_site_verified(uuid, text) from public, anon;
grant execute on function public.mark_site_verified(uuid, text) to authenticated;
