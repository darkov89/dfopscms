-- Narrow storage.objects SELECT for images:
-- 1) authenticated → only own paths (was: any object in bucket)
-- 2) public bucket read policy → anon only (was: TO public, which includes authenticated)

DROP POLICY IF EXISTS images_select_authenticated ON storage.objects;
DROP POLICY IF EXISTS images_select_own ON storage.objects;

CREATE POLICY images_select_own
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'images'
  AND public.storage_images_owned_by_caller(name)
);

DROP POLICY IF EXISTS images_select_public ON storage.objects;
CREATE POLICY images_select_public
ON storage.objects
FOR SELECT
TO anon
USING (bucket_id = 'images');

COMMENT ON POLICY images_select_public ON storage.objects IS
  'Public bucket read for anon (CDN/getPublicUrl). Authenticated uses images_select_own — no cross-tenant listing.';
