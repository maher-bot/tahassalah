alter policy "public reads active products" on public.products
  using (
    merchant_id = auth.uid()
    or public.is_admin()
    or public.staff_has(merchant_id, 'inventory') or public.staff_has(merchant_id, 'prices')
    or (is_active and public.is_approved_merchant(merchant_id) and public.buyer_enabled())
  );
alter policy "approved merchant inserts" on public.products
  with check (public.can_manage_products(merchant_id, 'inventory'));
alter policy "approved merchant updates" on public.products
  using (public.can_manage_products(merchant_id, 'inventory') or public.can_manage_products(merchant_id, 'prices'))
  with check (public.can_manage_products(merchant_id, 'inventory') or public.can_manage_products(merchant_id, 'prices'));
alter policy "approved merchant deletes" on public.products
  using (public.can_manage_products(merchant_id, 'inventory') or public.is_admin());

create or replace function public.products_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare inv boolean; pr boolean;
begin
  if tg_op = 'INSERT' and new.merchant_id is null then new.merchant_id := auth.uid(); end if;
  if auth.uid() = new.merchant_id or public.is_admin() then return new; end if;
  inv := public.staff_has(new.merchant_id, 'inventory');
  pr  := public.staff_has(new.merchant_id, 'prices');
  if tg_op = 'UPDATE' then
    new.merchant_id := old.merchant_id;
    if not inv then
      new.name := old.name; new.description := old.description; new.category := old.category;
      new.barcode := old.barcode; new.quantity := old.quantity; new.image_path := old.image_path;
      new.is_active := old.is_active;
    end if;
    if not pr then new.price := old.price; new.sale_price := old.sale_price; end if;
  end if;
  return new;
end $$;
create trigger products_guard before insert or update on public.products
  for each row execute function public.products_guard();
alter table public.products alter column merchant_id set default null;

alter policy "images: approved merchant uploads" on storage.objects
  with check (bucket_id = 'product-images'
    and public.is_approved_merchant(((storage.foldername(name))[1])::uuid)
    and ((storage.foldername(name))[1] = auth.uid()::text
         or public.staff_has(((storage.foldername(name))[1])::uuid, 'inventory')));
alter policy "images: approved merchant updates" on storage.objects
  using (bucket_id = 'product-images'
    and public.can_manage_products(((storage.foldername(name))[1])::uuid, 'inventory'));
alter policy "images: owner deletes" on storage.objects
  using (bucket_id = 'product-images'
    and ((storage.foldername(name))[1] = auth.uid()::text
         or public.can_manage_products(((storage.foldername(name))[1])::uuid, 'inventory')));
