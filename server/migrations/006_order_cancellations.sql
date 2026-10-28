ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancellation_request_status TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancellation_requested_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancellation_decided_at TIMESTAMPTZ;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_cancellation_request_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_cancellation_request_status_check CHECK (cancellation_request_status IS NULL OR cancellation_request_status IN ('pending','approved','rejected'));
CREATE INDEX IF NOT EXISTS orders_cancellation_status_idx ON orders(cancellation_request_status) WHERE cancellation_request_status IS NOT NULL;
