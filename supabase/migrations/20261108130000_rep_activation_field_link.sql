-- المحل اللي فعّله مسوّق لازم يطلع في محلاته في لوحة الفريق الميداني (مسجّل).
-- الدالة rep-activate تناديها بعد التفعيل مباشرة (للنظام فقط).

-- حارس الفريق الميداني: النظام (بدون مستخدم، مثل دوال الخادم) يعامل مثل الإدارة، مثل باقي الحراس
create or replace function public.field_stores_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare me uuid := public.current_rep_id();
begin
  if pg_trigger_depth() > 1 then return new; end if;
  if tg_op = 'INSERT' then
    if not (public.is_admin() or auth.uid() is null) then
      new.rep_id := me; new.merchant_id := null;
    end if;
    new.visits := 1; new.last_visit_at := now(); new.created_at := now();
  else
    if not (public.is_admin() or auth.uid() is null) then
      new.rep_id := old.rep_id; new.merchant_id := old.merchant_id;
      new.visits := old.visits; new.created_at := old.created_at;
      if old.status = 'registered' and old.merchant_id is not null then new.status := old.status; end if;
    end if;
  end if;
  return new;
end $$;

create or replace function public.link_rep_activation(mid uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare m public.merchants; sid uuid;
begin
  select * into m from public.merchants where id = mid;
  if m.id is null or m.activated_by_rep is null then return null; end if;
  select id into sid from public.field_stores where merchant_id = mid limit 1;
  if sid is null then
    select id into sid from public.field_stores where phone = m.phone and merchant_id is null limit 1;
  end if;
  if sid is not null then
    update public.field_stores set merchant_id = mid, rep_id = m.activated_by_rep, status = 'registered', last_visit_at = now() where id = sid;
  else
    insert into public.field_stores (rep_id, store_name, activity, phone, district, lat, lng, status, merchant_id, notes, consent_at)
    values (m.activated_by_rep, m.store_name, m.activity, m.phone, m.district, m.lat, m.lng, 'registered', mid, 'سجّله وفعّله المسوّق من الميدان', now())
    returning id into sid;
  end if;
  return sid;
end $$;
revoke all on function public.link_rep_activation(uuid) from public, anon, authenticated;

-- المحلات اللي تفعّلت قبل هذا التعديل
select public.link_rep_activation(id) from public.merchants where activated_by_rep is not null;
