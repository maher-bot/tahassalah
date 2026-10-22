create table if not exists public.product_changes (
  id          uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  staff_label text,
  action      text not null check (action in ('insert', 'update', 'delete')),
  product_id  uuid references public.products(id) on delete set null,
  payload     jsonb not null default '{}',
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  note        text,
  created_at  timestamptz not null default now(),
  reviewed_at timestamptz
);
create index if not exists product_changes_merchant_idx on public.product_changes (merchant_id, status, created_at desc);
alter table public.product_changes enable row level security;

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
  if inv then allowed := allowed || array['name','description','category','barcode','quantity','image_path','is_active']; end if;
  if pr or new.action = 'insert' then allowed := allowed || array['price','sale_price']; end if;
  for k in select jsonb_object_keys(coalesce(new.payload, '{}')) loop
    if k = any(allowed) then clean := clean || jsonb_build_object(k, new.payload -> k); end if;
  end loop;
  new.payload := case when new.action = 'delete' then '{}'::jsonb else clean end;
  new.user_id := auth.uid(); new.status := 'pending'; new.note := null; new.reviewed_at := null; new.created_at := now();
  new.staff_label := coalesce(nullif(st.name, ''), st.email);
  return new;
end $$;
create trigger product_changes_guard before insert on public.product_changes
  for each row execute function public.product_changes_guard();

create policy "staff submits changes" on public.product_changes for insert
  with check (public.is_approved_merchant(merchant_id)
    and (public.staff_has(merchant_id, 'inventory') or public.staff_has(merchant_id, 'prices')));
create policy "read changes" on public.product_changes for select
  using (user_id = auth.uid() or merchant_id = auth.uid() or public.is_admin());
create policy "staff cancels pending" on public.product_changes for delete
  using (user_id = auth.uid() and status = 'pending');

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
      insert into public.products (merchant_id, name, description, category, barcode, price, sale_price, quantity, image_path, is_active)
      values (c.merchant_id, p->>'name', p->>'description', p->>'category', p->>'barcode',
              (p->>'price')::numeric, nullif(p->>'sale_price', '')::numeric, coalesce((p->>'quantity')::int, 0),
              p->>'image_path', coalesce((p->>'is_active')::boolean, true))
      returning id into new_id;
    elsif c.action = 'update' then
      update public.products set
        name        = case when p ? 'name' then p->>'name' else name end,
        description = case when p ? 'description' then p->>'description' else description end,
        category    = case when p ? 'category' then p->>'category' else category end,
        barcode     = case when p ? 'barcode' then p->>'barcode' else barcode end,
        price       = case when p ? 'price' then (p->>'price')::numeric else price end,
        sale_price  = case when p ? 'sale_price' then nullif(p->>'sale_price', '')::numeric else sale_price end,
        quantity    = case when p ? 'quantity' then (p->>'quantity')::int else quantity end,
        image_path  = case when p ? 'image_path' then p->>'image_path' else image_path end,
        is_active   = case when p ? 'is_active' then (p->>'is_active')::boolean else is_active end
      where id = c.product_id and merchant_id = c.merchant_id;
    else
      delete from public.products where id = c.product_id and merchant_id = c.merchant_id;
    end if;
  end if;
  update public.product_changes set status = case when approve then 'approved' else 'rejected' end,
    note = reason, reviewed_at = now(), product_id = coalesce(new_id, product_id) where id = change_id;
end $$;
revoke execute on function public.product_changes_guard() from public, anon, authenticated;
revoke execute on function public.review_change(uuid, boolean, text) from public, anon;
grant execute on function public.review_change(uuid, boolean, text) to authenticated;
