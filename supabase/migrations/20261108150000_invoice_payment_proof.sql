-- التاجر يسدد بنفسه: يحوّل ويرفع الإيصال على المنصة من صفحة المطالبة (أو يرسله واتساب)،
-- والإدارة يوصلها إيميل وتأكد السداد بضغطة، فيتجدد الاشتراك.
alter table public.invoices
  add column if not exists submitted_at timestamptz,
  add column if not exists submitted_receipt text,
  add column if not exists submitted_ref text;

-- التاجر يرفع الإيصال في مجلده داخل receipts
drop policy if exists "receipts: staff upload own" on storage.objects;
create policy "receipts: staff upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text
              and (public.is_admin() or public.current_rep_id() is not null
                   or exists (select 1 from public.merchants m where m.id = auth.uid())));

create or replace function public.submit_payment_proof(inv_id uuid, receipt text, ref text default null)
returns void language plpgsql security definer set search_path = public as $$
declare inv public.invoices;
begin
  select * into inv from public.invoices where id = inv_id for update;
  if inv.id is null or inv.merchant_id is distinct from auth.uid() then raise exception 'invoice_not_found'; end if;
  if inv.status <> 'issued' then raise exception 'invoice_not_open'; end if;
  if receipt is null or receipt !~ ('^' || auth.uid()::text || '/') then raise exception 'bad_receipt'; end if;
  update public.invoices set submitted_at = now(), submitted_receipt = receipt, submitted_ref = nullif(trim(ref), '') where id = inv_id;
end $$;
revoke all on function public.submit_payment_proof(uuid, text, text) from public, anon;
grant execute on function public.submit_payment_proof(uuid, text, text) to authenticated;

-- الإدارة تأكد السداد بإيصال التاجر نفسه
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

-- إيميل للإدارة لما يرفع التاجر إيصال
create or replace function public.notify_invoice_paid()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare s public.notify_settings; t text;
begin
  t := case when new.status = 'paid' and old.status is distinct from 'paid' then 'paid'
            when new.submitted_at is not null and new.submitted_at is distinct from old.submitted_at then 'proof' end;
  if t is null then return new; end if;
  select * into s from public.notify_settings where id;
  if s is null then return new; end if;
  perform net.http_post(url := replace(s.function_url, '/notify', '/billing'),
    body := jsonb_build_object('type', t, 'invoice_id', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', s.webhook_secret),
    timeout_milliseconds := 10000);
  return new;
end $$;
