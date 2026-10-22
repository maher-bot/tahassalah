alter table public.merchants add column if not exists rep_code text;

create or replace function public.merchants_rep_code()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and not public.is_admin() then
    new.rep_code := old.rep_code;
    return new;
  end if;
  new.rep_code := nullif(upper(trim(coalesce(new.rep_code, ''))), '');
  if new.rep_code is not null and not exists (select 1 from public.reps where code = new.rep_code) then
    new.rep_code := null;
  end if;
  return new;
end $$;
create trigger merchants_rep_code before insert or update on public.merchants
  for each row execute function public.merchants_rep_code();

create or replace function public.merchants_link_field()
returns trigger language plpgsql security definer set search_path = public as $$
declare sid uuid; rid uuid;
begin
  select id into sid from public.field_stores where phone = new.phone and merchant_id is null limit 1;
  if sid is not null then
    update public.field_stores set merchant_id = new.id, status = 'registered', last_visit_at = now() where id = sid;
    return new;
  end if;
  if new.rep_code is not null then
    select id into rid from public.reps where code = new.rep_code;
    if rid is not null and not exists (select 1 from public.field_stores where phone = new.phone) then
      insert into public.field_stores (rep_id, store_name, activity, phone, district, lat, lng, status, merchant_id, notes)
      values (rid, new.store_name, new.activity, new.phone, new.district, new.lat, new.lng, 'registered', new.id, 'سجّل بكود المسوّق');
    end if;
  end if;
  return new;
end $$;
create trigger merchants_link_field after insert on public.merchants
  for each row execute function public.merchants_link_field();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('field-photos', 'field-photos', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "field photos: rep uploads" on storage.objects for insert to authenticated
  with check (bucket_id = 'field-photos' and (storage.foldername(name))[1] = public.current_rep_id()::text);
create policy "field photos: rep or admin reads" on storage.objects for select to authenticated
  using (bucket_id = 'field-photos' and ((storage.foldername(name))[1] = public.current_rep_id()::text or public.is_admin()));

revoke execute on function public.reps_guard() from public, anon, authenticated;
revoke execute on function public.field_stores_guard() from public, anon, authenticated;
revoke execute on function public.field_stores_first_visit() from public, anon, authenticated;
revoke execute on function public.field_visits_apply() from public, anon, authenticated;
revoke execute on function public.merchants_rep_code() from public, anon, authenticated;
revoke execute on function public.merchants_link_field() from public, anon, authenticated;
revoke execute on function public.my_rep() from public, anon;
revoke execute on function public.field_duplicates(text, double precision, double precision) from public, anon;
grant execute on function public.my_rep(), public.field_duplicates(text, double precision, double precision) to authenticated;
