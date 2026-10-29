-- عرض المؤسسين على مستوى المنصة كلها: أول 500 تاجر يتفعّل (بدل أول 500 في كل حي) ياخذ 6 أشهر بدل 3.
-- القفل يمنع تفعيلين متزامنين من تجاوز الـ 500.
create or replace function public.merchants_founder()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or auth.uid() is null) then
    if tg_op = 'INSERT' then new.founder := false; new.trial_months := 3; new.plan := 'free';
    else new.founder := old.founder; new.trial_months := old.trial_months; new.plan := old.plan; end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and new.status = 'approved' and old.status is distinct from 'approved' and not old.founder then
    perform pg_advisory_xact_lock(hashtext('merchants_founder'));
    if (select count(*) from public.merchants m where m.founder) < 500 then
      new.founder := true;
      new.trial_months := greatest(new.trial_months, 6);
    end if;
  end if;
  return new;
end $$;

revoke execute on function public.merchants_founder() from public, anon, authenticated;
