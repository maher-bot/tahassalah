-- المتنقلون: إذا موقعهم الحي محدَّث خلال آخر 15 دقيقة يظهر الموقع الحي الدقيق، وإلا يرجع للموقع المسجّل مع is_live = false.
-- المحلات: دقيق. الأسر (وأي سجل hide_location): دبوس تقريبي على مربع ~550م.
create or replace view public.stores_public with (security_invoker = false) as
with src as (
  select id, store_name, activity, city, district, kind, hide_location,
         lat, lng, live_lat, live_lng, live_at,
         (kind = 'mobile' and live_lat is not null and live_lng is not null
            and live_at > now() - interval '15 minutes') as is_live
  from public.merchants
  where status = 'approved' and public.buyer_enabled()
), base as (
  select id, store_name, activity, city, district,
         case when is_live then live_lat else lat end as lat,
         case when is_live then live_lng else lng end as lng,
         is_live,
         case when is_live then live_at end as live_at,
         (kind = 'family' or hide_location) as approx
  from src
), cells as (
  select *,
    case when approx and lat is not null and lng is not null
         then round((round(lat / 0.005) * 0.005)::numeric, 3)::float8 end as clat,
    case when approx and lat is not null and lng is not null
         then round((round(lng / 0.005) * 0.005)::numeric, 3)::float8 end as clng
  from base
)
select id, store_name, activity, city, district,
  case when approx then clat else lat end as lat,
  case when approx then clng else lng end as lng,
  approx as location_approx,
  is_live,
  live_at
from cells;
