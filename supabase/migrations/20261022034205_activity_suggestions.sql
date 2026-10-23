-- اقتراحات النشاط للتسجيل: الأنشطة اللي سجّلها تجار معتمدون من نفس النوع (أسماء فقط، بدون أي بيانات شخصية)
create or replace function public.activity_suggestions(k text)
returns table (activity text, n bigint)
language sql stable security definer set search_path = public as $$
  select m.activity, count(*)::bigint as n
  from public.merchants m
  where m.status = 'approved' and m.kind = k and m.activity is not null
  group by m.activity
  order by n desc, m.activity
  limit 40;
$$;
revoke execute on function public.activity_suggestions(text) from public, anon;
grant execute on function public.activity_suggestions(text) to authenticated;
