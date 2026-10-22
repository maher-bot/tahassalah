-- Initial marketplace schema for Tahassalah
-- Enables a public product discovery and merchant management flow

create extension if not exists "pgcrypto";

create table if not exists public.merchants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  business_type text not null check (business_type in ('shop', 'market', 'home_business', 'delivery')),
  email text,
  phone text,
  whatsapp text,
  city text,
  district text,
  address text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'inactive')),
  is_active boolean not null default false,
  latitude double precision,
  longitude double precision,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  sku text,
  name text not null,
  description text,
  category text,
  brand text,
  unit text,
  price numeric(12,2) not null default 0 check (price >= 0),
  stock integer not null default 0 check (stock >= 0),
  stock_status text not null default 'in_stock' check (stock_status in ('in_stock', 'low_stock', 'out_of_stock')),
  is_active boolean not null default true,
  images jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete restrict,
  customer_name text,
  customer_phone text,
  order_status text not null default 'pending' check (order_status in ('pending', 'confirmed', 'preparing', 'ready_for_pickup', 'completed', 'cancelled')),
  subtotal numeric(12,2) not null default 0 check (subtotal >= 0),
  delivery_fee numeric(12,2) not null default 0 check (delivery_fee >= 0),
  total numeric(12,2) not null default 0 check (total >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity integer not null default 1 check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  total_price numeric(12,2) not null check (total_price >= 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_merchants_city on public.merchants(city);
create index if not exists idx_merchants_status on public.merchants(status);
create index if not exists idx_products_merchant_id on public.products(merchant_id);
create index if not exists idx_products_category on public.products(category);
create index if not exists idx_products_active on public.products(is_active);
create index if not exists idx_orders_merchant_id on public.orders(merchant_id);
create index if not exists idx_orders_status on public.orders(order_status);
create index if not exists idx_order_items_order_id on public.order_items(order_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger merchants_set_updated_at
before update on public.merchants
for each row execute procedure public.set_updated_at();

create trigger products_set_updated_at
before update on public.products
for each row execute procedure public.set_updated_at();

create trigger orders_set_updated_at
before update on public.orders
for each row execute procedure public.set_updated_at();

alter table public.merchants enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

create policy "merchants_select_public" on public.merchants
for select using (true);

create policy "products_select_public" on public.products
for select using (is_active = true);

create policy "orders_select_public_for_merchant" on public.orders
for select using (true);

create policy "order_items_select_public_for_merchant" on public.order_items
for select using (true);

create policy "merchants_insert_authenticated_only" on public.merchants
for insert with check (auth.role() = 'authenticated');

create policy "products_insert_authenticated_only" on public.products
for insert with check (auth.role() = 'authenticated');

create policy "orders_insert_authenticated_only" on public.orders
for insert with check (auth.role() = 'authenticated');

create policy "order_items_insert_authenticated_only" on public.order_items
for insert with check (auth.role() = 'authenticated');

create policy "merchants_update_authenticated_only" on public.merchants
for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "products_update_authenticated_only" on public.products
for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "orders_update_authenticated_only" on public.orders
for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "order_items_update_authenticated_only" on public.order_items
for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
