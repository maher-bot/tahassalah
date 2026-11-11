-- تأكيد الاستلام من المشتري: الطلب المدفوع مسبقًا (تحويل، تابي، تمارا) يأكّده المشتري بزر «استلمت طلبي» بدون تواصل،
-- والرمز يبقى احتياط. الطلب غير المدفوع (كاش/شبكة عند التوصيل) يبقى بالرمز.
alter table public.orders add column if not exists buyer_confirmed_at timestamptz;

do $$
declare d text;
begin
  d := pg_get_functiondef('public.order_action(uuid, text, jsonb)'::regprocedure);
  d := replace(d, $r$  elsif (driver or staff) and action = 'code_help' then$r$,
    $r$  elsif action = 'buyer_confirm' and o.buyer_id = auth.uid() then
    if o.status <> 'out' or o.payment_status <> 'paid' then raise exception 'invalid_state'; end if;
    o.code_verified_at := coalesce(o.code_verified_at, now()); o.buyer_confirmed_at := now();
  elsif (driver or staff) and action = 'code_help' then$r$);
  d := replace(d, $r$code_override_reason = o.code_override_reason$r$,
    $r$code_override_reason = o.code_override_reason, code_verified_at = o.code_verified_at, buyer_confirmed_at = o.buyer_confirmed_at$r$);
  if d not like '%action = ''buyer_confirm''%' or d not like '%buyer_confirmed_at = o.buyer_confirmed_at%' then raise exception 'patch failed'; end if;
  execute d;
end $$;
revoke all on function public.order_action(uuid, text, jsonb) from public, anon, authenticated;

create or replace function public.notify_order_push()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare s public.notify_settings;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status and new.driver_user_id is not distinct from old.driver_user_id
     and new.collect_driver_user_id is not distinct from old.collect_driver_user_id and new.payment_status is not distinct from old.payment_status
     and new.adjust_pending is not distinct from old.adjust_pending and new.code_help_at is not distinct from old.code_help_at and new.buyer_confirmed_at is not distinct from old.buyer_confirmed_at
     and not (new.code_attempts >= 5 and old.code_attempts < 5) then
    return new;
  end if;
  select * into s from public.notify_settings where id;
  if s is null then return new; end if;
  perform net.http_post(url := replace(s.function_url, '/notify', '/push'),
    body := jsonb_build_object('type', tg_op, 'record', to_jsonb(new), 'old_record', case when tg_op = 'UPDATE' then to_jsonb(old) end),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', s.webhook_secret),
    timeout_milliseconds := 10000);
  return new;
end $$;

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
         o.code_attempts >= 5 as code_locked, o.code_help_at, o.code_override_by, o.code_override_reason, o.buyer_confirmed_at
  from public.orders o join public.merchants m on m.id = o.merchant_id
  where public.can_see_order(o);
revoke all on public.orders_v from public, anon;
grant select on public.orders_v to authenticated;
