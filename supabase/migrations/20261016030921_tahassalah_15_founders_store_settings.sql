alter table public.merchants add column if not exists founder boolean not null default false;
alter table public.merchants add column if not exists trial_months integer not null default 3
  check (trial_months between 1 and 12);

create or replace function public.merchants_founder()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    if tg_op = 'INSERT' then new.founder := false; new.trial_months := 3;
    else new.founder := old.founder; new.trial_months := old.trial_months; end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and new.status = 'approved' and old.status is distinct from 'approved' and not old.founder
     and (select count(*) from public.merchants m where m.founder and m.city = new.city
          and coalesce(m.district, '') = coalesce(new.district, '')) < 500 then
    new.founder := true;
    new.trial_months := greatest(new.trial_months, 6);
  end if;
  return new;
end $$;
create trigger merchants_founder before insert or update on public.merchants
  for each row execute function public.merchants_founder();

create or replace function public.end_expired_trials()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.merchants set plan = next_plan
  where plan = 'free' and trial_started_at is not null
    and trial_started_at + make_interval(months => trial_months) <= now();
  get diagnostics n = row_count;
  return n;
end $$;

create table if not exists public.store_settings (
  merchant_id        uuid primary key references public.merchants(id) on delete cascade,
  pickup             boolean not null default true,
  delivers           boolean not null default false,
  delivery_radius_m  integer not null default 1000 check (delivery_radius_m between 200 and 10000),
  delivery_fee       numeric(6,2) not null default 0 check (delivery_fee between 0 and 100),
  free_delivery_over numeric(8,2) check (free_delivery_over is null or free_delivery_over >= 0),
  min_order          numeric(8,2) not null default 0 check (min_order >= 0),
  delivery_from      time,
  delivery_to        time,
  prep_minutes       integer not null default 15 check (prep_minutes between 0 and 240),
  note               text check (note is null or char_length(note) <= 300),
  updated_at         timestamptz not null default now(),
  constraint pickup_or_delivery check (pickup or delivers)
);
alter table public.store_settings enable row level security;

create or replace function public.store_settings_touch()
returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
create trigger store_settings_touch before insert or update on public.store_settings
  for each row execute function public.store_settings_touch();

create policy "owner manages store settings" on public.store_settings for all
  using (merchant_id = auth.uid() and public.is_approved_merchant(auth.uid()))
  with check (merchant_id = auth.uid() and public.is_approved_merchant(auth.uid()));
create policy "read store settings" on public.store_settings for select
  using (public.is_admin() or public.staff_has(merchant_id, 'inventory') or public.staff_has(merchant_id, 'prices')
    or (public.is_approved_merchant(merchant_id) and public.buyer_enabled()));

revoke execute on function public.merchants_founder() from public, anon, authenticated;
revoke execute on function public.store_settings_touch() from public, anon, authenticated;
