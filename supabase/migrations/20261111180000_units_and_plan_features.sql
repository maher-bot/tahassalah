-- 1) وحدة البيع لكل منتج (وجبة، قطعة، حبة، كرتون...) و«متوفر دائمًا» للمطاعم والخدمات (بدون عدّ كمية).
-- 2) تقسيم الميزات على الباقات:
--    - «مميز» (pro) والفترة المجانية: كاشيرية الكاونتر والمناوبات، العهدة، ربط المخزون، سجل الحركات، والموظفين بلا حد.
--    - «تاجر» (trader): حتى 2 بصلاحية الطلبات (كاشير) و2 مندوبين.
--    - «أسر ومتجولين» و«أساسية»: بدون موظفين (مثل قبل).

-- ============ 1) الوحدة ============
alter table public.products add column if not exists unit text check (unit is null or char_length(unit) between 1 and 20);
alter table public.products add column if not exists always_available boolean not null default false;

-- الموظف بدون صلاحية المنتجات ما يغيّر الوحدة ولا «متوفر دائمًا»
do $$
declare d text;
begin
  d := pg_get_functiondef('public.products_guard()'::regprocedure);
  d := replace(d, 'new.preorder_hours := old.preorder_hours;', 'new.preorder_hours := old.preorder_hours; new.unit := old.unit; new.always_available := old.always_available;');
  if d not like '%new.always_available := old.always_available%' then raise exception 'patch failed'; end if;
  execute d;
end $$;

-- «متوفر دائمًا»: الطلب ما يفحص الكمية ولا ينقصها
do $$
declare d text;
begin
  d := pg_get_functiondef('public.place_order(uuid, jsonb, text, text, text, double precision, double precision, text, timestamp with time zone, boolean)'::regprocedure);
  d := replace(d, 'if p.quantity is not null and not coalesce(ss.service_roundtrip, false) and p.quantity < q then',
                  'if p.quantity is not null and not p.always_available and not coalesce(ss.service_roundtrip, false) and p.quantity < q then');
  d := replace(d, 'if p.quantity is not null and not coalesce(ss.service_roundtrip, false) then perform public.order_stock_adjust',
                  'if p.quantity is not null and not p.always_available and not coalesce(ss.service_roundtrip, false) then perform public.order_stock_adjust');
  if (select count(*) from regexp_matches(d, 'not p.always_available', 'g')) <> 2 then raise exception 'patch failed'; end if;
  execute d;
end $$;

create or replace function public.order_stock_adjust(pid uuid, delta integer)
returns void language plpgsql security definer set search_path = public as $$
declare claims text := current_setting('request.jwt.claims', true);
begin
  perform set_config('request.jwt.claims', '{}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  update public.products set quantity = quantity + delta where id = pid and quantity is not null and not always_available;
  perform set_config('request.jwt.claims', coalesce(claims, ''), true);
end $$;

-- ============ 2) الباقات ============
-- ميزات «مميز»: الباقة المميزة، أو الفترة المجانية (يجرّب كل شي)
create or replace function public.plan_pro(mid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select plan in ('pro', 'free') from public.merchants where id = mid), false) or public.is_admin();
$$;
revoke all on function public.plan_pro(uuid) from public, anon;
grant execute on function public.plan_pro(uuid) to authenticated;

-- للواجهة: باقة المحل وهل ميزات «مميز» متاحة (للموظفين بعد)
create or replace function public.store_features(mid uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('plan', m.plan, 'pro', public.plan_pro(mid), 'activity', m.activity)
  from public.merchants m where m.id = mid and (mid = auth.uid() or exists (select 1 from public.merchant_staff s where s.merchant_id = mid and s.user_id = auth.uid() and s.status = 'active'));
$$;
revoke all on function public.store_features(uuid) from public, anon;
grant execute on function public.store_features(uuid) to authenticated;

-- حدود الموظفين: «تاجر» 2 كاشير و2 مندوب، «مميز» بلا حد، «أسر/أساسية» بدون موظفين
create or replace function public.merchant_staff_plan_limits()
returns trigger language plpgsql security definer set search_path = public as $$
declare pl text := public.merchant_plan(new.merchant_id);
begin
  if public.is_admin() then return new; end if;
  if pl in ('basic', 'family') then raise exception 'plan_basic_staff'; end if;
  if pl = 'trader' and new.status <> 'suspended' then
    if 'orders' = any(new.perms) and (select count(*) from public.merchant_staff where merchant_id = new.merchant_id and id <> new.id
        and status <> 'suspended' and 'orders' = any(perms)) >= 2 then raise exception 'plan_trader_cashiers'; end if;
    if 'delivery' = any(new.perms) and (select count(*) from public.merchant_staff where merchant_id = new.merchant_id and id <> new.id
        and status <> 'suspended' and 'delivery' = any(perms)) >= 2 then raise exception 'plan_trader_drivers'; end if;
  end if;
  return new;
end $$;
drop trigger if exists merchant_staff_plan_limits on public.merchant_staff;
create trigger merchant_staff_plan_limits before insert or update of perms, status on public.merchant_staff
  for each row execute function public.merchant_staff_plan_limits();

-- الحد العام 10 موظفين: يبقى لـ«تاجر»، و«مميز» بلا حد
do $$
declare d text;
begin
  d := pg_get_functiondef('public.merchant_staff_guard()'::regprocedure);
  d := replace(d, 'if (select count(*) from public.merchant_staff where merchant_id = new.merchant_id) >= 10 then',
                  'if not public.plan_pro(new.merchant_id) and (select count(*) from public.merchant_staff where merchant_id = new.merchant_id) >= 10 then');
  if d not like '%not public.plan_pro(new.merchant_id) and%' then raise exception 'patch failed'; end if;
  execute d;
end $$;

-- ميزات «مميز» على الخادم
do $$
declare d text;
begin
  -- كاشيرية الكاونتر
  d := pg_get_functiondef('public.cashier_save(uuid, text, text, text, boolean)'::regprocedure);
  d := replace(d, $r$  if not exists (select 1 from public.merchants where id = auth.uid()) then raise exception 'not_allowed'; end if;$r$,
                  $r$  if not exists (select 1 from public.merchants where id = auth.uid()) then raise exception 'not_allowed'; end if;
  if not public.plan_pro(auth.uid()) then raise exception 'plan_pro_required'; end if;$r$);
  d := replace(d, '>= 30 then raise exception', '>= 200 then raise exception');
  if d not like '%plan_pro_required%' then raise exception 'patch failed: cashier_save'; end if;
  execute d;
  -- المناوبات
  d := pg_get_functiondef('public.shift_start(uuid, uuid, text, numeric)'::regprocedure);
  d := replace(d, $r$  if public.open_shift_id(mid) is not null then$r$,
                  $r$  if not public.plan_pro(mid) then return jsonb_build_object('ok', false, 'error', 'plan_pro_required'); end if;
  if public.open_shift_id(mid) is not null then$r$);
  if d not like '%plan_pro_required%' then raise exception 'patch failed: shift_start'; end if;
  execute d;
  -- استلام كاش المندوبين
  d := pg_get_functiondef('public.receive_cash(uuid, uuid, numeric, text)'::regprocedure);
  d := replace(d, $r$  if received is null or received < 0$r$,
                  $r$  if not public.plan_pro(mid) then raise exception 'plan_pro_required'; end if;
  if received is null or received < 0$r$);
  if d not like '%plan_pro_required%' then raise exception 'patch failed: receive_cash'; end if;
  execute d;
  -- مفتاح ربط المخزون
  d := pg_get_functiondef('public.pos_key_create()'::regprocedure);
  d := replace(d, $r$  k := 'tah_'$r$, $r$  if not public.plan_pro(auth.uid()) then raise exception 'plan_pro_required'; end if;
  k := 'tah_'$r$);
  if d not like '%plan_pro_required%' then raise exception 'patch failed: pos_key_create'; end if;
  execute d;
  -- تحديث المخزون من نظام الكاشير
  d := pg_get_functiondef('public.pos_stock_sync(text, jsonb)'::regprocedure);
  d := replace(d, $r$  if mid is null then raise exception 'bad_key'; end if;$r$,
                  $r$  if mid is null then raise exception 'bad_key'; end if;
  if not coalesce((select plan in ('pro', 'free') from public.merchants where id = mid), false) then raise exception 'plan_pro_required'; end if;$r$);
  if d not like '%plan_pro_required%' then raise exception 'patch failed: pos_stock_sync'; end if;
  execute d;
end $$;

-- عهدة المندوبين تطلع لـ«مميز» فقط
create or replace function public.driver_custody(mid uuid)
returns table (driver_user_id uuid, driver_name text, amount numeric, orders int, oldest timestamptz)
language sql stable security definer set search_path = public as $$
  select o.driver_user_id, max(o.driver_name), sum(o.collected_amount), count(*)::int, min(o.done_at)
  from public.orders o
  where o.merchant_id = mid and (mid = auth.uid() or public.staff_has(mid, 'orders')) and public.plan_pro(mid)
    and o.driver_user_id is not null and o.status = 'delivered' and o.collected_method = 'cash'
    and o.collected_amount is not null and o.cash_handover_id is null
  group by o.driver_user_id order by 3 desc;
$$;
