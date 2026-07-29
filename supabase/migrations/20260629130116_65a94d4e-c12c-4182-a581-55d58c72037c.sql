
-- Roles -----------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin', 'investor');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users read own roles" ON public.user_roles;
CREATE POLICY "users read own roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

DROP POLICY IF EXISTS "admins manage roles" ON public.user_roles;
CREATE POLICY "admins manage roles" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Seed all current auth.users as admin (single-tenant bootstrap)
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::public.app_role FROM auth.users
ON CONFLICT (user_id, role) DO NOTHING;

-- Investors ------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.investors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text UNIQUE NOT NULL,
  phone text,
  investment_amount numeric NOT NULL,
  roi_percentage numeric NOT NULL,
  investment_date date NOT NULL,
  investment_end_date date NOT NULL,
  duration_years numeric NOT NULL,
  status text NOT NULL DEFAULT 'Active',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.investors TO authenticated;
GRANT ALL ON public.investors TO service_role;
ALTER TABLE public.investors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins manage investors" ON public.investors;
CREATE POLICY "admins manage investors" ON public.investors
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "investor reads own row" ON public.investors;
CREATE POLICY "investor reads own row" ON public.investors
  FOR SELECT TO authenticated
  USING (lower(email) = lower(coalesce((auth.jwt() ->> 'email')::text, '')));

-- Investor returns -----------------------------------------------
CREATE TABLE IF NOT EXISTS public.investor_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  investor_id uuid NOT NULL REFERENCES public.investors(id) ON DELETE CASCADE,
  month date NOT NULL,
  net_profit numeric NOT NULL DEFAULT 0,
  return_amount numeric NOT NULL DEFAULT 0,
  return_percentage numeric NOT NULL DEFAULT 0,
  paid boolean NOT NULL DEFAULT false,
  paid_date date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (investor_id, month)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.investor_returns TO authenticated;
GRANT ALL ON public.investor_returns TO service_role;
ALTER TABLE public.investor_returns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins manage returns" ON public.investor_returns;
CREATE POLICY "admins manage returns" ON public.investor_returns
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "investor reads own returns" ON public.investor_returns;
CREATE POLICY "investor reads own returns" ON public.investor_returns
  FOR SELECT TO authenticated
  USING (
    investor_id IN (
      SELECT id FROM public.investors
      WHERE lower(email) = lower(coalesce((auth.jwt() ->> 'email')::text, ''))
    )
  );

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS investors_touch_updated_at ON public.investors;
CREATE TRIGGER investors_touch_updated_at
  BEFORE UPDATE ON public.investors
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
