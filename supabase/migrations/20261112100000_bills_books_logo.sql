-- 1) الفواتير المستحقة (للإدارة وللتاجر): تاريخ سداد، وتذكير يحدده صاحبها (أيام قبل الموعد أو تواريخ محددة)، وتكرار، ومرفقات.
--    merchant_id = null → فواتير المنصة (الإدارة)، وإلا فواتير التاجر (الباقة المميزة، صاحب المحل أو موظف بصلاحية الحسابات earnings).
-- 2) دفتر التاجر: الدخل والمصروفات (مبيعات المنصة تنحسب تلقائيًا من الطلبات، وهذا للباقي).
-- 3) شعار التاجر: يرفعه بنفسه ويظهر مباشرة، والإدارة تشوف قائمة الشعارات الجديدة وتقدر تشيل المخالف.

-- ============ صلاحية الدفاتر ============
create or replace function public.books_ok(mid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case when mid is null then public.is_admin()
              else (mid = auth.uid() or public.staff_has(mid, 'earnings')) and public.plan_pro(mid) end;
$$;
revoke all on function public.books_ok(uuid) from public, anon;
grant execute on function public.books_ok(uuid) to authenticated;

-- ============ 1) الفواتير المستحقة ============
create table if not exists public.bills (
  id           uuid primary key default gen_random_uuid(),
  merchant_id  uuid references public.merchants(id) on delete cascade,
  title        text not null check (char_length(title) between 2 and 120),
  vendor       text check (vendor is null or char_length(vendor) <= 120),
  category     text not null default 'other',
  amount       numeric(12,2) not null check (amount >= 0),
  due_date     date not null,
  repeat       text not null default 'none' check (repeat in ('none', 'monthly', 'quarterly', 'semiannual', 'yearly')),
  remind_days  int[] not null default '{7,0}',
  remind_dates date[] not null default '{}',
  reminded     text[] not null default '{}',
  note         text check (note is null or char_length(note) <= 1000),
  attachments  text[] not null default '{}',
  status       text not null default 'open' check (status in ('open', 'paid', 'cancelled')),
  paid_at      date,
  paid_method  text,
  paid_amount  numeric(12,2),
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  check (remind_days <@ array[0,1,3,7,14,20,30,45,60,90,120,180,270,365]::int[])
);
create index if not exists bills_owner_idx on public.bills (merchant_id, status, due_date);
alter table public.bills enable row level security;
drop policy if exists "bills: owner" on public.bills;
create policy "bills: owner" on public.bills for all to authenticated
  using (public.books_ok(merchant_id)) with check (public.books_ok(merchant_id));

-- ============ 2) دفتر التاجر ============
create table if not exists public.merchant_entries (
  id          uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  kind        text not null check (kind in ('income', 'expense')),
  category    text not null,
  amount      numeric(12,2) not null check (amount >= 0),
  entry_date  date not null default current_date,
  description text check (description is null or char_length(description) <= 300),
  attachments text[] not null default '{}',
  bill_id     uuid references public.bills(id) on delete set null,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists merchant_entries_idx on public.merchant_entries (merchant_id, entry_date desc);
alter table public.merchant_entries enable row level security;
drop policy if exists "entries: owner" on public.merchant_entries;
create policy "entries: owner" on public.merchant_entries for all to authenticated
  using (public.books_ok(merchant_id)) with check (public.books_ok(merchant_id));

-- مرفقات الفواتير والمصروفات: receipts/books/<merchant_id>/... للتاجر، وreceipts/finance/... للإدارة (موجودة)
drop policy if exists "books attachments" on storage.objects;
create policy "books attachments" on storage.objects for all to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = 'books' and public.books_ok(((storage.foldername(name))[2])::uuid))
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = 'books' and public.books_ok(((storage.foldername(name))[2])::uuid));

-- سداد فاتورة: تنحفظ كمصروف، ولو تتكرر تنفتح الجاية بنفس التذكير
create or replace function public.bill_pay(bid uuid, method text, paid_on date default current_date, amount numeric default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.bills; amt numeric; nxt date; nid uuid; cat text;
begin
  select * into b from public.bills where id = bid for update;
  if b.id is null or not public.books_ok(b.merchant_id) then raise exception 'not_allowed'; end if;
  if b.status <> 'open' then raise exception 'invalid_state'; end if;
  amt := coalesce(amount, b.amount);
  if amt < 0 then raise exception 'bad_amount'; end if;
  update public.bills set status = 'paid', paid_at = coalesce(paid_on, current_date), paid_method = left(method, 30), paid_amount = amt where id = bid;
  if b.merchant_id is null then
    cat := case when b.category in ('salaries', 'rent', 'marketing', 'tech', 'government', 'transport') then b.category else 'other' end;
    insert into public.finance_entries (kind, category, amount, entry_date, description, attachment_path, created_by)
      values ('expense', cat, amt, coalesce(paid_on, current_date), b.title || coalesce(' · ' || b.vendor, ''), b.attachments[1], auth.uid());
  else
    insert into public.merchant_entries (merchant_id, kind, category, amount, entry_date, description, attachments, bill_id)
      values (b.merchant_id, 'expense', b.category, amt, coalesce(paid_on, current_date), left(b.title || coalesce(' · ' || b.vendor, ''), 300), b.attachments, b.id);
  end if;
  if b.repeat <> 'none' then
    nxt := b.due_date + case b.repeat when 'monthly' then interval '1 month' when 'quarterly' then interval '3 months'
                                       when 'semiannual' then interval '6 months' else interval '1 year' end;
    insert into public.bills (merchant_id, title, vendor, category, amount, due_date, repeat, remind_days, note, created_by)
      values (b.merchant_id, b.title, b.vendor, b.category, b.amount, nxt, b.repeat, b.remind_days, b.note, auth.uid())
      returning id into nid;
  end if;
  return jsonb_build_object('paid', bid, 'next', nid, 'next_due', nxt);
end $$;
revoke all on function public.bill_pay(uuid, text, date, numeric) from public, anon;
grant execute on function public.bill_pay(uuid, text, date, numeric) to authenticated;

-- التذكيرات المستحقة اليوم (تناديها دالة billing يوميًا). كل تذكير ينرسل مرة وحدة.
create or replace function public.bill_reminders_due()
returns table (bill_id uuid, merchant_id uuid, store_name text, title text, vendor text, amount numeric, due_date date, days_left int,
               emails text[], user_ids uuid[])
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare today date := (now() at time zone 'Asia/Riyadh')::date; r record; k text;
begin
  for r in select b.* from public.bills b where b.status = 'open' and b.due_date >= today - 1 loop
    k := null;
    if (r.due_date - today) = any(r.remind_days) and not (('d' || (r.due_date - today)) = any(r.reminded)) then k := 'd' || (r.due_date - today);
    elsif today = any(r.remind_dates) and not (today::text = any(r.reminded)) then k := today::text; end if;
    continue when k is null;
    update public.bills set reminded = array_append(reminded, k) where id = r.id;
    bill_id := r.id; merchant_id := r.merchant_id; title := r.title; vendor := r.vendor; amount := r.amount;
    due_date := r.due_date; days_left := r.due_date - today;
    if r.merchant_id is null then
      store_name := null;
      emails := array(select n.admin_email from public.notify_settings n where n.id and n.admin_email is not null);
      user_ids := array(select a.user_id from public.admins a);
    else
      select m.store_name, array[m.email] into store_name, emails from public.merchants m where m.id = r.merchant_id;
      user_ids := array[r.merchant_id] || array(select s.user_id from public.merchant_staff s where s.merchant_id = r.merchant_id
                    and s.status = 'active' and s.user_id is not null and 'earnings' = any(s.perms));
    end if;
    return next;
  end loop;
end $$;
revoke all on function public.bill_reminders_due() from public, anon, authenticated;
grant execute on function public.bill_reminders_due() to service_role;

-- ============ 3) الشعار ============
alter table public.merchants add column if not exists logo_path text;
alter table public.merchants add column if not exists logo_at timestamptz;

create or replace function public.set_store_logo(path text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.merchants where id = auth.uid()) then raise exception 'not_allowed'; end if;
  if path is not null and path !~ ('^' || auth.uid()::text || '/logo-[a-z0-9-]+\.(webp|png|jpg|jpeg)$') then raise exception 'bad_path'; end if;
  update public.merchants set logo_path = path, logo_at = case when path is null then null else now() end where id = auth.uid();
end $$;
revoke all on function public.set_store_logo(text) from public, anon;
grant execute on function public.set_store_logo(text) to authenticated;

-- الإدارة: آخر الشعارات المضافة، وتقدر تشيل المخالف
create or replace function public.admin_logos(days int default 30)
returns table (id uuid, store_name text, activity text, logo_path text, logo_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.id, m.store_name, m.activity, m.logo_path, m.logo_at from public.merchants m
  where public.is_admin() and m.logo_path is not null and m.logo_at > now() - make_interval(days => greatest(1, least(days, 365)))
  order by m.logo_at desc limit 200;
$$;
revoke all on function public.admin_logos(int) from public, anon;
grant execute on function public.admin_logos(int) to authenticated;

create or replace function public.admin_remove_logo(mid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not_allowed'; end if;
  update public.merchants set logo_path = null, logo_at = null where id = mid;
end $$;
revoke all on function public.admin_remove_logo(uuid) from public, anon;
grant execute on function public.admin_remove_logo(uuid) to authenticated;

-- الشعار يظهر للمشتري
create or replace view public.stores_public with (security_invoker = false) as
 WITH src AS (
         SELECT merchants.id, merchants.store_name, merchants.activity, merchants.city, merchants.district, merchants.kind,
            merchants.hide_location, merchants.lat, merchants.lng, merchants.live_lat, merchants.live_lng, merchants.live_at, merchants.availability,
            merchants.kind = 'mobile'::text AND merchants.plan <> 'basic'::text AND (merchants.availability = ANY (ARRAY['available'::text, 'busy'::text]))
              AND merchants.live_until > now() AND merchants.live_lat IS NOT NULL AND merchants.live_lng IS NOT NULL AS is_live,
            merchants.plan = 'pro'::text AS premium, merchants.logo_path
           FROM merchants
          WHERE merchants.status = 'approved'::merchant_status AND buyer_enabled() AND (merchants.plan = 'free'::text
            OR merchants.plan = 'basic'::text AND (merchants.basic_until IS NULL OR merchants.basic_until > now())
            OR (merchants.plan = ANY (ARRAY['family'::text, 'trader'::text, 'pro'::text])) AND (merchants.paid_until IS NULL OR merchants.paid_until > now()))
        ), base AS (
         SELECT src.id, src.store_name, src.activity, src.city, src.district,
                CASE WHEN src.is_live THEN src.live_lat ELSE src.lat END AS lat,
                CASE WHEN src.is_live THEN src.live_lng ELSE src.lng END AS lng,
            src.is_live,
                CASE WHEN src.is_live THEN src.live_at ELSE NULL::timestamp with time zone END AS live_at,
            src.kind = 'family'::text OR src.hide_location AS approx,
                CASE WHEN src.is_live THEN src.availability ELSE NULL::text END AS availability,
            src.premium, src.logo_path
           FROM src
          WHERE src.kind <> 'mobile'::text OR src.is_live
        ), cells AS (
         SELECT base.*,
                CASE WHEN base.approx AND base.lat IS NOT NULL AND base.lng IS NOT NULL THEN round((round(base.lat / 0.005::double precision) * 0.005::double precision)::numeric, 3)::double precision ELSE NULL::double precision END AS clat,
                CASE WHEN base.approx AND base.lat IS NOT NULL AND base.lng IS NOT NULL THEN round((round(base.lng / 0.005::double precision) * 0.005::double precision)::numeric, 3)::double precision ELSE NULL::double precision END AS clng
           FROM base
        )
 SELECT id, store_name, activity, city, district,
        CASE WHEN approx THEN clat ELSE lat END AS lat,
        CASE WHEN approx THEN clng ELSE lng END AS lng,
    approx AS location_approx, is_live, live_at, availability, premium, logo_path
   FROM cells;

-- مبيعات المنصة للتاجر في فترة (للدفتر): تنحسب تلقائيًا من الطلبات المكتملة
create or replace function public.books_platform_sales(mid uuid, d1 date, d2 date)
returns table (method text, orders int, total numeric)
language sql stable security definer set search_path = public as $$
  select coalesce(o.collected_method, o.payment_method), count(*)::int, sum(o.total)
  from public.orders o
  where o.merchant_id = mid and public.books_ok(mid) and o.status in ('delivered', 'picked_up')
    and (o.done_at at time zone 'Asia/Riyadh')::date between d1 and d2
  group by 1;
$$;
revoke all on function public.books_platform_sales(uuid, date, date) from public, anon;
grant execute on function public.books_platform_sales(uuid, date, date) to authenticated;

-- لوحة التاجر: الشعار مع باقة المحل
create or replace function public.store_features(mid uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('plan', m.plan, 'pro', public.plan_pro(mid), 'activity', m.activity, 'logo_path', m.logo_path)
  from public.merchants m where m.id = mid and (mid = auth.uid() or exists (select 1 from public.merchant_staff s where s.merchant_id = mid and s.user_id = auth.uid() and s.status = 'active'));
$$;
