-- المختبرين: حسابات محددة تشوف المحلات وتطلب قبل الإطلاق، والصفحة تبقى مقفلة لبقية الناس.
-- buyer_enabled() نفسها ما تتغير (تشغيل الفترة المجانية وتنبيه العروض مربوطة بالإطلاق الفعلي).
create table if not exists public.buyer_testers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  note text, added_at timestamptz not null default now());
alter table public.buyer_testers enable row level security;

create or replace function public.buyer_access()
returns boolean language sql stable security definer set search_path = public as $$
  select public.buyer_enabled() or exists (select 1 from public.buyer_testers where user_id = auth.uid());
$$;
revoke all on function public.buyer_access() from public;
grant execute on function public.buyer_access() to anon, authenticated;

do $$
declare d text;
begin
  d := pg_get_functiondef('public.place_order'::regproc);
  assert position('not public.buyer_enabled()' in d) > 0, 'place_order';
  execute replace(d, 'not public.buyer_enabled()', 'not public.buyer_access()');
  d := pg_get_viewdef('public.stores_public'::regclass);
  assert position('buyer_enabled()' in d) > 0, 'stores_public';
  execute 'create or replace view public.stores_public with (security_invoker = false) as ' || replace(d, 'buyer_enabled()', 'buyer_access()');
end $$;

alter policy "public reads active products" on public.products using
  ((merchant_id = auth.uid()) OR is_admin() OR staff_has(merchant_id, 'inventory'::text) OR staff_has(merchant_id, 'prices'::text)
   OR (is_active AND is_approved_merchant(merchant_id) AND is_entitled(merchant_id) AND buyer_access()));
alter policy "read store settings" on public.store_settings using
  (is_admin() OR staff_has(merchant_id, 'inventory'::text) OR staff_has(merchant_id, 'prices'::text)
   OR (is_approved_merchant(merchant_id) AND is_entitled(merchant_id) AND buyer_access()));
