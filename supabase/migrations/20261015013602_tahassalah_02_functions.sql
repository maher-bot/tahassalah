create function public.buyer_enabled()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select buyer_enabled from public.app_settings where id), false);
$$;

create function public.is_approved_merchant(mid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.merchants where id = mid and status = 'approved');
$$;

create function public.merchants_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if public.is_admin() then
    if tg_op = 'UPDATE' and new.status is distinct from old.status then
      new.reviewed_at := now();
    end if;
    if new.status = 'approved' and new.plan = 'free' and new.trial_started_at is null and public.buyer_enabled() then
      new.trial_started_at := now();
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.status := 'pending';
    new.review_note := null;
    new.reviewed_at := null;
    new.submitted_at := now();
    new.trial_started_at := null;
    new.email := coalesce((select email from auth.users where id = auth.uid()), new.email);
  else
    new.id := old.id;
    new.email := old.email;
    new.created_at := old.created_at;
    new.reviewed_at := old.reviewed_at;
    new.review_note := old.review_note;
    new.trial_started_at := old.trial_started_at;
    if old.status = 'rejected' then
      new.status := 'pending';
      new.submitted_at := now();
    else
      new.status := old.status;
      new.submitted_at := old.submitted_at;
    end if;
  end if;
  return new;
end $$;
create trigger merchants_guard before insert or update on public.merchants
  for each row execute function public.merchants_guard();

create function public.start_trials_on_launch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.buyer_enabled and not old.buyer_enabled then
    update public.merchants set trial_started_at = now()
    where plan = 'free' and status = 'approved' and trial_started_at is null;
  end if;
  return new;
end $$;
create trigger start_trials_on_launch after update on public.app_settings
  for each row execute function public.start_trials_on_launch();

create function public.touch_updated_at()
returns trigger language plpgsql set search_path = public as $$ begin new.updated_at := now(); return new; end $$;
create trigger products_touch before update on public.products
  for each row execute function public.touch_updated_at();

create function public.set_next_plan(p text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p not in ('commission', 'monthly', 'yearly') then raise exception 'invalid plan'; end if;
  update public.merchants set next_plan = p where id = auth.uid();
end $$;
revoke execute on function public.set_next_plan(text) from public, anon;
grant execute on function public.set_next_plan(text) to authenticated;

create function public.end_expired_trials()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.merchants set plan = next_plan
  where plan = 'free' and trial_started_at is not null and trial_started_at + interval '3 months' <= now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.end_expired_trials() from public, anon, authenticated;

create function public.launch_stats()
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  return json_build_object(
    'by_status', (select coalesce(json_object_agg(status, n), '{}') from (select status, count(*) n from merchants group by status) x),
    'by_city', (select coalesce(json_agg(json_build_object('city', city, 'approved', a, 'pending', p, 'products', pr) order by a desc, p desc), '[]') from (
        select m.city,
               count(*) filter (where m.status = 'approved') a,
               count(*) filter (where m.status = 'pending') p,
               coalesce(sum((select count(*) from products pp where pp.merchant_id = m.id and pp.is_active)), 0) pr
        from merchants m group by m.city) c),
    'by_activity', (select coalesce(json_agg(json_build_object('activity', activity, 'n', n) order by n desc), '[]') from (
        select activity, count(*) n from merchants where status = 'approved' group by activity) a),
    'by_plan', (select coalesce(json_object_agg(plan, n), '{}') from (select plan, count(*) n from merchants where status = 'approved' group by plan) x),
    'products', (select count(*) from products where is_active),
    'stores_with_products', (select count(distinct merchant_id) from products where is_active),
    'last_7_days', (select count(*) from merchants where created_at > now() - interval '7 days')
  );
end $$;
revoke execute on function public.launch_stats() from public, anon;
grant execute on function public.launch_stats() to authenticated;

revoke execute on function public.merchants_guard() from public, anon, authenticated;
revoke execute on function public.start_trials_on_launch() from public, anon, authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;

create view public.stores_public with (security_invoker = false) as
  select id, store_name, activity, city, district, lat, lng
  from public.merchants where status = 'approved' and public.buyer_enabled();
grant select on public.stores_public to anon, authenticated;
