ALTER TABLE products
  ADD COLUMN IF NOT EXISTS creation_idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS products_creation_idempotency_key_unique
  ON products (creation_idempotency_key);
