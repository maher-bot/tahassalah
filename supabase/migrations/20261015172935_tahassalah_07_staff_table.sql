create table if not exists public.merchant_staff (
  id           uuid primary key default gen_random_uuid(),
  merchant_id  uuid not null references public.merchants(id) on delete cascade,
  email        text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  name         text check (name is null or char_length(name) <= 60),
  user_id      uuid references auth.users(id) on delete set null,
  role         text not null default 'stock' check (role in ('manager', 'stock', 'pricing', 'cashier', 'accountant')),
  perms        text[] not null default '{inventory}',
  status       text not null default 'invited' check (status in ('invited', 'active', 'suspended')),
  needs_approval boolean not null default true,
  invited_at   timestamptz not null default now(),
  accepted_at  timestamptz,
  unique (merchant_id, email),
  constraint perms_valid check (perms <@ array['inventory', 'prices', 'orders', 'sales', 'earnings']::text[])
);
create index if not exists merchant_staff_user_idx on public.merchant_staff (user_id) where user_id is not null;
create index if not exists merchant_staff_email_idx on public.merchant_staff (email);
alter table public.merchant_staff enable row level security;

create or replace function public.staff_has(mid uuid, perm text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.merchant_staff
    where merchant_id = mid and user_id = auth.uid() and status = 'active' and perm = any(perms));
$$;

create or replace function public.staff_direct(mid uuid, perm text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.merchant_staff
    where merchant_id = mid and user_id = auth.uid() and status = 'active'
      and not needs_approval and perm = any(perms));
$$;

create or replace function public.can_manage_products(mid uuid, perm text default 'inventory')
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_approved_merchant(mid)
     and (mid = auth.uid() or public.staff_direct(mid, perm));
$$;
