create or replace function public.ar_norm(t text)
returns text language sql immutable as $$
  select regexp_replace(
           translate(lower(coalesce(t, '')), 'أإآٱةىـ', 'ااااهي'),
           '(^|\s)ال|[\s\-_.،,]+|(محل|بقاله|تموينات|مؤسسه)', '', 'g');
$$;
