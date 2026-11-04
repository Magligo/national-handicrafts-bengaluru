CREATE TABLE IF NOT EXISTS coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  description TEXT,
  discount_type TEXT NOT NULL CHECK (discount_type IN ('percentage','fixed','free_delivery')),
  discount_value NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (discount_value >= 0),
  min_order_inr INTEGER NOT NULL DEFAULT 0 CHECK (min_order_inr >= 0),
  max_discount_inr INTEGER CHECK (max_discount_inr IS NULL OR max_discount_inr >= 0),
  total_usage_limit INTEGER CHECK (total_usage_limit IS NULL OR total_usage_limit > 0),
  per_customer_limit INTEGER NOT NULL DEFAULT 1 CHECK (per_customer_limit > 0),
  starts_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  first_order_only BOOLEAN NOT NULL DEFAULT FALSE,
  applicability TEXT NOT NULL DEFAULT 'all' CHECK (applicability IN ('all','products','categories')),
  applicable_product_ids UUID[] NOT NULL DEFAULT '{}',
  applicable_categories TEXT[] NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (expires_at IS NULL OR starts_at IS NULL OR expires_at > starts_at),
  CHECK ((applicability='products' AND cardinality(applicable_product_ids)>0) OR applicability<>'products'),
  CHECK ((applicability='categories' AND cardinality(applicable_categories)>0) OR applicability<>'categories')
);
CREATE INDEX IF NOT EXISTS coupons_active_window_idx ON coupons(active, starts_at, expires_at);
CREATE TABLE IF NOT EXISTS coupon_usages (
  id BIGSERIAL PRIMARY KEY,
  coupon_id UUID NOT NULL REFERENCES coupons(id) ON DELETE RESTRICT,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  customer_email TEXT,
  order_id TEXT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  coupon_code TEXT NOT NULL,
  discount_inr INTEGER NOT NULL CHECK (discount_inr >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS coupon_usages_customer_idx ON coupon_usages(coupon_id, customer_id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_id UUID REFERENCES coupons(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_code TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_inr INTEGER NOT NULL DEFAULT 0 CHECK (discount_inr >= 0);
