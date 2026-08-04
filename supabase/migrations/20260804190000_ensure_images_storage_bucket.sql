-- Bucket `images` był na Production (Dashboard), ale brakowało go na Staging —
-- upload z panelu kończył się błędem. Idempotentnie dopnij bucket + publiczny odczyt.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'images',
  'images',
  true,
  10485760, -- 10 MB
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = COALESCE(storage.buckets.file_size_limit, EXCLUDED.file_size_limit),
  allowed_mime_types = COALESCE(storage.buckets.allowed_mime_types, EXCLUDED.allowed_mime_types);

-- Publiczny odczyt (bucket public) — bez tego getPublicUrl działa, ale CDN/Storage API
-- może wymagać SELECT dla anon przy listingach; INSERT/UPDATE/DELETE bez zmian (ownership).
DROP POLICY IF EXISTS images_select_public ON storage.objects;
CREATE POLICY images_select_public
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'images');
