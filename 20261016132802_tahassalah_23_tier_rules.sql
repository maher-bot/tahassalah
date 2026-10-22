-- الباقة بعد الفترة المجانية + دورة الدفع
create or replace function public.set_plan_choice(p text, b text default 'monthly')
returns void language plpgsql security definer set search_path = public as $$
begin
  if p not in ('basic', 'trader', 'pro') then raise exception 'invalid plan'; end if;
  if b not in ('monthly', 'yearly') then raise exception 'invalid billing'; end if;
  update public.merchants set next_plan = p, billing = b where id = auth.uid();
end $$;
revoke execute on function public.set_plan_choice(text, text) from public, anon;
grant execute on function public.set_plan_choice(text, text) to authenticated;

create or replace function public.set_next_plan(p text)
returns void language sql security definer set search_path = public as $$
  select public.set_plan_choice(p, coalesce((select billing from public.merchants where id = auth.uid()), 'monthly'));
$$;

-- التاجر الجديد يبدأ دائمًا بالفترة المجانية بكل المزايا
create or replace function public.merchants_founder()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
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

create or replace function public.merchant_plan(mid uuid)
returns text language sql stable security definer set search_path = public as $$
  select plan from public.merchants where id = mid;
$$;

-- حدود الباقة الأساسية المجانية: 30 منتج ظاهر، بدون عروض، بدون توصيل، بدون موظفين
create or replace function public.products_plan_limits()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin() or public.merchant_plan(new.merchant_id) <> 'basic' then return new; end if;
  if new.sale_price is not null and (tg_op = 'INSERT' or old.sale_price is distinct from new.sale_price) then
    raise exception 'plan_basic_offers';
  end if;
  if new.is_active and (tg_op = 'INSERT' or not old.is_active)
     and (select count(*) from public.products where merchant_id = new.merchant_id and is_active and id <> new.id) >= 30 then
    raise exception 'plan_basic_products';
  end if;
  return new;
end $$;
create trigger products_plan_limits before insert or update on public.products
  for each row execute function public.products_plan_limits();

create or replace function public.store_settings_plan_limits()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.delivers and not public.is_admin() and public.merchant_plan(new.merchant_id) = 'basic' then
    raise exception 'plan_basic_delivery';
  end if;
  return new;
end $$;
create trigger store_settings_plan_limits before insert or update on public.store_settings
  for each row execute function public.store_settings_plan_limits();

create or replace function public.merchant_staff_plan_limits()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() and public.merchant_plan(new.merchant_id) = 'basic' then
    raise exception 'plan_basic_staff';
  end if;
  return new;
end $$;
create trigger merchant_staff_plan_limits before insert on public.merchant_staff
  for each row execute function public.merchant_staff_plan_limits();

-- نهاية الفترة المجانية: ينتقل للباقة اللي اختارها، والأساسية توقف المزايا المدفوعة
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
  p as (update public.products set sale_price = null, offer_ends_at = null, offer_reason = null
        where merchant_id in (select id from basic) and sale_price is not null returning 1),
  s as (update public.store_settings set delivers = false, pickup = true
        where merchant_id in (select id from basic) and delivers returning 1),
  t as (update public.merchant_staff set status = 'suspended'
        where merchant_id in (select id from basic) and status = 'active' returning 1)
  select count(*) into n from ended;
  return n;
end $$;

revoke execute on function public.products_plan_limits() from public, anon, authenticated;
revoke execute on function public.store_settings_plan_limits() from public, anon, authenticated;
revoke execute on function public.merchant_staff_plan_limits() from public, anon, authenticated;
revoke execute on function public.merchant_plan(uuid) from anon;
