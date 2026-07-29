
DROP POLICY IF EXISTS "Allow all" ON public.delivery_areas;
DROP POLICY IF EXISTS "Allow all" ON public.delivery_calculations;
DROP POLICY IF EXISTS "Allow all" ON public.reorder_alerts;

REVOKE ALL ON public.delivery_areas FROM anon;
REVOKE ALL ON public.delivery_calculations FROM anon;
REVOKE ALL ON public.reorder_alerts FROM anon;

CREATE POLICY "Admin/staff read delivery areas" ON public.delivery_areas
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));
CREATE POLICY "Admin/staff manage delivery areas" ON public.delivery_areas
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));

CREATE POLICY "Admin/staff read delivery calcs" ON public.delivery_calculations
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));
CREATE POLICY "Admin/staff manage delivery calcs" ON public.delivery_calculations
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));

CREATE POLICY "Admin/staff read reorder alerts" ON public.reorder_alerts
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));
CREATE POLICY "Admin/staff manage reorder alerts" ON public.reorder_alerts
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));
