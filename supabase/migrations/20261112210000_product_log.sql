-- سجل تعديلات المنتجات: كل إضافة أو تعديل أو حذف ينحفظ باسم اللي سواه (القيمة قبل وبعد)، ويشوفه صاحب المحل فقط.
-- نقص المخزون من الطلبات وربط الكاشير ما ينسجل (ما فيه مستخدم وقتها: auth.uid() فاضي).
create table if not exists public.product_log (
  id bigint generated always as identity primary key,
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  product_id uuid,
  product_name text,
  action text not null check (action in ('insert', 'update', 'delete')),
  actor_id uuid,
  actor_name text,
  by_owner boolean not null default false,
  changes jsonb not null default '{}',
  at timestamptz not null default now());
create index if not exists product_log_merchant_at on public.product_log (merchant_id, at desc);
alter table public.product_log enable row level security;
drop policy if exists "owner reads product log" on public.product_log;
create policy "owner reads product log" on public.product_log for select to authenticated using (merchant_id = auth.uid());
revoke all on public.product_log from anon;
grant select on public.product_log to authenticated;

create or replace function public.products_log()
returns trigger language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); mid uuid; ch jsonb := '{}'; k text; o jsonb; n jsonb; who text;
  keys text[] := array['name','price','sale_price','quantity','unit','always_available','pack_name','pack_size','pack_price','pack_only',
    'category','barcode','description','image_path','extra_images','is_active','offer_reason','offer_ends_at','expires_on','preorder_hours'];
begin
  if uid is null then return null; end if;
  mid := case when tg_op = 'DELETE' then old.merchant_id else new.merchant_id end;
  if not exists (select 1 from public.merchants where id = mid) then return null; end if;   -- المحل نفسه ينحذف
  who := case when public.is_admin() and uid <> mid and not exists (select 1 from public.merchant_staff where merchant_id = mid and user_id = uid and status = 'active')
              then 'الإدارة' else public.actor_label(mid) end;
  if tg_op = 'UPDATE' then
    o := to_jsonb(old); n := to_jsonb(new);
    foreach k in array keys loop
      if (o -> k) is distinct from (n -> k) then ch := ch || jsonb_build_object(k, jsonb_build_array(o -> k, n -> k)); end if;
    end loop;
    if ch = '{}'::jsonb then return null; end if;
    insert into public.product_log (merchant_id, product_id, product_name, action, actor_id, actor_name, by_owner, changes)
    values (mid, new.id, new.name, 'update', uid, who, uid = mid and who = 'صاحب المحل', ch);
  elsif tg_op = 'INSERT' then
    insert into public.product_log (merchant_id, product_id, product_name, action, actor_id, actor_name, by_owner, changes)
    values (mid, new.id, new.name, 'insert', uid, who, uid = mid and who = 'صاحب المحل', jsonb_build_object('price', jsonb_build_array(null, new.price), 'quantity', jsonb_build_array(null, new.quantity)));
  else
    insert into public.product_log (merchant_id, product_id, product_name, action, actor_id, actor_name, by_owner, changes)
    values (mid, old.id, old.name, 'delete', uid, who, uid = mid and who = 'صاحب المحل', jsonb_build_object('price', jsonb_build_array(old.price, null)));
  end if;
  return null;
end $$;
drop trigger if exists products_log on public.products;
create trigger products_log after insert or update or delete on public.products
  for each row execute function public.products_log();

select cron.unschedule('product-log-cleanup') where exists (select 1 from cron.job where jobname = 'product-log-cleanup');
select cron.schedule('product-log-cleanup', '23 3 * * *', $$delete from public.product_log where at < now() - interval '365 days'$$);
