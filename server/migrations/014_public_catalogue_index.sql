CREATE INDEX IF NOT EXISTS products_public_catalogue_name_idx
  ON products (name)
  WHERE active = TRUE AND verification_status = 'verified';
