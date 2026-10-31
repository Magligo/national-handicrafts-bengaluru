ALTER TABLE gallery_images ALTER COLUMN image_url DROP NOT NULL;
ALTER TABLE gallery_images ADD COLUMN IF NOT EXISTS media_type TEXT NOT NULL DEFAULT 'photo' CHECK (media_type IN ('photo','video','link'));
ALTER TABLE gallery_images ADD COLUMN IF NOT EXISTS media_url TEXT;
ALTER TABLE gallery_images ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;
ALTER TABLE gallery_images ADD COLUMN IF NOT EXISTS thumbnail_storage_public_id TEXT;
ALTER TABLE gallery_images ADD COLUMN IF NOT EXISTS external_url TEXT;

UPDATE gallery_images SET media_url = image_url WHERE media_url IS NULL;

CREATE INDEX IF NOT EXISTS gallery_media_type_public_order_idx
  ON gallery_images (published, media_type, order_index, created_at, id);
