-- Phase 5A: AI Business Watchdog foundation.
-- The watchdog stores advisory anomaly alerts only. It never mutates
-- expenses, ledger, accounts, payroll, invoices, stock, payments or approvals.

ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS ai_watchdog_alerts boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.ai_watchdog_settings (
  module text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT true,
  minimum_history_count integer NOT NULL DEFAULT 3,
  percentage_threshold numeric NOT NULL DEFAULT 35,
  minimum_absolute_pkr_variance numeric NOT NULL DEFAULT 500,
  cooldown_hours integer NOT NULL DEFAULT 24,
  high_severity_percentage numeric NOT NULL DEFAULT 50,
  critical_severity_percentage numeric NOT NULL DEFAULT 100,
  severity_thresholds jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id),
  CONSTRAINT ai_watchdog_settings_module_check CHECK (
    module IN (
      'expenses',
      'cash_bank',
      'inventory',
      'credit_supplier',
      'invoice_receivables',
      'payroll'
    )
  ),
  CONSTRAINT ai_watchdog_settings_history_check CHECK (minimum_history_count >= 1),
  CONSTRAINT ai_watchdog_settings_percentage_check CHECK (percentage_threshold >= 0),
  CONSTRAINT ai_watchdog_settings_abs_check CHECK (minimum_absolute_pkr_variance >= 0),
  CONSTRAINT ai_watchdog_settings_cooldown_check CHECK (cooldown_hours >= 1)
);

INSERT INTO public.ai_watchdog_settings (module)
VALUES
  ('expenses'),
  ('cash_bank'),
  ('inventory'),
  ('credit_supplier'),
  ('invoice_receivables'),
  ('payroll')
ON CONFLICT (module) DO NOTHING;

DROP TRIGGER IF EXISTS ai_watchdog_settings_touch_updated_at ON public.ai_watchdog_settings;
CREATE TRIGGER ai_watchdog_settings_touch_updated_at
  BEFORE UPDATE ON public.ai_watchdog_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.ai_watchdog_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_watchdog_settings FROM anon, authenticated;
GRANT SELECT ON public.ai_watchdog_settings TO authenticated;
GRANT ALL ON public.ai_watchdog_settings TO service_role;

DROP POLICY IF EXISTS "Admins read ai_watchdog_settings" ON public.ai_watchdog_settings;
CREATE POLICY "Admins read ai_watchdog_settings"
  ON public.ai_watchdog_settings FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE TABLE IF NOT EXISTS public.ai_watchdog_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module text NOT NULL,
  anomaly_type text NOT NULL,
  severity text NOT NULL DEFAULT 'medium',
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  actual_value numeric NOT NULL,
  expected_value numeric,
  absolute_variance numeric,
  percentage_variance numeric,
  detection_method text NOT NULL,
  deterministic_reason text NOT NULL,
  ai_explanation text,
  recommendation text,
  status text NOT NULL DEFAULT 'new',
  detected_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id),
  dedupe_key text NOT NULL UNIQUE,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_watchdog_alerts_module_check CHECK (
    module IN (
      'expenses',
      'cash_bank',
      'inventory',
      'credit_supplier',
      'invoice_receivables',
      'payroll'
    )
  ),
  CONSTRAINT ai_watchdog_alerts_severity_check CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT ai_watchdog_alerts_method_check CHECK (detection_method IN ('deterministic', 'statistical')),
  CONSTRAINT ai_watchdog_alerts_status_check CHECK (status IN ('new', 'reviewed', 'dismissed', 'resolved')),
  CONSTRAINT ai_watchdog_alerts_reason_not_blank CHECK (length(trim(deterministic_reason)) > 0),
  CONSTRAINT ai_watchdog_alerts_dedupe_not_blank CHECK (length(trim(dedupe_key)) > 0),
  CONSTRAINT ai_watchdog_alerts_review_state_check CHECK (
    (status = 'new' AND reviewed_at IS NULL AND reviewed_by IS NULL)
    OR
    (status <> 'new' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_ai_watchdog_alerts_status_detected
  ON public.ai_watchdog_alerts (status, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_watchdog_alerts_module_severity
  ON public.ai_watchdog_alerts (module, severity, status);
CREATE INDEX IF NOT EXISTS idx_ai_watchdog_alerts_source
  ON public.ai_watchdog_alerts (source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_ai_watchdog_alerts_unresolved_important
  ON public.ai_watchdog_alerts (detected_at DESC)
  WHERE status IN ('new', 'reviewed') AND severity IN ('high', 'critical');

DROP TRIGGER IF EXISTS ai_watchdog_alerts_touch_updated_at ON public.ai_watchdog_alerts;
CREATE TRIGGER ai_watchdog_alerts_touch_updated_at
  BEFORE UPDATE ON public.ai_watchdog_alerts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.ai_watchdog_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_watchdog_alerts FROM anon, authenticated;
GRANT SELECT ON public.ai_watchdog_alerts TO authenticated;
GRANT ALL ON public.ai_watchdog_alerts TO service_role;

DROP POLICY IF EXISTS "Admins read ai_watchdog_alerts" ON public.ai_watchdog_alerts;
CREATE POLICY "Admins read ai_watchdog_alerts"
  ON public.ai_watchdog_alerts FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Moderators read operational ai_watchdog_alerts" ON public.ai_watchdog_alerts;
CREATE POLICY "Moderators read operational ai_watchdog_alerts"
  ON public.ai_watchdog_alerts FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'moderator'::public.app_role)
    AND module = 'inventory'
    AND anomaly_type IN ('low_stock', 'stock_variance_spike')
  );

DROP POLICY IF EXISTS "Staff read permitted ai_watchdog_alerts" ON public.ai_watchdog_alerts;
CREATE POLICY "Staff read permitted ai_watchdog_alerts"
  ON public.ai_watchdog_alerts FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'staff'::public.app_role)
    AND module = 'inventory'
    AND anomaly_type = 'low_stock'
  );

CREATE OR REPLACE FUNCTION public.review_ai_watchdog_alert(
  _alert_id uuid,
  _status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF _status NOT IN ('reviewed', 'dismissed', 'resolved') THEN
    RAISE EXCEPTION 'Invalid watchdog status';
  END IF;

  UPDATE public.ai_watchdog_alerts
  SET status = _status,
      reviewed_at = now(),
      reviewed_by = auth.uid()
  WHERE id = _alert_id
    AND status <> _status;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'AI watchdog alert not found or already in requested status';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_ai_watchdog_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  notification_severity text := CASE
    WHEN NEW.severity = 'critical' THEN 'Critical'
    WHEN NEW.severity = 'high' THEN 'High'
    WHEN NEW.severity = 'medium' THEN 'Medium'
    ELSE 'Low'
  END;
BEGIN
  IF NEW.severity IN ('high', 'critical') THEN
    PERFORM public.create_notification_for_roles(
      ARRAY['admin'::public.app_role],
      'ai_watchdog',
      notification_severity,
      'AI Watchdog Alert',
      NEW.deterministic_reason,
      '/ai-watchdog?alert_id=' || NEW.id::text,
      'ai_watchdog_alert',
      NEW.id,
      'ai-watchdog:' || NEW.id::text
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ai_watchdog_alert_notification_created ON public.ai_watchdog_alerts;
CREATE TRIGGER ai_watchdog_alert_notification_created
  AFTER INSERT ON public.ai_watchdog_alerts
  FOR EACH ROW EXECUTE FUNCTION public.create_ai_watchdog_notification();

REVOKE ALL ON FUNCTION public.review_ai_watchdog_alert(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_ai_watchdog_notification() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_ai_watchdog_alert(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_ai_watchdog_notification() TO service_role;
