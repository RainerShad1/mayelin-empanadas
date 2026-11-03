-- ============================================================
--  Fotos de productos.
--  Bucket público para que la página las muestre; solo las
--  administradoras pueden subir, cambiar o borrar fotos.
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 2097152, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

create policy "admin sube fotos" on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and (select public.is_admin()));

create policy "admin ve fotos" on storage.objects for select to authenticated
  using (bucket_id = 'product-images' and (select public.is_admin()));

create policy "admin cambia fotos" on storage.objects for update to authenticated
  using (bucket_id = 'product-images' and (select public.is_admin()));

create policy "admin borra fotos" on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and (select public.is_admin()));
