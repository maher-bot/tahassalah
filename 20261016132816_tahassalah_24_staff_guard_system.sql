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
    if auth.uid() is null then return new; end if;   -- مهمة النظام المجدولة
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
