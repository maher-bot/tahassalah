-- إلغاء الباقة الأساسية المجانية: بعد الفترة المفتوحة يلزم الاشتراك مباشرة لكل الأنواع.
-- من لم يحدد باقته (next_plan = 'basic' تعني «أحدد لاحقًا»): المحل يصير «تاجر»، والأسرة والمتنقل «أسر ومتجولين».
-- paid_until = now(): يُخفى عن المشترين حتى يُفعَّل اشتراكه، وتبقى بياناته ومنتجاته.
create or replace function public.end_expired_trials()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with ended as (
    update public.merchants set
      plan = case when kind = 'store' then (case when next_plan = 'pro' then 'pro' else 'trader' end)
                  else (case when next_plan in ('trader', 'pro') then next_plan else 'family' end) end,
      basic_until = null,
      paid_until = now()
    where plan = 'free' and trial_started_at is not null
      and trial_started_at + make_interval(months => trial_months) <= now()
    returning id, plan
  ), lim as (select id from ended where plan = 'family'),
  t as (update public.merchant_staff set status = 'suspended'
        where merchant_id in (select id from lim) and status = 'active' returning 1)
  select count(*) into n from ended;
  return n;
end $$;
