ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS password_reset_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS password_reset_expires_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS customers_password_reset_token_hash_unique
  ON customers(password_reset_token_hash)
  WHERE password_reset_token_hash IS NOT NULL;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS inventory_restored_at TIMESTAMPTZ;
