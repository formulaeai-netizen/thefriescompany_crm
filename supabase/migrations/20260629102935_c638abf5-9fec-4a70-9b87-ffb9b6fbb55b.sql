
DROP POLICY IF EXISTS "Authenticated full access" ON public.daily_production;
DROP POLICY IF EXISTS "Allow all" ON public.daily_production;
DROP POLICY IF EXISTS "Enable all access for all users" ON public.daily_production;
CREATE POLICY "Authenticated full access" ON public.daily_production
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
REVOKE ALL ON public.daily_production FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_production TO authenticated;
GRANT ALL ON public.daily_production TO service_role;

DROP POLICY IF EXISTS "Authenticated full access" ON public.inventory_stock;
DROP POLICY IF EXISTS "Allow all" ON public.inventory_stock;
DROP POLICY IF EXISTS "Enable all access for all users" ON public.inventory_stock;
CREATE POLICY "Authenticated full access" ON public.inventory_stock
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
REVOKE ALL ON public.inventory_stock FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_stock TO authenticated;
GRANT ALL ON public.inventory_stock TO service_role;
