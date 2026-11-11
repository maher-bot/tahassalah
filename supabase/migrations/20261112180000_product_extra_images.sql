-- صور إضافية للمنتج (من جهات ثانية): الرئيسية في image_path، وحتى 3 إضافية هنا = 4 صور.
alter table public.products add column if not exists extra_images text[] not null default '{}';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'products_extra_images_max') then
    alter table public.products add constraint products_extra_images_max check (cardinality(extra_images) <= 3);
  end if;
end $$;

-- الموظف بدون صلاحية المخزون ما يغيّر الصور الإضافية (مثل الصورة الرئيسية)
do $$
declare d text;
begin
  d := pg_get_functiondef('public.products_guard'::regproc);
  if position('new.extra_images := old.extra_images' in d) = 0 then
    assert position('new.image_path := old.image_path;' in d) > 0, 'products_guard';
    execute replace(d, 'new.image_path := old.image_path;', 'new.image_path := old.image_path; new.extra_images := old.extra_images;');
  end if;
end $$;
