-- خدمة «استلام وتسليم» (مغاسل، خياطين، تصليح...): الزبون يختار الخدمات من قائمة الأسعار، ورسوم الاستلام والتسليم
-- (ومجاني فوق مبلغ) و«مستعجل» يحددها التاجر. مشواران: مندوب يستلم من الزبون (يصوّر الأغراض ويقدر يعدّل العدد،
-- والزبون يوافق على الفرق)، المحل ينفّذ، ثم مندوب (نفسه أو غيره) يرجعها ويحصّل. الدفع الافتراضي عند التسليم.

alter table public.store_settings
  add column if not exists service_roundtrip boolean not null default false,
  add column if not exists roundtrip_fee numeric(10,2) not null default 0,
  add column if not exists roundtrip_free_over numeric(10,2),
  add column if not exists turnaround_hours int not null default 48,
  add column if not exists express_enabled boolean not null default false,
  add column if not exists express_fee numeric(10,2) not null default 0,
  add column if not exists express_hours int not null default 24;

alter table public.orders drop constraint if exists orders_fulfillment_check;
alter table public.orders add constraint orders_fulfillment_check check (fulfillment in ('pickup', 'delivery', 'roundtrip'));
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check check (status in ('placed', 'accepted', 'preparing', 'ready', 'out', 'delivered', 'picked_up',
  'rejected', 'cancelled', 'to_collect', 'collecting', 'at_store', 'processing'));
alter table public.orders
  add column if not exists collect_at timestamptz,
  add column if not exists express boolean not null default false,
  add column if not exists express_fee numeric(10,2) not null default 0,
  add column if not exists turnaround_hours int,
  add column if not exists return_due_at timestamptz,
  add column if not exists collected_at timestamptz,
  add column if not exists collect_photos text[],
  add column if not exists collect_driver_staff_id uuid references public.merchant_staff(id) on delete set null,
  add column if not exists collect_driver_user_id uuid,
  add column if not exists collect_driver_name text,
  add column if not exists adjust_pending boolean not null default false,
  add column if not exists adjust_note text;
create index if not exists orders_collect_driver_idx on public.orders (collect_driver_user_id, status);

create or replace function public.can_see_order(o public.orders)
returns boolean language sql stable security definer set search_path = public as $$
  select o.buyer_id = auth.uid() or o.merchant_id = auth.uid() or public.staff_has(o.merchant_id, 'orders')
      or o.driver_user_id = auth.uid() or o.collect_driver_user_id = auth.uid() or public.is_admin();
$$;

create or replace function public.order_contact_ok(o public.orders)
returns boolean language sql stable security definer set search_path = public as $$
  select o.buyer_id = auth.uid() or public.is_admin()
      or (o.driver_user_id = auth.uid() and o.status in ('ready', 'out'))
      or (o.collect_driver_user_id = auth.uid() and o.status in ('to_collect', 'collecting'))
      or (o.fulfillment = 'pickup' and o.status in ('placed', 'accepted', 'preparing', 'ready')
          and (o.merchant_id = auth.uid() or public.staff_has(o.merchant_id, 'orders')));
$$;

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
         o.collect_at, o.express, o.express_fee, o.turnaround_hours, o.return_due_at, o.collected_at, o.collect_photos,
         o.collect_driver_staff_id, o.collect_driver_user_id, o.collect_driver_name, o.adjust_pending, o.adjust_note,
         (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'qty', i.qty, 'price', i.price, 'line_total', i.line_total) order by i.name), '[]')
            from public.order_items i where i.order_id = o.id) as items
  from public.orders o join public.merchants m on m.id = o.merchant_id
  where public.can_see_order(o);
revoke all on public.orders_v from public, anon;
grant select on public.orders_v to authenticated;


-- صور الاستلام: يشوفها أطراف الطلب
create or replace function public.order_photo_readable(path text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.orders o where path = any(o.collect_photos) and public.can_see_order(o));
$$;
revoke all on function public.order_photo_readable(text) from public, anon;
grant execute on function public.order_photo_readable(text) to authenticated;
drop policy if exists "receipts: order photos read" on storage.objects;
create policy "receipts: order photos read" on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and public.order_photo_readable(name));
-- المندوب يرفع صور الاستلام في مجلده
drop policy if exists "receipts: staff upload own" on storage.objects;
create policy "receipts: staff upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text
              and (public.is_admin() or public.current_rep_id() is not null
                   or exists (select 1 from public.merchants m where m.id = auth.uid())
                   or exists (select 1 from public.buyers b where b.id = auth.uid())
                   or exists (select 1 from public.merchant_staff s where s.user_id = auth.uid() and s.status = 'active')));

drop function if exists public.place_order(uuid, jsonb, text, text, text, double precision, double precision, text);
create or replace function public.place_order(mid uuid, items jsonb, fulfillment text, payment_method text,
  address text default null, lat double precision default null, lng double precision default null, note text default null,
  collect_at timestamptz default null, express boolean default false)
returns public.orders language plpgsql security definer set search_path = public as $$
declare b public.buyers; m public.merchants; ss public.store_settings; it jsonb; p public.products; q int; unit numeric;
        sub numeric := 0; fee numeric := 0; o public.orders; n int := 0;
begin
  select * into b from public.buyers where id = auth.uid();
  if b.id is null then raise exception 'buyer_profile_required'; end if;
  select * into m from public.merchants where id = mid;
  if m.id is null or m.status <> 'approved' or not public.is_entitled(mid) or not public.buyer_enabled() then raise exception 'store_unavailable'; end if;
  select * into ss from public.store_settings where merchant_id = mid;
  if fulfillment = 'pickup' and not coalesce(ss.pickup, true) then raise exception 'pickup_unavailable'; end if;
  if fulfillment = 'delivery' then
    if not coalesce(ss.delivers, false) then raise exception 'delivery_unavailable'; end if;
    if lat is null or lng is null or coalesce(trim(address), '') = '' then raise exception 'address_required'; end if;
  elsif fulfillment = 'roundtrip' then
    if not coalesce(ss.service_roundtrip, false) then raise exception 'roundtrip_unavailable'; end if;
    if lat is null or lng is null or coalesce(trim(address), '') = '' then raise exception 'address_required'; end if;
    if collect_at is null or collect_at < now() - interval '1 hour' or collect_at > now() + interval '14 days' then raise exception 'collect_time_required'; end if;
    if express and not coalesce(ss.express_enabled, false) then raise exception 'express_unavailable'; end if;
  elsif fulfillment <> 'pickup' then raise exception 'invalid_fulfillment'; end if;
  if payment_method = 'cash' and not coalesce(ss.pay_cash, true) then raise exception 'payment_unavailable'; end if;
  if payment_method = 'card' and not (case when fulfillment in ('delivery', 'roundtrip') then coalesce(ss.pay_card_delivery, false) else coalesce(ss.pay_card, false) end) then raise exception 'payment_unavailable'; end if;
  if payment_method = 'transfer' and not coalesce(ss.pay_transfer, false) then raise exception 'payment_unavailable'; end if;
  if payment_method in ('tabby', 'tamara') and (fulfillment <> 'pickup' or not (case payment_method when 'tabby' then coalesce(ss.pay_tabby, false) else coalesce(ss.pay_tamara, false) end)) then raise exception 'payment_unavailable'; end if;
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) = 0 or jsonb_array_length(items) > 100 then raise exception 'cart_empty'; end if;

  insert into public.orders (merchant_id, buyer_id, buyer_name, buyer_phone, fulfillment, address, lat, lng, note, payment_method, subtotal, total)
  values (mid, auth.uid(), b.name, coalesce(b.phone, (select phone from auth.users where id = auth.uid())), fulfillment,
          nullif(trim(address), ''), lat, lng, nullif(trim(note), ''), payment_method, 0, 0)
  returning * into o;
  for it in select * from jsonb_array_elements(items) loop
    q := (it->>'qty')::int;
    if q is null or q < 1 or q > 999 then raise exception 'invalid_qty'; end if;
    select * into p from public.products where id = (it->>'product_id')::uuid and merchant_id = mid and is_active for update;
    if p.id is null then raise exception 'product_unavailable'; end if;
    -- محلات الخدمات (استلام وتسليم) ما لها مخزون
    if p.quantity is not null and not coalesce(ss.service_roundtrip, false) and p.quantity < q then raise exception 'out_of_stock: %', p.name; end if;
    unit := case when p.sale_price is not null and (p.offer_ends_at is null or p.offer_ends_at > now()) then p.sale_price else p.price end;
    insert into public.order_items (order_id, product_id, name, price, qty, line_total) values (o.id, p.id, p.name, unit, q, round(unit * q, 2));
    if p.quantity is not null and not coalesce(ss.service_roundtrip, false) then perform public.order_stock_adjust(p.id, -q); end if;
    sub := sub + round(unit * q, 2); n := n + 1;
  end loop;
  if ss.min_order is not null and sub < ss.min_order then raise exception 'below_min_order: %', ss.min_order; end if;
  if fulfillment = 'delivery' then
    fee := case when ss.free_delivery_over is not null and sub >= ss.free_delivery_over then 0 else coalesce(ss.delivery_fee, 0) end;
  elsif fulfillment = 'roundtrip' then
    fee := case when ss.roundtrip_free_over is not null and sub >= ss.roundtrip_free_over then 0 else coalesce(ss.roundtrip_fee, 0) end;
  end if;
  update public.orders set subtotal = sub, delivery_fee = fee,
    express = coalesce(place_order.express, false) and place_order.fulfillment = 'roundtrip',
    express_fee = case when place_order.express and place_order.fulfillment = 'roundtrip' then coalesce(ss.express_fee, 0) else 0 end,
    total = sub + fee + case when place_order.express and place_order.fulfillment = 'roundtrip' then coalesce(ss.express_fee, 0) else 0 end,
    collect_at = case when place_order.fulfillment = 'roundtrip' then place_order.collect_at end,
    turnaround_hours = case when place_order.fulfillment = 'roundtrip' then (case when place_order.express then coalesce(ss.express_hours, 24) else coalesce(ss.turnaround_hours, 48) end) end
  where id = o.id returning * into o;
  return o;
end $$;
revoke all on function public.place_order(uuid, jsonb, text, text, text, double precision, double precision, text, timestamptz, boolean) from public, anon;
grant execute on function public.place_order(uuid, jsonb, text, text, text, double precision, double precision, text, timestamptz, boolean) to authenticated;


create or replace function public.order_action(oid uuid, action text, args jsonb default '{}')
returns public.orders language plpgsql security definer set search_path = public as $$
declare o public.orders; staff boolean; driver boolean; collector boolean; st public.merchant_staff; amt numeric; it jsonb; q int; newsub numeric; ss public.store_settings;
begin
  select * into o from public.orders where id = oid for update;
  if o.id is null then raise exception 'order_not_found'; end if;
  staff := o.merchant_id = auth.uid() or public.staff_has(o.merchant_id, 'orders');
  driver := o.driver_user_id is not null and o.driver_user_id = auth.uid();
  collector := o.collect_driver_user_id is not null and o.collect_driver_user_id = auth.uid();

  if action = 'cancel' and o.buyer_id = auth.uid() then
    if o.status <> 'placed' then raise exception 'cannot_cancel'; end if;
    o.status := 'cancelled'; o.reason := nullif(trim(args->>'reason'), '');
  elsif action = 'proof' and o.buyer_id = auth.uid() then
    if o.payment_method <> 'transfer' or o.payment_status = 'paid' or o.status in ('rejected', 'cancelled') then raise exception 'invalid_state'; end if;
    if (args->>'receipt') is null or (args->>'receipt') !~ ('^' || auth.uid()::text || '/') then raise exception 'bad_receipt'; end if;
    o.payment_proof := args->>'receipt'; o.payment_status := 'proof';
  -- ===== استلام وتسليم (مغاسل وخياطين...) =====
  elsif staff and action = 'assign_collect' then
    if o.fulfillment <> 'roundtrip' or o.status not in ('accepted', 'to_collect') then raise exception 'invalid_state'; end if;
    select * into st from public.merchant_staff where id = (args->>'staff_id')::uuid and merchant_id = o.merchant_id
      and status = 'active' and 'delivery' = any(perms);
    if st.id is null or st.user_id is null then raise exception 'driver_not_found'; end if;
    o.collect_driver_staff_id := st.id; o.collect_driver_user_id := st.user_id; o.collect_driver_name := coalesce(st.name, st.email);
    o.status := 'to_collect';
  elsif (collector or staff) and action = 'collecting' then
    if o.status <> 'to_collect' or o.collect_driver_user_id is null then raise exception 'invalid_state'; end if;
    o.status := 'collecting';
  elsif (collector or staff) and action = 'adjust' then
    -- فرق العدد وقت الاستلام: نعدّل الكميات ونعيد الحساب، والزبون يوافق
    if o.fulfillment <> 'roundtrip' or o.status not in ('to_collect', 'collecting', 'at_store') then raise exception 'invalid_state'; end if;
    for it in select * from jsonb_array_elements(args->'items') loop
      q := (it->>'qty')::int;
      if q is null or q < 0 or q > 999 then raise exception 'invalid_qty'; end if;
      if q = 0 then delete from public.order_items where id = (it->>'id')::uuid and order_id = o.id;
      else update public.order_items set qty = q, line_total = round(price * q, 2) where id = (it->>'id')::uuid and order_id = o.id; end if;
    end loop;
    select coalesce(sum(line_total), 0) into newsub from public.order_items where order_id = o.id;
    select * into ss from public.store_settings where merchant_id = o.merchant_id;
    o.delivery_fee := case when ss.roundtrip_free_over is not null and newsub >= ss.roundtrip_free_over then 0 else coalesce(ss.roundtrip_fee, 0) end;
    o.subtotal := newsub; o.total := newsub + o.delivery_fee + coalesce(o.express_fee, 0);
    o.adjust_pending := true; o.adjust_note := nullif(trim(args->>'note'), '');
  elsif action = 'approve_adjust' and o.buyer_id = auth.uid() then
    if not o.adjust_pending then raise exception 'invalid_state'; end if;
    o.adjust_pending := false;
  elsif (collector or staff) and action = 'collected' then
    if o.status not in ('to_collect', 'collecting') then raise exception 'invalid_state'; end if;
    o.status := 'at_store'; o.collected_at := now();
    o.return_due_at := now() + make_interval(hours => coalesce(o.turnaround_hours, 48));
    if jsonb_typeof(args->'photos') = 'array' then
      o.collect_photos := array(select jsonb_array_elements_text(args->'photos') limit 8);
      if exists (select 1 from unnest(o.collect_photos) x where x !~ ('^' || auth.uid()::text || '/')) then raise exception 'bad_photo'; end if;
    end if;
  elsif staff and action = 'processing' then
    if o.status <> 'at_store' then raise exception 'invalid_state'; end if;
    if o.adjust_pending then raise exception 'adjust_pending'; end if;
    o.status := 'processing';
  elsif staff and action = 'accept' then
    if o.status <> 'placed' then raise exception 'invalid_state'; end if;
    o.status := 'accepted'; o.accepted_at := now();
  elsif staff and action = 'reject' then
    if o.status not in ('placed', 'accepted', 'preparing', 'to_collect', 'collecting') then raise exception 'invalid_state'; end if;
    o.status := 'rejected'; o.reason := nullif(trim(args->>'reason'), '');
  elsif staff and action = 'preparing' then
    if o.status <> 'accepted' then raise exception 'invalid_state'; end if;
    o.status := 'preparing';
  elsif staff and action = 'ready' then
    if not ((o.fulfillment <> 'roundtrip' and o.status in ('accepted', 'preparing')) or (o.fulfillment = 'roundtrip' and o.status = 'processing')) then raise exception 'invalid_state'; end if;
    if o.adjust_pending then raise exception 'adjust_pending'; end if;
    o.status := 'ready'; o.ready_at := now();
  elsif staff and action = 'paid' then
    if o.payment_status = 'paid' or o.status in ('rejected', 'cancelled') then raise exception 'invalid_state'; end if;
    o.payment_status := 'paid'; o.paid_at := now();
  elsif staff and action = 'assign' then
    if not ((o.fulfillment = 'delivery' and o.status in ('accepted', 'preparing', 'ready')) or (o.fulfillment = 'roundtrip' and o.status = 'ready')) then raise exception 'invalid_state'; end if;
    if o.payment_method = 'transfer' and o.payment_status <> 'paid' then raise exception 'pay_before_delivery'; end if;
    select * into st from public.merchant_staff where id = (args->>'staff_id')::uuid and merchant_id = o.merchant_id
      and status = 'active' and 'delivery' = any(perms);
    if st.id is null or st.user_id is null then raise exception 'driver_not_found'; end if;
    o.driver_staff_id := st.id; o.driver_user_id := st.user_id; o.driver_name := coalesce(st.name, st.email);
    if o.status <> 'ready' then o.status := 'ready'; o.ready_at := now(); end if;
  elsif staff and action = 'picked_up' then
    if o.fulfillment <> 'pickup' or o.status not in ('accepted', 'preparing', 'ready') then raise exception 'invalid_state'; end if;
    o.status := 'picked_up'; o.done_at := now();
    if o.payment_status <> 'paid' then o.payment_status := 'paid'; o.paid_at := now(); end if;
  elsif (driver or staff) and action = 'out' then
    if o.status <> 'ready' or o.driver_user_id is null then raise exception 'invalid_state'; end if;
    o.status := 'out'; o.out_at := now();
  elsif (driver or staff) and action = 'delivered' then
    if o.status <> 'out' then raise exception 'invalid_state'; end if;
    o.status := 'delivered'; o.done_at := now();
    if o.payment_status <> 'paid' then
      amt := coalesce((args->>'amount')::numeric, o.total);
      o.collected_amount := amt; o.collected_method := case when args->>'method' = 'card' then 'card' else 'cash' end;
      o.payment_status := 'paid'; o.paid_at := now();
    end if;
  else
    raise exception 'not_allowed';
  end if;

  -- رجّع الكميات لو انلغى أو انرفض
  if o.status in ('rejected', 'cancelled') and not coalesce((select service_roundtrip from public.store_settings where merchant_id = o.merchant_id), false) then
    perform public.order_stock_adjust(i.product_id, i.qty) from public.order_items i where i.order_id = o.id and i.product_id is not null;
  end if;
  o.updated_at := now();
  update public.orders set collect_driver_staff_id = o.collect_driver_staff_id, collect_driver_user_id = o.collect_driver_user_id,
    collect_driver_name = o.collect_driver_name, collected_at = o.collected_at, collect_photos = o.collect_photos, return_due_at = o.return_due_at,
    adjust_pending = o.adjust_pending, adjust_note = o.adjust_note, subtotal = o.subtotal, delivery_fee = o.delivery_fee, total = o.total,
    status = o.status, reason = o.reason, payment_status = o.payment_status, payment_proof = o.payment_proof,
    paid_at = o.paid_at, accepted_at = o.accepted_at, ready_at = o.ready_at, out_at = o.out_at, done_at = o.done_at,
    driver_staff_id = o.driver_staff_id, driver_user_id = o.driver_user_id, driver_name = o.driver_name,
    collected_amount = o.collected_amount, collected_method = o.collected_method, updated_at = o.updated_at
  where id = o.id;
  return o;
end $$;
revoke all on function public.order_action(uuid, text, jsonb) from public, anon, authenticated;

