-- التوصيل لمدن ثانية: خيار للتاجر مع سياسة الرسوم.
-- الاتفاق على تكلفة الشحن بين الطرفين على الواتساب، والدفع بتحويل على الآيبان المسجّل (المعتمد) في النظام.
alter table public.store_settings
  add column if not exists ships_intercity boolean not null default false,
  add column if not exists intercity_fee_mode text not null default 'negotiable' check (intercity_fee_mode in ('free', 'buyer_fixed', 'negotiable')),
  add column if not exists intercity_fee numeric(8,2) check (intercity_fee is null or (intercity_fee >= 0 and intercity_fee <= 2000)),
  add column if not exists intercity_eta text check (intercity_eta is null or char_length(intercity_eta) <= 40),
  add column if not exists intercity_note text check (intercity_note is null or char_length(intercity_note) <= 160);
alter table public.store_settings
  add constraint store_settings_intercity_fee_chk check (intercity_fee_mode <> 'buyer_fixed' or intercity_fee is not null);
alter table public.store_settings drop constraint pickup_or_delivery;
alter table public.store_settings
  add constraint pickup_or_delivery check (pickup or delivers or ships_intercity);

create or replace function public.store_settings_plan_limits()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.delivers or new.ships_intercity) and not public.is_admin() and public.merchant_plan(new.merchant_id) = 'basic' then
    raise exception 'plan_basic_delivery';
  end if;
  return new;
end $$;

create or replace function public.end_expired_trials()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with ended as (
    update public.merchants set
      plan = case when kind = 'mobile' then (case when next_plan = 'basic' then 'family' else next_plan end) else 'basic' end,
      basic_until = case when kind = 'mobile' then null else now() + interval '3 months' end,
      paid_until = case when kind = 'mobile' then now() else null end
    where plan = 'free' and trial_started_at is not null
      and trial_started_at + make_interval(months => trial_months) <= now()
    returning id, plan
  ), basic as (select id from ended where plan = 'basic'),
  lim as (select id from ended where plan in ('basic', 'family')),
  p as (update public.products set sale_price = null, offer_ends_at = null, offer_reason = null, preorder_hours = null
        where merchant_id in (select id from basic) and (sale_price is not null or preorder_hours is not null) returning 1),
  s as (update public.store_settings set delivers = false, ships_intercity = false, pickup = true
        where merchant_id in (select id from basic) and (delivers or ships_intercity) returning 1),
  t as (update public.merchant_staff set status = 'suspended'
        where merchant_id in (select id from lim) and status = 'active' returning 1)
  select count(*) into n from ended;
  return n;
end $$;
