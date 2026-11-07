-- خدمات إضافية للتاجر (تسويق، تصوير، تصميم...): الإدارة تسجّل الطلب وتصدر له مطالبة بالمبلغ المتفق عليه،
-- والتاجر يسددها مثل مطالبة الاشتراك. ولو مسوّق جاب الطلب تنحسب له عمولة.

-- 1) قائمة الخدمات (تعبّيها الإدارة؛ السعر مقترح ويتعدّل في كل طلب)
create table if not exists public.services (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  default_price numeric(10,2),
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
alter table public.services enable row level security;
drop policy if exists "services: admin all" on public.services;
create policy "services: admin all" on public.services for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- 2) المطالبات: نوع «خدمة» بجانب «اشتراك»
alter table public.invoices add column if not exists kind text not null default 'subscription';
alter table public.invoices drop constraint if exists invoices_kind_chk;
alter table public.invoices add constraint invoices_kind_chk check (kind in ('subscription', 'service'));
alter table public.invoices add column if not exists description text;
alter table public.invoices add column if not exists qty numeric(10,2);
alter table public.invoices add column if not exists unit_price numeric(10,2);
alter table public.invoices alter column plan drop not null;
alter table public.invoices alter column billing drop not null;
alter table public.invoices alter column period_start drop not null;
alter table public.invoices alter column period_end drop not null;
drop index if exists public.invoices_one_open;
create unique index if not exists invoices_one_open_sub on public.invoices (merchant_id) where status = 'issued' and kind = 'subscription';

-- 3) طلبات الخدمات
create table if not exists public.service_requests (
  id             uuid primary key default gen_random_uuid(),
  merchant_id    uuid references public.merchants(id) on delete set null,
  store_name     text not null,
  service_id     uuid references public.services(id) on delete set null,
  title          text not null,
  note           text,
  amount         numeric(10,2) not null check (amount >= 0),
  status         text not null default 'invoiced' check (status in ('invoiced', 'paid', 'done', 'cancelled')),
  invoice_id     uuid references public.invoices(id) on delete set null,
  rep_id         uuid references public.reps(id) on delete set null,
  rep_commission numeric(10,2) not null default 0 check (rep_commission >= 0),
  paid_at        timestamptz,
  done_at        timestamptz,
  created_by     uuid,
  created_at     timestamptz not null default now()
);
create index if not exists service_requests_merchant_idx on public.service_requests (merchant_id, created_at desc);
alter table public.service_requests enable row level security;
drop policy if exists "service requests: admin all" on public.service_requests;
create policy "service requests: admin all" on public.service_requests for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "service requests: owner reads" on public.service_requests;
create policy "service requests: owner reads" on public.service_requests for select to authenticated using (merchant_id = auth.uid());

-- إصدار طلب خدمة ومطالبته دفعة وحدة
create or replace function public.issue_service_invoice(mid uuid, title text, unit_price numeric, qty numeric default 1,
  due_days int default 7, note text default null, svc uuid default null, rep uuid default null, commission numeric default 0)
returns public.invoices language plpgsql security definer set search_path = public as $$
declare m public.merchants; s public.billing_settings; amt numeric; inv public.invoices; req uuid;
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  select * into m from public.merchants where id = mid;
  if m.id is null then raise exception 'merchant_not_found'; end if;
  if coalesce(trim(title), '') = '' then raise exception 'title_required'; end if;
  if unit_price is null or unit_price <= 0 or qty is null or qty <= 0 then raise exception 'invalid_amount'; end if;
  if due_days is null or due_days < 0 or due_days > 90 then raise exception 'invalid_due'; end if;
  select * into s from public.billing_settings where id;
  amt := round(unit_price * qty, 2);
  insert into public.invoices (kind, merchant_id, store_name, owner_name, email, merchant_vat, description, qty, unit_price,
                               amount, vat, total, due_at, created_by)
  values ('service', mid, m.store_name, m.owner_name, m.email, case when m.vat_registered then m.vat_number end,
          trim(title), qty, unit_price, amt, round(amt * s.vat_rate, 2), amt + round(amt * s.vat_rate, 2),
          now() + make_interval(days => due_days), auth.uid())
  returning * into inv;
  insert into public.service_requests (merchant_id, store_name, service_id, title, note, amount, invoice_id, rep_id, rep_commission, created_by)
  values (mid, m.store_name, svc, trim(title), nullif(trim(note), ''), amt, inv.id, rep, coalesce(commission, 0), auth.uid());
  return inv;
end $$;
revoke all on function public.issue_service_invoice(uuid, text, numeric, numeric, int, text, uuid, uuid, numeric) from public, anon;
grant execute on function public.issue_service_invoice(uuid, text, numeric, numeric, int, text, uuid, uuid, numeric) to authenticated;

-- المطالبة الآلية للاشتراك: ما تتأثر بمطالبات الخدمات
create or replace function public.issue_invoice(mid uuid)
returns public.invoices language plpgsql security definer set search_path = public as $$
declare m public.merchants; s public.billing_settings; p text; b text; st timestamptz; en timestamptz; amt numeric; inv public.invoices;
begin
  if not (public.is_admin() or auth.uid() is null) then raise exception 'not_admin'; end if;
  select * into m from public.merchants where id = mid;
  if m.id is null then raise exception 'merchant_not_found'; end if;
  if m.status <> 'approved' then raise exception 'merchant_not_approved'; end if;
  select * into inv from public.invoices where merchant_id = mid and status = 'issued' and kind = 'subscription';
  if inv.id is not null then return inv; end if;
  select * into s from public.billing_settings where id;
  p := public.billing_plan(m); b := coalesce(m.billing, 'monthly');
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

create or replace function public.issue_due_invoices()
returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in
    select m.id from public.merchants m
    where m.status = 'approved'
      and public.billing_due(m) is not null
      and public.billing_due(m) <= now() + interval '7 days'
      and not exists (select 1 from public.invoices i where i.merchant_id = m.id and i.status = 'issued' and i.kind = 'subscription')
      and not exists (select 1 from public.invoices i where i.merchant_id = m.id and i.status = 'paid' and i.kind = 'subscription' and i.period_end > public.billing_due(m))
  loop
    perform public.issue_invoice(r.id); n := n + 1;
  end loop;
  return n;
end $$;

-- السداد: الاشتراك يتجدد، والخدمة تتعلّم «مدفوعة» وتنسجّل دخل خدمات
create or replace function public.pay_invoice(inv_id uuid, method text, ref text default null, receipt text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare inv public.invoices; m public.merchants; who text; claims text; rid uuid := public.current_rep_id(); admin_ok boolean := public.is_admin();
begin
  if not (admin_ok or rid is not null) then raise exception 'not_allowed'; end if;
  if method not in ('transfer', 'pos', 'cash') then raise exception 'invalid_method'; end if;
  select * into inv from public.invoices where id = inv_id for update;
  if inv.id is null then raise exception 'invoice_not_found'; end if;
  if inv.status <> 'issued' then raise exception 'invoice_not_open'; end if;
  if receipt is not null and receipt !~ ('^' || auth.uid()::text || '/') and receipt is distinct from inv.submitted_receipt then raise exception 'bad_receipt'; end if;
  who := case when admin_ok then 'الإدارة: ' || coalesce((select email from auth.users where id = auth.uid()), '')
              else 'المسوّق: ' || (select name || ' (' || code || ')' from public.reps where id = rid) end;
  update public.invoices set status = 'paid', paid_at = now(), paid_method = method, paid_ref = nullif(trim(ref), ''),
    paid_by = auth.uid(), paid_by_label = who, receipt_path = receipt where id = inv_id;
  if inv.kind = 'service' then
    update public.service_requests set status = 'paid', paid_at = now() where invoice_id = inv.id and status = 'invoiced';
    insert into public.finance_entries (kind, category, amount, vat, entry_date, description, invoice_id, created_by)
    values ('income', 'services', inv.amount, inv.vat, current_date, inv.description || ' · ' || inv.store_name || ' · ' || inv.number, inv.id, auth.uid());
    return jsonb_build_object('paid', true);
  end if;
  select * into m from public.merchants where id = inv.merchant_id;
  claims := current_setting('request.jwt.claims', true);
  perform set_config('request.jwt.claims', '{}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  if m.id is not null then
    if m.plan = 'free' then
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

-- إلغاء المطالبة يلغي طلب الخدمة المرتبط
create or replace function public.void_invoice(inv_id uuid, reason text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  update public.invoices set status = 'void', note = nullif(trim(reason), '') where id = inv_id and status = 'issued';
  if not found then raise exception 'invoice_not_open'; end if;
  update public.service_requests set status = 'cancelled' where invoice_id = inv_id and status = 'invoiced';
end $$;

-- إيميل المطالبة يوصل التاجر أول ما تصدر مطالبة الخدمة
create or replace function public.notify_invoice_issued()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare s public.notify_settings;
begin
  if new.kind <> 'service' then return new; end if;
  select * into s from public.notify_settings where id;
  if s is null then return new; end if;
  perform net.http_post(url := replace(s.function_url, '/notify', '/billing'),
    body := jsonb_build_object('type', 'issued', 'invoice_id', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', s.webhook_secret),
    timeout_milliseconds := 10000);
  return new;
end $$;
revoke execute on function public.notify_invoice_issued() from public, anon, authenticated;
drop trigger if exists notify_invoice_issued on public.invoices;
create trigger notify_invoice_issued after insert on public.invoices for each row execute function public.notify_invoice_issued();

-- 4) عمولة المسوّق على الخدمات المدفوعة في الشهر، تنضاف لمكافأته
drop function if exists public.rep_month_stats(date);
create function public.rep_month_stats(m date)
returns table(rep_id uuid, name text, code text, active boolean, stores bigint, monthly_target int, bonus_per_store numeric,
              extra bigint, bonus numeric, services_n bigint, services_commission numeric, total numeric, paid boolean, paid_amount numeric)
language sql stable security definer set search_path = public as $$
  with mon as (select date_trunc('month', m)::date as s, (date_trunc('month', m) + interval '1 month')::date as e),
  cnt as (
    select r.id, count(x.id) as n
    from public.reps r cross join mon
    left join public.merchants x on x.rep_code = r.code and x.status = 'approved'
      and x.reviewed_at >= mon.s and x.reviewed_at < mon.e
    group by r.id
  ),
  svc as (
    select q.rep_id, count(*) as n, sum(q.rep_commission) as c
    from public.service_requests q cross join mon
    where q.rep_id is not null and q.status in ('paid', 'done') and q.paid_at >= mon.s and q.paid_at < mon.e
    group by q.rep_id
  )
  select r.id, r.name, r.code, r.active, c.n, r.monthly_target, r.bonus_per_store,
         greatest(c.n - r.monthly_target, 0), greatest(c.n - r.monthly_target, 0) * r.bonus_per_store,
         coalesce(v.n, 0), coalesce(v.c, 0),
         greatest(c.n - r.monthly_target, 0) * r.bonus_per_store + coalesce(v.c, 0),
         f.id is not null, f.amount
  from public.reps r join cnt c on c.id = r.id cross join mon
  left join svc v on v.rep_id = r.id
  left join public.finance_entries f on f.rep_id = r.id and f.category = 'rep_bonus' and f.ref_month = mon.s
  where public.is_admin()
  order by r.code;
$$;
revoke all on function public.rep_month_stats(date) from public, anon;
grant execute on function public.rep_month_stats(date) to authenticated;
