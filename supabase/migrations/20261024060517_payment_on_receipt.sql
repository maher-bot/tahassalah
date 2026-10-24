-- الدفع عند الاستلام فقط (المنصة ما تستلم فلوس): نقدًا، أو بطاقة في المحل، أو بطاقة للمندوب (جهاز نقاط بيع أو SoftPOS على جواله).
-- pay_card_delivery ما يُعتمد إلا لو التوصيل شغّال (delivers).
alter table public.store_settings
  add column if not exists pay_cash boolean not null default true,
  add column if not exists pay_card boolean not null default false,
  add column if not exists pay_card_delivery boolean not null default false;
alter table public.store_settings
  add constraint store_settings_pay_chk check (pay_cash or pay_card or pay_card_delivery);
