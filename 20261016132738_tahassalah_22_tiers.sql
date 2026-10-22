alter table public.merchants drop constraint merchants_plan_check;
alter table public.merchants drop constraint merchants_next_plan_check;
update public.merchants set next_plan = 'basic' where next_plan not in ('basic', 'trader', 'pro');
update public.merchants set plan = 'trader' where plan not in ('free', 'basic', 'trader', 'pro');
alter table public.merchants alter column next_plan set default 'basic';
alter table public.merchants add constraint merchants_plan_check check (plan in ('free', 'basic', 'trader', 'pro'));
alter table public.merchants add constraint merchants_next_plan_check check (next_plan in ('basic', 'trader', 'pro'));
alter table public.merchants add column if not exists billing text not null default 'monthly' check (billing in ('monthly', 'yearly'));
