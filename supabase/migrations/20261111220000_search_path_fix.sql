-- تنبيه أمان Supabase: دوال بدون search_path ثابت
alter function public.plan_price(text, text) set search_path = public;
alter function public.billing_plan(public.merchants) set search_path = public;
alter function public.billing_due(public.merchants) set search_path = public;
