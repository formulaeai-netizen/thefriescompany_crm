-- Run in Supabase SQL editor.
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS weight_kg numeric,
  ADD COLUMN IF NOT EXISTS unit_price numeric;

-- Drop any prior DEFAULT 2.5 on weight_kg.
ALTER TABLE invoices ALTER COLUMN weight_kg DROP DEFAULT;