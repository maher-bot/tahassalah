create table if not exists public.reps (
  id         uuid primary key default gen_random_uuid(),
  email      text not null unique check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  name       text not null check (char_length(name) between 2 and 60),
  phone      text check (phone is null or phone ~ '^05[0-9]{8}$'),
  code       text not null unique check (code ~ '^[A-Z0-9]{2,8}$'),
  districts  text[] not null default '{}',
  daily_target integer not null default 10 check (daily_target between 0 and 200),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.reps enable row level security;

create or replace function public.current_rep_id()
returns uuid language sql stable security definer set search_path = public as $$
  select r.id from public.reps r
  where r.active and lower(r.email) = lower((select email from auth.users where id = auth.uid()));
$$;

create or replace function public.reps_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.email := lower(trim(new.email));
  new.code := upper(trim(new.code));
  return new;
end $$;
create trigger reps_guard before insert or update on public.reps
  for each row execute function public.reps_guard();

create policy "admin manages reps" on public.reps for all
  using (public.is_admin()) with check (public.is_admin());
create policy "rep reads self" on public.reps for select
  using (id = public.current_rep_id());

create or replace function public.my_rep()
returns table (id uuid, name text, code text, districts text[], daily_target integer)
language sql stable security definer set search_path = public as $$
  select r.id, r.name, r.code, r.districts, r.daily_target from public.reps r where r.id = public.current_rep_id();
$$;

create table if not exists public.field_stores (
  id            uuid primary key default gen_random_uuid(),
  rep_id        uuid not null references public.reps(id),
  store_name    text not null check (char_length(store_name) between 2 and 120),
  activity      text,
  contact_name  text check (contact_name is null or char_length(contact_name) <= 60),
  phone         text check (phone is null or phone ~ '^05[0-9]{8}$'),
  district      text,
  lat           double precision,
  lng           double precision,
  accuracy_m    integer,
  photo_path    text,
  status        text not null default 'interested'
                check (status in ('registered', 'interested', 'follow_up', 'not_interested', 'problem', 'closed')),
  problem       text,
  notes         text check (notes is null or char_length(notes) <= 1000),
  follow_up_on  date,
  visits        integer not null default 1,
  last_visit_at timestamptz not null default now(),
  merchant_id   uuid references public.merchants(id) on delete set null,
  created_at    timestamptz not null default now()
);
create unique index if not exists field_stores_phone_uq on public.field_stores (phone) where phone is not null;
create index if not exists field_stores_rep_idx on public.field_stores (rep_id, last_visit_at desc);
alter table public.field_stores enable row level security;

create table if not exists public.field_visits (
  id         uuid primary key default gen_random_uuid(),
  store_id   uuid not null references public.field_stores(id) on delete cascade,
  rep_id     uuid not null references public.reps(id),
  status     text not null check (status in ('registered', 'interested', 'follow_up', 'not_interested', 'problem', 'closed')),
  problem    text,
  notes      text check (notes is null or char_length(notes) <= 1000),
  lat        double precision,
  lng        double precision,
  created_at timestamptz not null default now()
);
create index if not exists field_visits_rep_idx on public.field_visits (rep_id, created_at desc);
create index if not exists field_visits_store_idx on public.field_visits (store_id, created_at desc);
alter table public.field_visits enable row level security;

create or replace function public.field_stores_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare me uuid := public.current_rep_id();
begin
  if pg_trigger_depth() > 1 then return new; end if;
  if tg_op = 'INSERT' then
    if not public.is_admin() then
      new.rep_id := me; new.merchant_id := null;
    end if;
    new.visits := 1; new.last_visit_at := now(); new.created_at := now();
  else
    if not public.is_admin() then
      new.rep_id := old.rep_id; new.merchant_id := old.merchant_id;
      new.visits := old.visits; new.created_at := old.created_at;
      if old.status = 'registered' and old.merchant_id is not null then new.status := old.status; end if;
    end if;
  end if;
  return new;
end $$;
create trigger field_stores_guard before insert or update on public.field_stores
  for each row execute function public.field_stores_guard();

create or replace function public.field_stores_first_visit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.field_visits (store_id, rep_id, status, problem, notes, lat, lng)
  values (new.id, new.rep_id, new.status, new.problem, new.notes, new.lat, new.lng);
  return new;
end $$;
create trigger field_stores_first_visit after insert on public.field_stores
  for each row execute function public.field_stores_first_visit();

create or replace function public.field_visits_apply()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return new; end if;
  if not public.is_admin() then new.rep_id := public.current_rep_id(); end if;
  new.created_at := now();
  update public.field_stores set
    status = case when status = 'registered' and merchant_id is not null then status else new.status end,
    problem = new.problem, notes = coalesce(new.notes, notes),
    visits = visits + 1, last_visit_at = now()
  where id = new.store_id;
  return new;
end $$;
create trigger field_visits_apply before insert on public.field_visits
  for each row execute function public.field_visits_apply();

create policy "rep or admin reads stores" on public.field_stores for select
  using (rep_id = public.current_rep_id() or public.is_admin());
create policy "rep adds stores" on public.field_stores for insert
  with check (public.current_rep_id() is not null or public.is_admin());
create policy "rep edits own stores" on public.field_stores for update
  using (rep_id = public.current_rep_id() or public.is_admin())
  with check (rep_id = public.current_rep_id() or public.is_admin());
create policy "admin removes stores" on public.field_stores for delete
  using (public.is_admin());

create policy "rep or admin reads visits" on public.field_visits for select
  using (rep_id = public.current_rep_id() or public.is_admin());
create policy "rep logs visits" on public.field_visits for insert
  with check (public.is_admin() or exists (select 1 from public.field_stores s
    where s.id = store_id and s.rep_id = public.current_rep_id()));

create or replace function public.field_duplicates(p_phone text, p_lat double precision, p_lng double precision)
returns table (store_id uuid, store_name text, rep_name text, mine boolean, status text, last_visit_at timestamptz, distance_m integer)
language sql stable security definer set search_path = public as $$
  select s.id, s.store_name, r.name, s.rep_id = public.current_rep_id(), s.status, s.last_visit_at,
    case when p_lat is null or s.lat is null then null else
      round(6371000 * 2 * asin(sqrt(power(sin(radians(s.lat - p_lat) / 2), 2)
        + cos(radians(p_lat)) * cos(radians(s.lat)) * power(sin(radians(s.lng - p_lng) / 2), 2))))::integer end
  from public.field_stores s join public.reps r on r.id = s.rep_id
  where (public.current_rep_id() is not null or public.is_admin())
    and ((p_phone is not null and s.phone = p_phone)
      or (p_lat is not null and s.lat is not null
          and abs(s.lat - p_lat) < 0.0005 and abs(s.lng - p_lng) < 0.0005
          and 6371000 * 2 * asin(sqrt(power(sin(radians(s.lat - p_lat) / 2), 2)
            + cos(radians(p_lat)) * cos(radians(s.lat)) * power(sin(radians(s.lng - p_lng) / 2), 2))) <= 40))
  order by s.last_visit_at desc limit 5;
$$;
