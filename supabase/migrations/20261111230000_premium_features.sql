-- مزايا «مميز» الموعودة في الموقع:
-- 1) شارة «مميز» وظهور أعلى في البحث (premium في stores_public، والترتيب في search_nearby).
-- 2) البحث عن المنتجات في المحلات القريبة (search_nearby)، ويسجّل البحث بدون هوية المشتري وبموقع تقريبي (~1 كم).
-- 3) تقرير «وش يدوّر عليه الناس قربك ولا يلقونه عندك» (demand_report) للباقة المميزة.
-- 4) تنبيه المشترين بعروض المحل (بموافقة المشتري offer_alerts): مرة وحدة كل 24 ساعة لكل محل.

-- ============ 1) الشارة ============
create or replace view public.stores_public with (security_invoker = false) as
 WITH src AS (
         SELECT merchants.id, merchants.store_name, merchants.activity, merchants.city, merchants.district, merchants.kind,
            merchants.hide_location, merchants.lat, merchants.lng, merchants.live_lat, merchants.live_lng, merchants.live_at, merchants.availability,
            merchants.kind = 'mobile'::text AND merchants.plan <> 'basic'::text AND (merchants.availability = ANY (ARRAY['available'::text, 'busy'::text]))
              AND merchants.live_until > now() AND merchants.live_lat IS NOT NULL AND merchants.live_lng IS NOT NULL AS is_live,
            merchants.plan = 'pro'::text AS premium
           FROM merchants
          WHERE merchants.status = 'approved'::merchant_status AND buyer_enabled() AND (merchants.plan = 'free'::text
            OR merchants.plan = 'basic'::text AND (merchants.basic_until IS NULL OR merchants.basic_until > now())
            OR (merchants.plan = ANY (ARRAY['family'::text, 'trader'::text, 'pro'::text])) AND (merchants.paid_until IS NULL OR merchants.paid_until > now()))
        ), base AS (
         SELECT src.id, src.store_name, src.activity, src.city, src.district,
                CASE WHEN src.is_live THEN src.live_lat ELSE src.lat END AS lat,
                CASE WHEN src.is_live THEN src.live_lng ELSE src.lng END AS lng,
            src.is_live,
                CASE WHEN src.is_live THEN src.live_at ELSE NULL::timestamp with time zone END AS live_at,
            src.kind = 'family'::text OR src.hide_location AS approx,
                CASE WHEN src.is_live THEN src.availability ELSE NULL::text END AS availability,
            src.premium
           FROM src
          WHERE src.kind <> 'mobile'::text OR src.is_live
        ), cells AS (
         SELECT base.*,
                CASE WHEN base.approx AND base.lat IS NOT NULL AND base.lng IS NOT NULL THEN round((round(base.lat / 0.005::double precision) * 0.005::double precision)::numeric, 3)::double precision ELSE NULL::double precision END AS clat,
                CASE WHEN base.approx AND base.lat IS NOT NULL AND base.lng IS NOT NULL THEN round((round(base.lng / 0.005::double precision) * 0.005::double precision)::numeric, 3)::double precision ELSE NULL::double precision END AS clng
           FROM base
        )
 SELECT id, store_name, activity, city, district,
        CASE WHEN approx THEN clat ELSE lat END AS lat,
        CASE WHEN approx THEN clng ELSE lng END AS lng,
    approx AS location_approx, is_live, live_at, availability, premium
   FROM cells;

-- ============ 2) البحث عن المنتجات القريبة ============
create table if not exists public.search_log (
  id       bigserial primary key,
  q        text not null,
  lat      double precision,   -- مقرّب لـ ~1 كم
  lng      double precision,
  store_id uuid references public.merchants(id) on delete cascade,   -- بحث داخل محل معيّن
  results  int not null default 0,
  at       timestamptz not null default now()
);
create index if not exists search_log_at_idx on public.search_log (at desc);
create index if not exists search_log_store_idx on public.search_log (store_id, at desc) where store_id is not null;
alter table public.search_log enable row level security;
revoke all on public.search_log from public, anon, authenticated;

create or replace function public.norm_q(t text)
returns text language sql immutable set search_path = public as $$
  select left(trim(regexp_replace(translate(lower(coalesce(t, '')), 'أإآةى', 'اااهي'), '\s+', ' ', 'g')), 60);
$$;

-- المحلات اللي يطابق اسمها أو نشاطها أو منتجاتها البحث، المميزة أولًا داخل 3 كم ثم الأقرب
create or replace function public.search_nearby(q text, la double precision default null, ln double precision default null)
returns table (id uuid, matches int, sample text[])
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare nq text := public.norm_q(q); n int;
begin
  if char_length(nq) < 2 then return; end if;
  return query
  with s as (select sp.* from public.stores_public sp),
  hits as (
    select s.id, s.premium,
           case when la is null or s.lat is null then null
                else 6371 * 2 * asin(sqrt(power(sin(radians(s.lat - la) / 2), 2) + cos(radians(la)) * cos(radians(s.lat)) * power(sin(radians(s.lng - ln) / 2), 2))) end as km,
           (select count(*)::int from public.products p where p.merchant_id = s.id and p.is_active and public.norm_q(p.name) like '%' || nq || '%') as pm,
           (select array_agg(p.name order by p.name) from (select p.name from public.products p where p.merchant_id = s.id and p.is_active
              and public.norm_q(p.name) like '%' || nq || '%' limit 3) p) as names,
           public.norm_q(s.store_name) like '%' || nq || '%' or public.norm_q(coalesce(s.activity, '')) like '%' || nq || '%' as name_hit
    from s
  )
  select h.id, h.pm, h.names from hits h
  where h.pm > 0 or h.name_hit
  order by (h.premium and coalesce(h.km, 0) <= 3) desc, h.km nulls last, h.pm desc
  limit 40;
  get diagnostics n = row_count;
  insert into public.search_log (q, lat, lng, results)
    values (nq, round(la::numeric, 2)::float8, round(ln::numeric, 2)::float8, n);
end $$;
revoke all on function public.search_nearby(text, double precision, double precision) from public;
grant execute on function public.search_nearby(text, double precision, double precision) to anon, authenticated;

-- بحث داخل محل ما لقى شي: نسجّله للمحل (بدون هوية المشتري)
create or replace function public.log_store_miss(mid uuid, q text)
returns void language sql security definer set search_path = public as $$
  insert into public.search_log (q, store_id, results)
  select public.norm_q(q), mid, 0 where char_length(public.norm_q(q)) >= 2
    and exists (select 1 from public.merchants where id = mid and status = 'approved');
$$;
revoke all on function public.log_store_miss(uuid, text) from public;
grant execute on function public.log_store_miss(uuid, text) to anon, authenticated;

-- ============ 3) تقرير الطلب في الحي (مميز) ============
create or replace function public.demand_report(days int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare m public.merchants; since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(days, 30), 180)));
begin
  select * into m from public.merchants where id = auth.uid();
  if m.id is null then raise exception 'not_allowed'; end if;
  if not public.plan_pro(m.id) then raise exception 'plan_pro_required'; end if;
  return jsonb_build_object(
    -- ناس قربك (3 كم) دوّروا عليه، وما عندك منتج بهذا الاسم
    'nearby', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (
        select l.q, count(*)::int n, count(*) filter (where l.results = 0)::int nowhere
        from public.search_log l
        where l.at >= since and l.store_id is null and l.lat is not null and m.lat is not null
          and abs(l.lat - m.lat) < 0.03 and abs(l.lng - m.lng) < 0.03
          and not exists (select 1 from public.products p where p.merchant_id = m.id and p.is_active and public.norm_q(p.name) like '%' || l.q || '%')
        group by l.q order by 2 desc limit 25) x),
    -- دوّروا داخل محلك وما لقوه
    'in_store', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (
        select l.q, count(*)::int n from public.search_log l
        where l.store_id = m.id and l.at >= since group by l.q order by 2 desc limit 25) x));
end $$;
revoke all on function public.demand_report(int) from public, anon;
grant execute on function public.demand_report(int) to authenticated;

-- ============ 4) تنبيه العروض ============
alter table public.buyers add column if not exists offer_alerts boolean not null default false;
alter table public.merchants add column if not exists last_offer_push_at timestamptz;

create or replace function public.set_offer_alerts(on_ boolean)
returns void language sql security definer set search_path = public as $$
  update public.buyers set offer_alerts = coalesce(on_, false) where id = auth.uid();
$$;
revoke all on function public.set_offer_alerts(boolean) from public, anon;
grant execute on function public.set_offer_alerts(boolean) to authenticated;

-- لما محل «مميز» يحط عرض جديد: تنبيه للمشترين الموافقين القريبين (مرة كل 24 ساعة للمحل)
create or replace function public.notify_offer_push()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare s public.notify_settings; m public.merchants;
begin
  if new.sale_price is null or not new.is_active then return new; end if;
  if tg_op = 'UPDATE' and old.sale_price is not distinct from new.sale_price then return new; end if;
  select * into m from public.merchants where id = new.merchant_id;
  if m.status <> 'approved' or not public.plan_pro(m.id) or not public.buyer_enabled() then return new; end if;
  if m.last_offer_push_at is not null and m.last_offer_push_at > now() - interval '24 hours' then return new; end if;
  select * into s from public.notify_settings where id;
  if s is null then return new; end if;
  update public.merchants set last_offer_push_at = now() where id = m.id;
  perform net.http_post(url := replace(s.function_url, '/notify', '/push'),
    body := jsonb_build_object('type', 'offer', 'merchant_id', m.id, 'store', m.store_name, 'lat', m.lat, 'lng', m.lng,
                               'product', new.name, 'price', new.price, 'sale', new.sale_price),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', s.webhook_secret),
    timeout_milliseconds := 10000);
  return new;
end $$;
drop trigger if exists products_offer_push on public.products;
create trigger products_offer_push after insert or update of sale_price, is_active on public.products
  for each row execute function public.notify_offer_push();

-- المشترين المستهدفين: موافقين على العروض، وعندهم تنبيهات، وطلبوا من المحل قبل أو آخر عنوان توصيل لهم داخل 3 كم
create or replace function public.offer_audience(mid uuid, la double precision, ln double precision)
returns table (user_id uuid) language sql stable security definer set search_path = public as $$
  select b.id from public.buyers b
  where b.offer_alerts and exists (select 1 from public.push_subscriptions ps where ps.user_id = b.id)
    and (exists (select 1 from public.orders o where o.buyer_id = b.id and o.merchant_id = mid)
         or exists (select 1 from (select o.lat, o.lng from public.orders o where o.buyer_id = b.id and o.lat is not null order by o.created_at desc limit 1) a
                    where la is not null and abs(a.lat - la) < 0.03 and abs(a.lng - ln) < 0.03))
  limit 2000;
$$;
revoke all on function public.offer_audience(uuid, double precision, double precision) from public, anon, authenticated;
grant execute on function public.offer_audience(uuid, double precision, double precision) to service_role;

-- سجلات البحث تنحذف بعد سنة (مذكور في سياسة الخصوصية)
select cron.unschedule('search-log-cleanup') where exists (select 1 from cron.job where jobname = 'search-log-cleanup');
select cron.schedule('search-log-cleanup', '17 3 * * *', $$delete from public.search_log where at < now() - interval '365 days'$$);
