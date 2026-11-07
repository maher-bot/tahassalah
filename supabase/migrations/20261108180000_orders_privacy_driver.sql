-- خصوصية بيانات المشتري في الطلبات (سدايا: كل واحد يشوف اللي يحتاجه لشغله فقط):
-- - الكاشير وصاحب المحل: الاسم والمنتجات والمبلغ. جوال الزبون وعنوانه يطلعون لهم في طلبات الاستلام من المحل فقط.
-- - المندوب المكلّف: الجوال والعنوان والموقع، وهو مكلّف بالطلب فقط (جاهز / في الطريق). بعد التسليم تنقفل.
-- - المشتري يشوف طلبه كامل.
-- القراءة صارت من orders_v (تخفي الحقول حسب مين يقرأ)، والجدول نفسه ما ينقرأ مباشرة.

create or replace function public.can_see_order_id(oid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.orders o where o.id = oid and public.can_see_order(o));
$$;
revoke all on function public.can_see_order_id(uuid) from public, anon;
grant execute on function public.can_see_order_id(uuid) to authenticated;

-- من يحق له يشوف بيانات التواصل والموقع
create or replace function public.order_contact_ok(o public.orders)
returns boolean language sql stable security definer set search_path = public as $$
  select o.buyer_id = auth.uid() or public.is_admin()
      or (o.driver_user_id = auth.uid() and o.status in ('ready', 'out'))
      or (o.fulfillment = 'pickup' and o.status in ('placed', 'accepted', 'preparing', 'ready')
          and (o.merchant_id = auth.uid() or public.staff_has(o.merchant_id, 'orders')));
$$;
revoke all on function public.order_contact_ok(public.orders) from public, anon;
grant execute on function public.order_contact_ok(public.orders) to authenticated;

drop view if exists public.orders_v;
create view public.orders_v with (security_invoker = false) as
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
         (select coalesce(jsonb_agg(jsonb_build_object('name', i.name, 'qty', i.qty, 'price', i.price, 'line_total', i.line_total) order by i.name), '[]')
            from public.order_items i where i.order_id = o.id) as items
  from public.orders o join public.merchants m on m.id = o.merchant_id
  where public.can_see_order(o);
revoke all on public.orders_v from public, anon;
grant select on public.orders_v to authenticated;

-- الجدول نفسه ما ينقرأ مباشرة (كل القراءة من orders_v)، والكتابة من الدوال فقط
drop policy if exists "orders: parties read" on public.orders;
revoke select on public.orders from authenticated, anon;
drop policy if exists "order items: parties read" on public.order_items;
create policy "order items: parties read" on public.order_items for select to authenticated using (public.can_see_order_id(order_id));

-- إيصال تحويل الطلب: يقرأه المحل وموظفين الطلبات
create or replace function public.order_proof_readable(path text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.orders o where o.payment_proof = path
                 and (o.merchant_id = auth.uid() or public.staff_has(o.merchant_id, 'orders')));
$$;
revoke all on function public.order_proof_readable(text) from public, anon;
grant execute on function public.order_proof_readable(text) to authenticated;
drop policy if exists "receipts: order proof read" on storage.objects;
create policy "receipts: order proof read" on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and public.order_proof_readable(name));

-- place_order و order_action ترجع orders كاملة لمن ناداها؛ نخليها ترجع رقم الطلب وحالته فقط
-- (المشتري يقرأ طلبه من orders_v). نغلف المخرجات بدوال ترجع jsonb مختصر.
create or replace function public.order_action_v(oid uuid, action text, args jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  o := public.order_action(oid, action, args);
  return jsonb_build_object('id', o.id, 'number', o.number, 'status', o.status, 'payment_status', o.payment_status);
end $$;
revoke all on function public.order_action_v(uuid, text, jsonb) from public, anon;
grant execute on function public.order_action_v(uuid, text, jsonb) to authenticated;
revoke execute on function public.order_action(uuid, text, jsonb) from authenticated;
