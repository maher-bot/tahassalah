create policy "merchant reads own" on public.merchants for select
  using (id = auth.uid() or public.is_admin());
create policy "merchant registers self" on public.merchants for insert
  with check (id = auth.uid());
create policy "merchant edits while not approved" on public.merchants for update
  using (id = auth.uid() and status in ('pending', 'rejected'))
  with check (id = auth.uid());
create policy "admin updates merchants" on public.merchants for update
  using (public.is_admin()) with check (public.is_admin());
create policy "admin deletes merchants" on public.merchants for delete
  using (public.is_admin());

create policy "everyone reads settings" on public.app_settings for select using (true);
create policy "admin changes settings" on public.app_settings for update
  using (public.is_admin()) with check (public.is_admin());

create policy "public reads active products" on public.products for select
  using (
    merchant_id = auth.uid()
    or public.is_admin()
    or (is_active and public.is_approved_merchant(merchant_id) and public.buyer_enabled())
  );
create policy "approved merchant inserts" on public.products for insert
  with check (merchant_id = auth.uid() and public.is_approved_merchant());
create policy "approved merchant updates" on public.products for update
  using (merchant_id = auth.uid() and public.is_approved_merchant())
  with check (merchant_id = auth.uid());
create policy "approved merchant deletes" on public.products for delete
  using ((merchant_id = auth.uid() and public.is_approved_merchant()) or public.is_admin());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('merchant-docs', 'merchant-docs', false, 5242880, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']),
  ('product-images', 'product-images', true, 2097152, array['image/jpeg', 'image/png', 'image/webp']);

create policy "docs: owner uploads" on storage.objects for insert to authenticated
  with check (bucket_id = 'merchant-docs' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "docs: owner or admin reads" on storage.objects for select to authenticated
  using (bucket_id = 'merchant-docs' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
create policy "docs: owner replaces" on storage.objects for update to authenticated
  using (bucket_id = 'merchant-docs' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "images: approved merchant uploads" on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and (storage.foldername(name))[1] = auth.uid()::text
              and public.is_approved_merchant());
create policy "images: approved merchant updates" on storage.objects for update to authenticated
  using (bucket_id = 'product-images' and (storage.foldername(name))[1] = auth.uid()::text
         and public.is_approved_merchant());
create policy "images: owner deletes" on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and (storage.foldername(name))[1] = auth.uid()::text);
