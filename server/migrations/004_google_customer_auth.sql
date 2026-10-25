ALTER TABLE customers ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS google_id TEXT UNIQUE;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS avatar_url TEXT;
CREATE INDEX IF NOT EXISTS customers_google_id_idx ON customers(google_id);
