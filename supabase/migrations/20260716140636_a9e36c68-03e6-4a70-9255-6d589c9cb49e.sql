DROP POLICY IF EXISTS "Authenticated can view products" ON public.products;

CREATE POLICY "Admin/staff can view products"
ON public.products
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));