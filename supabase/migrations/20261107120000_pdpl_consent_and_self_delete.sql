-- نظام حماية البيانات الشخصية: موافقات صريحة، وحذف الحساب بطلب صاحبه.

-- 1) موافقة صريحة على حفظ الموقع واستخدامه (الأسر المنتجة والعربات): بيت الأسرة والموقع المباشر.
--    التاريخ يضبطه الخادم، والتاجر يقدر يعطيها أو يسحبها فقط.
alter table public.merchants add column if not exists location_consent_at timestamptz;

create or replace function public.merchants_location_consent_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.location_consent_at is not null then new.location_consent_at := now(); end if;
  elsif new.location_consent_at is distinct from old.location_consent_at and new.location_consent_at is not null then
    new.location_consent_at := now();
  end if;
  return new;
end $$;
revoke execute on function public.merchants_location_consent_guard() from public, anon, authenticated;
drop trigger if exists merchants_location_consent_guard on public.merchants;
create trigger merchants_location_consent_guard before insert or update on public.merchants
  for each row execute function public.merchants_location_consent_guard();

create or replace function public.set_location_consent(agree boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  update public.merchants set location_consent_at = case when agree then now() else null end where id = auth.uid();
  if not found then raise exception 'merchant_not_found'; end if;
end $$;
revoke all on function public.set_location_consent(boolean) from public, anon;
grant execute on function public.set_location_consent(boolean) to authenticated;

-- 2) الفريق الميداني: إقرار المسوّق أنه أخبر صاحب المحل ووافق على حفظ اسمه وجواله وصورة الواجهة.
alter table public.field_stores add column if not exists consent_at timestamptz;
create or replace function public.field_stores_consent_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.consent_at is not null then new.consent_at := now(); end if;
  elsif new.consent_at is distinct from old.consent_at and new.consent_at is not null then
    new.consent_at := now();
  end if;
  return new;
end $$;
revoke execute on function public.field_stores_consent_guard() from public, anon, authenticated;
drop trigger if exists field_stores_consent_guard on public.field_stores;
create trigger field_stores_consent_guard before insert or update on public.field_stores
  for each row execute function public.field_stores_consent_guard();

-- 3) حذف الحساب بطلب صاحبه: المتجر ومنتجاته وإعداداته وحساباته البنكية وفريقه (بالحذف المتتالي)،
--    وبيانات الاتصال في زيارة الفريق الميداني المرتبطة به، وإيميل الدخول نفسه.
--    الملفات (المستندات وصور المنتجات) يحذفها التطبيق أولًا من المخزن بصلاحية صاحب الحساب.
create policy "docs: owner deletes own" on storage.objects for delete to authenticated
  using (bucket_id = 'merchant-docs' and (storage.foldername(name))[1] = auth.uid()::text);

create or replace function public.delete_my_account()
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare uid uuid := auth.uid(); m public.merchants;
begin
  if uid is null then raise exception 'not_signed_in'; end if;
  if public.is_admin() then raise exception 'admin_cannot_self_delete'; end if;
  select * into m from public.merchants where id = uid;
  if m.id is null then raise exception 'merchant_not_found'; end if;
  -- سجل بدون بيانات شخصية: نعرف أن حسابًا انحذف بطلب صاحبه ومتى فقط
  insert into public.merchant_edits (merchant_id, merchant_name, admin_id, admin_email, changes)
    values (uid, '(محذوف بطلب صاحبه)', null, null, jsonb_build_object('_self_deleted', true, 'kind', m.kind, 'status', m.status));
  update public.field_stores set contact_name = null, phone = null, notes = null, lat = null, lng = null, accuracy_m = null
    where merchant_id = uid;
  delete from public.merchants where id = uid;
  delete from auth.users where id = uid;
  return jsonb_build_object('deleted', true);
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
