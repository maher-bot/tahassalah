-- رقم واتساب التواصل مع المشترين: منفصل عن جوال التسجيل (phone) الذي يبقى خاصًا بين المنصة والتاجر.
-- لا يظهر في العرض العام stores_public؛ يُكشف للمشتري لاحقًا بدالة تسجّل الضغطة.
alter table public.merchants
  add column if not exists contact_phone text check (contact_phone is null or contact_phone ~ '^05[0-9]{8}$');

-- التاجر المعتمد ما يقدر يعدّل صفّه مباشرة، فيغيّر رقم التواصل من هذي الدالة
create or replace function public.set_contact_phone(p text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p is null or p !~ '^05[0-9]{8}$' then raise exception 'bad_contact_phone'; end if;
  update public.merchants set contact_phone = p where id = auth.uid();
  if not found then raise exception 'not_approved'; end if;
end $$;
revoke all on function public.set_contact_phone(text) from public, anon;
grant execute on function public.set_contact_phone(text) to authenticated;
