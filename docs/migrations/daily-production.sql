-- Run in your external Supabase SQL editor.
CREATE TABLE IF NOT EXISTS public.daily_production (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL DEFAULT CURRENT_DATE,
  raw_input_kg numeric NOT NULL,
  wastage_percent numeric NOT NULL DEFAULT 60,
  usable_kg numeric GENERATED ALWAYS AS
    (raw_input_kg * (1 - wastage_percent / 100)) STORED,
  pack_size_kg numeric NOT NULL DEFAULT 2.5,
  packs_produced numeric GENERATED ALWAYS AS
    (raw_input_kg * (1 - wastage_percent / 100) / pack_size_kg) STORED,
  target_packs numeric,
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.daily_production ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated full access" ON public.daily_production;
CREATE POLICY "Authenticated full access" ON public.daily_production
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_production TO authenticated;
GRANT ALL ON public.daily_production TO service_role;

CREATE INDEX IF NOT EXISTS daily_production_date_idx
  ON public.daily_production (date DESC);