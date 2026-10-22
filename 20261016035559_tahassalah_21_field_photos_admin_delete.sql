create policy "field photos: admin deletes" on storage.objects for delete to authenticated
  using (bucket_id = 'field-photos' and public.is_admin());
