-- Chunk 4, item A: wastage over-threshold alerting.
--
-- Business rule (owner-provided): standard expected wastage is ~60% of raw
-- material input; if actual approved wastage exceeds expected + tolerance,
-- raise an operational alert. These are editable business-rule settings,
-- kept deliberately separate from operational_comparison_precision_kg()
-- (a fixed technical comparison precision, not a business rule).
--
-- This migration is additive only:
--   - widens the operational_alerts_alert_type_check constraint to allow
--     two new alert types (no existing rows/values are touched);
--   - adds a new singleton settings table;
--   - redefines approve_wastage_verification() (CREATE OR REPLACE, same
--     signature) to add the new comparison, without changing any existing
--     behavior it already had (uploader-cannot-self-approve, the existing
--     wastage_variance alert, event logging, etc. are all preserved
--     verbatim).
--
-- Does not touch public.daily_production, its columns, defaults or
-- formula. Does not touch production.tsx. The comparison reads only the
-- already-snapshotted raw_input_kg_snapshot on wastage_verifications and
-- the Admin-approved staff_entered_weight/unit - it does not read or
-- write daily_production at all.

ALTER TABLE public.operational_alerts DROP CONSTRAINT IF EXISTS operational_alerts_alert_type_check;
ALTER TABLE public.operational_alerts ADD CONSTRAINT operational_alerts_alert_type_check CHECK (
  alert_type IN (
    'wastage_variance',
    'ai_weight_mismatch',
    'ai_unreadable',
    'ai_processing_failed',
    'wastage_rejected',
    'stock_variance',
    'audit_missed',
    'audit_incomplete',
    'wastage_over_threshold',
    'wastage_under_threshold'
  )
);

-- ---------------------------------------------------------------------
-- Editable business-rule settings (singleton). Admin/Moderator can read;
-- only Admin can update. Not exposed to Staff/Investor/Viewer.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.wastage_alert_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expected_wastage_percent numeric NOT NULL DEFAULT 60,
  wastage_tolerance_points numeric NOT NULL DEFAULT 5,
  -- Default OFF per explicit instruction: flags suspiciously LOW wastage
  -- (possible under-reporting). Must not be enabled without approval.
  low_wastage_alert_enabled boolean NOT NULL DEFAULT false,
  low_wastage_tolerance_points numeric NOT NULL DEFAULT 10,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wastage_alert_settings_expected_check CHECK (expected_wastage_percent >= 0 AND expected_wastage_percent <= 99),
  CONSTRAINT wastage_alert_settings_tolerance_check CHECK (wastage_tolerance_points >= 0 AND wastage_tolerance_points <= 40),
  CONSTRAINT wastage_alert_settings_low_tolerance_check CHECK (low_wastage_tolerance_points >= 0 AND low_wastage_tolerance_points <= 40)
);

CREATE UNIQUE INDEX IF NOT EXISTS wastage_alert_settings_singleton
  ON public.wastage_alert_settings ((true));

INSERT INTO public.wastage_alert_settings (
  id, expected_wastage_percent, wastage_tolerance_points, low_wastage_alert_enabled, low_wastage_tolerance_points
)
VALUES (
  '00000000-0000-4000-8000-000000000002', 60, 5, false, 10
)
ON CONFLICT DO NOTHING;

DROP TRIGGER IF EXISTS wastage_alert_settings_touch_updated_at ON public.wastage_alert_settings;
CREATE TRIGGER wastage_alert_settings_touch_updated_at
  BEFORE UPDATE ON public.wastage_alert_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.wastage_alert_settings ENABLE ROW LEVEL SECURITY;

-- Explicit REVOKE ALL before granting only SELECT: this Supabase project
-- has a database-level default privilege that auto-grants ALL on new
-- tables to authenticated/anon (see the Chunk 3 grant-hardening
-- migration) - revoke it up front rather than relying on RLS alone.
REVOKE ALL ON public.wastage_alert_settings FROM anon, authenticated;
GRANT SELECT ON public.wastage_alert_settings TO authenticated;
GRANT ALL ON public.wastage_alert_settings TO service_role;

DROP POLICY IF EXISTS "Admin and moderator read wastage_alert_settings" ON public.wastage_alert_settings;
CREATE POLICY "Admin and moderator read wastage_alert_settings"
  ON public.wastage_alert_settings
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'moderator'::public.app_role)
  );

-- No direct UPDATE policy/grant to authenticated: this singleton is
-- updated only via the service-role connection (mirrors the pattern used
-- for other settings tables in this repo) until an Admin-only settings
-- UI/RPC is added for it.

-- ---------------------------------------------------------------------
-- Redefine approve_wastage_verification() to add the over/under-threshold
-- comparison. Everything above the new block is identical to the
-- existing (already-executed) function body.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.approve_wastage_verification(_verification_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v public.wastage_verifications%ROWTYPE;
  actual_kg numeric;
  variance_kg numeric;
  s public.wastage_alert_settings%ROWTYPE;
  actual_percent numeric;
  over_threshold_percent numeric;
  under_threshold_percent numeric;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT * INTO v FROM public.wastage_verifications WHERE id = _verification_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Verification not found';
  END IF;

  IF v.uploaded_by = auth.uid() THEN
    RAISE EXCEPTION 'The uploader cannot approve their own submission';
  END IF;

  IF v.workflow_status <> 'pending_admin' THEN
    RAISE EXCEPTION 'Verification is not awaiting admin approval';
  END IF;

  UPDATE public.wastage_verifications
  SET workflow_status = 'approved',
      admin_decision_by = auth.uid(),
      admin_decision_at = now(),
      admin_decision_reason = NULL
  WHERE id = _verification_id;

  INSERT INTO public.wastage_verification_events (verification_id, actor_id, event_type, previous_status, new_status)
  VALUES (_verification_id, auth.uid(), 'approved', 'pending_admin', 'approved');

  actual_kg := CASE WHEN v.staff_entered_unit = 'g' THEN v.staff_entered_weight / 1000 ELSE v.staff_entered_weight END;
  variance_kg := actual_kg - v.expected_wastage_kg_snapshot;

  IF abs(variance_kg) > public.operational_comparison_precision_kg() THEN
    PERFORM public.raise_operational_alert(
      'wastage_variance', 'wastage_verification', _verification_id, 'warning',
      'Approved actual wastage differs from the expected/reference wastage for this batch',
      v.expected_wastage_kg_snapshot, actual_kg, variance_kg, 'kg'
    );
  END IF;

  -- Business-rule over/under-threshold check (Chunk 4, item A). Reads
  -- only wastage_verifications' own snapshot (raw_input_kg_snapshot) and
  -- the just-approved actual weight - daily_production is never read or
  -- written here.
  SELECT * INTO s FROM public.wastage_alert_settings LIMIT 1;
  IF FOUND AND v.raw_input_kg_snapshot > 0 THEN
    actual_percent := (actual_kg / v.raw_input_kg_snapshot) * 100;
    over_threshold_percent := s.expected_wastage_percent + s.wastage_tolerance_points;

    IF actual_percent > over_threshold_percent THEN
      PERFORM public.raise_operational_alert(
        'wastage_over_threshold', 'wastage_verification', _verification_id, 'warning',
        format(
          'Actual wastage %s%% exceeds the expected %s%% + %s point tolerance (threshold %s%%)',
          round(actual_percent, 2), s.expected_wastage_percent, s.wastage_tolerance_points, round(over_threshold_percent, 2)
        ),
        over_threshold_percent, actual_percent, actual_percent - over_threshold_percent, '%'
      );
    ELSIF s.low_wastage_alert_enabled THEN
      under_threshold_percent := s.expected_wastage_percent - s.low_wastage_tolerance_points;
      IF actual_percent < under_threshold_percent THEN
        PERFORM public.raise_operational_alert(
          'wastage_under_threshold', 'wastage_verification', _verification_id, 'info',
          format(
            'Actual wastage %s%% is below the expected %s%% - %s point tolerance (possible under-reporting)',
            round(actual_percent, 2), s.expected_wastage_percent, s.low_wastage_tolerance_points
          ),
          under_threshold_percent, actual_percent, actual_percent - under_threshold_percent, '%'
        );
      END IF;
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_wastage_verification(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_wastage_verification(uuid) TO authenticated;
