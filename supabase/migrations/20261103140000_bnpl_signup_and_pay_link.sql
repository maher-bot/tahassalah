-- 1) التقسيط وقت التسجيل: المحل يختار تابي أو تمارا (أو الاثنين) في نموذج التسجيل.
--    إعدادات الدفع (store_settings) ما تنكتب إلا بعد التفعيل، فنحفظ الاختيار هنا ونستخدمه افتراضيًا
--    أول ما يفتح التاجر «التوصيل والاستلام»، ويطلع للإدارة وقت المراجعة.
alter table public.merchants
  add column if not exists bnpl text[] not null default '{}';
alter table public.merchants drop constraint if exists merchants_bnpl_chk;
alter table public.merchants
  add constraint merchants_bnpl_chk check (bnpl <@ array['tabby', 'tamara']::text[]);

-- 2) رابط دفع إلكتروني خاص بالتاجر (بوابة دفع باسمه، أو متجره في سلة أو زد).
--    المشتري يدفع للتاجر مباشرة، والمنصة ما تمسك فلوس. الرابط ما يظهر للمشتري إلا بعد اعتماد الإدارة
--    (مثل الآيبان)، وينسحب الاعتماد تلقائيًا لو تغيّر الرابط.
alter table public.merchants
  add column if not exists pay_link text,
  add column if not exists pay_link_provider text,
  add column if not exists pay_link_verified_at timestamptz,
  add column if not exists pay_link_verified_note text;
alter table public.merchants drop constraint if exists merchants_pay_link_chk;
alter table public.merchants
  add constraint merchants_pay_link_chk check (
    pay_link is null or (pay_link ~ '^https://[^\s/]+\.[^\s/]+(/\S*)?$' and char_length(pay_link) <= 300));
alter table public.merchants drop constraint if exists merchants_pay_link_provider_chk;
alter table public.merchants
  add constraint merchants_pay_link_provider_chk check (
    pay_link_provider is null or pay_link_provider in ('tap', 'moyasar', 'hyperpay', 'paytabs', 'geidea', 'stcpay', 'salla', 'zid', 'other'));

create or replace function public.merchants_pay_link_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if not (public.is_admin() or auth.uid() is null) then
      new.pay_link_verified_at := null; new.pay_link_verified_note := null;
    end if;
    return new;
  end if;
  if not (public.is_admin() or auth.uid() is null) then
    new.pay_link_verified_at := old.pay_link_verified_at; new.pay_link_verified_note := old.pay_link_verified_note;
  end if;
  if (new.pay_link is distinct from old.pay_link or new.pay_link_provider is distinct from old.pay_link_provider)
     and new.pay_link_verified_at is not distinct from old.pay_link_verified_at then
    new.pay_link_verified_at := null; new.pay_link_verified_note := null;
  end if;
  return new;
end $$;
revoke execute on function public.merchants_pay_link_guard() from public, anon, authenticated;
drop trigger if exists merchants_pay_link_guard on public.merchants;
create trigger merchants_pay_link_guard before insert or update on public.merchants
  for each row execute function public.merchants_pay_link_guard();

-- التاجر يحفظ رابطه (أو يمسحه بقيم فاضية). الاعتماد يرجع «بانتظار المراجعة» تلقائيًا عن طريق الحارس.
create or replace function public.set_pay_link(provider text, link text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  update public.merchants set
    pay_link = nullif(trim(link), ''),
    pay_link_provider = case when nullif(trim(link), '') is null then null else nullif(trim(provider), '') end
  where id = auth.uid();
  if not found then raise exception 'merchant_not_found'; end if;
end $$;
revoke all on function public.set_pay_link(text, text) from public, anon;
grant execute on function public.set_pay_link(text, text) to authenticated;

-- الإدارة تعتمد الرابط بعد ما تفتحه وتتأكد أن اسم المستفيد في صفحة الدفع هو اسم المحل أو صاحبه.
create or replace function public.set_pay_link_verified(mid uuid, verified boolean, note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare mname text; mlink text;
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  select store_name, pay_link into mname, mlink from public.merchants where id = mid;
  if mname is null then raise exception 'merchant_not_found'; end if;
  if verified and mlink is null then raise exception 'no_pay_link'; end if;
  update public.merchants set
    pay_link_verified_at = case when verified then now() else null end,
    pay_link_verified_note = case when verified then nullif(trim(note), '') else null end
  where id = mid;
  insert into public.merchant_edits (merchant_id, merchant_name, admin_id, admin_email, changes, note)
    values (mid, mname, auth.uid(), (select email from auth.users where id = auth.uid()),
            jsonb_build_object('pay_link_verified', verified), nullif(trim(note), ''));
end $$;
revoke all on function public.set_pay_link_verified(uuid, boolean, text) from public, anon;
grant execute on function public.set_pay_link_verified(uuid, boolean, text) to authenticated;
