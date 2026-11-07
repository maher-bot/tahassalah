-- إشعارات التطبيق (Web Push): توصل على شاشة الجوال حتى والتطبيق مقفول.
-- الكاشير/صاحب المحل: طلب جديد وإيصال تحويل. المندوب: توصيلة أو استلام جديد. المشتري: كل تغيّر في حالة طلبه.
-- مفاتيح VAPID محفوظة في push_settings (يقرأها النظام فقط)، والإرسال من الدالة push.

create table if not exists public.push_settings (
  id            boolean primary key default true check (id),
  vapid_public  text not null,
  vapid_private text not null,
  subject       text not null default 'mailto:info@tahassalah.com'
);
alter table public.push_settings enable row level security;
revoke all on public.push_settings from anon, authenticated;

create or replace function public.vapid_public_key()
returns text language sql stable security definer set search_path = public as $$ select vapid_public from public.push_settings where id $$;
grant execute on function public.vapid_public_key() to anon, authenticated;

create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  ua         text,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists "push: own" on public.push_subscriptions;
create policy "push: own" on public.push_subscriptions for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- كل تغيير في الطلب يروح للدالة push، وهي تقرر مين يوصله وش
create or replace function public.notify_order_push()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare s public.notify_settings;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status and new.driver_user_id is not distinct from old.driver_user_id
     and new.collect_driver_user_id is not distinct from old.collect_driver_user_id and new.payment_status is not distinct from old.payment_status
     and new.adjust_pending is not distinct from old.adjust_pending then
    return new;
  end if;
  select * into s from public.notify_settings where id;
  if s is null then return new; end if;
  perform net.http_post(url := replace(s.function_url, '/notify', '/push'),
    body := jsonb_build_object('type', tg_op, 'record', to_jsonb(new), 'old_record', case when tg_op = 'UPDATE' then to_jsonb(old) end),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', s.webhook_secret),
    timeout_milliseconds := 10000);
  return new;
end $$;
revoke execute on function public.notify_order_push() from public, anon, authenticated;
drop trigger if exists notify_order_push on public.orders;
create trigger notify_order_push after insert or update on public.orders for each row execute function public.notify_order_push();
