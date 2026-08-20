-- Public investor interest is deliberately separate from the authenticated investor portfolio.
CREATE TABLE IF NOT EXISTS public.investor_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  contact text NOT NULL CHECK (length(trim(contact)) > 0),
  city text NOT NULL CHECK (length(trim(city)) > 0),
  interest_amount numeric NOT NULL CHECK (interest_amount > 0),
  message text,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','meeting','due_diligence','negotiation','invested','declined')),
  owner_user_id uuid REFERENCES auth.users(id),
  next_follow_up_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.investor_lead_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  investor_lead_id uuid NOT NULL REFERENCES public.investor_leads(id) ON DELETE CASCADE,
  activity_type text NOT NULL CHECK (activity_type IN ('note','call','meeting','follow_up','document_shared')),
  notes text,
  next_follow_up_at timestamptz,
  performed_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.operations_recommendation_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_key text NOT NULL,
  action text NOT NULL CHECK (action IN ('acknowledged','dismissed')),
  acted_by uuid NOT NULL REFERENCES auth.users(id),
  acted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recommendation_key, acted_by)
);
CREATE INDEX IF NOT EXISTS idx_investor_leads_status_follow_up ON public.investor_leads(status, next_follow_up_at);

ALTER TABLE public.investor_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investor_lead_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operations_recommendation_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can submit investor interest" ON public.investor_leads;
CREATE POLICY "Public can submit investor interest" ON public.investor_leads FOR INSERT TO anon, authenticated WITH CHECK (status = 'new' AND owner_user_id IS NULL AND notes IS NULL);
DROP POLICY IF EXISTS "Admins manage investor leads" ON public.investor_leads;
CREATE POLICY "Admins manage investor leads" ON public.investor_leads FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "Admins manage investor lead activities" ON public.investor_lead_activities;
CREATE POLICY "Admins manage investor lead activities" ON public.investor_lead_activities FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "Admins manage recommendation actions" ON public.operations_recommendation_actions;
CREATE POLICY "Admins manage recommendation actions" ON public.operations_recommendation_actions FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

REVOKE ALL ON public.investor_leads, public.investor_lead_activities, public.operations_recommendation_actions FROM anon, authenticated;
GRANT INSERT ON public.investor_leads TO anon, authenticated;
GRANT SELECT, UPDATE, DELETE ON public.investor_leads TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.investor_lead_activities, public.operations_recommendation_actions TO authenticated;

CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS investor_leads_set_updated_at ON public.investor_leads;
CREATE TRIGGER investor_leads_set_updated_at BEFORE UPDATE ON public.investor_leads FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.create_investor_interest_notification() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.create_notification_for_roles(
    ARRAY['admin'::public.app_role], 'investor_alerts', 'High', 'New investor interest',
    'A new investment interest submission requires review.', '/investor-leads', 'investor_lead', NEW.id,
    'investor-interest:' || NEW.id::text
  );
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS investor_interest_notification_created ON public.investor_leads;
CREATE TRIGGER investor_interest_notification_created AFTER INSERT ON public.investor_leads FOR EACH ROW EXECUTE FUNCTION public.create_investor_interest_notification();
REVOKE ALL ON FUNCTION public.create_investor_interest_notification() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_investor_interest_notification() TO service_role;
