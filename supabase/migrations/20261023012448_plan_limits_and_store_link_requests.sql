-- 1) حدود الباقات حسب عدد المنتجات الظاهرة: أساسي 30، أسر ومتجولين 100، تاجر 500، مميز بلا حد
create or replace function public.products_plan_limits()
returns trigger language plpgsql security definer set search_path = public as $$
declare pl text; lim int;
begin
  if auth.uid() is null or public.is_admin() then return new; end if;
  pl := public.merchant_plan(new.merchant_id);
  if pl = 'basic' then
    if new.sale_price is not null and (tg_op = 'INSERT' or old.sale_price is distinct from new.sale_price) then
      raise exception 'plan_basic_offers';
    end if;
    if new.preorder_hours is not null and (tg_op = 'INSERT' or old.preorder_hours is distinct from new.preorder_hours) then
      raise exception 'plan_basic_preorder';
    end if;
  end if;
  lim := case pl when 'basic' then 30 when 'family' then 100 when 'trader' then 500 end;
  if lim is not null and new.is_active and (tg_op = 'INSERT' or not old.is_active)
     and (select count(*) from public.products where merchant_id = new.merchant_id and is_active and id <> new.id) >= lim then
    raise exception 'plan_%_products', pl;
  end if;
  return new;
end $$;

-- 2) طلبات «اربط متجرك الإلكتروني»: نجمع اهتمام التجار (المنصة + الرابط) قبل بناء المزامنة
create table if not exists public.store_link_requests (
  merchant_id uuid primary key references public.merchants(id) on delete cascade,
  platform text not null check (platform in ('salla', 'zid', 'shopify', 'custom')),
  store_url text check (store_url is null or (char_length(store_url) <= 300 and store_url ~* '^https?://')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.store_link_requests enable row level security;
revoke all on public.store_link_requests from anon;
create policy "owner reads own link request" on public.store_link_requests for select
  using (merchant_id = auth.uid() or public.is_admin());
create policy "approved owner adds link request" on public.store_link_requests for insert
  with check (merchant_id = auth.uid() and public.is_approved_merchant(auth.uid()));
create policy "approved owner updates link request" on public.store_link_requests for update
  using (merchant_id = auth.uid() and public.is_approved_merchant(auth.uid()))
  with check (merchant_id = auth.uid());
create trigger store_link_requests_touch before update on public.store_link_requests
  for each row execute function public.touch_updated_at();
