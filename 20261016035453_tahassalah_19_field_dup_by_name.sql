-- تطبيع الأسماء العربية للمقارنة: نشيل «ال» والمسافات والتطويل، ونوحّد الألف والتاء المربوطة والياء
create or replace function public.ar_norm(t text)
returns text language sql immutable as $$
  select regexp_replace(
           translate(lower(coalesce(t, '')), 'أإآٱةىـ', 'اااايه'),
           '(^|\s)ال|[\s\-_.،,]+|(محل|بقاله|بقالة|تموينات|مؤسسه|مؤسسة)', '', 'g');
$$;

create or replace function public.field_duplicates(p_phone text, p_lat double precision, p_lng double precision,
  p_name text, p_district text default null)
returns table (store_id uuid, store_name text, rep_name text, mine boolean, status text, last_visit_at timestamptz, distance_m integer, reason text)
language sql stable security definer set search_path = public as $$
  with c as (
    select s.*, r.name as rname,
      case when p_lat is null or s.lat is null then null else
        round(6371000 * 2 * asin(sqrt(power(sin(radians(s.lat - p_lat) / 2), 2)
          + cos(radians(p_lat)) * cos(radians(s.lat)) * power(sin(radians(s.lng - p_lng) / 2), 2))))::integer end as dist,
      length(public.ar_norm(p_name)) >= 2 and (public.ar_norm(s.store_name) = public.ar_norm(p_name)
        or (length(public.ar_norm(p_name)) >= 4 and (public.ar_norm(s.store_name) like '%' || public.ar_norm(p_name) || '%'
            or public.ar_norm(p_name) like '%' || public.ar_norm(s.store_name) || '%'))) as same_name
    from public.field_stores s join public.reps r on r.id = s.rep_id
    where (public.current_rep_id() is not null or public.is_admin())
  )
  select id, store_name, rname, rep_id = public.current_rep_id(), status, last_visit_at, dist,
    case when p_phone is not null and phone = p_phone then 'phone'
         when dist is not null and dist <= 40 then 'near'
         else 'name' end
  from c
  where (p_phone is not null and phone = p_phone)
     or (dist is not null and dist <= 40)
     or (same_name and ((dist is not null and dist <= 150)
          or (dist is null and p_district is not null and district = p_district)))
  order by last_visit_at desc limit 5;
$$;
revoke execute on function public.field_duplicates(text, double precision, double precision, text, text) from public, anon;
grant execute on function public.field_duplicates(text, double precision, double precision, text, text) to authenticated;
revoke execute on function public.ar_norm(text) from anon;
