-- رمز التسليم: كل طلب له رمز 4 أرقام يشوفه المشتري فقط. المندوب (أو الكاشير في الاستلام من المحل)
-- يكتب الرمز اللي يقوله الزبون، والتسليم ما يكتمل إلا بالرمز الصح. 5 محاولات غلط تقفل الرمز.
-- لو الزبون ما عنده الرمز: المندوب يطلب مساعدة، والكاشير/صاحب المحل يوافق على «تسليم بدون رمز» مع السبب (ينحفظ باسمه).

alter table public.orders add column if not exists handover_code text;
alter table public.orders add column if not exists code_attempts int not null default 0;
alter table public.orders add column if not exists code_verified_at timestamptz;
alter table public.orders add column if not exists code_help_at timestamptz;
alter table public.orders add column if not exists code_override_at timestamptz;
alter table public.orders add column if not exists code_override_by text;
alter table public.orders add column if not exists code_override_reason text;

create or replace function public.orders_set_code()
returns trigger language plpgsql set search_path = public, extensions as $$
begin
  new.handover_code := lpad((abs(('x' || encode(gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 10000)::text, 4, '0');
  return new;
end $$;
drop trigger if exists orders_set_code on public.orders;
create trigger orders_set_code before insert on public.orders for each row execute function public.orders_set_code();

-- التحقق من الرمز (ما يرمي استثناء عشان المحاولة الغلط تنحسب)
create or replace function public.order_verify_code(oid uuid, code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  select * into o from public.orders where id = oid for update;
  if o.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not ((o.driver_user_id is not null and o.driver_user_id = auth.uid()) or o.merchant_id = auth.uid() or public.staff_has(o.merchant_id, 'orders')) then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;
  if not ((o.fulfillment = 'pickup' and o.status in ('accepted', 'preparing', 'ready')) or (o.fulfillment <> 'pickup' and o.status = 'out')) then
    return jsonb_build_object('ok', false, 'error', 'invalid_state');
  end if;
  if o.handover_code is null or o.code_verified_at is not null or o.code_override_at is not null then return jsonb_build_object('ok', true); end if;
  if o.code_attempts >= 5 then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
  if regexp_replace(coalesce(code, ''), '\D', '', 'g') = o.handover_code then
    update public.orders set code_verified_at = now() where id = oid;
    insert into public.order_events (order_id, merchant_id, action, actor_id, actor_name, shift_id)
      values (o.id, o.merchant_id, 'code_ok', auth.uid(), public.actor_label(o.merchant_id), public.open_shift_id(o.merchant_id));
    return jsonb_build_object('ok', true);
  end if;
  update public.orders set code_attempts = code_attempts + 1 where id = oid;
  return jsonb_build_object('ok', false, 'error', case when o.code_attempts + 1 >= 5 then 'locked' else 'bad_code' end, 'left', greatest(0, 4 - o.code_attempts));
end $$;
revoke all on function public.order_verify_code(uuid, text) from public, anon;
grant execute on function public.order_verify_code(uuid, text) to authenticated;

-- order_action: التسليم يحتاج الرمز، وإجراءين جديدين: code_help (المندوب يطلب مساعدة) وcode_override (الكاشير يوافق بدون رمز)
do $$
declare d text; n int;
begin
  d := pg_get_functiondef('public.order_action(uuid, text, jsonb)'::regprocedure);
  n := length(d);
  d := replace(d, $r$    if o.fulfillment <> 'pickup' or o.status not in ('accepted', 'preparing', 'ready') then raise exception 'invalid_state'; end if;$r$,
    $r$    if o.fulfillment <> 'pickup' or o.status not in ('accepted', 'preparing', 'ready') then raise exception 'invalid_state'; end if;
    if o.handover_code is not null and o.code_verified_at is null and o.code_override_at is null then raise exception 'code_required'; end if;$r$);
  d := replace(d, $r$    if o.status <> 'out' then raise exception 'invalid_state'; end if;
    o.status := 'delivered';$r$,
    $r$    if o.status <> 'out' then raise exception 'invalid_state'; end if;
    if o.handover_code is not null and o.code_verified_at is null and o.code_override_at is null then raise exception 'code_required'; end if;
    o.status := 'delivered';$r$);
  d := replace(d, $r$  else
    raise exception 'not_allowed';$r$,
    $r$  elsif (driver or staff) and action = 'code_help' then
    if o.status <> 'out' then raise exception 'invalid_state'; end if;
    o.code_help_at := now();
  elsif staff and action = 'code_override' then
    if not ((o.fulfillment = 'pickup' and o.status in ('accepted', 'preparing', 'ready')) or (o.fulfillment <> 'pickup' and o.status = 'out')) then raise exception 'invalid_state'; end if;
    if char_length(coalesce(trim(args->>'reason'), '')) < 3 then raise exception 'reason_required'; end if;
    o.code_override_at := now(); o.code_override_by := public.actor_label(o.merchant_id); o.code_override_reason := left(trim(args->>'reason'), 300);
  else
    raise exception 'not_allowed';$r$);
  d := replace(d, $r$collected_amount = o.collected_amount, collected_method = o.collected_method, updated_at = o.updated_at$r$,
    $r$collected_amount = o.collected_amount, collected_method = o.collected_method, updated_at = o.updated_at,
    code_help_at = o.code_help_at, code_override_at = o.code_override_at, code_override_by = o.code_override_by, code_override_reason = o.code_override_reason$r$);
  if (select count(*) from regexp_matches(d, 'code_required', 'g')) <> 2 or d not like '%code_override_reason = o.code_override_reason%' or d not like '%action = ''code_help''%' then
    raise exception 'patch failed';
  end if;
  execute d;
end $$;
revoke all on function public.order_action(uuid, text, jsonb) from public, anon, authenticated;

-- تنبيه المحل لما المندوب يطلب مساعدة أو ينقفل الرمز
create or replace function public.notify_order_push()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare s public.notify_settings;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status and new.driver_user_id is not distinct from old.driver_user_id
     and new.collect_driver_user_id is not distinct from old.collect_driver_user_id and new.payment_status is not distinct from old.payment_status
     and new.adjust_pending is not distinct from old.adjust_pending and new.code_help_at is not distinct from old.code_help_at
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

-- orders_v: الرمز للمشتري فقط
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
         o.code_attempts >= 5 as code_locked, o.code_help_at, o.code_override_by, o.code_override_reason
  from public.orders o join public.merchants m on m.id = o.merchant_id
  where public.can_see_order(o);
revoke all on public.orders_v from public, anon;
grant select on public.orders_v to authenticated;
