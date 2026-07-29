
-- Sequences for auto IDs
CREATE SEQUENCE IF NOT EXISTS public.returns_no_seq START 1;
CREATE SEQUENCE IF NOT EXISTS public.damaged_stock_no_seq START 1;

-- returns table
CREATE TABLE public.returns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  return_no TEXT NOT NULL UNIQUE DEFAULT ('RET-' || LPAD(nextval('public.returns_no_seq')::text, 4, '0')),
  invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
  client_name TEXT,
  branch TEXT,
  item_description TEXT NOT NULL,
  return_qty NUMERIC NOT NULL DEFAULT 0,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  total_return_value NUMERIC NOT NULL DEFAULT 0,
  return_date DATE NOT NULL DEFAULT CURRENT_DATE,
  reason TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'Pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.returns TO authenticated;
GRANT ALL ON public.returns TO service_role;
GRANT USAGE ON SEQUENCE public.returns_no_seq TO authenticated, service_role;

ALTER TABLE public.returns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read"   ON public.returns FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert" ON public.returns FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update" ON public.returns FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated delete" ON public.returns FOR DELETE TO authenticated USING (true);

CREATE TRIGGER touch_returns_updated_at BEFORE UPDATE ON public.returns
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- damaged_stock table
CREATE TABLE public.damaged_stock (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  entry_no TEXT NOT NULL UNIQUE DEFAULT ('DMG-' || LPAD(nextval('public.damaged_stock_no_seq')::text, 4, '0')),
  item_description TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Damaged',
  qty_lost NUMERIC NOT NULL DEFAULT 0,
  unit_cost NUMERIC NOT NULL DEFAULT 0,
  total_loss_value NUMERIC NOT NULL DEFAULT 0,
  loss_date DATE NOT NULL DEFAULT CURRENT_DATE,
  batch_no TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.damaged_stock TO authenticated;
GRANT ALL ON public.damaged_stock TO service_role;
GRANT USAGE ON SEQUENCE public.damaged_stock_no_seq TO authenticated, service_role;

ALTER TABLE public.damaged_stock ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read"   ON public.damaged_stock FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert" ON public.damaged_stock FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update" ON public.damaged_stock FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated delete" ON public.damaged_stock FOR DELETE TO authenticated USING (true);

CREATE TRIGGER touch_damaged_stock_updated_at BEFORE UPDATE ON public.damaged_stock
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
