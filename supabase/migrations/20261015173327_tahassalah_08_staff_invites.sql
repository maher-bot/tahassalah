create or replace function public.merchant_staff_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare owner_email text;
begin
  new.email := lower(trim(new.email));
  if tg_op = 'INSERT' then
    select email into owner_email from public.merchants where id = new.merchant_id;
    if lower(owner_email) = new.email then raise exception 'cannot_invite_self'; end if;
    if (select count(*) from public.merchant_staff where merchant_id = new.merchant_id) >= 10 then
      raise exception 'staff_limit';
    end if;
    new.status := 'invited'; new.user_id := null; new.accepted_at := null; new.invited_at := now();
  elsif tg_op = 'UPDATE' then
    new.merchant_id := old.merchant_id; new.email := old.email; new.invited_at := old.invited_at;
    if coalesce(current_setting('app.accepting_invite', true), '') = '1' then return new; end if;
    if auth.uid() is distinct from old.merchant_id and not public.is_admin() then
      raise exception 'not_allowed';
    end if;
    if old.status = 'invited' and new.status <> 'invited' then
      new.status := 'invited';
    end if;
    if old.status <> 'invited' and new.status = 'invited' then new.status := old.status; end if;
    new.user_id := old.user_id; new.accepted_at := old.accepted_at;
  end if;
  return new;
end $$;
create trigger merchant_staff_guard before insert or update on public.merchant_staff
  for each row execute function public.merchant_staff_guard();

create policy "owner manages staff" on public.merchant_staff for all
  using (merchant_id = auth.uid() and public.is_approved_merchant(auth.uid()))
  with check (merchant_id = auth.uid() and public.is_approved_merchant(auth.uid()));
create policy "staff reads own" on public.merchant_staff for select
  using (user_id = auth.uid() or public.is_admin());

create or replace function public.my_invites()
returns table (id uuid, store_name text, role text, perms text[], invited_at timestamptz)
language sql stable security definer set search_path = public as $$
  select s.id, m.store_name, s.role, s.perms, s.invited_at
  from public.merchant_staff s join public.merchants m on m.id = s.merchant_id
  where s.status = 'invited' and m.status = 'approved'
    and s.email = lower((select email from auth.users where id = auth.uid()));
$$;

create or replace function public.accept_invite(invite uuid, accept boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare me text := lower((select email from auth.users where id = auth.uid())); n integer;
begin
  if me is null then raise exception 'not_signed_in'; end if;
  if accept then
    perform set_config('app.accepting_invite', '1', true);
    update public.merchant_staff set user_id = auth.uid(), status = 'active', accepted_at = now()
      where id = invite and email = me and status = 'invited';
    get diagnostics n = row_count;
    perform set_config('app.accepting_invite', '', true);
  else
    delete from public.merchant_staff where id = invite and email = me and status = 'invited';
    get diagnostics n = row_count;
  end if;
  if n = 0 then raise exception 'invite_not_found'; end if;
end $$;

create or replace function public.leave_store(mid uuid)
returns void language sql security definer set search_path = public as $$
  delete from public.merchant_staff where merchant_id = mid and user_id = auth.uid();
$$;

create or replace function public.my_stores()
returns table (merchant_id uuid, store_name text, store_status public.merchant_status, role text, perms text[], needs_approval boolean)
language sql stable security definer set search_path = public as $$
  select m.id, m.store_name, m.status, s.role, s.perms, s.needs_approval
  from public.merchant_staff s join public.merchants m on m.id = s.merchant_id
  where s.user_id = auth.uid() and s.status = 'active' and m.status = 'approved';
$$;
