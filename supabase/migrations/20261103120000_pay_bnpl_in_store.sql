-- التقسيط عند الاستلام عبر حساب التاجر نفسه في تابي أو تمارا (المشتري يمسح باركود التاجر في المحل).
-- المنصة ما تستلم فلوس: المبلغ يروح من تابي أو تمارا للتاجر مباشرة. خيار إضافي للمحلات فقط،
-- فما يدخل في شرط «طريقة دفع واحدة على الأقل» (نقدًا أو بطاقة يبقى مطلوب).
alter table public.store_settings
  add column if not exists pay_tabby boolean not null default false,
  add column if not exists pay_tamara boolean not null default false;
