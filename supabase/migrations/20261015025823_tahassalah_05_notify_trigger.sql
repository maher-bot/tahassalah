create extension if not exists pg_net with schema extensions;

-- إعدادات الإشعارات (يقرأها النظام فقط؛ لا أحد من الموقع يقدر يقرأها)
create table public.notify_settings (
  id             boolean primary key default true check (id),
  webhook_secret text not null default encode(extensions.gen_random_bytes(24), 'hex'),
  function_url   text not null,
  admin_email    text not null,
  from_email     text not null,
  site_url       text not null
);
alter table public.notify_settings enable row level security;
revoke all on public.notify_settings from anon, authenticated;

-- placeholder: the real admin email is set directly in the database, not in git
insert into public.notify_settings (function_url, admin_email, from_email, site_url) values (
  'https://loyiwdjgtvyihnzrqskn.supabase.co/functions/v1/notify',
  'admin@example.com',
  'تحصّله <onboarding@resend.dev>',
  'https://maher-bot.github.io/tahassalah'
);

create function public.notify_merchant_change()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare s public.notify_settings;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;
  select * into s from public.notify_settings where id;
  if s is null then return new; end if;
  perform net.http_post(
    url := s.function_url,
    body := jsonb_build_object(
      'type', tg_op, 'table', 'merchants',
      'record', to_jsonb(new),
      'old_record', case when tg_op = 'UPDATE' then to_jsonb(old) else null end),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', s.webhook_secret),
    timeout_milliseconds := 10000
  );
  return new;
end $$;
revoke execute on function public.notify_merchant_change() from public, anon, authenticated;

create trigger notify_merchant_change after insert or update on public.merchants
  for each row execute function public.notify_merchant_change();
