
alter table public.merchants alter column cr_number drop not null;
alter table public.merchants alter column cr_path drop not null;
alter table public.merchants add constraint merchants_docs_by_kind check (
  (kind = 'store' and cr_number is not null and cr_path is not null)
  or (kind <> 'store' and id_number is not null and id_path is not null));
alter table public.merchants drop constraint if exists merchants_plan_check;
alter table public.merchants add constraint merchants_plan_check check (plan in ('free','basic','trader','pro','family'));
alter table public.merchants drop constraint if exists merchants_next_plan_check;
alter table public.merchants add constraint merchants_next_plan_check check (next_plan in ('basic','trader','pro','family'));
alter table public.merchants add constraint merchants_family_plan_kind check (kind <> 'store' or (plan <> 'family' and next_plan <> 'family'));
