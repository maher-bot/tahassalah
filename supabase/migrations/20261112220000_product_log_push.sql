-- تنبيه لصاحب المحل على جواله لما غيره (موظف) يغيّر سعر، أو يضيف منتج، أو يحذف منتج.
create or replace function public.product_log_push(mid uuid, title text, body text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare s public.notify_settings;
begin
  select * into s from public.notify_settings where id;
  if s is null then return; end if;
  perform net.http_post(url := replace(s.function_url, '/notify', '/push'),
    body := jsonb_build_object('type', 'direct', 'messages', jsonb_build_array(
      jsonb_build_object('users', jsonb_build_array(mid), 'title', title, 'body', body, 'url', 'merchant.html', 'tag', 'plog-' || mid))),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', s.webhook_secret),
    timeout_milliseconds := 10000);
exception when others then null;   -- التنبيه ما يوقف حفظ المنتج أبدًا
end $$;
revoke all on function public.product_log_push(uuid, text, text) from public, anon, authenticated;

create or replace function public.products_log()
returns trigger language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); mid uuid; ch jsonb := '{}'; k text; o jsonb; n jsonb; who text; mine boolean; msg text := '';
  keys text[] := array['name','price','sale_price','quantity','unit','always_available','pack_name','pack_size','pack_price','pack_only',
    'category','barcode','description','image_path','extra_images','is_active','offer_reason','offer_ends_at','expires_on','preorder_hours'];
  f text := 'FM999999990.00';
begin
  if uid is null then return null; end if;
  mid := case when tg_op = 'DELETE' then old.merchant_id else new.merchant_id end;
  if not exists (select 1 from public.merchants where id = mid) then return null; end if;   -- المحل نفسه ينحذف
  who := case when public.is_admin() and uid <> mid and not exists (select 1 from public.merchant_staff where merchant_id = mid and user_id = uid and status = 'active')
              then 'الإدارة' else public.actor_label(mid) end;
  mine := uid = mid and who = 'صاحب المحل';
  if tg_op = 'UPDATE' then
    o := to_jsonb(old); n := to_jsonb(new);
    foreach k in array keys loop
      if (o -> k) is distinct from (n -> k) then ch := ch || jsonb_build_object(k, jsonb_build_array(o -> k, n -> k)); end if;
    end loop;
    if ch = '{}'::jsonb then return null; end if;
    insert into public.product_log (merchant_id, product_id, product_name, action, actor_id, actor_name, by_owner, changes)
    values (mid, new.id, new.name, 'update', uid, who, mine, ch);
    if not mine and ch ?| array['price', 'sale_price', 'pack_price'] then
      if ch ? 'price' then msg := msg || 'السعر: ' || to_char(old.price, f) || ' ← ' || to_char(new.price, f) || ' ر.س. '; end if;
      if ch ? 'sale_price' then msg := msg || 'سعر العرض: ' || coalesce(to_char(old.sale_price, f), 'بدون') || ' ← ' || coalesce(to_char(new.sale_price, f), 'بدون') || '. '; end if;
      if ch ? 'pack_price' then msg := msg || 'سعر العبوة: ' || coalesce(to_char(old.pack_price, f), 'بدون') || ' ← ' || coalesce(to_char(new.pack_price, f), 'بدون') || '. '; end if;
      perform public.product_log_push(mid, '✏️ ' || who || ' غيّر سعر ' || new.name, trim(msg));
    end if;
  elsif tg_op = 'INSERT' then
    insert into public.product_log (merchant_id, product_id, product_name, action, actor_id, actor_name, by_owner, changes)
    values (mid, new.id, new.name, 'insert', uid, who, mine, jsonb_build_object('price', jsonb_build_array(null, new.price), 'quantity', jsonb_build_array(null, new.quantity)));
    -- رفع ملف منتجات كامل ما يرسل تنبيه لكل منتج: تنبيه واحد في الدقيقة لنفس الشخص
    if not mine and (select count(*) from public.product_log where merchant_id = mid and actor_id = uid and action = 'insert' and at > now() - interval '60 seconds') <= 1 then
      perform public.product_log_push(mid, '➕ ' || who || ' أضاف منتج', new.name || ' بسعر ' || to_char(new.price, f) || ' ر.س');
    end if;
  else
    insert into public.product_log (merchant_id, product_id, product_name, action, actor_id, actor_name, by_owner, changes)
    values (mid, old.id, old.name, 'delete', uid, who, mine, jsonb_build_object('price', jsonb_build_array(old.price, null)));
    if not mine then perform public.product_log_push(mid, '🗑️ ' || who || ' حذف منتج', old.name || ' (كان سعره ' || to_char(old.price, f) || ' ر.س)'); end if;
  end if;
  return null;
end $$;
