-- Phase 5C: Delivery Fulfillment + Proof of Receiving + payable gate.
-- Delivery/receiving is operational. Cash/Bank only move on real payment approval.

CREATE TABLE IF NOT EXISTS public.sales_order_fulfillments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_order_id uuid NOT NULL REFERENCES public.sales_orders(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  responsible_user uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'planned',
  planned_at timestamptz NOT NULL DEFAULT now(),
  ready_at timestamptz,
  dispatched_at timestamptz,
  delivered_at timestamptz,
  receiving_confirmed_at timestamptz,
  recipient_name text,
  receiving_notes text,
  proof_storage_path text,
  proof_mime_type text,
  proof_file_name text,
  invoice_id uuid,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_order_fulfillments_status_check CHECK (
    status IN ('planned', 'ready', 'dispatched', 'delivered', 'receiving_pending', 'receiving_confirmed', 'cancelled', 'failed')
  ),
  CONSTRAINT sales_order_fulfillments_cancel_reason_check CHECK (
    status NOT IN ('cancelled', 'failed') OR NULLIF(trim(COALESCE(cancel_reason, '')), '') IS NOT NULL
  )
);

CREATE TABLE IF NOT EXISTS public.sales_order_fulfillment_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fulfillment_id uuid NOT NULL REFERENCES public.sales_order_fulfillments(id) ON DELETE CASCADE,
  sales_order_item_id uuid NOT NULL REFERENCES public.sales_order_items(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  product_name_snapshot text NOT NULL,
  ordered_quantity_snapshot numeric NOT NULL,
  planned_quantity numeric NOT NULL,
  dispatched_quantity numeric NOT NULL DEFAULT 0,
  delivered_quantity numeric NOT NULL DEFAULT 0,
  accepted_quantity numeric NOT NULL DEFAULT 0,
  rejected_quantity numeric NOT NULL DEFAULT 0,
  unit text NOT NULL,
  unit_price_snapshot numeric,
  invoice_id uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_order_fulfillment_items_quantities_check CHECK (
    ordered_quantity_snapshot >= 0
    AND planned_quantity > 0
    AND dispatched_quantity >= 0
    AND delivered_quantity >= 0
    AND accepted_quantity >= 0
    AND rejected_quantity >= 0
    AND dispatched_quantity <= planned_quantity
    AND delivered_quantity <= planned_quantity
    AND accepted_quantity + rejected_quantity <= delivered_quantity
  )
);

CREATE TABLE IF NOT EXISTS public.delivery_accountability_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fulfillment_id uuid NOT NULL REFERENCES public.sales_order_fulfillments(id) ON DELETE CASCADE,
  responsible_user uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  incident_type text NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'open',
  notes text,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  penalty_recommended boolean,
  penalty_amount numeric,
  penalty_reason text,
  penalty_approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  penalty_approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT delivery_accountability_incidents_type_check CHECK (
    incident_type IN ('missing_receiving')
  ),
  CONSTRAINT delivery_accountability_incidents_status_check CHECK (
    status IN ('open', 'reviewed', 'resolved', 'penalty_approved')
  ),
  CONSTRAINT delivery_accountability_incidents_penalty_check CHECK (
    penalty_amount IS NULL OR penalty_amount >= 0
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_accountability_missing_receiving_once
  ON public.delivery_accountability_incidents (fulfillment_id, incident_type)
  WHERE incident_type = 'missing_receiving';
CREATE INDEX IF NOT EXISTS idx_sales_order_fulfillments_order ON public.sales_order_fulfillments(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_sales_order_fulfillments_status_delivered ON public.sales_order_fulfillments(status, delivered_at);
CREATE INDEX IF NOT EXISTS idx_sales_order_fulfillment_items_fulfillment ON public.sales_order_fulfillment_items(fulfillment_id);
CREATE INDEX IF NOT EXISTS idx_sales_order_fulfillment_items_order_item ON public.sales_order_fulfillment_items(sales_order_item_id);
CREATE INDEX IF NOT EXISTS idx_delivery_accountability_incidents_status ON public.delivery_accountability_incidents(status, detected_at);

DROP TRIGGER IF EXISTS set_sales_order_fulfillments_updated_at ON public.sales_order_fulfillments;
CREATE TRIGGER set_sales_order_fulfillments_updated_at
  BEFORE UPDATE ON public.sales_order_fulfillments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_sales_order_fulfillment_items_updated_at ON public.sales_order_fulfillment_items;
CREATE TRIGGER set_sales_order_fulfillment_items_updated_at
  BEFORE UPDATE ON public.sales_order_fulfillment_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_delivery_accountability_incidents_updated_at ON public.delivery_accountability_incidents;
CREATE TRIGGER set_delivery_accountability_incidents_updated_at
  BEFORE UPDATE ON public.delivery_accountability_incidents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.sales_order_fulfillments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_order_fulfillment_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_accountability_incidents ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.sales_order_fulfillments FROM anon, authenticated;
REVOKE ALL ON public.sales_order_fulfillment_items FROM anon, authenticated;
REVOKE ALL ON public.delivery_accountability_incidents FROM anon, authenticated;
GRANT SELECT ON public.sales_order_fulfillments TO authenticated;
GRANT SELECT ON public.sales_order_fulfillment_items TO authenticated;
GRANT SELECT ON public.delivery_accountability_incidents TO authenticated;
GRANT ALL ON public.sales_order_fulfillments TO service_role;
GRANT ALL ON public.sales_order_fulfillment_items TO service_role;
GRANT ALL ON public.delivery_accountability_incidents TO service_role;

DROP POLICY IF EXISTS "Ops users read sales order fulfillments" ON public.sales_order_fulfillments;
CREATE POLICY "Ops users read sales order fulfillments"
  ON public.sales_order_fulfillments FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'moderator'::public.app_role)
    OR public.has_role(auth.uid(), 'staff'::public.app_role)
  );

DROP POLICY IF EXISTS "Ops users read sales order fulfillment items" ON public.sales_order_fulfillment_items;
CREATE POLICY "Ops users read sales order fulfillment items"
  ON public.sales_order_fulfillment_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.sales_order_fulfillments f
      WHERE f.id = sales_order_fulfillment_items.fulfillment_id
        AND (
          public.has_role(auth.uid(), 'admin'::public.app_role)
          OR public.has_role(auth.uid(), 'moderator'::public.app_role)
          OR public.has_role(auth.uid(), 'staff'::public.app_role)
        )
    )
  );

DROP POLICY IF EXISTS "Admins and moderators read delivery accountability incidents" ON public.delivery_accountability_incidents;
CREATE POLICY "Admins and moderators read delivery accountability incidents"
  ON public.delivery_accountability_incidents FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'moderator'::public.app_role)
  );

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS sales_order_id uuid REFERENCES public.sales_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sales_order_fulfillment_id uuid REFERENCES public.sales_order_fulfillments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS receiving_status text NOT NULL DEFAULT 'legacy_collectible',
  ADD COLUMN IF NOT EXISTS receiving_confirmed_at timestamptz;

ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_receiving_status_check;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_receiving_status_check
  CHECK (receiving_status IN ('legacy_collectible', 'awaiting_receiving', 'payable'));

CREATE OR REPLACE FUNCTION public.prevent_awaiting_receiving_invoice_collection()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF COALESCE(NEW.receiving_status, 'legacy_collectible') = 'awaiting_receiving'
     AND (
       COALESCE(NEW.amount_received, 0) > 0
       OR NEW.payment_status = 'Done'::public.payment_status_enum
     ) THEN
    RAISE EXCEPTION 'Invoice is awaiting receiving confirmation and is not payable yet';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_awaiting_receiving_invoice_collection_trigger ON public.invoices;
CREATE TRIGGER prevent_awaiting_receiving_invoice_collection_trigger
BEFORE INSERT OR UPDATE OF receiving_status, amount_received, payment_status ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.prevent_awaiting_receiving_invoice_collection();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sales_order_fulfillments_invoice_id_fkey'
  ) THEN
    ALTER TABLE public.sales_order_fulfillments
      ADD CONSTRAINT sales_order_fulfillments_invoice_id_fkey
      FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sales_order_fulfillment_items_invoice_id_fkey'
  ) THEN
    ALTER TABLE public.sales_order_fulfillment_items
      ADD CONSTRAINT sales_order_fulfillment_items_invoice_id_fkey
      FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.assert_fulfillment_operator()
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
END;
$$;

CREATE OR REPLACE FUNCTION public.order_item_fulfillment_totals(_order_id uuid)
RETURNS TABLE (
  sales_order_item_id uuid,
  ordered_quantity numeric,
  planned_quantity numeric,
  dispatched_quantity numeric,
  delivered_quantity numeric,
  accepted_quantity numeric,
  remaining_to_plan numeric,
  remaining_to_deliver numeric,
  remaining_to_receive numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    soi.id,
    soi.quantity,
    COALESCE(SUM(foi.planned_quantity) FILTER (WHERE f.status NOT IN ('cancelled', 'failed')), 0),
    COALESCE(SUM(foi.dispatched_quantity) FILTER (WHERE f.status NOT IN ('cancelled', 'failed')), 0),
    COALESCE(SUM(foi.delivered_quantity) FILTER (WHERE f.status NOT IN ('cancelled', 'failed')), 0),
    COALESCE(SUM(foi.accepted_quantity) FILTER (WHERE f.status NOT IN ('cancelled', 'failed')), 0),
    GREATEST(soi.quantity - COALESCE(SUM(foi.planned_quantity) FILTER (WHERE f.status NOT IN ('cancelled', 'failed')), 0), 0),
    GREATEST(soi.quantity - COALESCE(SUM(foi.delivered_quantity) FILTER (WHERE f.status NOT IN ('cancelled', 'failed')), 0), 0),
    GREATEST(soi.quantity - COALESCE(SUM(foi.accepted_quantity) FILTER (WHERE f.status NOT IN ('cancelled', 'failed')), 0), 0)
  FROM public.sales_order_items soi
  LEFT JOIN public.sales_order_fulfillment_items foi ON foi.sales_order_item_id = soi.id
  LEFT JOIN public.sales_order_fulfillments f ON f.id = foi.fulfillment_id
  WHERE soi.sales_order_id = _order_id
  GROUP BY soi.id, soi.quantity;
$$;

CREATE OR REPLACE FUNCTION public.refresh_sales_order_delivery_status(_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  totals record;
BEGIN
  SELECT
    COALESCE(SUM(ordered_quantity), 0) AS ordered_qty,
    COALESCE(SUM(planned_quantity), 0) AS planned_qty,
    COALESCE(SUM(dispatched_quantity), 0) AS dispatched_qty,
    COALESCE(SUM(delivered_quantity), 0) AS delivered_qty,
    COALESCE(SUM(accepted_quantity), 0) AS accepted_qty,
    bool_and(accepted_quantity >= ordered_quantity) AS all_received,
    bool_and(delivered_quantity >= ordered_quantity) AS all_delivered,
    bool_and(planned_quantity >= ordered_quantity) AS all_planned
  INTO totals
  FROM public.order_item_fulfillment_totals(_order_id);

  UPDATE public.sales_orders
  SET status = CASE
    WHEN status IN ('draft', 'cancelled', 'completed') THEN status
    WHEN COALESCE(totals.ordered_qty, 0) > 0 AND totals.all_received THEN 'receiving_confirmed'
    WHEN COALESCE(totals.ordered_qty, 0) > 0 AND totals.all_delivered THEN 'receiving_pending'
    WHEN COALESCE(totals.dispatched_qty, 0) > 0 THEN 'dispatched'
    WHEN COALESCE(totals.all_planned, false) THEN 'allocated'
    WHEN status = 'confirmed' THEN 'planning'
    ELSE status
  END
  WHERE id = _order_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_sales_order_fulfillment(
  _order_id uuid,
  _responsible_user uuid,
  _items jsonb,
  _notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  order_row public.sales_orders%ROWTYPE;
  new_id uuid := gen_random_uuid();
  item_record jsonb;
  order_item public.sales_order_items%ROWTYPE;
  qty numeric;
  already_planned numeric;
  remaining numeric;
BEGIN
  PERFORM public.assert_fulfillment_operator();

  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'At least one fulfillment item is required';
  END IF;

  SELECT * INTO order_row
  FROM public.sales_orders
  WHERE id = _order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sales order not found';
  END IF;
  IF order_row.status NOT IN ('confirmed', 'planning', 'allocated', 'ready', 'dispatched', 'receiving_pending') THEN
    RAISE EXCEPTION 'Order is not eligible for fulfillment';
  END IF;

  INSERT INTO public.sales_order_fulfillments (
    id, sales_order_id, client_id, branch_id, responsible_user, status, planned_at, created_by
  ) VALUES (
    new_id, order_row.id, order_row.client_id, order_row.branch_id, COALESCE(_responsible_user, auth.uid()), 'planned', now(), auth.uid()
  );

  FOR item_record IN SELECT * FROM jsonb_array_elements(_items)
  LOOP
    qty := NULLIF(item_record->>'quantity', '')::numeric;
    IF qty IS NULL OR qty <= 0 THEN
      RAISE EXCEPTION 'Fulfillment quantity must be positive';
    END IF;

    SELECT * INTO order_item
    FROM public.sales_order_items
    WHERE id = (item_record->>'sales_order_item_id')::uuid
      AND sales_order_id = _order_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Sales order item not found for this order';
    END IF;

    SELECT COALESCE(SUM(foi.planned_quantity), 0)
    INTO already_planned
    FROM public.sales_order_fulfillment_items foi
    JOIN public.sales_order_fulfillments f ON f.id = foi.fulfillment_id
    WHERE foi.sales_order_item_id = order_item.id
      AND f.status NOT IN ('cancelled', 'failed');

    remaining := GREATEST(order_item.quantity - COALESCE(already_planned, 0), 0);
    IF qty > remaining THEN
      RAISE EXCEPTION 'Fulfillment quantity exceeds remaining ordered quantity';
    END IF;

    INSERT INTO public.sales_order_fulfillment_items (
      fulfillment_id,
      sales_order_item_id,
      product_id,
      product_name_snapshot,
      ordered_quantity_snapshot,
      planned_quantity,
      unit,
      unit_price_snapshot,
      notes
    ) VALUES (
      new_id,
      order_item.id,
      order_item.product_id,
      order_item.product_name_snapshot,
      order_item.quantity,
      qty,
      order_item.unit,
      order_item.unit_price,
      NULLIF(trim(COALESCE(item_record->>'notes', '')), '')
    );
  END LOOP;

  IF _notes IS NOT NULL AND trim(_notes) <> '' THEN
    UPDATE public.sales_order_fulfillments
    SET receiving_notes = trim(_notes)
    WHERE id = new_id;
  END IF;

  PERFORM public.refresh_sales_order_delivery_status(_order_id);
  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_sales_order_fulfillment_dispatched(_fulfillment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  f public.sales_order_fulfillments%ROWTYPE;
BEGIN
  PERFORM public.assert_fulfillment_operator();
  SELECT * INTO f FROM public.sales_order_fulfillments WHERE id = _fulfillment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fulfillment not found'; END IF;
  IF f.status NOT IN ('planned', 'ready') THEN RAISE EXCEPTION 'Fulfillment cannot be dispatched from current status'; END IF;

  UPDATE public.sales_order_fulfillment_items
  SET dispatched_quantity = planned_quantity
  WHERE fulfillment_id = _fulfillment_id;

  UPDATE public.sales_order_fulfillments
  SET status = 'dispatched', dispatched_at = COALESCE(dispatched_at, now())
  WHERE id = _fulfillment_id;

  PERFORM public.refresh_sales_order_delivery_status(f.sales_order_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_sales_order_fulfillment_delivered(_fulfillment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  f public.sales_order_fulfillments%ROWTYPE;
BEGIN
  PERFORM public.assert_fulfillment_operator();
  SELECT * INTO f FROM public.sales_order_fulfillments WHERE id = _fulfillment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fulfillment not found'; END IF;
  IF f.status <> 'dispatched' THEN RAISE EXCEPTION 'Fulfillment must be dispatched before delivery'; END IF;

  UPDATE public.sales_order_fulfillment_items
  SET delivered_quantity = CASE
    WHEN dispatched_quantity > 0 THEN dispatched_quantity
    ELSE planned_quantity
  END
  WHERE fulfillment_id = _fulfillment_id;

  UPDATE public.sales_order_fulfillments
  SET status = 'receiving_pending', delivered_at = COALESCE(delivered_at, now())
  WHERE id = _fulfillment_id;

  PERFORM public.refresh_sales_order_delivery_status(f.sales_order_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_sales_order_receiving(
  _fulfillment_id uuid,
  _recipient_name text,
  _received_at timestamptz DEFAULT now(),
  _notes text DEFAULT NULL,
  _proof_storage_path text DEFAULT NULL,
  _proof_mime_type text DEFAULT NULL,
  _proof_file_name text DEFAULT NULL,
  _items jsonb DEFAULT '[]'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  f public.sales_order_fulfillments%ROWTYPE;
  item_record jsonb;
  fulfillment_item public.sales_order_fulfillment_items%ROWTYPE;
  accepted numeric;
  rejected numeric;
  accepted_total numeric := 0;
  invoice_amount numeric := 0;
  new_invoice_id uuid := gen_random_uuid();
  item_summary text;
  packs_total numeric := 0;
  weight_total numeric := 0;
BEGIN
  PERFORM public.assert_fulfillment_operator();

  IF NULLIF(trim(COALESCE(_recipient_name, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Recipient name is required';
  END IF;
  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Receiving line items are required';
  END IF;

  SELECT * INTO f FROM public.sales_order_fulfillments WHERE id = _fulfillment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fulfillment not found'; END IF;
  IF f.status <> 'receiving_pending' THEN RAISE EXCEPTION 'Fulfillment is not awaiting receiving confirmation'; END IF;

  FOR item_record IN SELECT * FROM jsonb_array_elements(_items)
  LOOP
    accepted := COALESCE(NULLIF(item_record->>'accepted_quantity', '')::numeric, 0);
    rejected := COALESCE(NULLIF(item_record->>'rejected_quantity', '')::numeric, 0);
    IF accepted < 0 OR rejected < 0 THEN
      RAISE EXCEPTION 'Accepted/rejected quantities cannot be negative';
    END IF;

    SELECT * INTO fulfillment_item
    FROM public.sales_order_fulfillment_items
    WHERE id = (item_record->>'fulfillment_item_id')::uuid
      AND fulfillment_id = _fulfillment_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Fulfillment item not found';
    END IF;
    IF accepted + rejected > fulfillment_item.delivered_quantity THEN
      RAISE EXCEPTION 'Accepted plus rejected quantity cannot exceed delivered quantity';
    END IF;
    IF accepted > 0 AND fulfillment_item.unit_price_snapshot IS NULL THEN
      RAISE EXCEPTION 'Cannot create payable invoice without deterministic unit price';
    END IF;

    UPDATE public.sales_order_fulfillment_items
    SET accepted_quantity = accepted,
        rejected_quantity = rejected
    WHERE id = fulfillment_item.id;

    accepted_total := accepted_total + accepted;
    invoice_amount := invoice_amount + accepted * COALESCE(fulfillment_item.unit_price_snapshot, 0);
    IF lower(fulfillment_item.unit) IN ('pack', 'packs', 'packet', 'packets') THEN
      packs_total := packs_total + accepted;
    ELSIF lower(fulfillment_item.unit) IN ('kg', 'kgs', 'kilogram', 'kilograms') THEN
      weight_total := weight_total + accepted;
    END IF;
  END LOOP;

  IF accepted_total <= 0 THEN
    RAISE EXCEPTION 'At least one accepted quantity is required to create a payable invoice';
  END IF;
  IF invoice_amount <= 0 THEN
    RAISE EXCEPTION 'Accepted receiving amount must be positive';
  END IF;

  SELECT string_agg(product_name_snapshot || ' ' || trim(to_char(accepted_quantity, 'FM9999999990.##')) || ' ' || unit, ', ' ORDER BY product_name_snapshot)
  INTO item_summary
  FROM public.sales_order_fulfillment_items
  WHERE fulfillment_id = _fulfillment_id
    AND accepted_quantity > 0;

  INSERT INTO public.invoices (
    id,
    client_id,
    branch_id,
    date,
    delivery_date,
    item,
    weight_kg,
    no_of_packs,
    unit_price,
    amount,
    amount_received,
    payment_status,
    delivered,
    sales_order_id,
    sales_order_fulfillment_id,
    receiving_status,
    receiving_confirmed_at
  ) VALUES (
    new_invoice_id,
    f.client_id,
    f.branch_id,
    COALESCE(_received_at, now())::date,
    COALESCE(f.delivered_at, now())::date,
    item_summary,
    NULLIF(weight_total, 0),
    NULLIF(packs_total, 0),
    NULL,
    invoice_amount,
    0,
    'Not Done'::public.payment_status_enum,
    true,
    f.sales_order_id,
    f.id,
    'payable',
    COALESCE(_received_at, now())
  );

  UPDATE public.sales_order_fulfillment_items
  SET invoice_id = new_invoice_id
  WHERE fulfillment_id = _fulfillment_id
    AND accepted_quantity > 0;

  UPDATE public.sales_order_fulfillments
  SET status = 'receiving_confirmed',
      receiving_confirmed_at = COALESCE(_received_at, now()),
      recipient_name = trim(_recipient_name),
      receiving_notes = NULLIF(trim(COALESCE(_notes, '')), ''),
      proof_storage_path = NULLIF(trim(COALESCE(_proof_storage_path, '')), ''),
      proof_mime_type = NULLIF(trim(COALESCE(_proof_mime_type, '')), ''),
      proof_file_name = NULLIF(trim(COALESCE(_proof_file_name, '')), ''),
      invoice_id = new_invoice_id,
      confirmed_by = auth.uid()
  WHERE id = _fulfillment_id;

  PERFORM public.refresh_sales_order_delivery_status(f.sales_order_id);
  RETURN new_invoice_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_missing_receiving_incidents(_as_of date DEFAULT current_date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_count integer := 0;
  row record;
  incident_id uuid;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR current_setting('role', true) = 'service_role'
  ) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  FOR row IN
    SELECT
      f.id,
      f.sales_order_id,
      f.responsible_user,
      f.delivered_at,
      so.order_number
    FROM public.sales_order_fulfillments f
    JOIN public.sales_orders so ON so.id = f.sales_order_id
    WHERE f.status = 'receiving_pending'
      AND f.delivered_at::date <= _as_of - 3
      AND NOT EXISTS (
        SELECT 1
        FROM public.delivery_accountability_incidents i
        WHERE i.fulfillment_id = f.id
          AND i.incident_type = 'missing_receiving'
  )
  LOOP
    incident_id := NULL;

    INSERT INTO public.delivery_accountability_incidents (
      fulfillment_id, responsible_user, incident_type, detected_at, status, notes
    ) VALUES (
      row.id,
      row.responsible_user,
      'missing_receiving',
      now(),
      'open',
      'Receiving has not been confirmed for a delivery made 3+ calendar days ago.'
    )
    ON CONFLICT DO NOTHING
    RETURNING id INTO incident_id;

    IF incident_id IS NOT NULL THEN
      inserted_count := inserted_count + 1;

      IF to_regclass('public.notifications') IS NOT NULL THEN
        INSERT INTO public.notifications (
          recipient_user_id, category, severity, title, body, target_url,
          source_type, source_id, dedupe_key
        )
        SELECT DISTINCT ur.user_id,
          'operational_alerts',
          'High',
          'Receiving Missing',
          'Receiving has not been confirmed for a delivery made 3 days ago.',
          '/orders?order=' || row.sales_order_id || '&fulfillment=' || row.id,
          'delivery_accountability_incident',
          incident_id,
          'missing-receiving:' || row.id
        FROM public.user_roles ur
        WHERE ur.role = 'admin'::public.app_role
           OR ur.user_id = row.responsible_user
        ON CONFLICT (recipient_user_id, dedupe_key)
          WHERE dedupe_key IS NOT NULL
          DO UPDATE SET
            title = EXCLUDED.title,
            body = EXCLUDED.body,
            target_url = EXCLUDED.target_url;
      END IF;
    END IF;
  END LOOP;

  RETURN inserted_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.sales_order_demand_summary(_today date DEFAULT current_date)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH active_orders AS (
    SELECT *
    FROM public.sales_orders
    WHERE status = ANY(public.sales_order_active_statuses())
  ),
  active_items AS (
    SELECT
      so.id AS order_id,
      so.client_id,
      so.branch_id,
      so.client_name_snapshot,
      so.branch_name_snapshot,
      so.requested_delivery_date,
      soi.id AS sales_order_item_id,
      soi.product_id,
      soi.product_name_snapshot,
      soi.quantity,
      soi.unit
    FROM active_orders so
    JOIN public.sales_order_items soi ON soi.sales_order_id = so.id
  ),
  accepted AS (
    SELECT
      foi.sales_order_item_id,
      COALESCE(SUM(foi.accepted_quantity) FILTER (WHERE f.status NOT IN ('cancelled', 'failed')), 0) AS accepted_quantity,
      COALESCE(SUM(foi.delivered_quantity) FILTER (WHERE f.status NOT IN ('cancelled', 'failed')), 0) AS delivered_quantity
    FROM public.sales_order_fulfillment_items foi
    JOIN public.sales_order_fulfillments f ON f.id = foi.fulfillment_id
    GROUP BY foi.sales_order_item_id
  ),
  demand_items AS (
    SELECT
      ai.*,
      COALESCE(a.delivered_quantity, 0) AS delivered_quantity,
      COALESCE(a.accepted_quantity, 0) AS accepted_quantity,
      GREATEST(ai.quantity - COALESCE(a.delivered_quantity, 0), 0) AS operational_remaining,
      GREATEST(ai.quantity - COALESCE(a.accepted_quantity, 0), 0) AS commercial_remaining
    FROM active_items ai
    LEFT JOIN accepted a ON a.sales_order_item_id = ai.sales_order_item_id
  ),
  product_quantities AS (
    SELECT
      product_id,
      product_name_snapshot,
      unit,
      sum(quantity) AS ordered_quantity,
      sum(delivered_quantity) AS delivered_quantity,
      sum(accepted_quantity) AS accepted_quantity,
      sum(operational_remaining) AS operational_remaining,
      sum(commercial_remaining) AS commercial_remaining
    FROM demand_items
    GROUP BY product_id, product_name_snapshot, unit
  ),
  branch_quantities AS (
    SELECT
      client_id,
      branch_id,
      client_name_snapshot,
      COALESCE(branch_name_snapshot, 'No branch') AS branch_name,
      product_id,
      product_name_snapshot,
      unit,
      sum(operational_remaining) AS quantity
    FROM demand_items
    GROUP BY client_id, branch_id, client_name_snapshot, COALESCE(branch_name_snapshot, 'No branch'), product_id, product_name_snapshot, unit
  )
  SELECT jsonb_build_object(
    'as_of', _today,
    'orders_today', (SELECT count(*) FROM active_orders WHERE requested_delivery_date = _today),
    'orders_tomorrow', (SELECT count(*) FROM active_orders WHERE requested_delivery_date = _today + 1),
    'orders_next_3_days', (SELECT count(*) FROM active_orders WHERE requested_delivery_date BETWEEN _today AND _today + 2),
    'orders_next_7_days', (SELECT count(*) FROM active_orders WHERE requested_delivery_date BETWEEN _today AND _today + 6),
    'overdue_orders', (SELECT count(*) FROM active_orders WHERE requested_delivery_date < _today),
    'deliveries_due_today', (SELECT count(*) FROM active_orders WHERE requested_delivery_date = _today AND status NOT IN ('receiving_confirmed', 'completed')),
    'late_deliveries', (SELECT count(*) FROM active_orders WHERE requested_delivery_date < _today AND status NOT IN ('receiving_confirmed', 'completed')),
    'receiving_pending', (SELECT count(*) FROM public.sales_order_fulfillments WHERE status = 'receiving_pending'),
    'receiving_missing_3_days', (SELECT count(*) FROM public.sales_order_fulfillments WHERE status = 'receiving_pending' AND delivered_at::date <= _today - 3),
    'demand_policy', jsonb_build_object(
      'operational_production_demand', 'ordered - delivered',
      'commercial_outstanding_fulfillment', 'ordered - receiving_confirmed'
    ),
    'quantity_by_product', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'product_id', product_id,
          'product_name', product_name_snapshot,
          'unit', unit,
          'ordered_quantity', ordered_quantity,
          'delivered_quantity', delivered_quantity,
          'accepted_quantity', accepted_quantity,
          'operational_remaining', operational_remaining,
          'commercial_remaining', commercial_remaining,
          'quantity', operational_remaining
        )
        ORDER BY product_name_snapshot, unit
      )
      FROM product_quantities
    ), '[]'::jsonb),
    'quantity_by_customer_branch', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'client_id', client_id,
          'branch_id', branch_id,
          'client_name', client_name_snapshot,
          'branch_name', branch_name,
          'product_id', product_id,
          'product_name', product_name_snapshot,
          'unit', unit,
          'quantity', quantity
        )
        ORDER BY client_name_snapshot, branch_name, product_name_snapshot, unit
      )
      FROM branch_quantities
    ), '[]'::jsonb)
  );
$$;

DROP FUNCTION IF EXISTS public.product_demand(date);

CREATE OR REPLACE FUNCTION public.product_demand(_today date DEFAULT current_date)
RETURNS TABLE (
  product_id uuid,
  product_name text,
  unit text,
  total_confirmed_demand numeric,
  requested_quantity numeric,
  currently_allocated_quantity numeric,
  fulfilled_quantity numeric,
  remaining_demand numeric,
  earliest_requested_delivery date,
  order_count bigint,
  affected_customer_branches jsonb,
  delivered_quantity numeric,
  accepted_quantity numeric,
  commercial_remaining_demand numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH active_items AS (
    SELECT
      so.id AS order_id,
      so.client_id,
      so.branch_id,
      so.client_name_snapshot,
      so.branch_name_snapshot,
      so.requested_delivery_date,
      soi.id AS sales_order_item_id,
      soi.product_id,
      soi.product_name_snapshot,
      soi.quantity,
      soi.unit
    FROM public.sales_orders so
    JOIN public.sales_order_items soi ON soi.sales_order_id = so.id
    WHERE so.status = ANY(public.sales_order_active_statuses())
  ),
  fulfilled AS (
    SELECT
      foi.sales_order_item_id,
      COALESCE(SUM(foi.planned_quantity) FILTER (WHERE f.status NOT IN ('cancelled', 'failed')), 0) AS planned_quantity,
      COALESCE(SUM(foi.delivered_quantity) FILTER (WHERE f.status NOT IN ('cancelled', 'failed')), 0) AS delivered_quantity,
      COALESCE(SUM(foi.accepted_quantity) FILTER (WHERE f.status NOT IN ('cancelled', 'failed')), 0) AS accepted_quantity
    FROM public.sales_order_fulfillment_items foi
    JOIN public.sales_order_fulfillments f ON f.id = foi.fulfillment_id
    GROUP BY foi.sales_order_item_id
  )
  SELECT
    ai.product_id,
    ai.product_name_snapshot AS product_name,
    ai.unit,
    sum(ai.quantity) AS total_confirmed_demand,
    sum(ai.quantity) AS requested_quantity,
    sum(COALESCE(f.planned_quantity, 0)) AS currently_allocated_quantity,
    sum(COALESCE(f.delivered_quantity, 0)) AS fulfilled_quantity,
    sum(GREATEST(ai.quantity - COALESCE(f.delivered_quantity, 0), 0)) AS remaining_demand,
    min(ai.requested_delivery_date) AS earliest_requested_delivery,
    count(DISTINCT ai.order_id) AS order_count,
    jsonb_agg(
      DISTINCT jsonb_build_object(
        'client_id', ai.client_id,
        'branch_id', ai.branch_id,
        'client_name', ai.client_name_snapshot,
        'branch_name', COALESCE(ai.branch_name_snapshot, 'No branch')
      )
    ) AS affected_customer_branches,
    sum(COALESCE(f.delivered_quantity, 0)) AS delivered_quantity,
    sum(COALESCE(f.accepted_quantity, 0)) AS accepted_quantity,
    sum(GREATEST(ai.quantity - COALESCE(f.accepted_quantity, 0), 0)) AS commercial_remaining_demand
  FROM active_items ai
  LEFT JOIN fulfilled f ON f.sales_order_item_id = ai.sales_order_item_id
  GROUP BY ai.product_id, ai.product_name_snapshot, ai.unit
  ORDER BY min(ai.requested_delivery_date), ai.product_name_snapshot, ai.unit;
$$;

CREATE OR REPLACE FUNCTION public.get_customer_ledger_rows(
  _search text DEFAULT NULL,
  _branch_id uuid DEFAULT NULL,
  _balance_status text DEFAULT 'all',
  _date_from date DEFAULT NULL,
  _date_to date DEFAULT NULL,
  _due_status text DEFAULT 'all',
  _limit integer DEFAULT 50,
  _offset integer DEFAULT 0
)
RETURNS TABLE (
  invoice_id uuid,
  invoice_no text,
  client_id uuid,
  customer_name text,
  branch_id uuid,
  branch_name text,
  branch_key text,
  contact_number text,
  stock_date date,
  stock_quantity text,
  item text,
  amount numeric,
  verified_collections numeric,
  due_date date,
  balance numeric,
  days_since_stock_sent integer,
  payment_status text,
  last_payment_date timestamptz,
  due_status text,
  total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(_limit, 50), 1), 200000);
  v_offset integer := GREATEST(COALESCE(_offset, 0), 0);
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  RETURN QUERY
  WITH approved_payments AS (
    SELECT l.invoice_id, MAX(l.created_at) AS last_payment_date
    FROM public.cash_ledger_entries l
    WHERE l.entry_type = 'client_payment_credit'
      AND l.invoice_id IS NOT NULL
    GROUP BY l.invoice_id
  ),
  base AS (
    SELECT
      i.id AS invoice_id,
      i.invoice_no,
      i.client_id,
      COALESCE(NULLIF(c.legal_name, ''), NULLIF(c.dba, ''), 'Unknown Customer') AS customer_name,
      i.branch_id,
      COALESCE(NULLIF(b.branch_name, ''), 'Unassigned Branch') AS branch_name,
      COALESCE(i.branch_id::text, 'unassigned:' || i.client_id::text) AS branch_key,
      c.phone AS contact_number,
      COALESCE(i.delivery_date, i.date, i.created_at::date) AS stock_date,
      public.customer_ledger_quantity_label(i.weight_kg, i.no_of_packs) AS stock_quantity,
      NULLIF(i.item, '') AS item,
      COALESCE(i.amount, 0) AS amount,
      CASE
        WHEN i.payment_status = 'Done' THEN COALESCE(i.amount, 0)
        ELSE LEAST(COALESCE(i.amount_received, 0), COALESCE(i.amount, 0))
      END AS verified_collections,
      i.due_date,
      GREATEST(
        COALESCE(i.amount, 0) -
        CASE
          WHEN i.payment_status = 'Done' THEN COALESCE(i.amount, 0)
          ELSE LEAST(COALESCE(i.amount_received, 0), COALESCE(i.amount, 0))
        END,
        0
      ) AS balance,
      GREATEST((CURRENT_DATE - COALESCE(i.delivery_date, i.date, i.created_at::date))::int, 0) AS days_since_stock_sent,
      CASE
        WHEN i.receiving_status = 'awaiting_receiving' THEN 'Awaiting Receiving'
        ELSE i.payment_status::text
      END AS payment_status,
      ap.last_payment_date,
      CASE
        WHEN i.receiving_status = 'awaiting_receiving' THEN 'awaiting_receiving'
        WHEN GREATEST(
          COALESCE(i.amount, 0) -
          CASE
            WHEN i.payment_status = 'Done' THEN COALESCE(i.amount, 0)
            ELSE LEAST(COALESCE(i.amount_received, 0), COALESCE(i.amount, 0))
          END,
          0
        ) <= 0 THEN 'paid'
        WHEN i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE THEN 'overdue'
        WHEN i.due_date IS NOT NULL AND i.due_date <= CURRENT_DATE + 7 THEN 'due_soon'
        ELSE 'not_due'
      END AS due_status
    FROM public.invoices i
    LEFT JOIN public.clients c ON c.id = i.client_id
    LEFT JOIN public.branches b ON b.id = i.branch_id
    LEFT JOIN approved_payments ap ON ap.invoice_id = i.id
    WHERE COALESCE(i.is_deleted, false) = false
      AND COALESCE(i.receiving_status, 'legacy_collectible') <> 'awaiting_receiving'
  ),
  filtered AS (
    SELECT x.*
    FROM base x
    WHERE (_search IS NULL OR trim(_search) = ''
        OR x.customer_name ILIKE '%' || trim(_search) || '%'
        OR x.branch_name ILIKE '%' || trim(_search) || '%'
        OR x.invoice_no ILIKE '%' || trim(_search) || '%')
      AND (_branch_id IS NULL OR x.branch_id = _branch_id)
      AND (_date_from IS NULL OR x.stock_date >= _date_from)
      AND (_date_to IS NULL OR x.stock_date <= _date_to)
      AND (COALESCE(_balance_status, 'all') = 'all'
        OR (COALESCE(_balance_status, 'all') = 'outstanding' AND x.balance > 0)
        OR (COALESCE(_balance_status, 'all') = 'paid' AND x.balance = 0))
      AND (COALESCE(_due_status, 'all') = 'all'
        OR x.due_status = COALESCE(_due_status, 'all'))
  )
  SELECT
    f.invoice_id, f.invoice_no, f.client_id, f.customer_name, f.branch_id,
    f.branch_name, f.branch_key, f.contact_number, f.stock_date,
    f.stock_quantity, f.item, f.amount, f.verified_collections, f.due_date,
    f.balance, f.days_since_stock_sent, f.payment_status, f.last_payment_date,
    f.due_status, COUNT(*) OVER() AS total_count
  FROM filtered f
  ORDER BY f.stock_date DESC, f.invoice_no DESC
  LIMIT v_limit OFFSET v_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_fulfillment_operator() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.order_item_fulfillment_totals(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.refresh_sales_order_delivery_status(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_sales_order_fulfillment(uuid, uuid, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_sales_order_fulfillment_dispatched(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_sales_order_fulfillment_delivered(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.confirm_sales_order_receiving(uuid, text, timestamptz, text, text, text, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_missing_receiving_incidents(date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sales_order_demand_summary(date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.product_demand(date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_customer_ledger_rows(text, uuid, text, date, date, text, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.prevent_awaiting_receiving_invoice_collection() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.order_item_fulfillment_totals(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_sales_order_fulfillment(uuid, uuid, jsonb, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_sales_order_fulfillment_dispatched(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_sales_order_fulfillment_delivered(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_sales_order_receiving(uuid, text, timestamptz, text, text, text, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_missing_receiving_incidents(date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sales_order_demand_summary(date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.product_demand(date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_customer_ledger_rows(text, uuid, text, date, date, text, integer, integer) TO authenticated;
