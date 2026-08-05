-- Wastage AI retry support.
--
-- Lets an Admin retry AI processing for a failed pending-admin review row
-- without asking staff to upload the same image again. This does not approve,
-- reject, delete, or modify Daily Production data.

ALTER TABLE public.wastage_verification_events
  DROP CONSTRAINT IF EXISTS wastage_verification_events_event_type_check;

ALTER TABLE public.wastage_verification_events
  ADD CONSTRAINT wastage_verification_events_event_type_check CHECK (
    event_type IN (
      'submitted',
      'ai_processed',
      'ai_failed',
      'sent_to_admin',
      'approved',
      'rejected',
      'resubmission_requested',
      'ai_retry_requested'
    )
  );

CREATE OR REPLACE FUNCTION public.retry_wastage_ai_verification(_verification_id uuid)
RETURNS boolean
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

  SELECT * INTO v
  FROM public.wastage_verifications
  WHERE id = _verification_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Verification not found';
  END IF;

  IF v.workflow_status <> 'pending_admin' OR v.ai_result <> 'failed' THEN
    RAISE EXCEPTION 'Only failed pending-admin AI verifications can be retried';
  END IF;

  UPDATE public.wastage_verifications
  SET workflow_status = 'pending_ai',
      ai_result = NULL,
      ai_detected_weight = NULL,
      ai_detected_unit = NULL,
      ai_reading_quality = NULL,
      ai_error_code = NULL,
      ai_processed_at = NULL,
      ai_processing_started_at = NULL,
      -- Resetting the counter is intentional: a provider-side transient
      -- outage/rate-limit should not force staff to re-upload identical
      -- evidence once an Admin explicitly retries the same image.
      ai_attempt_count = 0,
      admin_decision_by = NULL,
      admin_decision_at = NULL,
      admin_decision_reason = NULL
  WHERE id = _verification_id;

  INSERT INTO public.wastage_verification_events (
    verification_id,
    actor_id,
    event_type,
    previous_status,
    new_status,
    reason
  )
  VALUES (
    _verification_id,
    auth.uid(),
    'ai_retry_requested',
    v.workflow_status,
    'pending_ai',
    'Admin retried failed AI processing'
  );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.retry_wastage_ai_verification(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retry_wastage_ai_verification(uuid) TO authenticated;
