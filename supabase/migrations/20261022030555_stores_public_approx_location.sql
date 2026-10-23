-- المحلات والمتنقلون: موقع دقيق. الأسر المنتجة: دبوس تقريبي على مربع ~550م (بدون حد أدنى للعدد).
create or replace view public.stores_public with (security_invoker = false) as
with base as (
  select id, store_name, activity, city, district, lat, lng,
         (kind = 'family' or hide_location) as approx
  from public.merchants
  where status = 'approved' and public.buyer_enabled()
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
  approx as location_approx
from cells;

-- سحب صلاحية الاستدعاء من دالتي trigger (التريقر يشتغل بدونها)
revoke execute on function public.merchants_family_guard() from public, anon, authenticated;
revoke execute on function public.merchants_wathq_check() from public, anon, authenticated;

-- تثبيت search_path لدالتين
alter function public.ar_norm(text) set search_path = '';
alter function public.store_settings_touch() set search_path = '';
