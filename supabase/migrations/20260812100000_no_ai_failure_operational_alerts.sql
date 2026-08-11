-- Stop generating Operational Alerts for unsuccessful AI verification reads.
--
-- AI failures/unreadable images should stay in the Wastage Verifications
-- review queue for retry/admin action, but they should not create noisy
-- Operational Alert rows. A successful AI read that detects a real weight
-- mismatch still raises `ai_weight_mismatch`.

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

  -- AI never gives final approval: every outcome still moves to mandatory
  -- Admin review. Failed/unreadable results intentionally do not create
  -- Operational Alerts; the review queue is the actionable surface.
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
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.record_wastage_ai_result(uuid, text, numeric, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_wastage_ai_result(uuid, text, numeric, text, text, text) TO service_role;
