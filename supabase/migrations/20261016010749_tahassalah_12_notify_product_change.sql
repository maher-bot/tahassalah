create or replace function public.notify_product_change()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare s public.notify_settings; m public.merchants;
begin
  -- إيميل واحد لكل دفعة: نتجاهل إذا فيه طلب معلّق ثاني لنفس المتجر خلال آخر 15 دقيقة
  if exists (select 1 from public.product_changes where merchant_id = new.merchant_id and id <> new.id
             and status = 'pending' and created_at > now() - interval '15 minutes') then
    return new;
  end if;
  select * into s from public.notify_settings where id;
  if s is null then return new; end if;
  select * into m from public.merchants where id = new.merchant_id;
  perform net.http_post(
    url := s.function_url,
    body := jsonb_build_object('type', 'INSERT', 'table', 'product_changes', 'record', to_jsonb(new),
      'owner_email', m.email, 'owner_name', m.owner_name, 'store_name', m.store_name,
      'product_name', coalesce(new.payload->>'name', (select name from public.products where id = new.product_id))),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', s.webhook_secret),
    timeout_milliseconds := 10000);
  return new;
end $$;
revoke execute on function public.notify_product_change() from public, anon, authenticated;
create trigger notify_product_change after insert on public.product_changes
  for each row execute function public.notify_product_change();
