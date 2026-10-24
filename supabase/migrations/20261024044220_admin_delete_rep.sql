-- حذف مسوّق من لوحة الفريق الميداني.
-- المسوّق اللي له محلات أو زيارات ما ينحذف إلا بعد نقلها لمسوّق ثاني (والأفضل إيقافه بدل الحذف للحفاظ على سجله).
create or replace function public.admin_delete_rep(rid uuid, transfer_to uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.reps; ns int; nv int;
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  select * into r from public.reps where id = rid;
  if r.id is null then raise exception 'rep_not_found'; end if;
  select count(*) into ns from public.field_stores where rep_id = rid;
  select count(*) into nv from public.field_visits where rep_id = rid;
  if ns + nv > 0 then
    if transfer_to is null then raise exception 'rep_has_records'; end if;
    if transfer_to = rid or not exists (select 1 from public.reps where id = transfer_to) then raise exception 'bad_transfer_target'; end if;
    update public.field_stores set rep_id = transfer_to where rep_id = rid;
    update public.field_visits set rep_id = transfer_to where rep_id = rid;
  end if;
  delete from public.reps where id = rid;
  insert into public.merchant_edits (merchant_id, merchant_name, admin_id, admin_email, changes)
    values (rid, 'مسوّق: ' || r.name, auth.uid(), (select email from auth.users where id = auth.uid()),
            jsonb_build_object('_rep_deleted', true, 'code', r.code, 'moved_stores', ns, 'moved_visits', nv, 'moved_to', transfer_to));
  return jsonb_build_object('deleted', true, 'moved_stores', ns, 'moved_visits', nv);
end $$;
revoke all on function public.admin_delete_rep(uuid, uuid) from public, anon;
grant execute on function public.admin_delete_rep(uuid, uuid) to authenticated;
