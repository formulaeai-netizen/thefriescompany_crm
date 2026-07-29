-- Restrict returns and damaged_stock tables to admin/staff roles

-- returns
DROP POLICY IF EXISTS "Authenticated read" ON public.returns;
DROP POLICY IF EXISTS "Authenticated insert" ON public.returns;
DROP POLICY IF EXISTS "Authenticated update" ON public.returns;
DROP POLICY IF EXISTS "Authenticated delete" ON public.returns;

CREATE POLICY "Admin/staff can view returns"
  ON public.returns FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff'));
CREATE POLICY "Admin/staff can insert returns"
  ON public.returns FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff'));
CREATE POLICY "Admin/staff can update returns"
  ON public.returns FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff'));
CREATE POLICY "Admin/staff can delete returns"
  ON public.returns FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff'));

-- damaged_stock
DROP POLICY IF EXISTS "Authenticated read" ON public.damaged_stock;
DROP POLICY IF EXISTS "Authenticated insert" ON public.damaged_stock;
DROP POLICY IF EXISTS "Authenticated update" ON public.damaged_stock;
DROP POLICY IF EXISTS "Authenticated delete" ON public.damaged_stock;

CREATE POLICY "Admin/staff can view damaged_stock"
  ON public.damaged_stock FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff'));
CREATE POLICY "Admin/staff can insert damaged_stock"
  ON public.damaged_stock FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff'));
CREATE POLICY "Admin/staff can update damaged_stock"
  ON public.damaged_stock FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff'));
CREATE POLICY "Admin/staff can delete damaged_stock"
  ON public.damaged_stock FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff'));
