-- الأساسي المجاني: 10 منتجات ظاهرة (للمحلات والأسر). المتنقل ما له باقة مجانية: يبقى على «أسر ومتجولين».
create or replace function public.products_plan_limits()
returns trigger language plpgsql security definer set search_path = public as $$
declare pl text; lim int;
begin
  if auth.uid() is null or public.is_admin() then return new; end if;
  pl := public.merchant_plan(new.merchant_id);
  if pl = 'basic' then
    if new.sale_price is not null and (tg_op = 'INSERT' or old.sale_price is distinct from new.sale_price) then
      raise exception 'plan_basic_offers';
    end if;
    if new.preorder_hours is not null and (tg_op = 'INSERT' or old.preorder_hours is distinct from new.preorder_hours) then
      raise exception 'plan_basic_preorder';
    end if;
  end if;
  lim := case pl when 'basic' then 10 when 'family' then 100 when 'trader' then 500 end;
  if lim is not null and new.is_active and (tg_op = 'INSERT' or not old.is_active)
     and (select count(*) from public.products where merchant_id = new.merchant_id and is_active and id <> new.id) >= lim then
    raise exception 'plan_%_products', pl;
  end if;
  return new;
end $$;

create or replace function public.set_plan_choice(p text, b text default 'monthly')
returns void language plpgsql security definer set search_path = public as $$
declare k text;
begin
  if p not in ('basic', 'trader', 'pro', 'family') then raise exception 'invalid plan'; end if;
  if b not in ('monthly', 'yearly') then raise exception 'invalid billing'; end if;
  select kind into k from public.merchants where id = auth.uid();
  if p = 'family' and coalesce(k, 'store') = 'store' then raise exception 'plan_family_kind'; end if;
  if p = 'basic' and k = 'mobile' then raise exception 'plan_mobile_basic'; end if;
  update public.merchants set next_plan = p, billing = b where id = auth.uid();
end $$;

create or replace function public.merchants_family_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- تحديث الموقع الحي وحالة الإتاحة يتم من الدوال الرسمية فقط
  if coalesce(current_setting('app.live_update', true), '') = '1' then return new; end if;
  if tg_op = 'INSERT' or new.kind is distinct from old.kind then
    new.hide_location := (new.kind = 'family');
  end if;
  if tg_op = 'UPDATE' and new.cr_number is distinct from old.cr_number and not (auth.uid() is null or pg_trigger_depth() > 1) then
    new.cr_check := null; new.cr_checked_at := null;
  end if;
  if public.is_admin() or auth.uid() is null or pg_trigger_depth() > 1 then return new; end if;
  -- المتنقل ما له باقة مجانية: الظهور للزبائن ميزة «أسر ومتجولين»
  if new.kind = 'mobile' and new.next_plan = 'basic' then new.next_plan := 'family'; end if;
  if tg_op = 'INSERT' then
    new.site_verified_at := null; new.site_verified_note := null;
    new.license_verified_at := null; new.license_verified_note := null;
    new.live_lat := null; new.live_lng := null; new.live_at := null;
    new.availability := 'off'; new.live_until := null;
    new.cr_check := null; new.cr_checked_at := null;
  else
    new.site_verified_at := old.site_verified_at; new.site_verified_note := old.site_verified_note;
    new.live_lat := old.live_lat; new.live_lng := old.live_lng; new.live_at := old.live_at;
    new.availability := old.availability; new.live_until := old.live_until;
    if new.kind is not distinct from old.kind then new.hide_location := old.hide_location; end if;
    if new.kind = 'store' and new.next_plan = 'family' then new.next_plan := 'basic'; end if;
    if new.license_number is distinct from old.license_number or new.extra_docs is distinct from old.extra_docs then
      new.license_verified_at := null; new.license_verified_note := null;
    else
      new.license_verified_at := old.license_verified_at; new.license_verified_note := old.license_verified_note;
    end if;
    if new.cr_number is not distinct from old.cr_number then
      new.cr_check := old.cr_check; new.cr_checked_at := old.cr_checked_at;
    end if;
  end if;
  return new;
end $$;
