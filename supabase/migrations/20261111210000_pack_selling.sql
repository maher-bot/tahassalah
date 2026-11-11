-- البيع بالحبة والكرتون لنفس المنتج (تجار الجملة والسوبرماركت):
-- المخزون يبقى بالحبة. الكرتون له عدد حبات (pack_size) وسعر (pack_price)، ولما ينطلب كرتون تنقص الحبات كلها.
-- pack_only: يباع بالكرتون فقط (جملة).
alter table public.products add column if not exists pack_name text check (pack_name is null or char_length(pack_name) between 1 and 20);
alter table public.products add column if not exists pack_size int check (pack_size is null or pack_size between 2 and 10000);
alter table public.products add column if not exists pack_price numeric(10,2) check (pack_price is null or pack_price > 0);
alter table public.products add column if not exists pack_only boolean not null default false;
alter table public.order_items add column if not exists pack_size int;

-- صلاحيات الموظف: الكرتون وعدد حباته مع المنتجات، وسعره مع الأسعار
do $$
declare d text;
begin
  d := pg_get_functiondef('public.products_guard()'::regprocedure);
  d := replace(d, 'new.always_available := old.always_available;', 'new.always_available := old.always_available; new.pack_name := old.pack_name; new.pack_size := old.pack_size; new.pack_only := old.pack_only;');
  d := replace(d, 'new.offer_ends_at := old.offer_ends_at; new.offer_reason := old.offer_reason;', 'new.offer_ends_at := old.offer_ends_at; new.offer_reason := old.offer_reason; new.pack_price := old.pack_price;');
  if d not like '%new.pack_only := old.pack_only%' or d not like '%new.pack_price := old.pack_price%' then raise exception 'patch failed: guard'; end if;
  execute d;
end $$;

-- الطلب: {"product_id", "qty", "pack": true} = كراتين
do $$
declare d text;
begin
  d := pg_get_functiondef('public.place_order(uuid, jsonb, text, text, text, double precision, double precision, text, timestamp with time zone, boolean)'::regprocedure);
  d := replace(d, 'q int; unit numeric;', 'q int; unit numeric; pk int; units int;');
  d := replace(d, $r$    if p.id is null then raise exception 'product_unavailable'; end if;$r$,
    $r$    if p.id is null then raise exception 'product_unavailable'; end if;
    pk := case when p.pack_only or coalesce((it->>'pack')::boolean, false) then p.pack_size end;
    if (p.pack_only or coalesce((it->>'pack')::boolean, false)) and (p.pack_size is null or p.pack_price is null) then raise exception 'pack_unavailable'; end if;
    units := q * coalesce(pk, 1);$r$);
  d := replace(d, 'and p.quantity < q then', 'and p.quantity < units then');
  d := replace(d, 'unit := case when p.sale_price', 'unit := case when pk is not null then p.pack_price when p.sale_price');
  d := replace(d, $r$insert into public.order_items (order_id, product_id, name, price, qty, line_total) values (o.id, p.id, p.name, unit, q, round(unit * q, 2));$r$,
    $r$insert into public.order_items (order_id, product_id, name, price, qty, line_total, pack_size)
      values (o.id, p.id, p.name || case when pk is not null then ' (' || coalesce(p.pack_name, 'كرتون') || ' ' || pk || ')' else '' end, unit, q, round(unit * q, 2), pk);$r$);
  d := replace(d, 'perform public.order_stock_adjust(p.id, -q)', 'perform public.order_stock_adjust(p.id, -units)');
  if d not like '%pk int; units int;%' or d not like '%p.quantity < units%' or d not like '%then p.pack_price when%'
     or d not like '%line_total, pack_size)%' or d not like '%order_stock_adjust(p.id, -units)%' then raise exception 'patch failed: place_order'; end if;
  execute d;
end $$;

-- الرفض/الإلغاء يرجّع الحبات كلها
do $$
declare d text;
begin
  d := pg_get_functiondef('public.order_action(uuid, text, jsonb)'::regprocedure);
  d := replace(d, 'perform public.order_stock_adjust(i.product_id, i.qty) from public.order_items i', 'perform public.order_stock_adjust(i.product_id, i.qty * coalesce(i.pack_size, 1)) from public.order_items i');
  if d not like '%i.qty * coalesce(i.pack_size, 1)%' then raise exception 'patch failed: order_action'; end if;
  execute d;
  d := pg_get_functiondef('public.pos_stock_sync(text, jsonb)'::regprocedure);
  d := replace(d, 'select coalesce(sum(i.qty), 0) into reserved', 'select coalesce(sum(i.qty * coalesce(i.pack_size, 1)), 0) into reserved');
  if d not like '%sum(i.qty * coalesce(i.pack_size, 1))%' then raise exception 'patch failed: pos_stock_sync'; end if;
  execute d;
end $$;
