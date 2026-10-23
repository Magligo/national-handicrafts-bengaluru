ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_inr INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS orders_payment_method_status_idx ON orders(payment_method, payment_status, status);
