-- تعديل بيانات التاجر من لوحة الإدارة (مع سجل لكل تعديل) + قفل رقم السجل التجاري/الهوية + حذف حساب التاجر.
-- رقم السجل التجاري (والهوية للأفراد) ثابت: صاحب الطلب يصحّحه فقط وهو «معلّق/مرفوض»، وبعد الاعتماد لا أحد (ولا الأدمن) يغيّره؛ الحل حذف الحساب.

create table if not exists public.merchant_edits (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null,
  merchant_name text,
  admin_id uuid,
  admin_email text,
  changes jsonb not null,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists merchant_edits_merchant_idx on public.merchant_edits (merchant_id, created_at desc);
alter table public.merchant_edits enable row level security;
revoke all on public.merchant_edits from anon;
create policy "admin reads edits" on public.merchant_edits for select using (public.is_admin());

create or replace function public.merchants_identity_lock()
returns trigger language plpgsql set search_path = public as $$
begin
  if (old.cr_number is not null and new.cr_number is distinct from old.cr_number)
     or (old.id_number is not null and new.id_number is distinct from old.id_number) then
    if not (old.status in ('pending', 'rejected') and auth.uid() is not null and auth.uid() = old.id) then
      raise exception 'immutable_identity';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.merchants_identity_lock() from public, anon, authenticated;
create trigger merchants_identity_lock before update on public.merchants
  for each row execute function public.merchants_identity_lock();

create or replace function public.admin_edit_merchant(mid uuid, patch jsonb, note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  m public.merchants; r public.merchants; k text; changes jsonb := '{}'::jsonb;
  allowed text[] := array['owner_name', 'store_name', 'activity', 'city', 'district', 'national_address', 'phone', 'contact_phone',
                          'lat', 'lng', 'bank_name', 'iban', 'vat_registered', 'vat_number', 'license_number'];
begin
  if not (public.is_admin() or auth.uid() is null) then raise exception 'not_admin'; end if;
  if patch is null or jsonb_typeof(patch) <> 'object' or patch = '{}'::jsonb then raise exception 'empty_patch'; end if;
  select * into m from public.merchants where id = mid;
  if m.id is null then raise exception 'merchant_not_found'; end if;
  for k in select jsonb_object_keys(patch) loop
    if k in ('cr_number', 'id_number') then raise exception 'immutable_identity'; end if;
    if not (k = any (allowed)) then raise exception 'field_not_editable: %', k; end if;
  end loop;
  r := jsonb_populate_record(m, patch);
  for k in select jsonb_object_keys(patch) loop
    if (to_jsonb(m) -> k) is distinct from (to_jsonb(r) -> k) then
      changes := changes || jsonb_build_object(k, jsonb_build_array(to_jsonb(m) -> k, to_jsonb(r) -> k));
    end if;
  end loop;
  if changes = '{}'::jsonb then return jsonb_build_object('changed', false); end if;
  update public.merchants set
    owner_name = r.owner_name, store_name = r.store_name, activity = r.activity, city = r.city, district = r.district,
    national_address = r.national_address, phone = r.phone, contact_phone = r.contact_phone, lat = r.lat, lng = r.lng,
    bank_name = r.bank_name, iban = r.iban, vat_registered = r.vat_registered, vat_number = r.vat_number, license_number = r.license_number
  where id = mid;
  insert into public.merchant_edits (merchant_id, merchant_name, admin_id, admin_email, changes, note)
    values (mid, r.store_name, auth.uid(), (select email from auth.users where id = auth.uid()), changes, nullif(trim(note), ''));
  return jsonb_build_object('changed', true, 'fields', (select jsonb_agg(x) from jsonb_object_keys(changes) x));
end $$;
revoke all on function public.admin_edit_merchant(uuid, jsonb, text) from public, anon;
grant execute on function public.admin_edit_merchant(uuid, jsonb, text) to authenticated;

create or replace function public.admin_set_merchant_email(mid uuid, new_email text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := lower(trim(coalesce(new_email, ''))); old_e text; mname text;
begin
  if not (public.is_admin() or auth.uid() is null) then raise exception 'not_admin'; end if;
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'bad_email'; end if;
  select store_name into mname from public.merchants where id = mid;
  if mname is null then raise exception 'merchant_not_found'; end if;
  select email into old_e from auth.users where id = mid;
  if lower(coalesce(old_e, '')) = e then return jsonb_build_object('changed', false); end if;
  if exists (select 1 from auth.users where lower(email) = e and id <> mid) then raise exception 'email_in_use'; end if;
  update auth.users set email = e, email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now() where id = mid;
  update auth.identities set identity_data = identity_data || jsonb_build_object('email', e, 'email_verified', true), updated_at = now()
    where user_id = mid and provider = 'email';
  update public.merchants set email = e where id = mid;
  insert into public.merchant_edits (merchant_id, merchant_name, admin_id, admin_email, changes)
    values (mid, mname, auth.uid(), (select email from auth.users where id = auth.uid()), jsonb_build_object('email', jsonb_build_array(old_e, e)));
  return jsonb_build_object('changed', true, 'email', e);
end $$;
revoke all on function public.admin_set_merchant_email(uuid, text) from public, anon;
grant execute on function public.admin_set_merchant_email(uuid, text) to authenticated;

create or replace function public.admin_delete_merchant(mid uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m public.merchants;
begin
  if not (public.is_admin() or auth.uid() is null) then raise exception 'not_admin'; end if;
  select * into m from public.merchants where id = mid;
  if m.id is null then raise exception 'merchant_not_found'; end if;
  insert into public.merchant_edits (merchant_id, merchant_name, admin_id, admin_email, changes)
    values (mid, m.store_name, auth.uid(), (select email from auth.users where id = auth.uid()),
            jsonb_build_object('_deleted', true, 'kind', m.kind, 'status', m.status));
  delete from public.merchants where id = mid;
  return jsonb_build_object('deleted', true);
end $$;
revoke all on function public.admin_delete_merchant(uuid) from public, anon;
grant execute on function public.admin_delete_merchant(uuid) to authenticated;

create policy "docs: admin deletes" on storage.objects for delete to authenticated
  using (bucket_id = 'merchant-docs' and public.is_admin());
create policy "images: admin deletes" on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and public.is_admin());
