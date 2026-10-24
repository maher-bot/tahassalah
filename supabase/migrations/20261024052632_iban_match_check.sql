-- علامة «الآيبان مطابق للسجل»: يعتمدها الأدمن بعد ما يقارن شهادة الآيبان بالسجل التجاري (أو بالهوية للأفراد).
-- تنسحب تلقائيًا لو تغيّر الآيبان أو شهادته، ولا أحد غير الأدمن يقدر يضبطها.

alter table public.merchants
  add column if not exists iban_verified_at timestamptz,
  add column if not exists iban_verified_note text;

create or replace function public.merchants_iban_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if not (public.is_admin() or auth.uid() is null) then
      new.iban_verified_at := null; new.iban_verified_note := null;
    end if;
    return new;
  end if;
  if not (public.is_admin() or auth.uid() is null) then
    new.iban_verified_at := old.iban_verified_at; new.iban_verified_note := old.iban_verified_note;
  end if;
  if (new.iban is distinct from old.iban or new.iban_path is distinct from old.iban_path)
     and new.iban_verified_at is not distinct from old.iban_verified_at then
    new.iban_verified_at := null; new.iban_verified_note := null;
  end if;
  return new;
end $$;
revoke execute on function public.merchants_iban_guard() from public, anon, authenticated;
create trigger merchants_iban_guard before insert or update on public.merchants
  for each row execute function public.merchants_iban_guard();

create or replace function public.set_iban_verified(mid uuid, verified boolean, note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare mname text;
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  select store_name into mname from public.merchants where id = mid;
  if mname is null then raise exception 'merchant_not_found'; end if;
  update public.merchants set
    iban_verified_at = case when verified then now() else null end,
    iban_verified_note = case when verified then nullif(trim(note), '') else null end
  where id = mid;
  insert into public.merchant_edits (merchant_id, merchant_name, admin_id, admin_email, changes, note)
    values (mid, mname, auth.uid(), (select email from auth.users where id = auth.uid()),
            jsonb_build_object('iban_verified', verified), nullif(trim(note), ''));
end $$;
revoke all on function public.set_iban_verified(uuid, boolean, text) from public, anon;
grant execute on function public.set_iban_verified(uuid, boolean, text) to authenticated;
