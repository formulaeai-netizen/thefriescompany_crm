-- Prompt 2, item D: credit inventory purchase foundation (backend only -
-- no reminders are sent, no worker wiring). A supplier name field is used
-- instead of a full supplier-management module, per instruction.

CREATE TABLE IF NOT EXISTS public.credit_inventory_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_name text NOT NULL,
  inventory_item_id uuid REFERENCES public.inventory(id) ON DELETE SET NULL,
  item_name_snapshot text NOT NULL,
  quantity numeric,
  unit text,
  amount_due numeric NOT NULL,
  purchased_at timestamptz NOT NULL DEFAULT now(),
  due_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'unpaid',
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  reminder_lead_hours integer NOT NULL DEFAULT 24,
  reminder_queued_at timestamptz,
  reminder_sent_at timestamptz,
  CONSTRAINT credit_inventory_purchases_status_check CHECK (status IN ('unpaid', 'paid', 'cancelled')),
  CONSTRAINT credit_inventory_purchases_amount_check CHECK (amount_due > 0),
  CONSTRAINT credit_inventory_purchases_lead_hours_check CHECK (reminder_lead_hours > 0 AND reminder_lead_hours <= 720),
  CONSTRAINT credit_inventory_purchases_paid_state_check CHECK (
    (status = 'paid') = (paid_at IS NOT NULL)
  ),
  CONSTRAINT credit_inventory_purchases_cancelled_state_check CHECK (
    (status = 'cancelled') = (cancelled_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_credit_inventory_purchases_status ON public.credit_inventory_purchases (status);
CREATE INDEX IF NOT EXISTS idx_credit_inventory_purchases_due_at ON public.credit_inventory_purchases (due_at);
-- Due-reminder eligibility scan: unpaid, not yet queued.
CREATE INDEX IF NOT EXISTS idx_credit_inventory_purchases_reminder_pending
  ON public.credit_inventory_purchases (due_at)
  WHERE status = 'unpaid' AND reminder_queued_at IS NULL;

DROP TRIGGER IF EXISTS credit_inventory_purchases_touch_updated_at ON public.credit_inventory_purchases;
CREATE TRIGGER credit_inventory_purchases_touch_updated_at
  BEFORE UPDATE ON public.credit_inventory_purchases
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.credit_inventory_purchases ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.credit_inventory_purchases FROM anon, authenticated;
GRANT SELECT ON public.credit_inventory_purchases TO authenticated;
GRANT ALL ON public.credit_inventory_purchases TO service_role;

DROP POLICY IF EXISTS "Admin and staff read credit_inventory_purchases" ON public.credit_inventory_purchases;
CREATE POLICY "Admin and staff read credit_inventory_purchases"
  ON public.credit_inventory_purchases FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'staff'::public.app_role)
    OR public.has_role(auth.uid(), 'moderator'::public.app_role)
  );

-- No INSERT/UPDATE/DELETE grant to authenticated - all writes go through
-- the controlled RPCs below, matching the existing repository pattern.

CREATE OR REPLACE FUNCTION public.create_credit_inventory_purchase(
  _supplier_name text,
  _item_name_snapshot text,
  _amount_due numeric,
  _due_at timestamptz,
  _inventory_item_id uuid DEFAULT NULL,
  _quantity numeric DEFAULT NULL,
  _unit text DEFAULT NULL,
  _notes text DEFAULT NULL,
  _reminder_lead_hours integer DEFAULT 24
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id uuid;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'staff'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  IF _supplier_name IS NULL OR length(trim(_supplier_name)) = 0 THEN
    RAISE EXCEPTION 'Supplier name is required';
  END IF;
  IF _item_name_snapshot IS NULL OR length(trim(_item_name_snapshot)) = 0 THEN
    RAISE EXCEPTION 'Item name is required';
  END IF;
  IF _amount_due IS NULL OR _amount_due <= 0 THEN
    RAISE EXCEPTION 'Amount due must be positive';
  END IF;
  IF _due_at IS NULL THEN
    RAISE EXCEPTION 'Due date/time is required';
  END IF;

  INSERT INTO public.credit_inventory_purchases (
    supplier_name, inventory_item_id, item_name_snapshot, quantity, unit,
    amount_due, due_at, notes, created_by, reminder_lead_hours
  ) VALUES (
    trim(_supplier_name), _inventory_item_id, trim(_item_name_snapshot), _quantity, _unit,
    _amount_due, _due_at, _notes, auth.uid(), COALESCE(_reminder_lead_hours, 24)
  )
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_credit_inventory_purchase(
  _purchase_id uuid,
  _supplier_name text,
  _item_name_snapshot text,
  _amount_due numeric,
  _due_at timestamptz,
  _inventory_item_id uuid DEFAULT NULL,
  _quantity numeric DEFAULT NULL,
  _unit text DEFAULT NULL,
  _notes text DEFAULT NULL,
  _reminder_lead_hours integer DEFAULT 24
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row_status text;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'staff'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT status INTO row_status FROM public.credit_inventory_purchases WHERE id = _purchase_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Credit inventory purchase not found';
  END IF;
  IF row_status <> 'unpaid' THEN
    RAISE EXCEPTION 'Only unpaid purchases can be edited';
  END IF;
  IF _amount_due IS NULL OR _amount_due <= 0 THEN
    RAISE EXCEPTION 'Amount due must be positive';
  END IF;
  IF _due_at IS NULL THEN
    RAISE EXCEPTION 'Due date/time is required';
  END IF;

  UPDATE public.credit_inventory_purchases
  SET supplier_name = trim(_supplier_name),
      inventory_item_id = _inventory_item_id,
      item_name_snapshot = trim(_item_name_snapshot),
      quantity = _quantity,
      unit = _unit,
      amount_due = _amount_due,
      due_at = _due_at,
      notes = _notes,
      reminder_lead_hours = COALESCE(_reminder_lead_hours, 24)
  WHERE id = _purchase_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_credit_inventory_purchase_paid(_purchase_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row_status text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT status INTO row_status FROM public.credit_inventory_purchases WHERE id = _purchase_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Credit inventory purchase not found';
  END IF;
  IF row_status <> 'unpaid' THEN
    RAISE EXCEPTION 'Only unpaid purchases can be marked paid';
  END IF;

  UPDATE public.credit_inventory_purchases
  SET status = 'paid', paid_at = now()
  WHERE id = _purchase_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_credit_inventory_purchase(_purchase_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row_status text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  IF _reason IS NULL OR length(trim(_reason)) = 0 THEN
    RAISE EXCEPTION 'A cancellation reason is required';
  END IF;

  SELECT status INTO row_status FROM public.credit_inventory_purchases WHERE id = _purchase_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Credit inventory purchase not found';
  END IF;
  IF row_status <> 'unpaid' THEN
    RAISE EXCEPTION 'Only unpaid purchases can be cancelled';
  END IF;

  UPDATE public.credit_inventory_purchases
  SET status = 'cancelled', cancelled_at = now(), cancellation_reason = _reason
  WHERE id = _purchase_id;
END;
$$;

-- Service-role-only: atomically claims (marks reminder_queued_at) every
-- unpaid, not-yet-queued purchase whose due_at falls within its own
-- reminder_lead_hours window. FOR UPDATE SKIP LOCKED prevents two
-- concurrent worker runs from double-claiming the same row. Does not
-- send anything - queueing only.
CREATE OR REPLACE FUNCTION public.claim_due_credit_purchase_reminders()
RETURNS SETOF public.credit_inventory_purchases
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT id FROM public.credit_inventory_purchases
    WHERE status = 'unpaid'
      AND reminder_queued_at IS NULL
      AND due_at <= now() + (reminder_lead_hours || ' hours')::interval
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.credit_inventory_purchases p
  SET reminder_queued_at = now()
  FROM due
  WHERE p.id = due.id
  RETURNING p.*;
END;
$$;

REVOKE ALL ON FUNCTION public.create_credit_inventory_purchase(text, text, numeric, timestamptz, uuid, numeric, text, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_credit_inventory_purchase(uuid, text, text, numeric, timestamptz, uuid, numeric, text, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_credit_inventory_purchase_paid(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_credit_inventory_purchase(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_due_credit_purchase_reminders() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_credit_inventory_purchase(text, text, numeric, timestamptz, uuid, numeric, text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_credit_inventory_purchase(uuid, text, text, numeric, timestamptz, uuid, numeric, text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_credit_inventory_purchase_paid(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_credit_inventory_purchase(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_credit_purchase_reminders() TO service_role;
