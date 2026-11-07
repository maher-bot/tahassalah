-- صور الاستلام والتسليم تطلع للكاشير وصاحب المحل (والإدارة) فقط، مو للمندوب ولا للزبون.
-- (المندوب يصوّر من كاميرا الصفحة مباشرة، والصورة ما تنحفظ في جواله.)
create or replace function public.order_staff_ok(o public.orders)
returns boolean language sql stable security definer set search_path = public as $$
  select o.merchant_id = auth.uid() or public.staff_has(o.merchant_id, 'orders') or public.is_admin();
$$;
revoke all on function public.order_staff_ok(public.orders) from public, anon;
grant execute on function public.order_staff_ok(public.orders) to authenticated;

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
         o.collect_at, o.express, o.express_fee, o.turnaround_hours, o.return_due_at, o.collected_at,
         case when public.order_staff_ok(o) then o.collect_photos end as collect_photos,
         o.collect_driver_staff_id, o.collect_driver_user_id, o.collect_driver_name, o.adjust_pending, o.adjust_note,
         (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'qty', i.qty, 'price', i.price, 'line_total', i.line_total) order by i.name), '[]')
            from public.order_items i where i.order_id = o.id) as items,
         case when public.order_staff_ok(o) then o.delivery_photos end as delivery_photos
  from public.orders o join public.merchants m on m.id = o.merchant_id
  where public.can_see_order(o);

create or replace function public.order_photo_readable(path text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.orders o where (path = any(o.collect_photos) or path = any(o.delivery_photos)) and public.order_staff_ok(o));
$$;
