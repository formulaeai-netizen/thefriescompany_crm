-- Remove leftover broad authenticated policies from operational tables
DROP POLICY IF EXISTS "Authenticated can read delivery_areas" ON public.delivery_areas;
DROP POLICY IF EXISTS "Authenticated can insert delivery_areas" ON public.delivery_areas;
DROP POLICY IF EXISTS "Authenticated can update delivery_areas" ON public.delivery_areas;
DROP POLICY IF EXISTS "Authenticated can delete delivery_areas" ON public.delivery_areas;

DROP POLICY IF EXISTS "Authenticated can read delivery_calculations" ON public.delivery_calculations;
DROP POLICY IF EXISTS "Authenticated can insert delivery_calculations" ON public.delivery_calculations;
DROP POLICY IF EXISTS "Authenticated can update delivery_calculations" ON public.delivery_calculations;
DROP POLICY IF EXISTS "Authenticated can delete delivery_calculations" ON public.delivery_calculations;

DROP POLICY IF EXISTS "Authenticated can read reorder_alerts" ON public.reorder_alerts;
DROP POLICY IF EXISTS "Authenticated can insert reorder_alerts" ON public.reorder_alerts;
DROP POLICY IF EXISTS "Authenticated can update reorder_alerts" ON public.reorder_alerts;
DROP POLICY IF EXISTS "Authenticated can delete reorder_alerts" ON public.reorder_alerts;

-- Ensure anonymous users cannot access these operational tables through the data API
REVOKE ALL ON public.delivery_areas FROM anon;
REVOKE ALL ON public.delivery_calculations FROM anon;
REVOKE ALL ON public.reorder_alerts FROM anon;

-- Tighten investor self-service reads so a matching email is not enough; the user must also have the investor role
DROP POLICY IF EXISTS "investor reads own row" ON public.investors;
CREATE POLICY "investor reads own row"
ON public.investors
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'investor'::public.app_role)
  AND lower(email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
);

DROP POLICY IF EXISTS "investor reads own returns" ON public.investor_returns;
CREATE POLICY "investor reads own returns"
ON public.investor_returns
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'investor'::public.app_role)
  AND investor_id IN (
    SELECT investors.id
    FROM public.investors
    WHERE lower(investors.email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
  )
);

-- Profile rows are created by backend automation/admins only; regular users should not self-insert arbitrary profile rows
DROP POLICY IF EXISTS "profiles admin insert" ON public.profiles;
CREATE POLICY "profiles admin insert"
ON public.profiles
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));