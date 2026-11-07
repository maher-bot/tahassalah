-- السلة والطلبات (المرحلة الأولى): المشتري يطلب من محل واحد، يدفع عند الاستلام (نقدًا أو شبكة) أو تحويل
-- أو تابي/تمارا في المحل. الطلب يوصل الكاشير، يقبله ويجهّزه، ولو توصيل يحوّله لمندوب المحل بعد الدفع
-- (أو مع الدفع عند الاستلام). المنصة ما تمسك فلوس: الدفع للمحل مباشرة.

-- 1) أدوار جديدة في فريق المتجر: كاشير (الطلبات) ومندوب توصيل
alter table public.merchant_staff drop constraint if exists merchant_staff_role_check;
alter table public.merchant_staff add constraint merchant_staff_role_check
  check (role in ('manager', 'stock', 'pricing', 'cashier', 'accountant', 'driver'));
alter table public.merchant_staff drop constraint if exists perms_valid;
alter table public.merchant_staff add constraint perms_valid
  check (perms <@ array['inventory', 'prices', 'orders', 'sales', 'earnings', 'delivery']::text[]);

-- 2) المشترين (الحساب بالجوال)
create table if not exists public.buyers (
  id         uuid primary key references auth.users(id) on delete cascade,
  name       text not null check (char_length(trim(name)) between 2 and 60),
  phone      text,
  created_at timestamptz not null default now()
);
alter table public.buyers enable row level security;
drop policy if exists "buyers: own" on public.buyers;
create policy "buyers: own" on public.buyers for all to authenticated using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists "buyers: admin reads" on public.buyers;
create policy "buyers: admin reads" on public.buyers for select to authenticated using (public.is_admin());

-- 3) الطلبات
create sequence if not exists public.order_seq;
create table if not exists public.orders (
  id               uuid primary key default gen_random_uuid(),
  number           text unique not null default ('O-' || lpad(nextval('public.order_seq')::text, 6, '0')),
  merchant_id      uuid not null references public.merchants(id) on delete cascade,
  buyer_id         uuid references auth.users(id) on delete set null,
  buyer_name       text not null,
  buyer_phone      text,
  fulfillment      text not null check (fulfillment in ('pickup', 'delivery')),
  address          text,
  lat              double precision,
  lng              double precision,
  note             text,
  payment_method   text not null check (payment_method in ('cash', 'card', 'transfer', 'tabby', 'tamara')),
  payment_status   text not null default 'unpaid' check (payment_status in ('unpaid', 'proof', 'paid')),
  payment_proof    text,
  status           text not null default 'placed' check (status in ('placed', 'accepted', 'preparing', 'ready', 'out', 'delivered', 'picked_up', 'rejected', 'cancelled')),
  subtotal         numeric(10,2) not null,
  delivery_fee     numeric(10,2) not null default 0,
  total            numeric(10,2) not null,
  driver_staff_id  uuid references public.merchant_staff(id) on delete set null,
  driver_user_id   uuid,
  driver_name      text,
  collected_amount numeric(10,2),
  collected_method text check (collected_method in ('cash', 'card')),
  reason           text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  accepted_at      timestamptz,
  ready_at         timestamptz,
  out_at           timestamptz,
  done_at          timestamptz,
  paid_at          timestamptz
);
create index if not exists orders_merchant_idx on public.orders (merchant_id, created_at desc);
create index if not exists orders_buyer_idx on public.orders (buyer_id, created_at desc);
create index if not exists orders_driver_idx on public.orders (driver_user_id, status);

create table if not exists public.order_items (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  name       text not null,
  price      numeric(10,2) not null,
  qty        int not null check (qty > 0),
  line_total numeric(10,2) not null
);
create index if not exists order_items_order_idx on public.order_items (order_id);

-- من يشوف الطلب: المشتري، صاحب المحل وموظفين الطلبات، المندوب المكلّف، والإدارة
create or replace function public.can_see_order(o public.orders)
returns boolean language sql stable security definer set search_path = public as $$
  select o.buyer_id = auth.uid() or o.merchant_id = auth.uid() or public.staff_has(o.merchant_id, 'orders')
      or o.driver_user_id = auth.uid() or public.is_admin();
$$;
alter table public.orders enable row level security;
drop policy if exists "orders: parties read" on public.orders;
create policy "orders: parties read" on public.orders for select to authenticated using (public.can_see_order(orders));
alter table public.order_items enable row level security;
drop policy if exists "order items: parties read" on public.order_items;
create policy "order items: parties read" on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and public.can_see_order(o)));

-- تعديل الكمية من الطلب (حجز / إرجاع): تعديل نظام، فحارس المنتجات ما يمنعه عن المشتري
create or replace function public.order_stock_adjust(pid uuid, delta int)
returns void language plpgsql security definer set search_path = public as $$
declare claims text := current_setting('request.jwt.claims', true);
begin
  perform set_config('request.jwt.claims', '{}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  update public.products set quantity = quantity + delta where id = pid and quantity is not null;
  perform set_config('request.jwt.claims', coalesce(claims, ''), true);
end $$;
revoke all on function public.order_stock_adjust(uuid, int) from public, anon, authenticated;

-- 4) إنشاء الطلب من السلة (الأسعار والتوفر من القاعدة، مو من المتصفح)
create or replace function public.place_order(mid uuid, items jsonb, fulfillment text, payment_method text,
  address text default null, lat double precision default null, lng double precision default null, note text default null)
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
  elsif fulfillment <> 'pickup' then raise exception 'invalid_fulfillment'; end if;
  if payment_method = 'cash' and not coalesce(ss.pay_cash, true) then raise exception 'payment_unavailable'; end if;
  if payment_method = 'card' and not (case when fulfillment = 'delivery' then coalesce(ss.pay_card_delivery, false) else coalesce(ss.pay_card, false) end) then raise exception 'payment_unavailable'; end if;
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
    if p.quantity is not null and p.quantity < q then raise exception 'out_of_stock: %', p.name; end if;
    unit := case when p.sale_price is not null and (p.offer_ends_at is null or p.offer_ends_at > now()) then p.sale_price else p.price end;
    insert into public.order_items (order_id, product_id, name, price, qty, line_total) values (o.id, p.id, p.name, unit, q, round(unit * q, 2));
    if p.quantity is not null then perform public.order_stock_adjust(p.id, -q); end if;
    sub := sub + round(unit * q, 2); n := n + 1;
  end loop;
  if ss.min_order is not null and sub < ss.min_order then raise exception 'below_min_order: %', ss.min_order; end if;
  if fulfillment = 'delivery' then
    fee := case when ss.free_delivery_over is not null and sub >= ss.free_delivery_over then 0 else coalesce(ss.delivery_fee, 0) end;
  end if;
  update public.orders set subtotal = sub, delivery_fee = fee, total = sub + fee where id = o.id returning * into o;
  return o;
end $$;
revoke all on function public.place_order(uuid, jsonb, text, text, text, double precision, double precision, text) from public, anon;
grant execute on function public.place_order(uuid, jsonb, text, text, text, double precision, double precision, text) to authenticated;

-- 5) حالات الطلب
create or replace function public.order_action(oid uuid, action text, args jsonb default '{}')
returns public.orders language plpgsql security definer set search_path = public as $$
declare o public.orders; staff boolean; driver boolean; st public.merchant_staff; amt numeric;
begin
  select * into o from public.orders where id = oid for update;
  if o.id is null then raise exception 'order_not_found'; end if;
  staff := o.merchant_id = auth.uid() or public.staff_has(o.merchant_id, 'orders');
  driver := o.driver_user_id is not null and o.driver_user_id = auth.uid();

  if action = 'cancel' and o.buyer_id = auth.uid() then
    if o.status <> 'placed' then raise exception 'cannot_cancel'; end if;
    o.status := 'cancelled'; o.reason := nullif(trim(args->>'reason'), '');
  elsif action = 'proof' and o.buyer_id = auth.uid() then
    if o.payment_method <> 'transfer' or o.payment_status = 'paid' or o.status in ('rejected', 'cancelled') then raise exception 'invalid_state'; end if;
    if (args->>'receipt') is null or (args->>'receipt') !~ ('^' || auth.uid()::text || '/') then raise exception 'bad_receipt'; end if;
    o.payment_proof := args->>'receipt'; o.payment_status := 'proof';
  elsif staff and action = 'accept' then
    if o.status <> 'placed' then raise exception 'invalid_state'; end if;
    o.status := 'accepted'; o.accepted_at := now();
  elsif staff and action = 'reject' then
    if o.status not in ('placed', 'accepted', 'preparing') then raise exception 'invalid_state'; end if;
    o.status := 'rejected'; o.reason := nullif(trim(args->>'reason'), '');
  elsif staff and action = 'preparing' then
    if o.status <> 'accepted' then raise exception 'invalid_state'; end if;
    o.status := 'preparing';
  elsif staff and action = 'ready' then
    if o.status not in ('accepted', 'preparing') then raise exception 'invalid_state'; end if;
    o.status := 'ready'; o.ready_at := now();
  elsif staff and action = 'paid' then
    if o.payment_status = 'paid' or o.status in ('rejected', 'cancelled') then raise exception 'invalid_state'; end if;
    o.payment_status := 'paid'; o.paid_at := now();
  elsif staff and action = 'assign' then
    if o.fulfillment <> 'delivery' or o.status not in ('accepted', 'preparing', 'ready') then raise exception 'invalid_state'; end if;
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
  if o.status in ('rejected', 'cancelled') then
    perform public.order_stock_adjust(i.product_id, i.qty) from public.order_items i where i.order_id = o.id and i.product_id is not null;
  end if;
  o.updated_at := now();
  update public.orders set status = o.status, reason = o.reason, payment_status = o.payment_status, payment_proof = o.payment_proof,
    paid_at = o.paid_at, accepted_at = o.accepted_at, ready_at = o.ready_at, out_at = o.out_at, done_at = o.done_at,
    driver_staff_id = o.driver_staff_id, driver_user_id = o.driver_user_id, driver_name = o.driver_name,
    collected_amount = o.collected_amount, collected_method = o.collected_method, updated_at = o.updated_at
  where id = o.id;
  return o;
end $$;
revoke all on function public.order_action(uuid, text, jsonb) from public, anon;
grant execute on function public.order_action(uuid, text, jsonb) to authenticated;

-- بيانات التحويل للمشتري: الآيبان المعتمد للمحل، بعد قبول الطلب فقط
create or replace function public.order_transfer_info(oid uuid)
returns table(bank_name text, iban text, holder text) language sql stable security definer set search_path = public as $$
  select m.bank_name, m.iban, m.owner_name from public.orders o join public.merchants m on m.id = o.merchant_id
  where o.id = oid and o.buyer_id = auth.uid() and o.payment_method = 'transfer'
    and o.status in ('accepted', 'preparing', 'ready', 'out') and m.iban_verified_at is not null;
$$;
revoke all on function public.order_transfer_info(uuid) from public, anon;
grant execute on function public.order_transfer_info(uuid) to authenticated;

-- مندوبين المحل (للكاشير وصاحب المحل)
create or replace function public.store_drivers(mid uuid)
returns table(id uuid, name text, email text, open_orders bigint) language sql stable security definer set search_path = public as $$
  select s.id, s.name, s.email, (select count(*) from public.orders o where o.driver_staff_id = s.id and o.status in ('ready', 'out'))
  from public.merchant_staff s
  where s.merchant_id = mid and s.status = 'active' and s.user_id is not null and 'delivery' = any(s.perms)
    and (mid = auth.uid() or public.staff_has(mid, 'orders'))
  order by s.name;
$$;
revoke all on function public.store_drivers(uuid) from public, anon;
grant execute on function public.store_drivers(uuid) to authenticated;

-- 6) إيصال تحويل المشتري
drop policy if exists "receipts: staff upload own" on storage.objects;
create policy "receipts: staff upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text
              and (public.is_admin() or public.current_rep_id() is not null
                   or exists (select 1 from public.merchants m where m.id = auth.uid())
                   or exists (select 1 from public.buyers b where b.id = auth.uid())));
drop policy if exists "receipts: order proof read" on storage.objects;
create policy "receipts: order proof read" on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and exists (select 1 from public.orders o where o.payment_proof = name
         and (o.merchant_id = auth.uid() or public.staff_has(o.merchant_id, 'orders'))));
