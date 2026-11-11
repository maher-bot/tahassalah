-- مناوبات الكاشير + عهدة الكاش + ربط المخزون مع نظام الكاشير (POS).
-- 1) كاشيرية الكاونتر: اسم ورقم سري (بدون رقم هوية). يفتح مناوبته على جهاز المحل، والتنبيهات تروح للجهاز اللي عليه مناوبة.
-- 2) كل حركة على الطلب تنحفظ باسم اللي سواها (order_events).
-- 3) العهدة: كاش المندوب يبقى في ذمته لين يستلمه كاشير المناوبة، وتقرير إغلاق المناوبة.
-- 4) ربط المخزون: مفتاح لكل محل، ونظام الكاشير يرسل الكميات تلقائيًا لدالة stock-sync.

-- ============ 1) الكاشيرية والمناوبات ============
create table if not exists public.counter_cashiers (
  id          uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  name        text not null check (char_length(name) between 2 and 60),
  phone       text check (phone is null or phone ~ '^05[0-9]{8}$'),
  pin_hash    text not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists counter_cashiers_m_idx on public.counter_cashiers (merchant_id);
alter table public.counter_cashiers enable row level security;
revoke all on public.counter_cashiers from public, anon, authenticated;
grant select (id, merchant_id, name, phone, active, created_at) on public.counter_cashiers to authenticated;
drop policy if exists "cashiers: store read" on public.counter_cashiers;
create policy "cashiers: store read" on public.counter_cashiers for select to authenticated
  using (merchant_id = auth.uid() or public.staff_has(merchant_id, 'orders'));

create table if not exists public.cashier_shifts (
  id             uuid primary key default gen_random_uuid(),
  merchant_id    uuid not null references public.merchants(id) on delete cascade,
  device_user_id uuid not null references auth.users(id) on delete cascade,
  cashier_id     uuid references public.counter_cashiers(id) on delete set null,
  staff_id       uuid references public.merchant_staff(id) on delete set null,
  cashier_name   text not null,
  started_at     timestamptz not null default now(),
  ended_at       timestamptz,
  opening_cash   numeric(10,2) not null default 0 check (opening_cash >= 0),
  counted_cash   numeric(10,2),
  expected_cash  numeric(10,2),
  report         jsonb,
  note           text check (note is null or char_length(note) <= 300)
);
create unique index if not exists cashier_shifts_open_idx on public.cashier_shifts (merchant_id, device_user_id) where ended_at is null;
create index if not exists cashier_shifts_m_idx on public.cashier_shifts (merchant_id, started_at desc);
alter table public.cashier_shifts enable row level security;
revoke all on public.cashier_shifts from public, anon, authenticated;
grant select on public.cashier_shifts to authenticated;
drop policy if exists "shifts: owner or device read" on public.cashier_shifts;
create policy "shifts: owner or device read" on public.cashier_shifts for select to authenticated
  using (merchant_id = auth.uid() or device_user_id = auth.uid());

create table if not exists public.pin_attempts (
  id bigserial primary key, merchant_id uuid not null, device_user_id uuid not null, at timestamptz not null default now()
);
create index if not exists pin_attempts_idx on public.pin_attempts (merchant_id, device_user_id, at desc);
alter table public.pin_attempts enable row level security;
revoke all on public.pin_attempts from public, anon, authenticated;

-- صاحب المحل يضيف/يعدّل كاشير (الرقم السري 4-6 أرقام، ينحفظ مشفّر)
create or replace function public.cashier_save(cid uuid, cname text, cphone text, pin text, is_active boolean default true)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare r public.counter_cashiers;
begin
  if not exists (select 1 from public.merchants where id = auth.uid()) then raise exception 'not_allowed'; end if;
  if pin is not null and pin !~ '^[0-9]{4,6}$' then raise exception 'bad_pin_format'; end if;
  cphone := nullif(regexp_replace(coalesce(cphone, ''), '\D', '', 'g'), '');
  if cid is null then
    if pin is null then raise exception 'bad_pin_format'; end if;
    if (select count(*) from public.counter_cashiers where merchant_id = auth.uid()) >= 30 then raise exception 'too_many'; end if;
    insert into public.counter_cashiers (merchant_id, name, phone, pin_hash, active)
      values (auth.uid(), trim(cname), cphone, crypt(pin, gen_salt('bf', 8)), coalesce(is_active, true)) returning * into r;
  else
    update public.counter_cashiers set name = trim(cname), phone = cphone, active = coalesce(is_active, active),
      pin_hash = case when pin is null then pin_hash else crypt(pin, gen_salt('bf', 8)) end
      where id = cid and merchant_id = auth.uid() returning * into r;
    if r.id is null then raise exception 'not_found'; end if;
  end if;
  return r.id;
end $$;
revoke all on function public.cashier_save(uuid, text, text, text, boolean) from public, anon;
grant execute on function public.cashier_save(uuid, text, text, text, boolean) to authenticated;

create or replace function public.cashier_delete(cid uuid)
returns void language sql security definer set search_path = public as $$
  delete from public.counter_cashiers where id = cid and merchant_id = auth.uid();
$$;
revoke all on function public.cashier_delete(uuid) from public, anon;
grant execute on function public.cashier_delete(uuid) to authenticated;

create or replace function public.open_shift_id(mid uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.cashier_shifts where merchant_id = mid and device_user_id = auth.uid() and ended_at is null limit 1;
$$;
revoke all on function public.open_shift_id(uuid) from public, anon;
grant execute on function public.open_shift_id(uuid) to authenticated;

-- اسم اللي يسوي الحركة: كاشير المناوبة على هذا الجهاز، أو صاحب المحل، أو الموظف بحسابه
create or replace function public.actor_label(mid uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select cashier_name from public.cashier_shifts where merchant_id = mid and device_user_id = auth.uid() and ended_at is null limit 1),
    (select coalesce(name, email) from public.merchant_staff where merchant_id = mid and user_id = auth.uid() and status = 'active' limit 1),
    case when mid = auth.uid() then 'صاحب المحل' end,
    'الزبون');
$$;
revoke all on function public.actor_label(uuid) from public, anon;

-- بدء المناوبة: كاشير بالرقم السري، أو الموظف/صاحب المحل بحسابه (cashier = null)
-- يرجع {ok, error}. الخطأ ما يرمي استثناء عشان محاولة الرقم الغلط تنحفظ (5 محاولات غلط = قفل 10 دقايق).
create or replace function public.shift_start(mid uuid, cashier uuid default null, pin text default null, opening numeric default 0)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare c public.counter_cashiers; s public.cashier_shifts; st public.merchant_staff; nm text;
begin
  if not (mid = auth.uid() or public.staff_has(mid, 'orders')) then return jsonb_build_object('ok', false, 'error', 'not_allowed'); end if;
  if public.open_shift_id(mid) is not null then return jsonb_build_object('ok', false, 'error', 'shift_open'); end if;
  if opening is null or opening < 0 or opening > 100000 then return jsonb_build_object('ok', false, 'error', 'bad_amount'); end if;
  if cashier is not null then
    if (select count(*) from public.pin_attempts where merchant_id = mid and device_user_id = auth.uid() and at > now() - interval '10 minutes') >= 5 then
      return jsonb_build_object('ok', false, 'error', 'pin_locked');
    end if;
    select * into c from public.counter_cashiers where id = cashier and merchant_id = mid and active;
    if c.id is null or pin is null or c.pin_hash <> crypt(pin, c.pin_hash) then
      insert into public.pin_attempts (merchant_id, device_user_id) values (mid, auth.uid());
      return jsonb_build_object('ok', false, 'error', 'bad_pin');
    end if;
    delete from public.pin_attempts where merchant_id = mid and device_user_id = auth.uid();
    nm := c.name;
  else
    select * into st from public.merchant_staff where merchant_id = mid and user_id = auth.uid() and status = 'active' limit 1;
    nm := coalesce(st.name, st.email, case when mid = auth.uid() then 'صاحب المحل' end);
  end if;
  insert into public.cashier_shifts (merchant_id, device_user_id, cashier_id, staff_id, cashier_name, opening_cash)
    values (mid, auth.uid(), c.id, st.id, nm, round(opening, 2)) returning * into s;
  return jsonb_build_object('ok', true, 'id', s.id, 'name', s.cashier_name, 'started_at', s.started_at);
end $$;
revoke all on function public.shift_start(uuid, uuid, text, numeric) from public, anon;
grant execute on function public.shift_start(uuid, uuid, text, numeric) to authenticated;

-- ============ 2) سجل الحركات على الطلب ============
create table if not exists public.order_events (
  id          bigserial primary key,
  order_id    uuid not null references public.orders(id) on delete cascade,
  merchant_id uuid not null,
  action      text not null,
  actor_id    uuid,
  actor_name  text,
  shift_id    uuid references public.cashier_shifts(id) on delete set null,
  at          timestamptz not null default now()
);
create index if not exists order_events_order_idx on public.order_events (order_id, at);
create index if not exists order_events_shift_idx on public.order_events (shift_id) where shift_id is not null;
alter table public.order_events enable row level security;
revoke all on public.order_events from public, anon, authenticated;

create or replace function public.order_action_v(oid uuid, action text, args jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  o := public.order_action(oid, action, args);
  insert into public.order_events (order_id, merchant_id, action, actor_id, actor_name, shift_id)
    values (o.id, o.merchant_id, action, auth.uid(),
            case when o.buyer_id = auth.uid() then 'الزبون' else public.actor_label(o.merchant_id) end,
            public.open_shift_id(o.merchant_id));
  return jsonb_build_object('id', o.id, 'number', o.number, 'status', o.status, 'payment_status', o.payment_status);
end $$;
revoke all on function public.order_action_v(uuid, text, jsonb) from public, anon;
grant execute on function public.order_action_v(uuid, text, jsonb) to authenticated;

-- الاستلام من المحل: نحفظ طريقة الدفع (نقد/شبكة) عشان تقرير المناوبة
do $$
declare d text;
begin
  d := pg_get_functiondef('public.order_action(uuid, text, jsonb)'::regprocedure);
  d := replace(d, $r$    o.status := 'picked_up'; o.done_at := now();
    if o.payment_status <> 'paid' then o.payment_status := 'paid'; o.paid_at := now(); end if;$r$, $r$    o.status := 'picked_up'; o.done_at := now();
    if o.payment_status <> 'paid' then
      o.collected_amount := o.total; o.collected_method := case when args->>'method' = 'card' then 'card' else 'cash' end;
      o.payment_status := 'paid'; o.paid_at := now();
    end if;$r$);
  if d not like '%o.collected_amount := o.total;%' then raise exception 'patch failed'; end if;
  execute d;
end $$;
revoke all on function public.order_action(uuid, text, jsonb) from public, anon, authenticated;

-- ============ 3) العهدة ============
alter table public.orders add column if not exists cash_handover_id uuid;

create table if not exists public.cash_handovers (
  id               uuid primary key default gen_random_uuid(),
  merchant_id      uuid not null references public.merchants(id) on delete cascade,
  driver_user_id   uuid not null,
  driver_name      text,
  expected         numeric(10,2) not null,
  received         numeric(10,2) not null check (received >= 0),
  order_ids        uuid[] not null,
  shift_id         uuid references public.cashier_shifts(id) on delete set null,
  received_by      uuid,
  received_by_name text,
  note             text check (note is null or char_length(note) <= 300),
  at               timestamptz not null default now()
);
create index if not exists cash_handovers_m_idx on public.cash_handovers (merchant_id, at desc);
create index if not exists cash_handovers_shift_idx on public.cash_handovers (shift_id) where shift_id is not null;
create index if not exists cash_handovers_d_idx on public.cash_handovers (driver_user_id, at desc);
alter table public.cash_handovers enable row level security;
revoke all on public.cash_handovers from public, anon, authenticated;
grant select on public.cash_handovers to authenticated;
drop policy if exists "handovers: parties read" on public.cash_handovers;
create policy "handovers: parties read" on public.cash_handovers for select to authenticated
  using (merchant_id = auth.uid() or driver_user_id = auth.uid() or public.staff_has(merchant_id, 'orders'));

-- الكاش اللي مع كل مندوب للمحل (ما سلّمه بعد)
create or replace function public.driver_custody(mid uuid)
returns table (driver_user_id uuid, driver_name text, amount numeric, orders int, oldest timestamptz)
language sql stable security definer set search_path = public as $$
  select o.driver_user_id, max(o.driver_name), sum(o.collected_amount), count(*)::int, min(o.done_at)
  from public.orders o
  where o.merchant_id = mid and (mid = auth.uid() or public.staff_has(mid, 'orders'))
    and o.driver_user_id is not null and o.status = 'delivered' and o.collected_method = 'cash'
    and o.collected_amount is not null and o.cash_handover_id is null
  group by o.driver_user_id order by 3 desc;
$$;
revoke all on function public.driver_custody(uuid) from public, anon;
grant execute on function public.driver_custody(uuid) to authenticated;

-- المندوب: الكاش اللي معي لكل محل
create or replace function public.my_custody()
returns table (merchant_id uuid, store_name text, amount numeric, orders int)
language sql stable security definer set search_path = public as $$
  select o.merchant_id, max(m.store_name), sum(o.collected_amount), count(*)::int
  from public.orders o join public.merchants m on m.id = o.merchant_id
  where o.driver_user_id = auth.uid() and o.status = 'delivered' and o.collected_method = 'cash'
    and o.collected_amount is not null and o.cash_handover_id is null
  group by o.merchant_id order by 3 desc;
$$;
revoke all on function public.my_custody() from public, anon;
grant execute on function public.my_custody() to authenticated;

-- الكاشير يستلم كاش المندوب: كل طلباته النقدية اللي ما تسلّمت تنتقل لعهدة المناوبة
create or replace function public.receive_cash(mid uuid, driver uuid, received numeric, note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ids uuid[]; exp numeric; dn text; h public.cash_handovers;
begin
  if not (mid = auth.uid() or public.staff_has(mid, 'orders')) then raise exception 'not_allowed'; end if;
  if received is null or received < 0 or received > 1000000 then raise exception 'bad_amount'; end if;
  select array_agg(id), sum(collected_amount), max(driver_name) into ids, exp, dn
  from (select id, collected_amount, driver_name from public.orders
        where merchant_id = mid and driver_user_id = driver and status = 'delivered' and collected_method = 'cash'
          and collected_amount is not null and cash_handover_id is null for update) x;
  if ids is null then raise exception 'nothing_to_receive'; end if;
  insert into public.cash_handovers (merchant_id, driver_user_id, driver_name, expected, received, order_ids, shift_id, received_by, received_by_name, note)
    values (mid, driver, dn, exp, round(receive_cash.received, 2), ids, public.open_shift_id(mid), auth.uid(), public.actor_label(mid), nullif(trim(receive_cash.note), ''))
    returning * into h;
  update public.orders set cash_handover_id = h.id where id = any(ids);
  return jsonb_build_object('id', h.id, 'expected', h.expected, 'received', h.received, 'orders', array_length(ids, 1));
end $$;
revoke all on function public.receive_cash(uuid, uuid, numeric, text) from public, anon;
grant execute on function public.receive_cash(uuid, uuid, numeric, text) to authenticated;

-- تقرير المناوبة
create or replace function public.shift_report(sid uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s public.cashier_shifts; r jsonb; cash_sales numeric; card_sales numeric; transfers numeric; ho numeric; ho_n int; n int;
begin
  select * into s from public.cashier_shifts where id = sid;
  if s.id is null or not (s.merchant_id = auth.uid() or s.device_user_id = auth.uid()) then raise exception 'not_allowed'; end if;
  select coalesce(sum(o.collected_amount) filter (where o.collected_method = 'cash'), 0),
         coalesce(sum(o.collected_amount) filter (where o.collected_method = 'card'), 0)
    into cash_sales, card_sales
    from public.orders o where o.id in (select order_id from public.order_events where shift_id = sid and action = 'picked_up') and o.fulfillment = 'pickup';
  select coalesce(sum(o.total), 0) into transfers
    from public.orders o where o.id in (select order_id from public.order_events where shift_id = sid and action = 'paid');
  select coalesce(sum(received), 0), count(*) into ho, ho_n from public.cash_handovers where shift_id = sid;
  select count(distinct order_id) into n from public.order_events where shift_id = sid;
  r := jsonb_build_object('orders', n, 'opening', s.opening_cash, 'cash_sales', cash_sales, 'card_sales', card_sales,
        'transfers', transfers, 'handovers', ho, 'handovers_count', ho_n,
        'expected_cash', s.opening_cash + cash_sales + ho);
  return r;
end $$;
revoke all on function public.shift_report(uuid) from public, anon;
grant execute on function public.shift_report(uuid) to authenticated;

-- إنهاء المناوبة: الكاشير يعد الدرج ويكتب المبلغ، والتقرير ينحفظ مع الفرق
create or replace function public.shift_end(sid uuid, counted numeric, note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.cashier_shifts; r jsonb;
begin
  select * into s from public.cashier_shifts where id = sid for update;
  if s.id is null or not (s.merchant_id = auth.uid() or s.device_user_id = auth.uid()) then raise exception 'not_allowed'; end if;
  if s.ended_at is not null then raise exception 'shift_closed'; end if;
  if counted is null or counted < 0 or counted > 1000000 then raise exception 'bad_amount'; end if;
  r := public.shift_report(sid);
  r := r || jsonb_build_object('counted', round(counted, 2), 'diff', round(counted, 2) - (r->>'expected_cash')::numeric);
  update public.cashier_shifts set ended_at = now(), counted_cash = round(counted, 2), expected_cash = (r->>'expected_cash')::numeric,
    report = r, note = nullif(trim(shift_end.note), '') where id = sid;
  return r;
end $$;
revoke all on function public.shift_end(uuid, numeric, text) from public, anon;
grant execute on function public.shift_end(uuid, numeric, text) to authenticated;

-- ============ orders_v: نضيف سجل الحركات وحالة تسليم الكاش (للكاشير وصاحب المحل) ============
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
            from public.order_events e where e.order_id = o.id and e.action <> 'cancel') end as history
  from public.orders o join public.merchants m on m.id = o.merchant_id
  where public.can_see_order(o);
revoke all on public.orders_v from public, anon;
grant select on public.orders_v to authenticated;

-- ============ 4) ربط المخزون مع نظام الكاشير ============
create table if not exists public.pos_links (
  merchant_id  uuid primary key references public.merchants(id) on delete cascade,
  key_hash     text not null unique,
  key_hint     text not null,
  created_at   timestamptz not null default now(),
  last_sync_at timestamptz,
  last_result  jsonb
);
alter table public.pos_links enable row level security;
revoke all on public.pos_links from public, anon, authenticated;
grant select (merchant_id, key_hint, created_at, last_sync_at, last_result) on public.pos_links to authenticated;
drop policy if exists "pos: owner read" on public.pos_links;
create policy "pos: owner read" on public.pos_links for select to authenticated using (merchant_id = auth.uid());

-- مفتاح جديد (يطلع مرة وحدة، وينحفظ مشفّر). إنشاء مفتاح جديد يلغي القديم.
create or replace function public.pos_key_create()
returns text language plpgsql security definer set search_path = public, extensions as $$
declare k text;
begin
  if not exists (select 1 from public.merchants where id = auth.uid() and status = 'approved') then raise exception 'not_allowed'; end if;
  k := 'tah_' || encode(gen_random_bytes(24), 'hex');
  insert into public.pos_links (merchant_id, key_hash, key_hint) values (auth.uid(), encode(digest(k, 'sha256'), 'hex'), right(k, 4))
  on conflict (merchant_id) do update set key_hash = excluded.key_hash, key_hint = excluded.key_hint, created_at = now(), last_sync_at = null, last_result = null;
  return k;
end $$;
revoke all on function public.pos_key_create() from public, anon;
grant execute on function public.pos_key_create() to authenticated;

create or replace function public.pos_key_revoke()
returns void language sql security definer set search_path = public as $$
  delete from public.pos_links where merchant_id = auth.uid();
$$;
revoke all on function public.pos_key_revoke() from public, anon;
grant execute on function public.pos_key_revoke() to authenticated;

-- تحديث الكميات من نظام الكاشير (تناديها دالة stock-sync فقط).
-- الكمية في المنصة = كمية نظام الكاشير - الكميات المحجوزة في طلبات المنصة اللي لسا ما خلصت
-- (عشان ما ترجع الكمية قبل ما يتسجّل الطلب في نظام الكاشير).
create or replace function public.pos_stock_sync(h text, items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare mid uuid; r record; p record; reserved int; newq int; newp numeric; upd int := 0; same int := 0; bad int := 0; unknown text[] := '{}'; res jsonb;
begin
  select merchant_id into mid from public.pos_links where key_hash = h;
  if mid is null then raise exception 'bad_key'; end if;
  if jsonb_typeof(items) <> 'array' then raise exception 'bad_body'; end if;
  if jsonb_array_length(items) > 5000 then raise exception 'too_many'; end if;
  for r in select distinct on (bc) bc, q, pr from (
      select nullif(trim(coalesce(x->>'barcode', x->>'sku', x->>'code')), '') bc,
             case when coalesce(x->>'quantity', x->>'qty', x->>'stock') ~ '^-?[0-9]+(\.[0-9]+)?$' then coalesce(x->>'quantity', x->>'qty', x->>'stock')::numeric end q,
             case when (x->>'price') ~ '^[0-9]+(\.[0-9]+)?$' then (x->>'price')::numeric end pr
      from jsonb_array_elements(items) x) y where bc is not null
  loop
    if r.q is null then bad := bad + 1; continue; end if;
    select id, quantity, price, sale_price into p from public.products where merchant_id = mid and barcode = r.bc order by created_at limit 1;
    if p.id is null then unknown := unknown || r.bc; continue; end if;
    select coalesce(sum(i.qty), 0) into reserved from public.order_items i join public.orders o on o.id = i.order_id
      where i.product_id = p.id and o.status in ('placed', 'accepted', 'preparing', 'ready', 'out');
    newq := greatest(0, floor(r.q)::int - reserved);
    newp := case when r.pr > 0 and r.pr < 1000000 then round(r.pr, 2) else p.price end;
    if p.quantity is distinct from newq or p.price is distinct from newp then
      update public.products set quantity = newq, price = newp,
        sale_price = case when p.sale_price is not null and p.sale_price >= newp then null else p.sale_price end
        where id = p.id;
      upd := upd + 1;
    else same := same + 1; end if;
  end loop;
  res := jsonb_build_object('updated', upd, 'unchanged', same, 'invalid', bad, 'unknown_count', coalesce(array_length(unknown, 1), 0),
                            'unknown', to_jsonb(unknown[1:50]));
  update public.pos_links set last_sync_at = now(), last_result = res where merchant_id = mid;
  return res;
end $$;
revoke all on function public.pos_stock_sync(text, jsonb) from public, anon, authenticated;
grant execute on function public.pos_stock_sync(text, jsonb) to service_role;
