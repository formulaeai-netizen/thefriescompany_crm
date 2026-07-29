DO $$
DECLARE
  tbl text;
  pol text;
  tables text[] := ARRAY[
    'clients','branches','invoices','expenses',
    'settings','whatsapp_logs','inventory','stock_movements'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    FOR pol IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = tbl
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol, tbl);
    END LOOP;
    EXECUTE format('CREATE POLICY "Authenticated read"   ON public.%I FOR SELECT TO authenticated USING (true)', tbl);
    EXECUTE format('CREATE POLICY "Authenticated insert" ON public.%I FOR INSERT TO authenticated WITH CHECK (true)', tbl);
    EXECUTE format('CREATE POLICY "Authenticated update" ON public.%I FOR UPDATE TO authenticated USING (true) WITH CHECK (true)', tbl);
    EXECUTE format('CREATE POLICY "Authenticated delete" ON public.%I FOR DELETE TO authenticated USING (true)', tbl);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', tbl);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', tbl);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', tbl);
  END LOOP;
END $$;

ALTER FUNCTION public.generate_invoice_no() SET search_path = public, pg_temp;