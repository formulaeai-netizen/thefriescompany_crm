-- Wastage scale-image verification foundation.
--
-- IMPORTANT: this migration does not touch public.daily_production and does
-- not change the existing Wastage % field, its default, or its formula.
-- public.daily_production.id is used directly as the production/batch
-- reference; no separate production_batches table is created.

CREATE TABLE IF NOT EXISTS public.wastage_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- ON DELETE RESTRICT (not CASCADE): a production row with existing
  -- wastage evidence/history must not be silently deletable. Deleting it
  -- while verification rows reference it must fail until the historical
  -- dependency is handled explicitly.
  daily_production_id uuid NOT NULL REFERENCES public.daily_production(id) ON DELETE RESTRICT,

  staff_entered_weight numeric NOT NULL,
  staff_entered_unit text NOT NULL,
  image_storage_path text NOT NULL,
  uploaded_by uuid NOT NULL REFERENCES auth.users(id),
  uploaded_at timestamptz NOT NULL DEFAULT now(),

  -- Snapshots of the production record at submission time so this
  -- verification stays historically accurate even if the daily_production
  -- row is later viewed/changed.
  raw_input_kg_snapshot numeric NOT NULL,
  wastage_percent_snapshot numeric NOT NULL,
  expected_wastage_kg_snapshot numeric NOT NULL,

  -- Prepared for Chunk 3. No raw model response is stored - only the
  -- specific extracted/validated fields.
  ai_result text,
  ai_detected_weight numeric,
  ai_detected_unit text,
  ai_reading_quality text,
  ai_error_code text,
  ai_attempt_count integer NOT NULL DEFAULT 0,
  ai_processed_at timestamptz,
  -- Set only while workflow_status = 'ai_processing'. Lets a stuck/crashed
  -- attempt become retry-eligible after 10 minutes without ever allowing
  -- two concurrent requests to both hold a successful claim.
  ai_processing_started_at timestamptz,

  workflow_status text NOT NULL DEFAULT 'pending_ai',
  admin_decision_by uuid REFERENCES auth.users(id),
  admin_decision_at timestamptz,
  admin_decision_reason text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT wastage_verifications_image_path_unique UNIQUE (image_storage_path),

  CONSTRAINT wastage_verifications_staff_weight_check CHECK (staff_entered_weight > 0),
  CONSTRAINT wastage_verifications_staff_unit_check CHECK (staff_entered_unit IN ('kg', 'g')),
  CONSTRAINT wastage_verifications_ai_unit_check CHECK (ai_detected_unit IS NULL OR ai_detected_unit IN ('kg', 'g')),
  CONSTRAINT wastage_verifications_ai_weight_check CHECK (ai_detected_weight IS NULL OR ai_detected_weight > 0),

  CONSTRAINT wastage_verifications_raw_input_check CHECK (raw_input_kg_snapshot > 0),
  CONSTRAINT wastage_verifications_wastage_pct_check CHECK (wastage_percent_snapshot >= 0 AND wastage_percent_snapshot <= 99),
  CONSTRAINT wastage_verifications_expected_wastage_check CHECK (expected_wastage_kg_snapshot >= 0),

  CONSTRAINT wastage_verifications_ai_result_check CHECK (ai_result IS NULL OR ai_result IN ('match', 'mismatch', 'unreadable', 'failed')),
  CONSTRAINT wastage_verifications_ai_quality_check CHECK (ai_reading_quality IS NULL OR ai_reading_quality IN ('clear', 'partial', 'unreadable')),

  CONSTRAINT wastage_verifications_workflow_status_check CHECK (
    workflow_status IN ('pending_ai', 'ai_processing', 'pending_admin', 'approved', 'rejected', 'resubmission_required')
  ),

  -- AI must have processed the row before it can leave pending_ai/ai_processing.
  CONSTRAINT wastage_verifications_ai_processed_check CHECK (
    (workflow_status IN ('pending_ai', 'ai_processing') AND ai_processed_at IS NULL)
    OR (workflow_status NOT IN ('pending_ai', 'ai_processing') AND ai_processed_at IS NOT NULL)
  ),

  -- ai_result and ai_processed_at must move together: no result recorded
  -- means no processing has completed yet.
  CONSTRAINT wastage_verifications_ai_result_processed_check CHECK (
    (ai_result IS NULL AND ai_processed_at IS NULL)
    OR (ai_result IS NOT NULL AND ai_processed_at IS NOT NULL)
  ),

  -- ai_attempt_count is incremented only by a successful
  -- claim_wastage_ai_processing() claim (at claim time, not at result time),
  -- so it can already be >= 1 while ai_result is still NULL (mid-processing
  -- or a stuck/abandoned attempt). Capped at the approved maximum of 2.
  CONSTRAINT wastage_verifications_ai_attempt_count_check CHECK (ai_attempt_count >= 0 AND ai_attempt_count <= 2),

  -- ai_processing_started_at is populated exactly while a claim is held.
  CONSTRAINT wastage_verifications_ai_processing_started_check CHECK (
    (workflow_status = 'ai_processing' AND ai_processing_started_at IS NOT NULL)
    OR (workflow_status <> 'ai_processing' AND ai_processing_started_at IS NULL)
  ),

  -- Entering ai_processing always happens through a successful claim, which
  -- increments ai_attempt_count in the same transaction.
  CONSTRAINT wastage_verifications_ai_processing_attempt_check CHECK (
    workflow_status <> 'ai_processing' OR ai_attempt_count >= 1
  ),

  -- Consistent AI-result state combinations. The AI must never fabricate a
  -- reading: match/mismatch require an actual positive detected weight and
  -- unit with a clear/partial reading quality and no error code; unreadable
  -- requires reading_quality = 'unreadable' and forbids a detected
  -- weight/unit (nothing was confidently read); failed requires a non-empty
  -- error code and forbids any detected weight/unit/reading quality (the
  -- image was never assessed).
  CONSTRAINT wastage_verifications_ai_state_check CHECK (
    ai_result IS NULL
    OR (
      ai_result IN ('match', 'mismatch')
      AND ai_detected_weight IS NOT NULL AND ai_detected_weight > 0
      AND ai_detected_unit IN ('kg', 'g')
      AND ai_reading_quality IN ('clear', 'partial')
      AND ai_error_code IS NULL
    )
    OR (
      ai_result = 'unreadable'
      AND ai_reading_quality = 'unreadable'
      AND ai_detected_weight IS NULL
      AND ai_detected_unit IS NULL
      AND ai_error_code IS NULL
    )
    OR (
      ai_result = 'failed'
      AND ai_error_code IS NOT NULL AND length(trim(ai_error_code)) > 0
      AND ai_detected_weight IS NULL
      AND ai_detected_unit IS NULL
      AND ai_reading_quality IS NULL
    )
  ),

  -- Admin decision fields are only ever populated together with the status
  -- that requires them, and reject/resubmission always carry a reason.
  CONSTRAINT wastage_verifications_admin_decision_check CHECK (
    (workflow_status IN ('pending_ai', 'ai_processing', 'pending_admin')
      AND admin_decision_by IS NULL AND admin_decision_at IS NULL)
    OR (workflow_status = 'approved'
      AND admin_decision_by IS NOT NULL AND admin_decision_at IS NOT NULL)
    OR (workflow_status IN ('rejected', 'resubmission_required')
      AND admin_decision_by IS NOT NULL AND admin_decision_at IS NOT NULL
      AND admin_decision_reason IS NOT NULL AND length(trim(admin_decision_reason)) > 0)
  )
);

-- Only one simultaneously active submission per production/batch record.
-- 'rejected' and 'resubmission_required' are terminal for that row; a
-- resubmission creates a new row rather than overwriting this one.
CREATE UNIQUE INDEX IF NOT EXISTS idx_wastage_verifications_active_per_production
  ON public.wastage_verifications (daily_production_id)
  WHERE workflow_status IN ('pending_ai', 'ai_processing', 'pending_admin', 'approved');

CREATE INDEX IF NOT EXISTS idx_wastage_verifications_daily_production_id ON public.wastage_verifications(daily_production_id);
CREATE INDEX IF NOT EXISTS idx_wastage_verifications_uploaded_by ON public.wastage_verifications(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_wastage_verifications_workflow_status ON public.wastage_verifications(workflow_status);

DROP TRIGGER IF EXISTS wastage_verifications_touch_updated_at ON public.wastage_verifications;
CREATE TRIGGER wastage_verifications_touch_updated_at
  BEFORE UPDATE ON public.wastage_verifications
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.wastage_verifications ENABLE ROW LEVEL SECURITY;

-- No direct INSERT/UPDATE is granted to authenticated users. All writes go
-- through the SECURITY DEFINER functions below so validation, snapshotting,
-- duplicate-prevention and history logging cannot be bypassed.
REVOKE ALL ON public.wastage_verifications FROM anon;
GRANT SELECT ON public.wastage_verifications TO authenticated;
GRANT ALL ON public.wastage_verifications TO service_role;

DROP POLICY IF EXISTS "Staff view own wastage_verifications" ON public.wastage_verifications;
CREATE POLICY "Staff view own wastage_verifications"
  ON public.wastage_verifications
  FOR SELECT TO authenticated
  USING (uploaded_by = auth.uid());

DROP POLICY IF EXISTS "Admin views all wastage_verifications" ON public.wastage_verifications;
CREATE POLICY "Admin views all wastage_verifications"
  ON public.wastage_verifications
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Moderator views all wastage_verifications" ON public.wastage_verifications;
CREATE POLICY "Moderator views all wastage_verifications"
  ON public.wastage_verifications
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'moderator'::public.app_role));

-- ---------------------------------------------------------------------
-- Event history (append-only). No DELETE/UPDATE is granted to
-- authenticated at all, so critical evidence/history cannot silently
-- disappear once a submission or decision event has been recorded.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.wastage_verification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  verification_id uuid NOT NULL REFERENCES public.wastage_verifications(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id),
  event_type text NOT NULL,
  previous_status text,
  new_status text NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wastage_verification_events_event_type_check CHECK (
    event_type IN ('submitted', 'ai_processed', 'ai_failed', 'sent_to_admin', 'approved', 'rejected', 'resubmission_requested')
  )
);

CREATE INDEX IF NOT EXISTS idx_wastage_verification_events_verification_id ON public.wastage_verification_events(verification_id);

ALTER TABLE public.wastage_verification_events ENABLE ROW LEVEL SECURITY;

-- Append-only: no INSERT/UPDATE/DELETE grants to authenticated. Rows are
-- only ever written by the SECURITY DEFINER functions in this migration.
REVOKE ALL ON public.wastage_verification_events FROM anon;
GRANT SELECT ON public.wastage_verification_events TO authenticated;
GRANT ALL ON public.wastage_verification_events TO service_role;

DROP POLICY IF EXISTS "Staff view own wastage_verification_events" ON public.wastage_verification_events;
CREATE POLICY "Staff view own wastage_verification_events"
  ON public.wastage_verification_events
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.wastage_verifications wv
      WHERE wv.id = verification_id AND wv.uploaded_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admin views all wastage_verification_events" ON public.wastage_verification_events;
CREATE POLICY "Admin views all wastage_verification_events"
  ON public.wastage_verification_events
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Moderator views all wastage_verification_events" ON public.wastage_verification_events;
CREATE POLICY "Moderator views all wastage_verification_events"
  ON public.wastage_verification_events
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'moderator'::public.app_role));

-- ---------------------------------------------------------------------
-- Private storage bucket for scale-reading photos (no upload happens
-- here). Hardened with a size limit and a restricted MIME allowlist: the
-- repository has no pre-existing upload-size/MIME standard (the
-- payment-proofs bucket set neither), so this uses an explicit 8 MB
-- maximum and practical scale-photo formats only.
-- ---------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'wastage-scale-images', 'wastage-scale-images', false,
  8388608, -- 8 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Staff or admin upload own wastage scale images" ON storage.objects;
CREATE POLICY "Staff or admin upload own wastage scale images"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'wastage-scale-images'
    AND (public.has_role(auth.uid(), 'staff'::public.app_role) OR public.has_role(auth.uid(), 'admin'::public.app_role))
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Uploader reads own wastage scale images" ON storage.objects;
CREATE POLICY "Uploader reads own wastage scale images"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'wastage-scale-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Admin reads all wastage scale images" ON storage.objects;
CREATE POLICY "Admin reads all wastage scale images"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'wastage-scale-images'
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
  );

-- Intentionally no UPDATE/DELETE storage policy is created for
-- authenticated users: submitted evidence cannot be overwritten or deleted
-- by staff, admin or moderator (moderator additionally has no SELECT
-- policy on this bucket at all, so it gets no private-evidence access
-- either). Only service_role (used for future controlled server-side
-- processing) retains full access via its superuser-equivalent bypass
-- of RLS.

-- ---------------------------------------------------------------------
-- Controlled submission function (Staff or Admin)
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.submit_wastage_verification(
  _daily_production_id uuid,
  _staff_entered_weight numeric,
  _staff_entered_unit text,
  _image_storage_path text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  prod public.daily_production%ROWTYPE;
  expected_kg numeric;
  new_id uuid;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'staff'::public.app_role)
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  IF _staff_entered_weight IS NULL OR _staff_entered_weight <= 0 THEN
    RAISE EXCEPTION 'Weight must be a positive number';
  END IF;

  IF _staff_entered_unit NOT IN ('kg', 'g') THEN
    RAISE EXCEPTION 'Unit must be kg or g';
  END IF;

  IF _image_storage_path IS NULL OR length(trim(_image_storage_path)) = 0 THEN
    RAISE EXCEPTION 'Image path is required';
  END IF;

  IF (storage.foldername(_image_storage_path))[1] <> auth.uid()::text THEN
    RAISE EXCEPTION 'Image path must be within the caller''s own folder';
  END IF;

  -- The referenced object must actually exist in the private bucket at
  -- exactly this path, so a nonexistent path (or another user's path,
  -- already blocked above) can never create a verification record.
  IF NOT EXISTS (
    SELECT 1 FROM storage.objects
    WHERE bucket_id = 'wastage-scale-images'
      AND name = _image_storage_path
  ) THEN
    RAISE EXCEPTION 'The referenced image does not exist in the wastage-scale-images bucket';
  END IF;

  SELECT * INTO prod FROM public.daily_production WHERE id = _daily_production_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Production record not found';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.wastage_verifications
    WHERE daily_production_id = _daily_production_id
      AND workflow_status IN ('pending_ai', 'ai_processing', 'pending_admin', 'approved')
  ) THEN
    RAISE EXCEPTION 'This production record already has an active wastage verification';
  END IF;

  expected_kg := prod.raw_input_kg * prod.wastage_percent / 100;

  INSERT INTO public.wastage_verifications (
    daily_production_id, staff_entered_weight, staff_entered_unit,
    image_storage_path, uploaded_by,
    raw_input_kg_snapshot, wastage_percent_snapshot, expected_wastage_kg_snapshot
  )
  VALUES (
    _daily_production_id, _staff_entered_weight, _staff_entered_unit,
    _image_storage_path, auth.uid(),
    prod.raw_input_kg, prod.wastage_percent, expected_kg
  )
  RETURNING id INTO new_id;

  INSERT INTO public.wastage_verification_events (verification_id, actor_id, event_type, previous_status, new_status)
  VALUES (new_id, auth.uid(), 'submitted', NULL, 'pending_ai');

  RETURN new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_wastage_verification(uuid, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_wastage_verification(uuid, numeric, text, text) TO authenticated;

-- ---------------------------------------------------------------------
-- Atomic AI-processing claim (service_role only). Prevents two concurrent
-- server requests from both charging the OpenAI API for the same
-- verification: the row is locked with SELECT ... FOR UPDATE, so a second
-- concurrent caller blocks until the first transaction commits, then sees
-- the already-updated status and fails the eligibility check. A first
-- attempt is claimable from 'pending_ai'. A stuck/crashed attempt becomes
-- retry-eligible from 'ai_processing' once its claim is older than 10
-- minutes. At most 2 attempts total are ever allowed. Returns whether the
-- claim succeeded; it never raises for an ordinary "already claimed" or
-- "attempts exhausted" case, so callers can handle it without treating it
-- as an error. Not exposed to Staff browser code - only service_role can
-- execute it, so retry control is never reachable from the client.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.claim_wastage_ai_processing(_verification_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v public.wastage_verifications%ROWTYPE;
  stale_cutoff timestamptz := now() - interval '10 minutes';
BEGIN
  SELECT * INTO v FROM public.wastage_verifications WHERE id = _verification_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v.ai_attempt_count >= 2 THEN
    RETURN false;
  END IF;

  IF v.workflow_status = 'pending_ai' THEN
    -- First attempt: always eligible.
    NULL;
  ELSIF v.workflow_status = 'ai_processing' AND v.ai_processing_started_at < stale_cutoff THEN
    -- Prior attempt is stuck/abandoned: eligible for one controlled retry.
    NULL;
  ELSE
    RETURN false;
  END IF;

  UPDATE public.wastage_verifications
  SET workflow_status = 'ai_processing',
      ai_processing_started_at = now(),
      ai_attempt_count = ai_attempt_count + 1
  WHERE id = _verification_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_wastage_ai_processing(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_wastage_ai_processing(uuid) TO service_role;

-- ---------------------------------------------------------------------
-- Record AI result (service_role only). No raw model response is accepted
-- or stored. Inputs are validated against the same combinations enforced
-- by wastage_verifications_ai_state_check so a caller gets a clear error
-- instead of a raw constraint-violation. Only accepts a record that
-- currently holds a successful ai_processing claim - ai_attempt_count was
-- already incremented at claim time, so it is not incremented again here.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.record_wastage_ai_result(
  _verification_id uuid,
  _ai_result text,
  _ai_detected_weight numeric,
  _ai_detected_unit text,
  _ai_reading_quality text,
  _ai_error_code text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v public.wastage_verifications%ROWTYPE;
  staff_kg numeric;
  ai_kg numeric;
  variance_kg numeric;
  event_type_value text;
BEGIN
  IF _ai_result NOT IN ('match', 'mismatch', 'unreadable', 'failed') THEN
    RAISE EXCEPTION 'Invalid ai_result value';
  END IF;

  IF _ai_result IN ('match', 'mismatch') THEN
    IF _ai_detected_weight IS NULL OR _ai_detected_weight <= 0 THEN
      RAISE EXCEPTION 'A % result requires a positive detected weight', _ai_result;
    END IF;
    IF _ai_detected_unit IS NULL OR _ai_detected_unit NOT IN ('kg', 'g') THEN
      RAISE EXCEPTION 'A % result requires a valid detected unit (kg or g)', _ai_result;
    END IF;
    IF _ai_reading_quality IS NULL OR _ai_reading_quality NOT IN ('clear', 'partial') THEN
      RAISE EXCEPTION 'A % result requires a clear or partial reading quality', _ai_result;
    END IF;
    IF _ai_error_code IS NOT NULL THEN
      RAISE EXCEPTION 'A % result must not carry an error code', _ai_result;
    END IF;
  ELSIF _ai_result = 'unreadable' THEN
    IF _ai_reading_quality IS DISTINCT FROM 'unreadable' THEN
      RAISE EXCEPTION 'An unreadable result requires ai_reading_quality = unreadable';
    END IF;
    IF _ai_detected_weight IS NOT NULL OR _ai_detected_unit IS NOT NULL THEN
      RAISE EXCEPTION 'An unreadable result must not include a fabricated detected weight/unit';
    END IF;
  ELSIF _ai_result = 'failed' THEN
    IF _ai_error_code IS NULL OR length(trim(_ai_error_code)) = 0 THEN
      RAISE EXCEPTION 'A failed result requires a non-empty error code';
    END IF;
    IF _ai_detected_weight IS NOT NULL OR _ai_detected_unit IS NOT NULL OR _ai_reading_quality IS NOT NULL THEN
      RAISE EXCEPTION 'A failed result must not include a detected weight, unit or reading quality';
    END IF;
  END IF;

  SELECT * INTO v FROM public.wastage_verifications WHERE id = _verification_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Verification not found';
  END IF;

  IF v.workflow_status <> 'ai_processing' THEN
    RAISE EXCEPTION 'Verification does not currently hold an AI-processing claim';
  END IF;

  UPDATE public.wastage_verifications
  SET ai_result = _ai_result,
      ai_detected_weight = _ai_detected_weight,
      ai_detected_unit = _ai_detected_unit,
      ai_reading_quality = _ai_reading_quality,
      ai_error_code = _ai_error_code,
      ai_processed_at = now(),
      ai_processing_started_at = NULL,
      workflow_status = 'pending_admin'
  WHERE id = _verification_id;

  -- AI never gives final approval: every outcome (including a processing
  -- failure) still moves to mandatory Admin review.
  event_type_value := CASE WHEN _ai_result = 'failed' THEN 'ai_failed' ELSE 'ai_processed' END;

  INSERT INTO public.wastage_verification_events (verification_id, actor_id, event_type, previous_status, new_status)
  VALUES (_verification_id, NULL, event_type_value, 'ai_processing', 'pending_admin');

  IF _ai_result = 'mismatch' THEN
    staff_kg := CASE WHEN v.staff_entered_unit = 'g' THEN v.staff_entered_weight / 1000 ELSE v.staff_entered_weight END;
    ai_kg := CASE WHEN _ai_detected_unit = 'g' THEN _ai_detected_weight / 1000 ELSE _ai_detected_weight END;
    variance_kg := ai_kg - staff_kg;
    PERFORM public.raise_operational_alert(
      'ai_weight_mismatch', 'wastage_verification', _verification_id, 'warning',
      'AI-detected scale weight does not match Staff-entered weight',
      staff_kg, ai_kg, variance_kg, 'kg'
    );
  ELSIF _ai_result = 'unreadable' THEN
    PERFORM public.raise_operational_alert(
      'ai_unreadable', 'wastage_verification', _verification_id, 'warning',
      'AI could not reliably read the weighing-scale image', NULL, NULL, NULL, NULL
    );
  ELSIF _ai_result = 'failed' THEN
    PERFORM public.raise_operational_alert(
      'ai_processing_failed', 'wastage_verification', _verification_id, 'critical',
      'AI processing failed for this wastage verification', NULL, NULL, NULL, NULL
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.record_wastage_ai_result(uuid, text, numeric, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_wastage_ai_result(uuid, text, numeric, text, text, text) TO service_role;

-- ---------------------------------------------------------------------
-- Admin-only final decision functions
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
END;
$$;

REVOKE ALL ON FUNCTION public.approve_wastage_verification(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_wastage_verification(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_wastage_verification(_verification_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v public.wastage_verifications%ROWTYPE;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  IF _reason IS NULL OR length(trim(_reason)) = 0 THEN
    RAISE EXCEPTION 'A rejection reason is required';
  END IF;

  SELECT * INTO v FROM public.wastage_verifications WHERE id = _verification_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Verification not found';
  END IF;

  IF v.uploaded_by = auth.uid() THEN
    RAISE EXCEPTION 'The uploader cannot decide on their own submission';
  END IF;

  IF v.workflow_status <> 'pending_admin' THEN
    RAISE EXCEPTION 'Verification is not awaiting admin approval';
  END IF;

  UPDATE public.wastage_verifications
  SET workflow_status = 'rejected',
      admin_decision_by = auth.uid(),
      admin_decision_at = now(),
      admin_decision_reason = _reason
  WHERE id = _verification_id;

  INSERT INTO public.wastage_verification_events (verification_id, actor_id, event_type, previous_status, new_status, reason)
  VALUES (_verification_id, auth.uid(), 'rejected', 'pending_admin', 'rejected', _reason);

  PERFORM public.raise_operational_alert(
    'wastage_rejected', 'wastage_verification', _verification_id, 'info',
    'Admin rejected this wastage verification submission', NULL, NULL, NULL, NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reject_wastage_verification(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_wastage_verification(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.request_resubmission_wastage_verification(_verification_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v public.wastage_verifications%ROWTYPE;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  IF _reason IS NULL OR length(trim(_reason)) = 0 THEN
    RAISE EXCEPTION 'A resubmission reason is required';
  END IF;

  SELECT * INTO v FROM public.wastage_verifications WHERE id = _verification_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Verification not found';
  END IF;

  IF v.uploaded_by = auth.uid() THEN
    RAISE EXCEPTION 'The uploader cannot decide on their own submission';
  END IF;

  IF v.workflow_status <> 'pending_admin' THEN
    RAISE EXCEPTION 'Verification is not awaiting admin approval';
  END IF;

  UPDATE public.wastage_verifications
  SET workflow_status = 'resubmission_required',
      admin_decision_by = auth.uid(),
      admin_decision_at = now(),
      admin_decision_reason = _reason
  WHERE id = _verification_id;

  INSERT INTO public.wastage_verification_events (verification_id, actor_id, event_type, previous_status, new_status, reason)
  VALUES (_verification_id, auth.uid(), 'resubmission_requested', 'pending_admin', 'resubmission_required', _reason);
END;
$$;

REVOKE ALL ON FUNCTION public.request_resubmission_wastage_verification(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_resubmission_wastage_verification(uuid, text) TO authenticated;
