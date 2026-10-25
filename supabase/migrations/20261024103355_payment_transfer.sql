-- الأسر المنتجة والمتنقلون: الدفع نقدًا أو بتحويل على الحساب.
-- التاجر يرسل بيانات حسابه للمشتري عبر الواتساب لما يتفقون، والمنصة ما تعرض رقم الآيبان.
alter table public.store_settings add column if not exists pay_transfer boolean not null default false;
alter table public.store_settings drop constraint if exists store_settings_pay_chk;
alter table public.store_settings
  add constraint store_settings_pay_chk check (pay_cash or pay_card or pay_card_delivery or pay_transfer);
