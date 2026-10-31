ALTER TABLE products
  ADD COLUMN IF NOT EXISTS image_public_ids JSONB NOT NULL DEFAULT '[]'::jsonb;


ALTER TABLE shop_banners
  ADD COLUMN IF NOT EXISTS storage_public_id TEXT;
