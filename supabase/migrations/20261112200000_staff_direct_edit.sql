-- قرار صاحب المشروع: اللي ياخذ الصلاحية يعدّل مباشرة بدون موافقة (عشان ما تتأخر التعديلات).
alter table public.merchant_staff alter column needs_approval set default false;
alter table public.merchant_staff disable trigger user;
update public.merchant_staff set needs_approval = false where needs_approval;
alter table public.merchant_staff enable trigger user;
