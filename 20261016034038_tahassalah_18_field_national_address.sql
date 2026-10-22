alter table public.field_stores add column if not exists national_address text
  check (national_address is null or national_address ~ '^[A-Z]{4}[0-9]{4}$');
