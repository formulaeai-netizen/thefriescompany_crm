-- Finished Stock Availability Gate for invoice creation.
-- Inventory remains the stock source of truth. This layer only calculates
-- allocatable packets and records invoice commitments/override audit data.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS stock_gate_status text NOT NULL DEFAULT 'clear',
  ADD COLUMN IF NOT EXISTS stock_override_reason text,
  ADD COLUMN IF NOT EXISTS stock_override_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS stock_override_at timestamptz,
  ADD COLUMN IF NOT EXISTS stock_shortages_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_stock_gate_status_check;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_stock_gate_status_check
  CHECK (stock_gate_status IN ('clear', 'forced_shortage'));
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_stock_override_metadata_check;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_stock_override_metadata_check
  CHECK (
    (stock_gate_status = 'clear'
      AND stock_override_reason IS NULL
      AND stock_override_by IS NULL
      AND stock_override_at IS NULL)
    OR
    (stock_gate_status = 'forced_shortage'
      AND NULLIF(trim(stock_override_reason), '') IS NOT NULL
      AND stock_override_by IS NOT NULL
      AND stock_override_at IS NOT NULL
      AND jsonb_typeof(stock_shortages_snapshot) = 'array'
      AND jsonb_array_length(stock_shortages_snapshot) > 0)
  );

CREATE TABLE IF NOT EXISTS public.invoice_finished_stock_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  product_name_snapshot text NOT NULL,
  requested_packets numeric NOT NULL CHECK (requested_packets > 0),
  available_packets_snapshot numeric NOT NULL CHECK (available_packets_snapshot >= 0),
  shortfall_packets_snapshot numeric NOT NULL DEFAULT 0 CHECK (shortfall_packets_snapshot >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (invoice_id, product_id)
);

CREATE TABLE IF NOT EXISTS public.invoice_stock_override_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL UNIQUE REFERENCES public.invoices(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  overridden_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL CHECK (NULLIF(trim(reason), '') IS NOT NULL),
  shortages jsonb NOT NULL CHECK (
    jsonb_typeof(shortages) = 'array' AND jsonb_array_length(shortages) > 0
  )
);

CREATE INDEX IF NOT EXISTS idx_invoice_finished_stock_lines_product
  ON public.invoice_finished_stock_lines(product_id, invoice_id);

ALTER TABLE public.invoice_finished_stock_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_stock_override_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.invoice_finished_stock_lines, public.invoice_stock_override_audit
  FROM anon, authenticated;
GRANT SELECT ON public.invoice_finished_stock_lines TO authenticated;
GRANT SELECT ON public.invoice_stock_override_audit TO authenticated;
GRANT ALL ON public.invoice_finished_stock_lines, public.invoice_stock_override_audit TO service_role;

DROP POLICY IF EXISTS "Invoice operators read finished stock lines" ON public.invoice_finished_stock_lines;
CREATE POLICY "Invoice operators read finished stock lines"
  ON public.invoice_finished_stock_lines FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'staff'::public.app_role)
  );

DROP POLICY IF EXISTS "Admins read invoice stock override audit" ON public.invoice_stock_override_audit;
CREATE POLICY "Admins read invoice stock override audit"
  ON public.invoice_stock_override_audit FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE OR REPLACE FUNCTION public.finished_stock_packet_quantity(_quantity numeric, _unit text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN lower(trim(COALESCE(_unit, ''))) IN ('pack', 'packs', 'packet', 'packets')
      THEN GREATEST(COALESCE(_quantity, 0), 0)
    WHEN lower(trim(COALESCE(_unit, ''))) IN ('kg', 'kgs', 'kilogram', 'kilograms')
      THEN GREATEST(COALESCE(_quantity, 0), 0) / 2.5
    ELSE 0
  END;
$$;

CREATE OR REPLACE FUNCTION public.finished_stock_availability(_product_ids uuid[] DEFAULT NULL)
RETURNS TABLE (
  product_id uuid,
  product_name text,
  current_finished_stock numeric,
  dispatched_packets numeric,
  reserved_packets numeric,
  invoiced_packets numeric,
  available_packets numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'staff'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH selected_products AS (
    SELECT p.id, p.name
    FROM public.products p
    WHERE p.is_active = true
      AND (_product_ids IS NULL OR p.id = ANY(_product_ids))
  ),
  inventory_totals AS (
    SELECT
      p.id AS product_id,
      COALESCE(SUM(public.finished_stock_packet_quantity(i.current_stock, i.unit)), 0) AS packets
    FROM selected_products p
    LEFT JOIN public.inventory i
      ON lower(trim(i.item_name)) = lower(trim(p.name))
      AND lower(trim(COALESCE(i.unit, ''))) IN (
        'pack', 'packs', 'packet', 'packets', 'kg', 'kgs', 'kilogram', 'kilograms'
      )
    GROUP BY p.id
  ),
  dispatched_totals AS (
    SELECT
      foi.product_id,
      COALESCE(SUM(public.finished_stock_packet_quantity(foi.dispatched_quantity, foi.unit)), 0) AS packets
    FROM public.sales_order_fulfillment_items foi
    JOIN public.sales_order_fulfillments f ON f.id = foi.fulfillment_id
    WHERE f.status NOT IN ('cancelled', 'failed')
      AND foi.dispatched_quantity > 0
    GROUP BY foi.product_id
  ),
  reserved_totals AS (
    SELECT
      api.product_id,
      COALESCE(SUM(public.finished_stock_packet_quantity(api.approved_quantity, api.unit)), 0) AS packets
    FROM public.stock_allocation_plan_items api
    JOIN public.stock_allocation_plans ap ON ap.id = api.allocation_plan_id
    WHERE ap.status IN ('approved', 'partially_executed')
      AND api.fulfillment_id IS NULL
      AND COALESCE(api.approved_quantity, 0) > 0
    GROUP BY api.product_id
  ),
  gated_invoice_totals AS (
    SELECT l.product_id, COALESCE(SUM(l.requested_packets), 0) AS packets
    FROM public.invoice_finished_stock_lines l
    JOIN public.invoices i ON i.id = l.invoice_id
    WHERE COALESCE(i.is_deleted, false) = false
    GROUP BY l.product_id
  ),
  legacy_invoice_totals AS (
    SELECT
      p.id AS product_id,
      COALESCE(SUM(COALESCE(i.no_of_packs, i.weight_kg / 2.5, 0)), 0) AS packets
    FROM selected_products p
    JOIN public.invoices i
      ON lower(trim(COALESCE(i.item, ''))) = lower(trim(p.name))
      AND COALESCE(i.is_deleted, false) = false
      AND i.sales_order_fulfillment_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.invoice_finished_stock_lines l WHERE l.invoice_id = i.id
      )
    GROUP BY p.id
  )
  SELECT
    p.id,
    p.name,
    COALESCE(inv.packets, 0),
    COALESCE(dispatched.packets, 0),
    COALESCE(reserved.packets, 0),
    COALESCE(gated.packets, 0) + COALESCE(legacy.packets, 0),
    GREATEST(
      COALESCE(inv.packets, 0)
      - COALESCE(dispatched.packets, 0)
      - COALESCE(reserved.packets, 0)
      - COALESCE(gated.packets, 0)
      - COALESCE(legacy.packets, 0),
      0
    )
  FROM selected_products p
  LEFT JOIN inventory_totals inv ON inv.product_id = p.id
  LEFT JOIN dispatched_totals dispatched ON dispatched.product_id = p.id
  LEFT JOIN reserved_totals reserved ON reserved.product_id = p.id
  LEFT JOIN gated_invoice_totals gated ON gated.product_id = p.id
  LEFT JOIN legacy_invoice_totals legacy ON legacy.product_id = p.id
  ORDER BY p.name;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_stock_gated_invoice(
  _client_id uuid,
  _branch_id uuid,
  _date date,
  _delivery_date date,
  _due_date date,
  _amount numeric,
  _amount_received numeric,
  _payment_status public.payment_status_enum,
  _lines jsonb,
  _unit_price numeric DEFAULT NULL,
  _force_override boolean DEFAULT false,
  _override_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized_lines jsonb;
  line_snapshots jsonb := '[]'::jsonb;
  line_record record;
  stock_record record;
  shortages jsonb := '[]'::jsonb;
  new_invoice_id uuid := gen_random_uuid();
  new_invoice_no text;
  item_summary text;
  total_packets numeric;
  actor uuid := auth.uid();
  actor_is_admin boolean;
  actor_is_staff boolean;
BEGIN
  actor_is_admin := public.has_role(actor, 'admin'::public.app_role);
  actor_is_staff := public.has_role(actor, 'staff'::public.app_role);
  IF NOT (actor_is_admin OR actor_is_staff) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _force_override AND NOT actor_is_admin THEN
    RAISE EXCEPTION 'Only an Admin can force-create an invoice with insufficient stock'
      USING ERRCODE = '42501';
  END IF;
  IF _force_override AND NULLIF(trim(COALESCE(_override_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Stock override reason is required';
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'Invoice amount must be positive';
  END IF;
  IF COALESCE(_amount_received, 0) < 0 THEN
    RAISE EXCEPTION 'Amount received cannot be negative';
  END IF;
  IF _date IS NULL OR _delivery_date IS NULL OR _due_date IS NULL THEN
    RAISE EXCEPTION 'Invoice, delivery and due dates are required';
  END IF;
  IF jsonb_typeof(_lines) <> 'array' OR jsonb_array_length(_lines) = 0 THEN
    RAISE EXCEPTION 'At least one invoice product line is required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clients WHERE id = _client_id) THEN
    RAISE EXCEPTION 'Invalid client';
  END IF;
  IF _branch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.branches WHERE id = _branch_id AND client_id = _client_id
  ) THEN
    RAISE EXCEPTION 'Branch does not belong to selected client';
  END IF;

  BEGIN
    SELECT jsonb_agg(
      jsonb_build_object(
        'product_id', grouped.product_id,
        'product_name', grouped.product_name,
        'requested_packets', grouped.requested_packets
      ) ORDER BY grouped.product_id
    )
    INTO normalized_lines
    FROM (
      SELECT
        p.id AS product_id,
        p.name AS product_name,
        SUM((line->>'requested_packets')::numeric) AS requested_packets
      FROM jsonb_array_elements(_lines) line
      JOIN public.products p
        ON p.id = (line->>'product_id')::uuid
        AND p.is_active = true
      GROUP BY p.id, p.name
    ) grouped;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'Invoice product lines contain invalid product or quantity values';
  END;

  IF normalized_lines IS NULL
     OR jsonb_array_length(normalized_lines) = 0
     OR jsonb_array_length(normalized_lines) <> jsonb_array_length(_lines) THEN
    RAISE EXCEPTION 'Every invoice line must reference an active product';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(normalized_lines) line
    WHERE (line->>'requested_packets')::numeric <= 0
  ) THEN
    RAISE EXCEPTION 'Requested packet quantity must be positive';
  END IF;

  -- Product-scoped transaction locks serialize validation and insertion. A
  -- concurrent request cannot validate against the same stale availability.
  FOR line_record IN
    SELECT (line->>'product_id')::uuid AS product_id
    FROM jsonb_array_elements(normalized_lines) line
    ORDER BY (line->>'product_id')::uuid
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended('finished-stock-invoice:' || line_record.product_id::text, 0)
    );
  END LOOP;

  FOR line_record IN
    SELECT
      (line->>'product_id')::uuid AS product_id,
      line->>'product_name' AS product_name,
      (line->>'requested_packets')::numeric AS requested_packets
    FROM jsonb_array_elements(normalized_lines) line
  LOOP
    SELECT * INTO stock_record
    FROM public.finished_stock_availability(ARRAY[line_record.product_id]);

    IF stock_record.product_id IS NULL THEN
      RAISE EXCEPTION 'Finished stock availability is unavailable for selected product';
    END IF;
    IF line_record.requested_packets > stock_record.available_packets THEN
      shortages := shortages || jsonb_build_array(jsonb_build_object(
        'product_id', line_record.product_id,
        'product', line_record.product_name,
        'requested_qty', line_record.requested_packets,
        'available_qty', stock_record.available_packets,
        'shortfall_qty', line_record.requested_packets - stock_record.available_packets
      ));
    END IF;
    line_snapshots := line_snapshots || jsonb_build_array(jsonb_build_object(
      'product_id', line_record.product_id,
      'product_name', line_record.product_name,
      'requested_packets', line_record.requested_packets,
      'available_packets', stock_record.available_packets,
      'shortfall_packets', GREATEST(
        line_record.requested_packets - stock_record.available_packets,
        0
      )
    ));
  END LOOP;

  IF jsonb_array_length(shortages) > 0 AND NOT _force_override THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'INSUFFICIENT_FINISHED_STOCK',
      'message', 'Not enough packets available',
      'shortages', shortages
    );
  END IF;
  IF _force_override AND jsonb_array_length(shortages) = 0 THEN
    RAISE EXCEPTION 'Stock override is not required because sufficient stock is available';
  END IF;

  SELECT
    string_agg(
      line->>'product_name' || ' ' || trim(to_char((line->>'requested_packets')::numeric, 'FM9999999990.##')) || ' packets',
      ', ' ORDER BY line->>'product_name'
    ),
    SUM((line->>'requested_packets')::numeric)
  INTO item_summary, total_packets
  FROM jsonb_array_elements(normalized_lines) line;

  INSERT INTO public.invoices (
    id, client_id, branch_id, date, delivery_date, due_date, item,
    weight_kg, no_of_packs, unit_price, amount, amount_received,
    payment_status, delivered, stock_gate_status, stock_override_reason,
    stock_override_by, stock_override_at, stock_shortages_snapshot
  ) VALUES (
    new_invoice_id, _client_id, _branch_id, _date, _delivery_date, _due_date, item_summary,
    total_packets * 2.5, total_packets, _unit_price, _amount, COALESCE(_amount_received, 0),
    COALESCE(_payment_status, 'Not Done'::public.payment_status_enum), false,
    CASE WHEN jsonb_array_length(shortages) > 0 THEN 'forced_shortage' ELSE 'clear' END,
    CASE WHEN jsonb_array_length(shortages) > 0 THEN trim(_override_reason) ELSE NULL END,
    CASE WHEN jsonb_array_length(shortages) > 0 THEN actor ELSE NULL END,
    CASE WHEN jsonb_array_length(shortages) > 0 THEN now() ELSE NULL END,
    shortages
  )
  RETURNING invoice_no INTO new_invoice_no;

  FOR line_record IN
    SELECT
      (line->>'product_id')::uuid AS product_id,
      line->>'product_name' AS product_name,
      (line->>'requested_packets')::numeric AS requested_packets,
      (line->>'available_packets')::numeric AS available_packets,
      (line->>'shortfall_packets')::numeric AS shortfall_packets
    FROM jsonb_array_elements(line_snapshots) line
  LOOP
    INSERT INTO public.invoice_finished_stock_lines (
      invoice_id, product_id, product_name_snapshot, requested_packets,
      available_packets_snapshot, shortfall_packets_snapshot
    ) VALUES (
      new_invoice_id,
      line_record.product_id,
      line_record.product_name,
      line_record.requested_packets,
      line_record.available_packets,
      line_record.shortfall_packets
    );
  END LOOP;

  IF jsonb_array_length(shortages) > 0 THEN
    INSERT INTO public.invoice_stock_override_audit (
      invoice_id, actor_id, overridden_at, reason, shortages
    ) VALUES (
      new_invoice_id, actor, now(), trim(_override_reason), shortages
    );

    IF to_regprocedure(
      'public.create_notification_for_roles(public.app_role[], text, text, text, text, text, text, uuid, text)'
    ) IS NOT NULL THEN
      PERFORM public.create_notification_for_roles(
        ARRAY['admin'::public.app_role],
        'operational_alerts',
        'High',
        'Invoice Created With Stock Override',
        COALESCE(new_invoice_no, 'Invoice') || ' was force-created despite a finished-stock shortage.',
        '/invoices',
        'invoice_stock_override',
        new_invoice_id,
        'invoice-stock-override:' || new_invoice_id::text
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'invoice_id', new_invoice_id,
    'invoice_no', new_invoice_no,
    'stock_gate_status', CASE
      WHEN jsonb_array_length(shortages) > 0 THEN 'forced_shortage'
      ELSE 'clear'
    END,
    'shortages', shortages
  );
END;
$$;

-- Authenticated invoice creation must use the stock-gated RPC. Existing
-- SECURITY DEFINER receiving workflows and service-role maintenance remain valid.
DROP POLICY IF EXISTS "Admin or staff insert" ON public.invoices;
REVOKE INSERT ON public.invoices FROM authenticated;

REVOKE ALL ON FUNCTION public.finished_stock_packet_quantity(numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.finished_stock_availability(uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_stock_gated_invoice(
  uuid, uuid, date, date, date, numeric, numeric, public.payment_status_enum,
  jsonb, numeric, boolean, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finished_stock_availability(uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_stock_gated_invoice(
  uuid, uuid, date, date, date, numeric, numeric, public.payment_status_enum,
  jsonb, numeric, boolean, text
) TO authenticated, service_role;
