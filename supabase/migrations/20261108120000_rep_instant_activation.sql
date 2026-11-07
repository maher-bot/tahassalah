-- تفعيل فوري عن طريق المسوّق: المسوّق الموثوق (صلاحية من الإدارة) يسجّل المحل من جواله وهو عنده،
-- يصوّر المستندات من الأصل، والحساب يتفعّل مباشرة. صاحب المحل يجيه إيميل يحط فيه كلمة المرور.
-- الإدارة يوصلها إيميل بالمستندات وتقدر توقف المحل في أي وقت. الإنشاء نفسه في الدالة rep-activate.

-- 1) صلاحية التفعيل للمسوّق (تعطيها الإدارة لمسوّق معيّن)
alter table public.reps add column if not exists can_activate boolean not null default false;

-- 2) مين فعّل المحل (للمتابعة والمحاسبة). ما يغيّرها إلا النظام أو الإدارة.
alter table public.merchants add column if not exists activated_by_rep uuid references public.reps(id) on delete set null;

create or replace function public.merchants_activated_by_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if public.is_admin() or auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then new.activated_by_rep := null;
  else new.activated_by_rep := old.activated_by_rep; end if;
  return new;
end $$;
revoke execute on function public.merchants_activated_by_guard() from public, anon, authenticated;
drop trigger if exists merchants_activated_by_guard on public.merchants;
create trigger merchants_activated_by_guard before insert or update on public.merchants
  for each row execute function public.merchants_activated_by_guard();

-- 3) my_rep يرجّع الصلاحية عشان الواجهة تعرض زر «سجّل وفعّل محل»
drop function if exists public.my_rep();
create function public.my_rep()
returns table(id uuid, name text, code text, districts text[], daily_target integer, can_activate boolean)
language sql stable security definer set search_path = public as $$
  select r.id, r.name, r.code, r.districts, r.daily_target, r.can_activate from public.reps r where r.id = public.current_rep_id();
$$;
revoke all on function public.my_rep() from public, anon;
grant execute on function public.my_rep() to authenticated;

-- 4) المسوّق المصرّح له يرفع المستندات في مجلد مؤقت باسمه (rep-<حسابه>/...)،
--    والدالة تنقلها لمجلد المحل بعد إنشاء الحساب.
create or replace function public.can_rep_activate()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.reps r where r.id = public.current_rep_id() and r.can_activate);
$$;
revoke all on function public.can_rep_activate() from public, anon;
grant execute on function public.can_rep_activate() to authenticated;

drop policy if exists "docs: rep uploads for activation" on storage.objects;
create policy "docs: rep uploads for activation" on storage.objects for insert to authenticated
  with check (bucket_id = 'merchant-docs' and (storage.foldername(name))[1] = 'rep-' || auth.uid()::text and public.can_rep_activate());

-- 5) البحث عن حساب موجود بنفس الإيميل (للنظام فقط)
create or replace function public.user_id_by_email(e text)
returns uuid language sql stable security definer set search_path = public, auth as $$
  select id from auth.users where lower(email) = lower(trim(e)) limit 1;
$$;
revoke all on function public.user_id_by_email(text) from public, anon, authenticated;
