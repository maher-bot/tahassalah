-- حسابات آيبان إضافية للتاجر (حتى 4 غير الحساب الأساسي في merchants).
-- كل حساب يراجعه الأدمن ويعتمده، ولا يظهر للمشتري (لاحقًا، بعد موافقة التاجر على الطلب) إلا المعتمد.
create table public.merchant_ibans (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  bank_name text not null check (char_length(bank_name) between 2 and 60),
  iban text not null check (iban ~ '^SA[0-9]{2}[0-9A-Z]{20}$'),
  cert_path text,
  verified_at timestamptz,
  verified_note text,
  created_at timestamptz not null default now(),
  unique (merchant_id, iban)
);
create index merchant_ibans_merchant_idx on public.merchant_ibans (merchant_id);
alter table public.merchant_ibans enable row level security;
revoke all on public.merchant_ibans from anon;
create policy "ibans: owner or admin reads" on public.merchant_ibans for select using (merchant_id = auth.uid() or public.is_admin());
create policy "ibans: owner adds" on public.merchant_ibans for insert with check (merchant_id = auth.uid());
create policy "ibans: owner updates own" on public.merchant_ibans for update using (merchant_id = auth.uid()) with check (merchant_id = auth.uid());
create policy "ibans: owner or admin deletes" on public.merchant_ibans for delete using (merchant_id = auth.uid() or public.is_admin());

create or replace function public.merchant_ibans_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.iban := upper(regexp_replace(new.iban, '\s', '', 'g'));
  if tg_op = 'INSERT' then
    if (select count(*) from public.merchant_ibans where merchant_id = new.merchant_id) >= 4 then raise exception 'ibans_limit'; end if;
    if exists (select 1 from public.merchants where id = new.merchant_id and iban = new.iban) then raise exception 'iban_is_primary'; end if;
    if not (public.is_admin() or auth.uid() is null) then new.verified_at := null; new.verified_note := null; end if;
  else
    if not (public.is_admin() or auth.uid() is null) then
      new.merchant_id := old.merchant_id; new.verified_at := old.verified_at; new.verified_note := old.verified_note;
    end if;
    if new.iban is distinct from old.iban and exists (select 1 from public.merchants where id = new.merchant_id and iban = new.iban) then raise exception 'iban_is_primary'; end if;
    if (new.iban is distinct from old.iban or new.cert_path is distinct from old.cert_path) and new.verified_at is not distinct from old.verified_at then
      new.verified_at := null; new.verified_note := null;
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.merchant_ibans_guard() from public, anon, authenticated;
create trigger merchant_ibans_guard before insert or update on public.merchant_ibans
  for each row execute function public.merchant_ibans_guard();

create or replace function public.set_extra_iban_verified(iid uuid, verified boolean, note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare x public.merchant_ibans; mname text;
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  select * into x from public.merchant_ibans where id = iid;
  if x.id is null then raise exception 'iban_not_found'; end if;
  select store_name into mname from public.merchants where id = x.merchant_id;
  update public.merchant_ibans set
    verified_at = case when verified then now() else null end,
    verified_note = case when verified then nullif(trim(note), '') else null end
  where id = iid;
  insert into public.merchant_edits (merchant_id, merchant_name, admin_id, admin_email, changes, note)
    values (x.merchant_id, mname, auth.uid(), (select email from auth.users where id = auth.uid()),
            jsonb_build_object('extra_iban_verified', verified, 'iban_tail', right(x.iban, 4)), nullif(trim(note), ''));
end $$;
revoke all on function public.set_extra_iban_verified(uuid, boolean, text) from public, anon;
grant execute on function public.set_extra_iban_verified(uuid, boolean, text) to authenticated;

create policy "docs: owner deletes extra iban certificates" on storage.objects for delete to authenticated
  using (bucket_id = 'merchant-docs' and (storage.foldername(name))[1] = auth.uid()::text and name like '%/iban2-%');
