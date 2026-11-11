-- عنوان المشتري وموقعه ينحفظون في حسابه من أول طلب توصيل، عشان ما يعيد كتابتهم كل مرة.
alter table public.buyers add column if not exists address text check (address is null or char_length(address) <= 200);
alter table public.buyers add column if not exists lat double precision;
alter table public.buyers add column if not exists lng double precision;
