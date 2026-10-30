ALTER TABLE products
  ADD COLUMN IF NOT EXISTS specifications JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE products SET specifications = '{}'::jsonb WHERE specifications IS NULL;

-- Give older JSONB variants stable identifiers without changing their labels, prices or stock.
UPDATE products AS product
SET variants = (
  SELECT jsonb_agg(
    CASE
      WHEN jsonb_typeof(item.value) = 'object' AND COALESCE(item.value ->> 'id', '') = ''
        THEN item.value || jsonb_build_object('id', gen_random_uuid()::text)
      ELSE item.value
    END ORDER BY item.ordinality)
  FROM jsonb_array_elements(product.variants) WITH ORDINALITY AS item(value, ordinality)
) 
WHERE jsonb_typeof(product.variants) = 'array'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(product.variants) AS item(value)
    WHERE jsonb_typeof(item.value) = 'object' AND COALESCE(item.value ->> 'id', '') = ''
  );
