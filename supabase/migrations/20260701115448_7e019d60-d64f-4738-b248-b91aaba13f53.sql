-- Restrict inventory, stock_movements, inventory_stock, branches to admin/staff only
DO $$
DECLARE
  t text;
  p text;
BEGIN
  FOREACH t IN ARRAY ARRAY['inventory','stock_movements','inventory_stock','branches'] LOOP
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=t LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p, t);
    END LOOP;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($f$CREATE POLICY "Admin/staff read %1$s" ON public.%1$I FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff'))$f$, t);
    EXECUTE format($f$CREATE POLICY "Admin/staff insert %1$s" ON public.%1$I FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff'))$f$, t);
    EXECUTE format($f$CREATE POLICY "Admin/staff update %1$s" ON public.%1$I FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff')) WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff'))$f$, t);
    EXECUTE format($f$CREATE POLICY "Admin delete %1$s" ON public.%1$I FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'))$f$, t);
  END LOOP;
END$$;

REVOKE ALL ON public.inventory, public.stock_movements, public.inventory_stock, public.branches FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory, public.stock_movements, public.inventory_stock, public.branches TO authenticated;
GRANT ALL ON public.inventory, public.stock_movements, public.inventory_stock, public.branches TO service_role;
