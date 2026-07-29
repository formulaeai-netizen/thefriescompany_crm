
-- Helper: rebuild policies as admin+staff for operational tables
DO $$
DECLARE
  tbl text;
  pol text;
  op_tables text[] := ARRAY['clients','invoices','payment_screenshots','daily_production','expenses','whatsapp_logs'];
BEGIN
  FOREACH tbl IN ARRAY op_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=tbl LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol, tbl);
    END LOOP;
    EXECUTE format($f$CREATE POLICY "Admin or staff read"   ON public.%I FOR SELECT TO authenticated USING  (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'staff'::app_role))$f$, tbl);
    EXECUTE format($f$CREATE POLICY "Admin or staff insert" ON public.%I FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'staff'::app_role))$f$, tbl);
    EXECUTE format($f$CREATE POLICY "Admin or staff update" ON public.%I FOR UPDATE TO authenticated USING  (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'staff'::app_role)) WITH CHECK (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'staff'::app_role))$f$, tbl);
    EXECUTE format($f$CREATE POLICY "Admin or staff delete" ON public.%I FOR DELETE TO authenticated USING  (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'staff'::app_role))$f$, tbl);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', tbl);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', tbl);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', tbl);
  END LOOP;
END $$;

-- Settings: admin-only (contains API credentials)
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE pol text;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='settings' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.settings', pol);
  END LOOP;
END $$;
CREATE POLICY "Admin read"   ON public.settings FOR SELECT TO authenticated USING  (public.has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "Admin insert" ON public.settings FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "Admin update" ON public.settings FOR UPDATE TO authenticated USING  (public.has_role(auth.uid(),'admin'::app_role)) WITH CHECK (public.has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "Admin delete" ON public.settings FOR DELETE TO authenticated USING  (public.has_role(auth.uid(),'admin'::app_role));
REVOKE ALL ON public.settings FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.settings TO authenticated;
GRANT ALL ON public.settings TO service_role;

-- Lock down the auth trigger function from public execution (only trigger fires it)
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
