alter table public.products add column if not exists offer_ends_at timestamptz;
alter table public.products add column if not exists offer_reason text
  check (offer_reason is null or offer_reason in ('expiry', 'low_stock', 'clearance', 'season', 'new'));
alter table public.products add column if not exists expires_on date;

create or replace function public.products_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare inv boolean; pr boolean;
begin
  if tg_op = 'INSERT' and new.merchant_id is null then new.merchant_id := auth.uid(); end if;
  if auth.uid() is not null and not (auth.uid() = new.merchant_id or public.is_admin()) then
    inv := public.staff_has(new.merchant_id, 'inventory');
    pr  := public.staff_has(new.merchant_id, 'prices');
    if tg_op = 'UPDATE' then
      new.merchant_id := old.merchant_id;
      if not inv then
        new.name := old.name; new.description := old.description; new.category := old.category;
        new.barcode := old.barcode; new.quantity := old.quantity; new.image_path := old.image_path;
        new.is_active := old.is_active; new.expires_on := old.expires_on;
      end if;
      if not pr then
        new.price := old.price; new.sale_price := old.sale_price;
        new.offer_ends_at := old.offer_ends_at; new.offer_reason := old.offer_reason;
      end if;
    end if;
  end if;
  if new.sale_price is null then new.offer_ends_at := null; new.offer_reason := null; end if;
  return new;
end $$;

create or replace function public.product_changes_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare inv boolean; pr boolean; st public.merchant_staff; allowed text[]; k text; clean jsonb := '{}';
begin
  select * into st from public.merchant_staff
    where merchant_id = new.merchant_id and user_id = auth.uid() and status = 'active';
  if st is null then raise exception 'not_staff'; end if;
  inv := 'inventory' = any(st.perms); pr := 'prices' = any(st.perms);
  if new.action in ('insert', 'delete') and not inv then raise exception 'no_permission'; end if;
  if new.action = 'update' and not (inv or pr) then raise exception 'no_permission'; end if;
  if new.action <> 'insert' and not exists (select 1 from public.products where id = new.product_id and merchant_id = new.merchant_id) then
    raise exception 'product_not_found';
  end if;
  allowed := array[]::text[];
  if inv then allowed := allowed || array['name','description','category','barcode','quantity','image_path','is_active','expires_on']; end if;
  if pr or new.action = 'insert' then allowed := allowed || array['price','sale_price','offer_ends_at','offer_reason']; end if;
  for k in select jsonb_object_keys(coalesce(new.payload, '{}')) loop
    if k = any(allowed) then clean := clean || jsonb_build_object(k, new.payload -> k); end if;
  end loop;
  new.payload := case when new.action = 'delete' then '{}'::jsonb else clean end;
  new.user_id := auth.uid(); new.status := 'pending'; new.note := null; new.reviewed_at := null; new.created_at := now();
  new.staff_label := coalesce(nullif(st.name, ''), st.email);
  return new;
end $$;

create or replace function public.review_change(change_id uuid, approve boolean, reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare c public.product_changes; p jsonb; new_id uuid;
begin
  select * into c from public.product_changes where id = change_id and status = 'pending';
  if c is null then raise exception 'change_not_found'; end if;
  if c.merchant_id <> auth.uid() then raise exception 'not_allowed'; end if;
  if approve then
    p := c.payload;
    if c.action = 'insert' then
      insert into public.products (merchant_id, name, description, category, barcode, price, sale_price, quantity,
        image_path, is_active, offer_ends_at, offer_reason, expires_on)
      values (c.merchant_id, p->>'name', p->>'description', p->>'category', p->>'barcode',
              (p->>'price')::numeric, nullif(p->>'sale_price', '')::numeric, coalesce((p->>'quantity')::int, 0),
              p->>'image_path', coalesce((p->>'is_active')::boolean, true),
              nullif(p->>'offer_ends_at', '')::timestamptz, nullif(p->>'offer_reason', ''), nullif(p->>'expires_on', '')::date)
      returning id into new_id;
    elsif c.action = 'update' then
      update public.products set
        name          = case when p ? 'name' then p->>'name' else name end,
        description   = case when p ? 'description' then p->>'description' else description end,
        category      = case when p ? 'category' then p->>'category' else category end,
        barcode       = case when p ? 'barcode' then p->>'barcode' else barcode end,
        price         = case when p ? 'price' then (p->>'price')::numeric else price end,
        sale_price    = case when p ? 'sale_price' then nullif(p->>'sale_price', '')::numeric else sale_price end,
        quantity      = case when p ? 'quantity' then (p->>'quantity')::int else quantity end,
        image_path    = case when p ? 'image_path' then p->>'image_path' else image_path end,
        is_active     = case when p ? 'is_active' then (p->>'is_active')::boolean else is_active end,
        offer_ends_at = case when p ? 'offer_ends_at' then nullif(p->>'offer_ends_at', '')::timestamptz else offer_ends_at end,
        offer_reason  = case when p ? 'offer_reason' then nullif(p->>'offer_reason', '') else offer_reason end,
        expires_on    = case when p ? 'expires_on' then nullif(p->>'expires_on', '')::date else expires_on end
      where id = c.product_id and merchant_id = c.merchant_id;
    else
      delete from public.products where id = c.product_id and merchant_id = c.merchant_id;
    end if;
  end if;
  update public.product_changes set status = case when approve then 'approved' else 'rejected' end,
    note = reason, reviewed_at = now(), product_id = coalesce(new_id, product_id) where id = change_id;
end $$;

create or replace function public.end_expired_offers()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.products set sale_price = null, offer_ends_at = null, offer_reason = null
  where offer_ends_at is not null and offer_ends_at <= now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.end_expired_offers() from public, anon, authenticated;

select cron.schedule('end-offers', '7 * * * *', 'select public.end_expired_offers()');
