-- Run in your external Supabase SQL editor.

-- 1. Extend daily_production with variance tracking
ALTER TABLE public.daily_production
  ADD COLUMN IF NOT EXISTS actual_packs_produced numeric,
  ADD COLUMN IF NOT EXISTS variance_packs numeric,
  ADD COLUMN IF NOT EXISTS variance_reason text,
  ADD COLUMN IF NOT EXISTS ai_flag text;

-- 2. inventory_stock daily ledger
CREATE TABLE IF NOT EXISTS public.inventory_stock (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL DEFAULT CURRENT_DATE UNIQUE,
  opening_packs numeric DEFAULT 0,
  packs_produced numeric DEFAULT 0,
  packs_delivered numeric DEFAULT 0,
  closing_packs numeric GENERATED ALWAYS AS
    (COALESCE(opening_packs,0) + COALESCE(packs_produced,0) - COALESCE(packs_delivered,0)) STORED,
  raw_material_kg numeric DEFAULT 0,
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.inventory_stock ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated full access" ON public.inventory_stock;
CREATE POLICY "Authenticated full access" ON public.inventory_stock
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_stock TO authenticated;
GRANT ALL ON public.inventory_stock TO service_role;

CREATE INDEX IF NOT EXISTS inventory_stock_date_idx
  ON public.inventory_stock (date DESC);