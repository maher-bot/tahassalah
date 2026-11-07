-- قسم الحسابات في الإدارة: مطالبات اشتراك التجار، السداد (تحويل / شبكة / نقدي) من الإدارة أو المسوّق،
-- الدخل والمصروفات، ومكافآت المسوّقين (هدف شهري، وكل محل فوقه بمبلغ ثابت).

-- 1) بيانات المنشأة اللي تطلع في المطالبة (تعدّلها الإدارة)
create table if not exists public.billing_settings (
  id           boolean primary key default true check (id),
  company_name text not null default 'مصنع رواحل العرب للصناعة',
  brand_name   text not null default 'تحصّله',
  cr_number    text not null default '7004683152',
  vat_number   text not null default '310232985300003',
  address      text not null default 'مكة المكرمة، المملكة العربية السعودية',
  bank_name    text,
  iban         text,
  vat_rate     numeric(5,4) not null default 0.15,
  remind_days  int[] not null default '{7,3,0}',
  updated_at   timestamptz not null default now()
);
insert into public.billing_settings (id) values (true) on conflict do nothing;
alter table public.billing_settings enable row level security;
drop policy if exists "billing settings: signed in read" on public.billing_settings;
create policy "billing settings: signed in read" on public.billing_settings for select to authenticated using (true);
drop policy if exists "billing settings: admin write" on public.billing_settings;
create policy "billing settings: admin write" on public.billing_settings for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- أسعار الباقات (بدون الضريبة)
create or replace function public.plan_price(p text, b text)
returns numeric language sql immutable as $$
  select case p
    when 'family' then case when b = 'yearly' then 290 else 29 end
    when 'trader' then case when b = 'yearly' then 590 else 59 end
    when 'pro'    then case when b = 'yearly' then 1190 else 119 end
  end::numeric;
$$;

-- الباقة اللي تنفوتر: الحالية لو مدفوعة، أو اللي اختارها بعد الفترة المجانية
create or replace function public.billing_plan(m public.merchants)
returns text language sql stable as $$
  select case
    when m.plan in ('family', 'trader', 'pro') then m.plan
    when m.kind = 'store' then (case when m.next_plan = 'pro' then 'pro' else 'trader' end)
    else (case when m.next_plan in ('trader', 'pro') then m.next_plan else 'family' end)
  end;
$$;

-- تاريخ الاستحقاق: نهاية الفترة المجانية أو نهاية الاشتراك المدفوع (فاضي = ما بدأ العد أو بلا نهاية)
create or replace function public.billing_due(m public.merchants)
returns timestamptz language sql stable as $$
  select case
    when m.plan = 'free' then
      case when m.trial_started_at is null then null
           else greatest(m.trial_started_at + make_interval(months => m.trial_months), coalesce(m.paid_until, '-infinity')) end
    when m.plan = 'basic' then m.basic_until
    else m.paid_until
  end;
$$;

-- 2) المطالبات
create sequence if not exists public.invoice_seq;
create table if not exists public.invoices (
  id            uuid primary key default gen_random_uuid(),
  number        text unique not null default ('TH-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.invoice_seq')::text, 6, '0')),
  merchant_id   uuid references public.merchants(id) on delete set null,
  store_name    text not null,
  owner_name    text,
  email         text,
  merchant_vat  text,
  plan          text not null check (plan in ('family', 'trader', 'pro')),
  billing       text not null check (billing in ('monthly', 'yearly')),
  period_start  timestamptz not null,
  period_end    timestamptz not null,
  amount        numeric(10,2) not null,
  vat           numeric(10,2) not null,
  total         numeric(10,2) not null,
  status        text not null default 'issued' check (status in ('issued', 'paid', 'void')),
  issued_at     timestamptz not null default now(),
  due_at        timestamptz not null,
  paid_at       timestamptz,
  paid_method   text check (paid_method in ('transfer', 'pos', 'cash')),
  paid_ref      text,
  paid_by       uuid,
  paid_by_label text,
  receipt_path  text,
  note          text,
  reminders     jsonb not null default '{}',
  created_by    uuid
);
create index if not exists invoices_merchant_idx on public.invoices (merchant_id, issued_at desc);
create index if not exists invoices_status_idx on public.invoices (status, due_at);
create unique index if not exists invoices_one_open on public.invoices (merchant_id) where status = 'issued';
alter table public.invoices enable row level security;
drop policy if exists "invoices: admin all" on public.invoices;
create policy "invoices: admin all" on public.invoices for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "invoices: owner reads" on public.invoices;
create policy "invoices: owner reads" on public.invoices for select to authenticated using (merchant_id = auth.uid());

-- إصدار مطالبة لتاجر (الإدارة يدويًا، أو النظام قبل الاستحقاق بأيام)
create or replace function public.issue_invoice(mid uuid)
returns public.invoices language plpgsql security definer set search_path = public as $$
declare m public.merchants; s public.billing_settings; p text; b text; st timestamptz; en timestamptz; amt numeric; inv public.invoices;
begin
  if not (public.is_admin() or auth.uid() is null) then raise exception 'not_admin'; end if;
  select * into m from public.merchants where id = mid;
  if m.id is null then raise exception 'merchant_not_found'; end if;
  if m.status <> 'approved' then raise exception 'merchant_not_approved'; end if;
  select * into inv from public.invoices where merchant_id = mid and status = 'issued';
  if inv.id is not null then return inv; end if;
  select * into s from public.billing_settings where id;
  p := public.billing_plan(m); b := coalesce(m.billing, 'monthly');
  -- الفترة تبدأ من الاستحقاق لو ما جا بعد، وإلا من اليوم (اشتراك منتهي)
  st := public.billing_due(m);
  if st is null or st < now() then st := now(); end if;
  en := st + case when b = 'yearly' then interval '12 months' else interval '1 month' end;
  amt := public.plan_price(p, b);
  insert into public.invoices (merchant_id, store_name, owner_name, email, merchant_vat, plan, billing, period_start, period_end,
                               amount, vat, total, due_at, created_by)
  values (mid, m.store_name, m.owner_name, m.email, case when m.vat_registered then m.vat_number end, p, b, st, en,
          amt, round(amt * s.vat_rate, 2), amt + round(amt * s.vat_rate, 2), st, auth.uid())
  returning * into inv;
  return inv;
end $$;
revoke all on function public.issue_invoice(uuid) from public, anon;
grant execute on function public.issue_invoice(uuid) to authenticated;

-- النظام: يصدر مطالبات من يستحق خلال 7 أيام (يومي)
create or replace function public.issue_due_invoices()
returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in
    select m.id from public.merchants m
    where m.status = 'approved'
      and public.billing_due(m) is not null
      and public.billing_due(m) <= now() + interval '7 days'
      and not exists (select 1 from public.invoices i where i.merchant_id = m.id and i.status = 'issued')
      and not exists (select 1 from public.invoices i where i.merchant_id = m.id and i.status = 'paid' and i.period_end > public.billing_due(m))
  loop
    perform public.issue_invoice(r.id); n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.issue_due_invoices() from public, anon, authenticated;

-- 3) السداد: الإدارة أو المسوّق النشط. يمدد الاشتراك تلقائيًا ويسجّل الدخل.
create or replace function public.pay_invoice(inv_id uuid, method text, ref text default null, receipt text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare inv public.invoices; m public.merchants; who text; claims text; rid uuid := public.current_rep_id(); admin_ok boolean := public.is_admin();
begin
  if not (admin_ok or rid is not null) then raise exception 'not_allowed'; end if;
  if method not in ('transfer', 'pos', 'cash') then raise exception 'invalid_method'; end if;
  select * into inv from public.invoices where id = inv_id for update;
  if inv.id is null then raise exception 'invoice_not_found'; end if;
  if inv.status <> 'issued' then raise exception 'invoice_not_open'; end if;
  if receipt is not null and receipt !~ ('^' || auth.uid()::text || '/') then raise exception 'bad_receipt'; end if;
  who := case when admin_ok then 'الإدارة: ' || coalesce((select email from auth.users where id = auth.uid()), '')
              else 'المسوّق: ' || (select name || ' (' || code || ')' from public.reps where id = rid) end;
  update public.invoices set status = 'paid', paid_at = now(), paid_method = method, paid_ref = nullif(trim(ref), ''),
    paid_by = auth.uid(), paid_by_label = who, receipt_path = receipt where id = inv_id;
  select * into m from public.merchants where id = inv.merchant_id;
  -- تجديد الاشتراك تعديل نظام: حراس جدول التجار يمنعونه عن غير الإدارة، فننفذه كنظام (بدون مستخدم) داخل هذه الدالة فقط
  claims := current_setting('request.jwt.claims', true);
  perform set_config('request.jwt.claims', '{}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  if m.id is not null then
    if m.plan = 'free' then
      -- دفع قبل نهاية الفترة المجانية: يكمل فترته، والاشتراك يبدأ بعدها
      update public.merchants set next_plan = inv.plan, billing = inv.billing, paid_until = inv.period_end where id = m.id;
    else
      update public.merchants set plan = inv.plan, next_plan = inv.plan, billing = inv.billing,
        paid_until = greatest(coalesce(paid_until, now()), inv.period_end), basic_until = null where id = m.id;
      update public.merchant_staff set status = 'active' where merchant_id = m.id and status = 'suspended' and inv.plan <> 'family';
    end if;
  end if;
  perform set_config('request.jwt.claims', coalesce(claims, ''), true);
  insert into public.finance_entries (kind, category, amount, vat, entry_date, description, invoice_id, created_by)
  values ('income', 'subscription', inv.amount, inv.vat, current_date, 'اشتراك ' || inv.store_name || ' · ' || inv.number, inv.id, auth.uid());
  return jsonb_build_object('paid', true, 'paid_until', inv.period_end);
end $$;
revoke all on function public.pay_invoice(uuid, text, text, text) from public, anon;
grant execute on function public.pay_invoice(uuid, text, text, text) to authenticated;

create or replace function public.void_invoice(inv_id uuid, reason text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  update public.invoices set status = 'void', note = nullif(trim(reason), '') where id = inv_id and status = 'issued';
  if not found then raise exception 'invoice_not_open'; end if;
end $$;
revoke all on function public.void_invoice(uuid, text) from public, anon;
grant execute on function public.void_invoice(uuid, text) to authenticated;

-- المسوّق يبحث عن مطالبة مفتوحة (باسم المحل أو الجوال أو رقم المطالبة) عشان يسجّل سدادها
create or replace function public.rep_open_invoices(q text)
returns table(id uuid, number text, store_name text, plan text, billing text, total numeric, due_at timestamptz, phone text)
language sql stable security definer set search_path = public as $$
  select i.id, i.number, i.store_name, i.plan, i.billing, i.total, i.due_at, m.phone
  from public.invoices i left join public.merchants m on m.id = i.merchant_id
  where (public.current_rep_id() is not null or public.is_admin()) and i.status = 'issued'
    and length(trim(coalesce(q, ''))) >= 2
    and (i.store_name ilike '%' || trim(q) || '%' or m.phone = trim(q) or i.number ilike '%' || trim(q) || '%')
  order by i.due_at limit 20;
$$;
revoke all on function public.rep_open_invoices(text) from public, anon;
grant execute on function public.rep_open_invoices(text) to authenticated;

-- 4) الدخل والمصروفات
create table if not exists public.finance_entries (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('income', 'expense')),
  category    text not null,
  amount      numeric(12,2) not null check (amount >= 0),
  vat         numeric(12,2) not null default 0 check (vat >= 0),
  entry_date  date not null default current_date,
  description text,
  invoice_id  uuid references public.invoices(id) on delete set null,
  rep_id      uuid references public.reps(id) on delete set null,
  ref_month   date,
  attachment_path text,
  created_by  uuid,
  created_at  timestamptz not null default now()
);
create index if not exists finance_entries_date_idx on public.finance_entries (entry_date desc);
create unique index if not exists finance_rep_bonus_once on public.finance_entries (rep_id, ref_month) where category = 'rep_bonus';
alter table public.finance_entries enable row level security;
drop policy if exists "finance: admin all" on public.finance_entries;
create policy "finance: admin all" on public.finance_entries for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- 5) مكافآت المسوّقين: هدف شهري، وكل محل مفعّل فوقه بمبلغ
alter table public.reps add column if not exists monthly_target int not null default 260;
alter table public.reps add column if not exists bonus_per_store numeric(8,2) not null default 15;

create or replace function public.rep_month_stats(m date)
returns table(rep_id uuid, name text, code text, active boolean, stores bigint, monthly_target int, bonus_per_store numeric,
              extra bigint, bonus numeric, paid boolean, paid_amount numeric)
language sql stable security definer set search_path = public as $$
  with mon as (select date_trunc('month', m)::date as s, (date_trunc('month', m) + interval '1 month')::date as e),
  cnt as (
    select r.id, count(x.id) as n
    from public.reps r cross join mon
    left join public.merchants x on x.rep_code = r.code and x.status = 'approved'
      and x.reviewed_at >= mon.s and x.reviewed_at < mon.e
    group by r.id
  )
  select r.id, r.name, r.code, r.active, c.n, r.monthly_target, r.bonus_per_store,
         greatest(c.n - r.monthly_target, 0), greatest(c.n - r.monthly_target, 0) * r.bonus_per_store,
         f.id is not null, f.amount
  from public.reps r join cnt c on c.id = r.id cross join mon
  left join public.finance_entries f on f.rep_id = r.id and f.category = 'rep_bonus' and f.ref_month = mon.s
  where public.is_admin()
  order by r.code;
$$;
revoke all on function public.rep_month_stats(date) from public, anon;
grant execute on function public.rep_month_stats(date) to authenticated;

-- 6) إيصالات السداد (صورة إيصال الشبكة أو التحويل)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;
drop policy if exists "receipts: staff upload own" on storage.objects;
create policy "receipts: staff upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text
              and (public.is_admin() or public.current_rep_id() is not null));
drop policy if exists "receipts: admin reads" on storage.objects;
create policy "receipts: admin reads" on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and (public.is_admin() or (storage.foldername(name))[1] = auth.uid()::text));
drop policy if exists "finance attachments: admin" on storage.objects;
create policy "finance attachments: admin" on storage.objects for all to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = 'finance' and public.is_admin())
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = 'finance' and public.is_admin());

-- 7) الاشتراك المدفوع مقدمًا ما يضيع لما تخلص الفترة المجانية
create or replace function public.end_expired_trials()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with ended as (
    update public.merchants set
      plan = case when kind = 'store' then (case when next_plan = 'pro' then 'pro' else 'trader' end)
                  else (case when next_plan in ('trader', 'pro') then next_plan else 'family' end) end,
      basic_until = null,
      paid_until = case when paid_until > now() then paid_until else now() end
    where plan = 'free' and trial_started_at is not null
      and trial_started_at + make_interval(months => trial_months) <= now()
    returning id, plan, paid_until
  ), lim as (select id from ended where plan = 'family'),
  t as (update public.merchant_staff set status = 'suspended'
        where merchant_id in (select id from lim) and status = 'active' returning 1)
  select count(*) into n from ended;
  return n;
end $$;

-- 8) إيميلات المطالبات: الدالة billing تصدر المطالبات المستحقة وترسل التذكيرات (يوميًا 9 صباحًا بتوقيت مكة)،
--    ويوصل التاجر إيصال لما تنسدد المطالبة.
create or replace function public.notify_invoice_paid()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare s public.notify_settings;
begin
  if new.status = 'paid' and old.status is distinct from 'paid' then
    select * into s from public.notify_settings where id;
    if s is null then return new; end if;
    perform net.http_post(url := replace(s.function_url, '/notify', '/billing'),
      body := jsonb_build_object('type', 'paid', 'invoice_id', new.id),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', s.webhook_secret),
      timeout_milliseconds := 10000);
  end if;
  return new;
end $$;
revoke execute on function public.notify_invoice_paid() from public, anon, authenticated;
drop trigger if exists notify_invoice_paid on public.invoices;
create trigger notify_invoice_paid after update on public.invoices for each row execute function public.notify_invoice_paid();

create or replace function public.billing_daily()
returns void language plpgsql security definer set search_path = public, extensions as $$
declare s public.notify_settings;
begin
  perform public.issue_due_invoices();
  select * into s from public.notify_settings where id;
  if s is null then return; end if;
  perform net.http_post(url := replace(s.function_url, '/notify', '/billing'),
    body := jsonb_build_object('type', 'daily'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', s.webhook_secret),
    timeout_milliseconds := 60000);
end $$;
revoke all on function public.billing_daily() from public, anon, authenticated;

select cron.unschedule('billing-daily') where exists (select 1 from cron.job where jobname = 'billing-daily');
select cron.schedule('billing-daily', '7 6 * * *', 'select public.billing_daily()');
