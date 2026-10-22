create table public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;

create function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

create type public.merchant_status as enum ('pending', 'approved', 'rejected', 'suspended');

create table public.merchants (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text not null,
  owner_name    text not null check (char_length(owner_name) between 2 and 80),
  store_name    text not null check (char_length(store_name) between 2 and 80),
  activity      text not null,
  city          text not null,
  district      text,
  phone         text not null check (phone ~ '^05[0-9]{8}$'),
  lat           double precision,
  lng           double precision,
  cr_number     text not null check (cr_number ~ '^[0-9]{10}$'),
  vat_registered boolean not null default true,
  vat_number    text check (vat_number is null or vat_number ~ '^3[0-9]{13}3$'),
  bank_name     text not null,
  iban          text not null check (iban ~ '^SA[0-9]{2}[0-9A-Z]{20}$'),
  national_address text constraint merchants_national_address_check check (national_address is null or national_address ~ '^[A-Z]{4}[0-9]{4}$'),
  plan          text not null default 'free' constraint merchants_plan_check check (plan in ('free', 'commission', 'monthly', 'yearly')),
  next_plan     text not null default 'commission' constraint merchants_next_plan_check check (next_plan in ('commission', 'monthly', 'yearly')),
  trial_started_at timestamptz,
  cr_path       text not null,
  vat_path      text,
  iban_path     text not null,
  status        public.merchant_status not null default 'pending',
  review_note   text,
  reviewed_at   timestamptz,
  submitted_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint vat_required check (
    (vat_registered and vat_number is not null and vat_path is not null) or not vat_registered
  )
);
create index merchants_status_idx on public.merchants (status, submitted_at desc);
alter table public.merchants enable row level security;

create table public.app_settings (
  id               boolean primary key default true check (id),
  buyer_enabled    boolean not null default false,
  payments_enabled boolean not null default false,
  launch_city      text not null default 'مكة المكرمة',
  updated_at       timestamptz not null default now()
);
insert into public.app_settings (id) values (true);
alter table public.app_settings enable row level security;
grant select on public.app_settings to anon, authenticated;

create table public.products (
  id           uuid primary key default gen_random_uuid(),
  merchant_id  uuid not null references public.merchants(id) on delete cascade default auth.uid(),
  name         text not null check (char_length(name) between 2 and 120),
  description  text check (description is null or char_length(description) <= 1000),
  category     text,
  barcode      text,
  price        numeric(10,2) not null check (price >= 0),
  sale_price   numeric(10,2) check (sale_price is null or (sale_price >= 0 and sale_price < price)),
  quantity     integer not null default 0 check (quantity >= 0),
  image_path   text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index products_merchant_idx on public.products (merchant_id, created_at desc);
create index products_name_idx on public.products (lower(name));
alter table public.products enable row level security;
