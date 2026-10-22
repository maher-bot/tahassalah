create or replace function public.field_stores_link_merchant()
returns trigger language plpgsql security definer set search_path = public as $$
declare mid uuid;
begin
  if new.phone is not null and new.merchant_id is null
     and (tg_op = 'INSERT' or new.phone is distinct from old.phone) then
    select id into mid from public.merchants where phone = new.phone limit 1;
    if mid is not null then new.merchant_id := mid; new.status := 'registered'; end if;
  end if;
  return new;
end $$;
create trigger field_stores_link_merchant before insert or update on public.field_stores
  for each row execute function public.field_stores_link_merchant();
revoke execute on function public.field_stores_link_merchant() from public, anon, authenticated;
