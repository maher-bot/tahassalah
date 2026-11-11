-- بحث المشتري عن منتج (بالاسم أو الباركود) ومقارنة سعره بين المحلات القريبة.
-- يرجّع صف لكل منتج مطابق في كل محل ظاهر للمشتري، والواجهة تجمعها (بالباركود ثم بالاسم).
create or replace function public.product_search(q text default null, bc text default null, la double precision default null, ln double precision default null)
returns table (id uuid, merchant_id uuid, store_name text, logo_path text, premium boolean, km double precision,
               name text, barcode text, category text, unit text, image_path text, extra_images text[],
               price numeric, sale_price numeric, on_offer boolean, in_stock boolean, quantity int, always_available boolean,
               pack_name text, pack_size int, pack_price numeric, pack_only boolean)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare nq text := public.norm_q(q); b text := nullif(regexp_replace(coalesce(bc, ''), '\D', '', 'g'), ''); n int;
begin
  if b is null and char_length(nq) < 2 then return; end if;
  return query
  select p.id, p.merchant_id, s.store_name, s.logo_path, s.premium,
         case when la is null or s.lat is null then null
              else 6371 * 2 * asin(sqrt(power(sin(radians(s.lat - la) / 2), 2) + cos(radians(la)) * cos(radians(s.lat)) * power(sin(radians(s.lng - ln) / 2), 2))) end,
         p.name, p.barcode, p.category, p.unit, p.image_path, p.extra_images,
         p.price, p.sale_price,
         p.sale_price is not null and (p.offer_ends_at is null or p.offer_ends_at > now()),
         p.always_available or coalesce(st.service_roundtrip, false) or coalesce(p.quantity, 0) > 0,
         p.quantity, p.always_available, p.pack_name, p.pack_size, p.pack_price, p.pack_only
  from public.products p
  join public.stores_public s on s.id = p.merchant_id          -- stores_public = المحلات الظاهرة للمشتري فقط (مع المختبرين قبل الإطلاق)
  left join public.store_settings st on st.merchant_id = p.merchant_id
  where p.is_active and public.is_entitled(p.merchant_id)
    and (case when b is not null then p.barcode = b else public.norm_q(p.name) like '%' || nq || '%' end)
  order by 6 nulls last
  limit 300;
  get diagnostics n = row_count;
  insert into public.search_log (q, lat, lng, results)
    values (coalesce(b, nq), round(la::numeric, 2)::float8, round(ln::numeric, 2)::float8, n);
end $$;
revoke all on function public.product_search(text, text, double precision, double precision) from public;
grant execute on function public.product_search(text, text, double precision, double precision) to anon, authenticated;
