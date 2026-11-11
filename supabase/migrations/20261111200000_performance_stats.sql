-- مؤشرات الأداء:
-- 1) store_stats: لصاحب المحل في الباقة المميزة (أو الفترة المجانية): الطلبات والمبيعات، المنتجات الأكثر طلبًا، أداء المندوبين والكاشيرية.
-- 2) admin_stats: للإدارة بدون أي مبالغ: عدد الطلبات والقطع المباعة لكل محل، والمنتجات الأكثر طلبًا، وأداء المنصة كاملة.

create or replace function public.store_stats(mid uuid, days int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(days, 30), 365))); r jsonb;
begin
  if mid is distinct from auth.uid() then raise exception 'not_allowed'; end if;
  if not public.plan_pro(mid) then raise exception 'plan_pro_required'; end if;
  with o as (select * from public.orders where merchant_id = mid and created_at >= since),
  done as (select * from o where status in ('delivered', 'picked_up')),
  items as (select i.* from public.order_items i join done on done.id = i.order_id)
  select jsonb_build_object(
    'days', days,
    'orders', (select count(*) from o),
    'done', (select count(*) from done),
    'rejected', (select count(*) from o where status = 'rejected'),
    'cancelled', (select count(*) from o where status = 'cancelled'),
    'active', (select count(*) from o where status not in ('delivered', 'picked_up', 'rejected', 'cancelled')),
    'sales', (select coalesce(sum(total), 0) from done),
    'avg_order', (select coalesce(round(avg(total), 2), 0) from done),
    'items_sold', (select coalesce(sum(qty), 0) from items),
    'buyers', (select count(distinct buyer_id) from done),
    'repeat_buyers', (select count(*) from (select buyer_id from done group by buyer_id having count(*) > 1) x),
    'accept_min', (select round(avg(extract(epoch from accepted_at - created_at)) / 60) from o where accepted_at is not null),
    'prep_min', (select round(avg(extract(epoch from ready_at - accepted_at)) / 60) from o where ready_at is not null and accepted_at is not null and fulfillment <> 'roundtrip'),
    'deliver_min', (select round(avg(extract(epoch from done_at - out_at)) / 60) from o where status = 'delivered' and out_at is not null),
    'by_fulfillment', (select coalesce(jsonb_object_agg(fulfillment, n), '{}') from (select fulfillment, count(*) n from done group by 1) x),
    'by_payment', (select coalesce(jsonb_object_agg(payment_method, n), '{}') from (select payment_method, count(*) n from done group by 1) x),
    'by_day', (select coalesce(jsonb_agg(jsonb_build_object('d', d, 'n', n, 's', s) order by d), '[]') from (
        select (created_at at time zone 'Asia/Riyadh')::date d, count(*) n, coalesce(sum(total) filter (where status in ('delivered', 'picked_up')), 0) s from o group by 1) x),
    'by_hour', (select coalesce(jsonb_agg(jsonb_build_object('h', h, 'n', n) order by h), '[]') from (
        select extract(hour from created_at at time zone 'Asia/Riyadh')::int h, count(*) n from o group by 1) x),
    'top_products', (select coalesce(jsonb_agg(x order by x.qty desc), '[]') from (
        select i.name, sum(i.qty)::int qty, sum(i.line_total) rev, count(distinct i.order_id)::int orders from items i group by i.name order by 2 desc limit 15) x),
    'no_sales', (select count(*) from public.products p where p.merchant_id = mid and p.is_active
        and not exists (select 1 from items i where i.product_id = p.id)),
    'low_stock', (select coalesce(jsonb_agg(jsonb_build_object('name', p.name, 'qty', p.quantity, 'unit', p.unit) order by p.quantity), '[]')
        from public.products p where p.merchant_id = mid and p.is_active and not p.always_available and p.quantity <= 5
        and exists (select 1 from items i where i.product_id = p.id)),
    'confirm', jsonb_build_object(
        'code', (select count(*) from done where code_verified_at is not null and buyer_confirmed_at is null),
        'buyer', (select count(*) from done where buyer_confirmed_at is not null),
        'override', (select count(*) from done where code_override_at is not null)),
    'drivers', (select coalesce(jsonb_agg(x order by x.delivered desc), '[]') from (
        select max(driver_name) name, count(*) filter (where status = 'delivered')::int delivered,
               round(avg(extract(epoch from done_at - out_at) / 60) filter (where status = 'delivered' and out_at is not null)) avg_min,
               coalesce(sum(collected_amount) filter (where collected_method = 'cash' and status = 'delivered'), 0) cash,
               coalesce(sum(collected_amount) filter (where collected_method = 'cash' and status = 'delivered' and cash_handover_id is null), 0) cash_held,
               count(*) filter (where code_override_at is not null)::int overrides,
               count(*) filter (where status = 'out')::int on_road
        from o where driver_user_id is not null group by driver_user_id) x),
    'cashiers', (select coalesce(jsonb_agg(x order by x.orders desc), '[]') from (
        select e.actor_name name, count(distinct e.order_id)::int orders,
               count(*) filter (where e.action = 'accept')::int accepted,
               count(*) filter (where e.action = 'reject')::int rejected,
               count(*) filter (where e.action = 'picked_up')::int handed,
               round(avg(extract(epoch from e.at - o.created_at) / 60) filter (where e.action = 'accept')) accept_min
        from public.order_events e join o on o.id = e.order_id
        where e.actor_id is distinct from o.buyer_id and e.actor_id is distinct from o.driver_user_id
          and e.actor_id is distinct from o.collect_driver_user_id
          and e.action in ('accept', 'reject', 'preparing', 'ready', 'assign', 'assign_collect', 'picked_up', 'paid', 'processing', 'code_override', 'code_ok', 'adjust')
        group by e.actor_name) x),
    'shifts', (select coalesce(jsonb_agg(x order by x.shifts desc), '[]') from (
        select cashier_name name, count(*)::int shifts,
               round(sum(extract(epoch from coalesce(ended_at, now()) - started_at)) / 3600, 1) hours,
               coalesce(sum(counted_cash - expected_cash) filter (where ended_at is not null), 0) diff,
               count(*) filter (where ended_at is not null and counted_cash < expected_cash)::int short
        from public.cashier_shifts where merchant_id = mid and started_at >= since group by cashier_name) x)
  ) into r;
  return r;
end $$;
revoke all on function public.store_stats(uuid, int) from public, anon;
grant execute on function public.store_stats(uuid, int) to authenticated;

-- الإدارة: أداء المنصة وكل محل، بدون مبالغ (عدد الطلبات والقطع فقط)
create or replace function public.admin_stats(days int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(days, 30), 365))); r jsonb;
begin
  if not public.is_admin() then raise exception 'not_allowed'; end if;
  with o as (select * from public.orders where created_at >= since),
  done as (select * from o where status in ('delivered', 'picked_up')),
  items as (select i.*, done.merchant_id from public.order_items i join done on done.id = i.order_id),
  m as (select * from public.merchants where status = 'approved')
  select jsonb_build_object(
    'days', days,
    'orders', (select count(*) from o),
    'done', (select count(*) from done),
    'rejected', (select count(*) from o where status = 'rejected'),
    'cancelled', (select count(*) from o where status = 'cancelled'),
    'items_sold', (select coalesce(sum(qty), 0) from items),
    'buyers', (select count(distinct buyer_id) from o),
    'new_buyers', (select count(*) from public.buyers where created_at >= since),
    'repeat_buyers', (select count(*) from (select buyer_id from done group by buyer_id having count(*) > 1) x),
    'stores', (select count(*) from m),
    'stores_selling', (select count(distinct merchant_id) from done),
    'new_stores', (select count(*) from m where created_at >= since),
    'accept_min', (select round(avg(extract(epoch from accepted_at - created_at)) / 60) from o where accepted_at is not null),
    'deliver_min', (select round(avg(extract(epoch from done_at - out_at)) / 60) from o where status = 'delivered' and out_at is not null),
    'by_day', (select coalesce(jsonb_agg(jsonb_build_object('d', d, 'n', n) order by d), '[]') from (
        select (created_at at time zone 'Asia/Riyadh')::date d, count(*) n from o group by 1) x),
    'by_fulfillment', (select coalesce(jsonb_object_agg(fulfillment, n), '{}') from (select fulfillment, count(*) n from done group by 1) x),
    'by_activity', (select coalesce(jsonb_agg(x order by x.orders desc), '[]') from (
        select coalesce(mm.activity, 'غير محدد') activity, count(distinct mm.id)::int stores, count(d.id)::int orders
        from m mm left join done d on d.merchant_id = mm.id group by 1) x),
    'by_district', (select coalesce(jsonb_agg(x order by x.orders desc), '[]') from (
        select coalesce(mm.district, 'غير محدد') district, count(distinct mm.id)::int stores, count(d.id)::int orders
        from m mm left join done d on d.merchant_id = mm.id group by 1) x),
    'top_products', (select coalesce(jsonb_agg(x order by x.qty desc), '[]') from (
        select i.name, sum(i.qty)::int qty, count(distinct i.merchant_id)::int stores from items i group by i.name order by 2 desc limit 20) x),
    'store_list', (select coalesce(jsonb_agg(x order by x.done desc, x.store_name), '[]') from (
        select mm.id, mm.store_name, mm.activity, mm.district, mm.plan, mm.kind,
               (select count(*) from public.products p where p.merchant_id = mm.id and p.is_active)::int products,
               (select count(*) from o where o.merchant_id = mm.id)::int orders,
               (select count(*) from done where done.merchant_id = mm.id)::int done,
               (select count(*) from o where o.merchant_id = mm.id and o.status = 'rejected')::int rejected,
               (select coalesce(sum(qty), 0) from items where items.merchant_id = mm.id)::int items_sold,
               (select max(created_at) from public.orders where merchant_id = mm.id) last_order,
               (select coalesce(jsonb_agg(t order by t.qty desc), '[]') from (
                  select i.name, sum(i.qty)::int qty from items i where i.merchant_id = mm.id group by i.name order by 2 desc limit 3) t) top
        from m mm) x)
  ) into r;
  return r;
end $$;
revoke all on function public.admin_stats(int) from public, anon;
grant execute on function public.admin_stats(int) to authenticated;
