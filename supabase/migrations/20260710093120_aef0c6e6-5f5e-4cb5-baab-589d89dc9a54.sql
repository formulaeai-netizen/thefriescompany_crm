
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS reorder_threshold_days int DEFAULT 14,
  ADD COLUMN IF NOT EXISTS last_order_date date,
  ADD COLUMN IF NOT EXISTS reorder_alert_sent boolean DEFAULT false;

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS petrol_rate_per_litre numeric DEFAULT 297.53,
  ADD COLUMN IF NOT EXISTS default_vehicle_type text,
  ADD COLUMN IF NOT EXISTS reorder_threshold_days int DEFAULT 14;

-- reorder_alerts
CREATE TABLE IF NOT EXISTS public.reorder_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  last_order_date date,
  days_since_order int,
  alert_sent boolean DEFAULT false,
  alert_sent_at timestamptz,
  resolved boolean DEFAULT false,
  resolved_at timestamptz,
  created_at timestamptz DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reorder_alerts TO authenticated;
GRANT ALL ON public.reorder_alerts TO service_role;
ALTER TABLE public.reorder_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read reorder_alerts" ON public.reorder_alerts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert reorder_alerts" ON public.reorder_alerts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update reorder_alerts" ON public.reorder_alerts FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete reorder_alerts" ON public.reorder_alerts FOR DELETE TO authenticated USING (true);

-- delivery_calculations
CREATE TABLE IF NOT EXISTS public.delivery_calculations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  delivery_area text,
  distance_km numeric,
  vehicle_type text,
  petrol_rate numeric,
  fuel_efficiency numeric,
  calculated_fuel_cost numeric,
  service_fee numeric DEFAULT 0,
  total_delivery_cost numeric,
  notes text,
  created_at timestamptz DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.delivery_calculations TO authenticated;
GRANT ALL ON public.delivery_calculations TO service_role;
ALTER TABLE public.delivery_calculations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read delivery_calculations" ON public.delivery_calculations FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert delivery_calculations" ON public.delivery_calculations FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update delivery_calculations" ON public.delivery_calculations FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete delivery_calculations" ON public.delivery_calculations FOR DELETE TO authenticated USING (true);

-- delivery_areas
CREATE TABLE IF NOT EXISTS public.delivery_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  area_name text NOT NULL UNIQUE,
  distance_km numeric NOT NULL,
  created_at timestamptz DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.delivery_areas TO authenticated;
GRANT ALL ON public.delivery_areas TO service_role;
ALTER TABLE public.delivery_areas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read delivery_areas" ON public.delivery_areas FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert delivery_areas" ON public.delivery_areas FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update delivery_areas" ON public.delivery_areas FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete delivery_areas" ON public.delivery_areas FOR DELETE TO authenticated USING (true);

INSERT INTO public.delivery_areas (area_name, distance_km) VALUES
  ('DHA Phase 1-4', 12),
  ('DHA Phase 5-6', 15),
  ('SMCHS', 8),
  ('North Nazimabad', 14),
  ('Johar', 18),
  ('Ocean (Clifton)', 10),
  ('Gulshan-e-Iqbal', 16),
  ('Nishat', 19),
  ('Maskan', 17),
  ('Saddar', 9),
  ('Korangi', 22),
  ('Malir', 25)
ON CONFLICT (area_name) DO NOTHING;
