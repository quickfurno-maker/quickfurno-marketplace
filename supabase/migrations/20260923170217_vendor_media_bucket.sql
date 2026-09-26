-- Vendor portfolio photos.
--
-- Public READ: these are marketing images on public vendor profiles, so a
-- signed-URL dance would buy nothing and cost a round trip per thumbnail.
-- Paths are vendor-uuid scoped, so nothing is guessable in a useful way.
--
-- No client WRITE policy at all. Uploads go through /api/vendor/media, which
-- re-encodes every image server-side to strip EXIF before it ever reaches
-- storage — vendor phone photos of client homes carry GPS coordinates, and a
-- direct-to-storage signed upload would put those coordinates in a public
-- bucket. The service role is the only writer, and it is server-only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'vendor-media',
  'vendor-media',
  true,
  8388608,                                            -- 8 MiB, a second line of defence behind the route's own check
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Anyone may read. Nobody may write without the service role.
drop policy if exists "vendor media public read" on storage.objects;
create policy "vendor media public read"
  on storage.objects for select
  using (bucket_id = 'vendor-media');
