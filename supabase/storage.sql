-- Ejecutar en SQL Editor del proyecto Supabase del equipo.
-- Solo lectura pública e inserciones nuevas en la carpeta de TEAM-029.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lumon-media', 'lumon-media', true, 307200, array['image/webp'])
on conflict (id) do update set public = true,
  file_size_limit = 307200, allowed_mime_types = array['image/webp'];

create policy "lumon_team029_insert_webp"
on storage.objects for insert to anon
with check (
  bucket_id = 'lumon-media'
  and (storage.foldername(name))[1] = 'TEAM-029'
);

-- No crear políticas UPDATE ni DELETE para anon.
-- La lectura pública del bucket no requiere una política SELECT.
