-- الموظف اللي تعديله يمر بموافقة صاحب المحل يقدر يضيف الصور الإضافية بعد (تنطبّق عند الموافقة).
do $$
declare d text; arr text := 'coalesce((select array_agg(v) from jsonb_array_elements_text(case when jsonb_typeof(p->''extra_images'') = ''array'' then p->''extra_images'' else ''[]''::jsonb end) v), ''{}'')';
begin
  d := pg_get_functiondef('public.product_changes_guard'::regproc);
  if position('''extra_images''' in d) = 0 then
    assert position('''image_path'',''is_active'',''expires_on'']' in d) > 0, 'guard';
    execute replace(d, '''image_path'',''is_active'',''expires_on'']', '''image_path'',''extra_images'',''is_active'',''expires_on'']');
  end if;
  d := pg_get_functiondef('public.review_change'::regproc);
  if position('extra_images' in d) = 0 then
    assert position('image_path, is_active, offer_ends_at, offer_reason, expires_on)' in d) > 0, 'rc1';
    assert position('p->>''image_path'', coalesce((p->>''is_active'')' in d) > 0, 'rc2';
    assert position('is_active     = case when p ? ''is_active''' in d) > 0, 'rc3';
    d := replace(d, 'image_path, is_active, offer_ends_at, offer_reason, expires_on)', 'image_path, extra_images, is_active, offer_ends_at, offer_reason, expires_on)');
    d := replace(d, 'p->>''image_path'', coalesce((p->>''is_active'')', 'p->>''image_path'', ' || arr || ', coalesce((p->>''is_active'')');
    d := replace(d, 'is_active     = case when p ? ''is_active''', 'extra_images  = case when p ? ''extra_images'' then ' || arr || ' else extra_images end,
        is_active     = case when p ? ''is_active''');
    execute d;
  end if;
end $$;
