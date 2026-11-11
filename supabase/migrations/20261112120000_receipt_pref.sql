-- المشتري يختار وقت الطلب: بدون فاتورة، أو فاتورة ورقية مع الطلب، أو على الواتساب.
-- الواتساب: المشتري وافق يوصله الإيصال على جواله، فرقمه يطلع للمحل (صاحب المحل وكاشير الطلبات) لهذا الغرض.
alter table public.orders add column if not exists receipt_pref text not null default 'none' check (receipt_pref in ('none', 'paper', 'whatsapp'));
alter table public.orders add column if not exists receipt_sent_at timestamptz;

create or replace function public.order_set_receipt(oid uuid, pref text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if pref not in ('none', 'paper', 'whatsapp') then raise exception 'invalid'; end if;
  update public.orders set receipt_pref = pref
  where id = oid and buyer_id = auth.uid() and status not in ('delivered', 'picked_up', 'rejected', 'cancelled');
  if not found then raise exception 'not_allowed'; end if;
end $$;
revoke all on function public.order_set_receipt(uuid, text) from public, anon;
grant execute on function public.order_set_receipt(uuid, text) to authenticated;

-- الكاشير يعلّم إنه أرسل الإيصال واتساب
create or replace function public.order_receipt_sent(oid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.orders o set receipt_sent_at = now()
  where o.id = oid and (o.merchant_id = auth.uid() or public.staff_has(o.merchant_id, 'orders'));
end $$;
revoke all on function public.order_receipt_sent(uuid) from public, anon;
grant execute on function public.order_receipt_sent(uuid) to authenticated;

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
         o.collect_at, o.express, o.express_fee, o.turnaround_hours, o.return_due_at, o.collected_at,
         case when public.order_staff_ok(o) then o.collect_photos end as collect_photos,
         o.collect_driver_staff_id, o.collect_driver_user_id, o.collect_driver_name, o.adjust_pending, o.adjust_note,
         (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'qty', i.qty, 'price', i.price, 'line_total', i.line_total) order by i.name), '[]')
            from public.order_items i where i.order_id = o.id) as items,
         case when public.order_staff_ok(o) then o.delivery_photos end as delivery_photos,
         case when public.order_staff_ok(o) then o.pickup_photos end as pickup_photos,
         o.cash_handover_id,
         case when public.order_staff_ok(o) then (select coalesce(jsonb_agg(jsonb_build_object('a', e.action, 'by', e.actor_name, 'at', e.at) order by e.at), '[]')
            from public.order_events e where e.order_id = o.id and e.action <> 'cancel') end as history,
         case when o.buyer_id = auth.uid() then o.handover_code end as handover_code,
         (o.handover_code is not null) as code_needed,
         (o.code_verified_at is not null or o.code_override_at is not null) as code_ok,
         o.code_attempts >= 5 as code_locked, o.code_help_at, o.code_override_by, o.code_override_reason, o.buyer_confirmed_at,
         o.receipt_pref, o.receipt_sent_at,
         case when o.receipt_pref = 'whatsapp' and public.order_staff_ok(o) then o.buyer_phone end as receipt_phone
  from public.orders o join public.merchants m on m.id = o.merchant_id
  where public.can_see_order(o);
revoke all on public.orders_v from public, anon;
grant select on public.orders_v to authenticated;
