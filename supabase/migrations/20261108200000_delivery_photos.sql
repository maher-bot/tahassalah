-- صورة التسليم: المندوب يصوّر الطلب عند الزبون، وبها يكتمل التوصيل. تنحفظ مع صور الاستلام ويشوفها أطراف الطلب.
alter table public.orders add column if not exists delivery_photos text[];

do $$
declare d text;
begin
  d := pg_get_functiondef('public.order_action(uuid, text, jsonb)'::regprocedure);
  d := replace(d, $r$    o.status := 'delivered'; o.done_at := now();$r$, $r$    o.status := 'delivered'; o.done_at := now();
    if jsonb_typeof(args->'photos') = 'array' then
      o.delivery_photos := array(select jsonb_array_elements_text(args->'photos') limit 4);
      if exists (select 1 from unnest(o.delivery_photos) x where x !~ ('^' || auth.uid()::text || '/')) then raise exception 'bad_photo'; end if;
    end if;$r$);
  d := replace(d, 'collect_photos = o.collect_photos,', 'collect_photos = o.collect_photos, delivery_photos = o.delivery_photos,');
  if d not like '%delivery_photos = o.delivery_photos%' then raise exception 'patch failed'; end if;
  execute d;
end $$;
revoke all on function public.order_action(uuid, text, jsonb) from public, anon, authenticated;

create or replace view public.orders_v with (security_invoker = false) as
  select o.id, o.number, o.merchant_id, m.store_name, m.lat as store_lat, m.lng as store_lng, m.district as store_district,
         o.buyer_id, o.buyer_name,
         case when public.order_contact_ok(o) then o.buyer_phone end as buyer_phone,
         case when public.order_contact_ok(o) then o.address end as address,
         case when public.order_contact_ok(o) then o.lat end as lat,
         case when public.order_contact_ok(o) then o.lng end as lng,
         o.fulfillment, o.note, o.payment_method, o.payment_status, o.payment_proof, o.status,
         o.subtotal, o.delivery_fee, o.total, o.driver_staff_id, o.driver_user_id, o.driver_name,
         o.collected_amount, o.collected_method, o.reason, o.created_at, o.updated_at,
         o.accepted_at, o.ready_at, o.out_at, o.done_at, o.paid_at,
         o.collect_at, o.express, o.express_fee, o.turnaround_hours, o.return_due_at, o.collected_at, o.collect_photos,
         o.collect_driver_staff_id, o.collect_driver_user_id, o.collect_driver_name, o.adjust_pending, o.adjust_note,
         (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'qty', i.qty, 'price', i.price, 'line_total', i.line_total) order by i.name), '[]')
            from public.order_items i where i.order_id = o.id) as items,
         o.delivery_photos
  from public.orders o join public.merchants m on m.id = o.merchant_id
  where public.can_see_order(o);

create or replace function public.order_photo_readable(path text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.orders o where (path = any(o.collect_photos) or path = any(o.delivery_photos)) and public.can_see_order(o));
$$;
