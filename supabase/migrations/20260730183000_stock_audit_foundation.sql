-- Monthly physical stock audit foundation - normalized schema.
--
-- Single production-facility model for now: no facilities-management module
-- is created; a facility_name snapshot is stored per audit instead.
-- Quantities are stored in normalized rows, not JSONB blobs, so both
-- participants' original counts are preserved and comparable.

CREATE TABLE IF NOT EXISTS public.stock_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_date date NOT NULL,
  audit_type text NOT NULL,
  facility_name text NOT NULL DEFAULT 'Production Facility',
  status text NOT NULL DEFAULT 'open',
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  locked_at timestamptz,
  approval_notes text,
  CONSTRAINT stock_audits_audit_type_check CHECK (audit_type IN ('mid_month', 'month_end')),
  -- Clean state machine: open -> staff_submitted / management_submitted
  -- (whichever arrives first) -> ready_for_reconciliation (both arrived)
  -- -> locked. There is no separate 'approved' status: the final Admin
  -- function approves and locks atomically (approved_by/approved_at are
  -- still recorded on the same row), so a distinct 'approved' status
  -- would never be reachable and is intentionally not included here.
  CONSTRAINT stock_audits_status_check CHECK (
    status IN ('open', 'staff_submitted', 'management_submitted', 'ready_for_reconciliation', 'locked')
  ),
  CONSTRAINT stock_audits_unique_session UNIQUE (audit_date, audit_type)
);

CREATE INDEX IF NOT EXISTS idx_stock_audits_status ON public.stock_audits(status);

ALTER TABLE public.stock_audits ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.stock_audits FROM anon;
GRANT SELECT ON public.stock_audits TO authenticated;
GRANT ALL ON public.stock_audits TO service_role;

DROP POLICY IF EXISTS "Staff and admin view stock_audits" ON public.stock_audits;
CREATE POLICY "Staff and admin view stock_audits"
  ON public.stock_audits
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'staff'::public.app_role)
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
  );

DROP POLICY IF EXISTS "Moderator views stock_audits" ON public.stock_audits;
CREATE POLICY "Moderator views stock_audits"
  ON public.stock_audits
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'moderator'::public.app_role));

-- ---------------------------------------------------------------------
-- Immutable per-item system-stock snapshot, taken when the audit session
-- is created. Sourced from public.inventory.current_stock per Chunk 1
-- findings. public.inventory / stock_movements are never altered here.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.stock_audit_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid NOT NULL REFERENCES public.stock_audits(id) ON DELETE CASCADE,
  inventory_id uuid REFERENCES public.inventory(id) ON DELETE SET NULL,
  item_name_snapshot text NOT NULL,
  unit_snapshot text,
  system_quantity_snapshot numeric NOT NULL,
  reconciled_quantity numeric,
  variance_quantity numeric,
  reconciliation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_audit_items_unique_item UNIQUE (audit_id, inventory_id)
);

CREATE INDEX IF NOT EXISTS idx_stock_audit_items_audit_id ON public.stock_audit_items(audit_id);

ALTER TABLE public.stock_audit_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.stock_audit_items FROM anon;
GRANT SELECT ON public.stock_audit_items TO authenticated;
GRANT ALL ON public.stock_audit_items TO service_role;

DROP POLICY IF EXISTS "Staff and admin view stock_audit_items" ON public.stock_audit_items;
CREATE POLICY "Staff and admin view stock_audit_items"
  ON public.stock_audit_items
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'staff'::public.app_role)
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
  );

DROP POLICY IF EXISTS "Moderator views stock_audit_items" ON public.stock_audit_items;
CREATE POLICY "Moderator views stock_audit_items"
  ON public.stock_audit_items
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'moderator'::public.app_role));

-- ---------------------------------------------------------------------
-- One submission header per participant type per audit.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.stock_audit_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid NOT NULL REFERENCES public.stock_audits(id) ON DELETE CASCADE,
  participant_type text NOT NULL,
  submitted_by uuid NOT NULL REFERENCES auth.users(id),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  CONSTRAINT stock_audit_submissions_participant_type_check CHECK (participant_type IN ('staff', 'management')),
  CONSTRAINT stock_audit_submissions_unique_per_audit UNIQUE (audit_id, participant_type)
);

CREATE INDEX IF NOT EXISTS idx_stock_audit_submissions_audit_id ON public.stock_audit_submissions(audit_id);

ALTER TABLE public.stock_audit_submissions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.stock_audit_submissions FROM anon;
GRANT SELECT ON public.stock_audit_submissions TO authenticated;
GRANT ALL ON public.stock_audit_submissions TO service_role;

DROP POLICY IF EXISTS "Own or admin/moderator view stock_audit_submissions" ON public.stock_audit_submissions;
CREATE POLICY "Own or admin/moderator view stock_audit_submissions"
  ON public.stock_audit_submissions
  FOR SELECT TO authenticated
  USING (
    submitted_by = auth.uid()
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'moderator'::public.app_role)
  );

-- ---------------------------------------------------------------------
-- One physical count per inventory item per participant submission.
-- Both participants' original counts are preserved independently and are
-- never merged or overwritten during reconciliation.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.stock_audit_submission_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES public.stock_audit_submissions(id) ON DELETE CASCADE,
  audit_item_id uuid NOT NULL REFERENCES public.stock_audit_items(id) ON DELETE CASCADE,
  physical_quantity numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_audit_submission_items_quantity_check CHECK (physical_quantity >= 0),
  CONSTRAINT stock_audit_submission_items_unique UNIQUE (submission_id, audit_item_id)
);

CREATE INDEX IF NOT EXISTS idx_stock_audit_submission_items_submission_id ON public.stock_audit_submission_items(submission_id);

ALTER TABLE public.stock_audit_submission_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.stock_audit_submission_items FROM anon;
GRANT SELECT ON public.stock_audit_submission_items TO authenticated;
GRANT ALL ON public.stock_audit_submission_items TO service_role;

DROP POLICY IF EXISTS "Own or admin/moderator view stock_audit_submission_items" ON public.stock_audit_submission_items;
CREATE POLICY "Own or admin/moderator view stock_audit_submission_items"
  ON public.stock_audit_submission_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.stock_audit_submissions s
      WHERE s.id = submission_id AND s.submitted_by = auth.uid()
    )
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'moderator'::public.app_role)
  );

-- ---------------------------------------------------------------------
-- Append-only audit history
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.stock_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid NOT NULL REFERENCES public.stock_audits(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id),
  event_type text NOT NULL,
  previous_status text,
  new_status text NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_audit_events_event_type_check CHECK (
    event_type IN ('created', 'staff_submitted', 'management_submitted', 'reconciled', 'locked')
  )
);

CREATE INDEX IF NOT EXISTS idx_stock_audit_events_audit_id ON public.stock_audit_events(audit_id);

ALTER TABLE public.stock_audit_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.stock_audit_events FROM anon;
GRANT SELECT ON public.stock_audit_events TO authenticated;
GRANT ALL ON public.stock_audit_events TO service_role;

DROP POLICY IF EXISTS "Participant or admin/moderator view stock_audit_events" ON public.stock_audit_events;
CREATE POLICY "Participant or admin/moderator view stock_audit_events"
  ON public.stock_audit_events
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.stock_audit_submissions s
      WHERE s.audit_id = stock_audit_events.audit_id AND s.submitted_by = auth.uid()
    )
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'moderator'::public.app_role)
  );

-- ---------------------------------------------------------------------
-- Ensure/create the due audit session (Admin or Moderator). Idempotent:
-- returns the existing session if one already exists for that date/type.
-- Only valid for the 15th or the final calendar day of the month. Does
-- not require or activate any cron/scheduler.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ensure_due_stock_audit(_audit_date date)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  computed_type text;
  existing_id uuid;
  new_id uuid;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'moderator'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  IF extract(day FROM _audit_date)::int = 15 THEN
    computed_type := 'mid_month';
  ELSIF _audit_date = ((date_trunc('month', _audit_date) + interval '1 month - 1 day')::date) THEN
    computed_type := 'month_end';
  ELSE
    RAISE EXCEPTION 'The given date is not a mid-month (15th) or month-end audit date';
  END IF;

  SELECT id INTO existing_id
  FROM public.stock_audits
  WHERE audit_date = _audit_date AND audit_type = computed_type;

  IF FOUND THEN
    RETURN existing_id;
  END IF;

  INSERT INTO public.stock_audits (audit_date, audit_type, facility_name, status, created_by)
  VALUES (_audit_date, computed_type, 'Production Facility', 'open', auth.uid())
  RETURNING id INTO new_id;

  INSERT INTO public.stock_audit_items (audit_id, inventory_id, item_name_snapshot, unit_snapshot, system_quantity_snapshot)
  SELECT new_id, i.id, i.item_name, i.unit, COALESCE(i.current_stock, 0)
  FROM public.inventory i;

  INSERT INTO public.stock_audit_events (audit_id, actor_id, event_type, previous_status, new_status)
  VALUES (new_id, auth.uid(), 'created', NULL, 'open');

  RETURN new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_due_stock_audit(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_due_stock_audit(date) TO authenticated;

-- ---------------------------------------------------------------------
-- Staff physical-count submission. Hardened to require a complete
-- payload: every stock_audit_items row for this audit must appear
-- exactly once, quantities must be numeric and non-negative, and
-- duplicate/unknown item ids are rejected. All validation happens before
-- any row is written, so a failed item never leaves a partial submission
-- behind (and if an exception is raised, Postgres rolls back everything
-- this function call has done so far).
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.submit_stock_audit_staff_count(
  _audit_id uuid,
  _items jsonb,
  _notes text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  audit_row public.stock_audits%ROWTYPE;
  submission_id uuid;
  item jsonb;
  item_id uuid;
  item_qty numeric;
  submitted_ids uuid[] := ARRAY[]::uuid[];
  expected_count integer;
  distinct_count integer;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'staff'::public.app_role)
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT * INTO audit_row FROM public.stock_audits WHERE id = _audit_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stock audit not found';
  END IF;

  IF audit_row.status = 'locked' THEN
    RAISE EXCEPTION 'This audit is already reconciled and locked';
  END IF;

  IF EXISTS (SELECT 1 FROM public.stock_audit_submissions WHERE audit_id = _audit_id AND participant_type = 'staff') THEN
    RAISE EXCEPTION 'Staff have already submitted counts for this audit';
  END IF;

  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' THEN
    RAISE EXCEPTION 'Items must be a JSON array';
  END IF;

  IF jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'At least one item count is required';
  END IF;

  SELECT count(*) INTO expected_count FROM public.stock_audit_items WHERE audit_id = _audit_id;

  -- Validate the full payload (existence, type, duplicates, membership)
  -- before writing the submission header or any item row.
  FOR item IN SELECT * FROM jsonb_array_elements(_items)
  LOOP
    IF item->>'audit_item_id' IS NULL THEN
      RAISE EXCEPTION 'Each item requires an audit_item_id';
    END IF;

    BEGIN
      item_id := (item->>'audit_item_id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'audit_item_id must be a valid uuid';
    END;

    IF item_id = ANY(submitted_ids) THEN
      RAISE EXCEPTION 'Duplicate audit_item_id in submission: %', item_id;
    END IF;
    submitted_ids := array_append(submitted_ids, item_id);

    IF NOT EXISTS (SELECT 1 FROM public.stock_audit_items WHERE id = item_id AND audit_id = _audit_id) THEN
      RAISE EXCEPTION 'Item % does not belong to this audit', item_id;
    END IF;

    BEGIN
      item_qty := (item->>'physical_quantity')::numeric;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'physical_quantity must be numeric for item %', item_id;
    END;

    IF item_qty IS NULL OR item_qty < 0 THEN
      RAISE EXCEPTION 'physical_quantity must be zero or positive for item %', item_id;
    END IF;
  END LOOP;

  distinct_count := array_length(submitted_ids, 1);
  IF distinct_count <> expected_count THEN
    RAISE EXCEPTION 'Submission must include every audit item exactly once (expected %, got %)', expected_count, distinct_count;
  END IF;

  INSERT INTO public.stock_audit_submissions (audit_id, participant_type, submitted_by, notes)
  VALUES (_audit_id, 'staff', auth.uid(), _notes)
  RETURNING id INTO submission_id;

  FOR item IN SELECT * FROM jsonb_array_elements(_items)
  LOOP
    INSERT INTO public.stock_audit_submission_items (submission_id, audit_item_id, physical_quantity)
    VALUES (submission_id, (item->>'audit_item_id')::uuid, (item->>'physical_quantity')::numeric);
  END LOOP;

  UPDATE public.stock_audits
  SET status = CASE
    WHEN status IN ('management_submitted', 'ready_for_reconciliation') THEN 'ready_for_reconciliation'
    ELSE 'staff_submitted'
  END
  WHERE id = _audit_id;

  INSERT INTO public.stock_audit_events (audit_id, actor_id, event_type, previous_status, new_status)
  VALUES (_audit_id, auth.uid(), 'staff_submitted', audit_row.status,
    CASE WHEN audit_row.status IN ('management_submitted', 'ready_for_reconciliation') THEN 'ready_for_reconciliation' ELSE 'staff_submitted' END);

  RETURN submission_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_stock_audit_staff_count(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_stock_audit_staff_count(uuid, jsonb, text) TO authenticated;

-- ---------------------------------------------------------------------
-- Management (Admin or Moderator) physical-count submission. Same
-- completeness/validation hardening as the staff function above.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.submit_stock_audit_management_count(
  _audit_id uuid,
  _items jsonb,
  _notes text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  audit_row public.stock_audits%ROWTYPE;
  submission_id uuid;
  item jsonb;
  item_id uuid;
  item_qty numeric;
  submitted_ids uuid[] := ARRAY[]::uuid[];
  expected_count integer;
  distinct_count integer;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'moderator'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT * INTO audit_row FROM public.stock_audits WHERE id = _audit_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stock audit not found';
  END IF;

  IF audit_row.status = 'locked' THEN
    RAISE EXCEPTION 'This audit is already reconciled and locked';
  END IF;

  IF EXISTS (SELECT 1 FROM public.stock_audit_submissions WHERE audit_id = _audit_id AND participant_type = 'management') THEN
    RAISE EXCEPTION 'Management have already submitted counts for this audit';
  END IF;

  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' THEN
    RAISE EXCEPTION 'Items must be a JSON array';
  END IF;

  IF jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'At least one item count is required';
  END IF;

  SELECT count(*) INTO expected_count FROM public.stock_audit_items WHERE audit_id = _audit_id;

  FOR item IN SELECT * FROM jsonb_array_elements(_items)
  LOOP
    IF item->>'audit_item_id' IS NULL THEN
      RAISE EXCEPTION 'Each item requires an audit_item_id';
    END IF;

    BEGIN
      item_id := (item->>'audit_item_id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'audit_item_id must be a valid uuid';
    END;

    IF item_id = ANY(submitted_ids) THEN
      RAISE EXCEPTION 'Duplicate audit_item_id in submission: %', item_id;
    END IF;
    submitted_ids := array_append(submitted_ids, item_id);

    IF NOT EXISTS (SELECT 1 FROM public.stock_audit_items WHERE id = item_id AND audit_id = _audit_id) THEN
      RAISE EXCEPTION 'Item % does not belong to this audit', item_id;
    END IF;

    BEGIN
      item_qty := (item->>'physical_quantity')::numeric;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'physical_quantity must be numeric for item %', item_id;
    END;

    IF item_qty IS NULL OR item_qty < 0 THEN
      RAISE EXCEPTION 'physical_quantity must be zero or positive for item %', item_id;
    END IF;
  END LOOP;

  distinct_count := array_length(submitted_ids, 1);
  IF distinct_count <> expected_count THEN
    RAISE EXCEPTION 'Submission must include every audit item exactly once (expected %, got %)', expected_count, distinct_count;
  END IF;

  INSERT INTO public.stock_audit_submissions (audit_id, participant_type, submitted_by, notes)
  VALUES (_audit_id, 'management', auth.uid(), _notes)
  RETURNING id INTO submission_id;

  FOR item IN SELECT * FROM jsonb_array_elements(_items)
  LOOP
    INSERT INTO public.stock_audit_submission_items (submission_id, audit_item_id, physical_quantity)
    VALUES (submission_id, (item->>'audit_item_id')::uuid, (item->>'physical_quantity')::numeric);
  END LOOP;

  UPDATE public.stock_audits
  SET status = CASE
    WHEN status IN ('staff_submitted', 'ready_for_reconciliation') THEN 'ready_for_reconciliation'
    ELSE 'management_submitted'
  END
  WHERE id = _audit_id;

  INSERT INTO public.stock_audit_events (audit_id, actor_id, event_type, previous_status, new_status)
  VALUES (_audit_id, auth.uid(), 'management_submitted', audit_row.status,
    CASE WHEN audit_row.status IN ('staff_submitted', 'ready_for_reconciliation') THEN 'ready_for_reconciliation' ELSE 'management_submitted' END);

  RETURN submission_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_stock_audit_management_count(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_stock_audit_management_count(uuid, jsonb, text) TO authenticated;

-- ---------------------------------------------------------------------
-- Admin-only reconciliation and lock. Hardened to require:
--   - audit status is exactly 'ready_for_reconciliation' (both
--     submissions present and complete, guaranteed by the hardened
--     submit functions above);
--   - the reconciled-items payload is a non-empty JSON array covering
--     every audit item exactly once (partial/duplicate/unknown items
--     are rejected, and nothing is written until the full payload has
--     passed validation);
--   - a reconciliation_reason is required whenever the Staff and
--     Management counts differ from each other, the reconciled value
--     differs from either submitted count, or the reconciled value
--     differs from the system snapshot beyond the shared comparison
--     precision.
-- Both original participant submissions are read-only here and are
-- never modified. This is the only function that can lock an audit;
-- once locked, no submission/reconciliation function accepts further
-- writes for it. Moderator can submit the Management count (above) but
-- cannot call this function.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reconcile_and_lock_stock_audit(
  _audit_id uuid,
  _reconciled_items jsonb,
  _approval_notes text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  audit_row public.stock_audits%ROWTYPE;
  staff_submission_id uuid;
  management_submission_id uuid;
  expected_count integer;
  distinct_count integer;
  item jsonb;
  item_id uuid;
  reconciled numeric;
  reason text;
  audit_item_row public.stock_audit_items%ROWTYPE;
  staff_qty numeric;
  management_qty numeric;
  variance numeric;
  needs_reason boolean;
  submitted_ids uuid[] := ARRAY[]::uuid[];
  precision_kg numeric;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT * INTO audit_row FROM public.stock_audits WHERE id = _audit_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stock audit not found';
  END IF;

  IF audit_row.status = 'locked' THEN
    RAISE EXCEPTION 'This audit is already locked';
  END IF;

  IF audit_row.status <> 'ready_for_reconciliation' THEN
    RAISE EXCEPTION 'This audit is not ready for reconciliation (status is %)', audit_row.status;
  END IF;

  SELECT id INTO staff_submission_id FROM public.stock_audit_submissions WHERE audit_id = _audit_id AND participant_type = 'staff';
  IF staff_submission_id IS NULL THEN
    RAISE EXCEPTION 'Staff submission is missing';
  END IF;

  SELECT id INTO management_submission_id FROM public.stock_audit_submissions WHERE audit_id = _audit_id AND participant_type = 'management';
  IF management_submission_id IS NULL THEN
    RAISE EXCEPTION 'Management submission is missing';
  END IF;

  IF _reconciled_items IS NULL OR jsonb_typeof(_reconciled_items) <> 'array' THEN
    RAISE EXCEPTION 'Reconciled items must be a JSON array';
  END IF;

  IF jsonb_array_length(_reconciled_items) = 0 THEN
    RAISE EXCEPTION 'At least one reconciled item is required';
  END IF;

  SELECT count(*) INTO expected_count FROM public.stock_audit_items WHERE audit_id = _audit_id;
  precision_kg := public.operational_comparison_precision_kg();

  -- Validate the full reconciliation payload before writing anything.
  FOR item IN SELECT * FROM jsonb_array_elements(_reconciled_items)
  LOOP
    IF item->>'audit_item_id' IS NULL THEN
      RAISE EXCEPTION 'Each reconciled item requires an audit_item_id';
    END IF;

    BEGIN
      item_id := (item->>'audit_item_id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'audit_item_id must be a valid uuid';
    END;

    IF item_id = ANY(submitted_ids) THEN
      RAISE EXCEPTION 'Duplicate reconciled audit_item_id: %', item_id;
    END IF;
    submitted_ids := array_append(submitted_ids, item_id);

    IF NOT EXISTS (SELECT 1 FROM public.stock_audit_items WHERE id = item_id AND audit_id = _audit_id) THEN
      RAISE EXCEPTION 'Item % does not belong to this audit', item_id;
    END IF;

    BEGIN
      reconciled := (item->>'reconciled_quantity')::numeric;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'reconciled_quantity must be numeric for item %', item_id;
    END;

    IF reconciled IS NULL OR reconciled < 0 THEN
      RAISE EXCEPTION 'reconciled_quantity must be zero or positive for item %', item_id;
    END IF;
  END LOOP;

  distinct_count := array_length(submitted_ids, 1);
  IF distinct_count <> expected_count THEN
    RAISE EXCEPTION 'Reconciliation must cover every audit item exactly once (expected %, got %)', expected_count, distinct_count;
  END IF;

  -- All validation passed. Apply the reconciliation per item, requiring a
  -- reason wherever the participants' counts differ or the reconciled
  -- value differs from either submitted count or the system snapshot.
  FOR item IN SELECT * FROM jsonb_array_elements(_reconciled_items)
  LOOP
    item_id := (item->>'audit_item_id')::uuid;
    reconciled := (item->>'reconciled_quantity')::numeric;
    reason := item->>'reconciliation_reason';

    SELECT * INTO audit_item_row FROM public.stock_audit_items WHERE id = item_id;

    SELECT sasi.physical_quantity INTO staff_qty
    FROM public.stock_audit_submission_items sasi
    WHERE sasi.submission_id = staff_submission_id AND sasi.audit_item_id = item_id;

    SELECT sasi.physical_quantity INTO management_qty
    FROM public.stock_audit_submission_items sasi
    WHERE sasi.submission_id = management_submission_id AND sasi.audit_item_id = item_id;

    IF staff_qty IS NULL OR management_qty IS NULL THEN
      RAISE EXCEPTION 'Both Staff and Management counts are required for item % before reconciliation', audit_item_row.item_name_snapshot;
    END IF;

    variance := reconciled - audit_item_row.system_quantity_snapshot;

    needs_reason := (
      abs(staff_qty - management_qty) > precision_kg
      OR abs(reconciled - staff_qty) > precision_kg
      OR abs(reconciled - management_qty) > precision_kg
      OR abs(variance) > precision_kg
    );

    IF needs_reason AND (reason IS NULL OR length(trim(reason)) = 0) THEN
      RAISE EXCEPTION 'A reconciliation reason is required for item % because counts differ or vary from system stock', audit_item_row.item_name_snapshot;
    END IF;

    UPDATE public.stock_audit_items
    SET reconciled_quantity = reconciled,
        variance_quantity = variance,
        reconciliation_reason = reason
    WHERE id = item_id;

    IF abs(variance) > precision_kg THEN
      PERFORM public.raise_operational_alert(
        'stock_variance', 'stock_audit_item', item_id, 'warning',
        format('Physical stock variance detected for %s during %s audit', audit_item_row.item_name_snapshot, audit_row.audit_type),
        audit_item_row.system_quantity_snapshot, reconciled, variance, audit_item_row.unit_snapshot
      );
    END IF;
  END LOOP;

  INSERT INTO public.stock_audit_events (audit_id, actor_id, event_type, previous_status, new_status, reason)
  VALUES (_audit_id, auth.uid(), 'reconciled', audit_row.status, audit_row.status, _approval_notes);

  UPDATE public.stock_audits
  SET status = 'locked',
      approved_by = auth.uid(),
      approved_at = now(),
      locked_at = now(),
      approval_notes = _approval_notes
  WHERE id = _audit_id;

  INSERT INTO public.stock_audit_events (audit_id, actor_id, event_type, previous_status, new_status, reason)
  VALUES (_audit_id, auth.uid(), 'locked', audit_row.status, 'locked', _approval_notes);
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_and_lock_stock_audit(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_and_lock_stock_audit(uuid, jsonb, text) TO authenticated;
