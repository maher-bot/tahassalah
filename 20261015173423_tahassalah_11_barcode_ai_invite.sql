create or replace function public.barcode_lookup(code text)
returns table (name text, category text, description text)
language sql stable security definer set search_path = public as $$
  select p.name, p.category, p.description from public.products p
  where p.barcode = code and code ~ '^[0-9]{8,14}$'
  order by p.updated_at desc limit 1;
$$;

create table if not exists public.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day     date not null default current_date,
  count   integer not null default 0,
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon, authenticated;

create or replace function public.can_use_ai(mid uuid, uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.merchants where id = mid and status = 'approved')
    and (mid = uid or exists (select 1 from public.merchant_staff
          where merchant_id = mid and user_id = uid and status = 'active' and 'inventory' = any(perms)));
$$;
revoke execute on function public.can_use_ai(uuid, uuid) from public, anon, authenticated;

revoke execute on function public.merchant_staff_guard() from public, anon, authenticated;
revoke execute on function public.products_guard() from public, anon, authenticated;
revoke execute on function public.my_invites() from public, anon;
revoke execute on function public.accept_invite(uuid, boolean) from public, anon;
revoke execute on function public.leave_store(uuid) from public, anon;
revoke execute on function public.my_stores() from public, anon;
revoke execute on function public.barcode_lookup(text) from public, anon;
revoke execute on function public.staff_has(uuid, text) from anon;
revoke execute on function public.staff_direct(uuid, text) from anon;
grant execute on function public.my_invites(), public.accept_invite(uuid, boolean), public.leave_store(uuid),
  public.my_stores(), public.barcode_lookup(text) to authenticated;

create or replace function public.notify_staff_invite()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare s public.notify_settings;
begin
  select * into s from public.notify_settings where id;
  if s is null then return new; end if;
  perform net.http_post(
    url := s.function_url,
    body := jsonb_build_object('type', 'INSERT', 'table', 'merchant_staff', 'record', to_jsonb(new),
      'store_name', (select store_name from public.merchants where id = new.merchant_id)),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', s.webhook_secret),
    timeout_milliseconds := 10000);
  return new;
end $$;
revoke execute on function public.notify_staff_invite() from public, anon, authenticated;
create trigger notify_staff_invite after insert on public.merchant_staff
  for each row execute function public.notify_staff_invite();
