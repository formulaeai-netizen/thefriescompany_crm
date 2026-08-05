-- Dedicated operational alerts table for wastage verification and stock
-- audit findings. This is intentionally separate from public.reorder_alerts
-- (which is a client reorder-lapse log, not an operational/stock alert) and
-- is not reused or modified.

CREATE TABLE IF NOT EXISTS public.operational_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type text NOT NULL,
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  severity text NOT NULL DEFAULT 'warning',
  message text NOT NULL,
  expected_value numeric,
  actual_value numeric,
  variance_value numeric,
  unit text,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_by uuid REFERENCES auth.users(id),
  resolved_at timestamptz,
  resolution_notes text,
  CONSTRAINT operational_alerts_alert_type_check CHECK (
    alert_type IN (
      'wastage_variance',
      'ai_weight_mismatch',
      'ai_unreadable',
      'ai_processing_failed',
      'wastage_rejected',
      'stock_variance',
      'audit_missed',
      'audit_incomplete'
    )
  ),
  CONSTRAINT operational_alerts_severity_check CHECK (severity IN ('info', 'warning', 'critical')),
  CONSTRAINT operational_alerts_status_check CHECK (status IN ('open', 'resolved')),
  CONSTRAINT operational_alerts_resolution_check CHECK (
    (status = 'open' AND resolved_by IS NULL AND resolved_at IS NULL AND resolution_notes IS NULL)
    OR
    (status = 'resolved' AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL AND resolution_notes IS NOT NULL AND length(trim(resolution_notes)) > 0)
  )
);

-- Only one active (unresolved) alert per distinct source event.
CREATE UNIQUE INDEX IF NOT EXISTS idx_operational_alerts_active_source
  ON public.operational_alerts (alert_type, source_type, source_id)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_operational_alerts_status ON public.operational_alerts(status);
CREATE INDEX IF NOT EXISTS idx_operational_alerts_source ON public.operational_alerts(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_operational_alerts_created_at ON public.operational_alerts(created_at);

ALTER TABLE public.operational_alerts ENABLE ROW LEVEL SECURITY;

-- Authenticated clients get SELECT only (subject to the RLS policies
-- below). There is no table-level UPDATE grant: resolution is only
-- possible through the controlled resolve_operational_alert() function,
-- which runs as SECURITY DEFINER and therefore does not need a client
-- UPDATE privilege to do its work.
REVOKE ALL ON public.operational_alerts FROM anon;
GRANT SELECT ON public.operational_alerts TO authenticated;
GRANT ALL ON public.operational_alerts TO service_role;

DROP POLICY IF EXISTS "Admin reads operational_alerts" ON public.operational_alerts;
CREATE POLICY "Admin reads operational_alerts"
  ON public.operational_alerts
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Moderator reads operational_alerts" ON public.operational_alerts;
CREATE POLICY "Moderator reads operational_alerts"
  ON public.operational_alerts
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'moderator'::public.app_role));

-- Resolution must go through the controlled resolve_operational_alert()
-- function below so resolution_notes are always enforced. No UPDATE
-- policy exists for public.operational_alerts and no UPDATE privilege is
-- granted to authenticated (see GRANT above), so a direct client UPDATE
-- is rejected by Postgres before RLS is even evaluated. Investor, Staff
-- and Viewer have no SELECT policy on this table either, so they get no
-- general alert access at all.

-- Technical comparison precision (NOT a business tolerance) shared by the
-- wastage-verification and stock-audit variance checks in the other
-- Chunk 2 migrations. Centralized here instead of scattering the literal
-- 0.01 value across multiple SQL functions and TypeScript files. A wider
-- operational tolerance can be introduced later, but only after explicit
-- business approval - this correction pass does not change the value.
CREATE OR REPLACE FUNCTION public.operational_comparison_precision_kg()
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 0.01::numeric
$$;

REVOKE ALL ON FUNCTION public.operational_comparison_precision_kg() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operational_comparison_precision_kg() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.resolve_operational_alert(_alert_id uuid, _resolution_notes text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'moderator'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  IF _resolution_notes IS NULL OR length(trim(_resolution_notes)) = 0 THEN
    RAISE EXCEPTION 'Resolution notes are required';
  END IF;

  UPDATE public.operational_alerts
  SET status = 'resolved',
      resolved_by = auth.uid(),
      resolved_at = now(),
      resolution_notes = _resolution_notes
  WHERE id = _alert_id
    AND status = 'open';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Alert not found or already resolved';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_operational_alert(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_operational_alert(uuid, text) TO authenticated;

-- Internal helper used by wastage/stock-audit functions (SECURITY DEFINER)
-- to raise a non-duplicate alert. Not directly callable by authenticated
-- clients; only reachable through other SECURITY DEFINER functions in this
-- schema.
CREATE OR REPLACE FUNCTION public.raise_operational_alert(
  _alert_type text,
  _source_type text,
  _source_id uuid,
  _severity text,
  _message text,
  _expected_value numeric,
  _actual_value numeric,
  _variance_value numeric,
  _unit text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.operational_alerts (
    alert_type, source_type, source_id, severity, message,
    expected_value, actual_value, variance_value, unit
  )
  VALUES (
    _alert_type, _source_type, _source_id, _severity, _message,
    _expected_value, _actual_value, _variance_value, _unit
  )
  ON CONFLICT DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.raise_operational_alert(text, text, uuid, text, text, numeric, numeric, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.raise_operational_alert(text, text, uuid, text, text, numeric, numeric, numeric, text) TO service_role;
