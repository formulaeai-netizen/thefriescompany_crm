-- Phase 5B: Canonical Sales Orders + Demand Foundation
-- Additive only. Orders are operational demand; they do not create invoices,
-- receivables, cash/bank ledger entries, stock movements or payroll rows.

CREATE SEQUENCE IF NOT EXISTS public.sales_order_number_seq;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.sales_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text NOT NULL UNIQUE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  client_name_snapshot text NOT NULL,
  branch_name_snapshot text,
  order_source text NOT NULL DEFAULT 'admin',
  external_source_key text,
  ordered_at timestamptz NOT NULL DEFAULT now(),
  requested_delivery_date date NOT NULL,
  promised_delivery_date date,
  priority text NOT NULL DEFAULT 'normal',
  status text NOT NULL DEFAULT 'draft',
  customer_notes text,
  internal_notes text,
  assigned_to uuid,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  updated_by uuid,
  confirmed_by uuid,
  cancelled_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  CONSTRAINT sales_orders_source_check CHECK (order_source IN ('admin', 'customer_portal', 'whatsapp')),
  CONSTRAINT sales_orders_priority_check CHECK (priority IN ('normal', 'high', 'urgent')),
  CONSTRAINT sales_orders_status_check CHECK (
    status IN (
      'draft',
      'confirmed',
      'planning',
      'allocated',
      'ready',
      'dispatched',
      'delivered',
      'receiving_pending',
      'receiving_confirmed',
      'completed',
      'cancelled'
    )
  ),
  CONSTRAINT sales_orders_cancel_reason_check CHECK (
    status <> 'cancelled' OR NULLIF(trim(cancellation_reason), '') IS NOT NULL
  ),
  CONSTRAINT sales_orders_confirmed_at_check CHECK (
    (status IN ('confirmed','planning','allocated','ready','dispatched','delivered','receiving_pending','receiving_confirmed','completed') AND confirmed_at IS NOT NULL)
    OR status IN ('draft','cancelled')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_orders_external_source_key
  ON public.sales_orders (external_source_key)
  WHERE external_source_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_orders_client_branch
  ON public.sales_orders (client_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_sales_orders_status_delivery
  ON public.sales_orders (status, requested_delivery_date);
CREATE INDEX IF NOT EXISTS idx_sales_orders_assigned_to
  ON public.sales_orders (assigned_to)
  WHERE assigned_to IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.sales_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_order_id uuid NOT NULL REFERENCES public.sales_orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  product_name_snapshot text NOT NULL,
  quantity numeric NOT NULL,
  unit text NOT NULL,
  unit_price numeric,
  line_total numeric GENERATED ALWAYS AS (
    CASE WHEN unit_price IS NULL THEN NULL ELSE quantity * unit_price END
  ) STORED,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_order_items_quantity_check CHECK (quantity > 0),
  CONSTRAINT sales_order_items_unit_check CHECK (NULLIF(trim(unit), '') IS NOT NULL),
  CONSTRAINT sales_order_items_unit_price_check CHECK (unit_price IS NULL OR unit_price >= 0)
);

CREATE INDEX IF NOT EXISTS idx_sales_order_items_order
  ON public.sales_order_items (sales_order_id);
CREATE INDEX IF NOT EXISTS idx_sales_order_items_product
  ON public.sales_order_items (product_id);

DROP TRIGGER IF EXISTS set_sales_orders_updated_at ON public.sales_orders;
CREATE TRIGGER set_sales_orders_updated_at
  BEFORE UPDATE ON public.sales_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.sales_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_order_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.sales_orders FROM anon, authenticated;
REVOKE ALL ON public.sales_order_items FROM anon, authenticated;
GRANT SELECT ON public.sales_orders TO authenticated;
GRANT SELECT ON public.sales_order_items TO authenticated;
GRANT ALL ON public.sales_orders TO service_role;
GRANT ALL ON public.sales_order_items TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.sales_order_number_seq TO authenticated, service_role;

DROP POLICY IF EXISTS "Admins and moderators read sales orders" ON public.sales_orders;
CREATE POLICY "Admins and moderators read sales orders"
  ON public.sales_orders FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'moderator'::public.app_role)
  );

DROP POLICY IF EXISTS "Admins and moderators read sales order items" ON public.sales_order_items;
CREATE POLICY "Admins and moderators read sales order items"
  ON public.sales_order_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.sales_orders so
      WHERE so.id = sales_order_items.sales_order_id
        AND (
          public.has_role(auth.uid(), 'admin'::public.app_role)
          OR public.has_role(auth.uid(), 'moderator'::public.app_role)
        )
    )
  );

CREATE OR REPLACE FUNCTION public.assert_sales_order_operator()
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
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_sales_order_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_num bigint;
BEGIN
  next_num := nextval('public.sales_order_number_seq');
  RETURN 'ORD-' || to_char(now(), 'YYYY') || '-' || lpad(next_num::text, 5, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.sales_order_active_statuses()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ARRAY[
    'confirmed',
    'planning',
    'allocated',
    'ready',
    'dispatched',
    'delivered',
    'receiving_pending',
    'receiving_confirmed'
  ]::text[];
$$;

CREATE OR REPLACE FUNCTION public.create_sales_order_notifications(_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  so public.sales_orders%ROWTYPE;
  roles public.app_role[] := ARRAY['admin'::public.app_role, 'moderator'::public.app_role];
BEGIN
  SELECT * INTO so FROM public.sales_orders WHERE id = _order_id;
  IF NOT FOUND OR so.status NOT IN ('confirmed', 'planning') THEN
    RETURN;
  END IF;

  IF to_regprocedure('public.create_notification_for_roles(public.app_role[], text, text, text, text, text, text, uuid, text)') IS NOT NULL THEN
    PERFORM public.create_notification_for_roles(
      roles,
      'operational_alerts',
      CASE WHEN so.priority = 'urgent' THEN 'High' ELSE 'Medium' END,
      'Sales Order Confirmed',
      so.order_number || ' confirmed for ' || so.client_name_snapshot || COALESCE(' - ' || so.branch_name_snapshot, ''),
      '/orders?order=' || so.id,
      'sales_order',
      so.id,
      'order-confirmed:' || so.id
    );

    IF so.priority = 'urgent' THEN
      PERFORM public.create_notification_for_roles(
        roles,
        'operational_alerts',
        'High',
        'Urgent Sales Order',
        so.order_number || ' is marked urgent.',
        '/orders?order=' || so.id,
        'sales_order',
        so.id,
        'urgent-order:' || so.id
      );
    END IF;

    IF so.requested_delivery_date <= (current_date + 1) THEN
      PERFORM public.create_notification_for_roles(
        roles,
        'operational_alerts',
        CASE WHEN so.requested_delivery_date < current_date THEN 'High' ELSE 'Medium' END,
        'Order Delivery Date Approaching',
        so.order_number || ' requested delivery is ' || so.requested_delivery_date::text || '.',
        '/orders?order=' || so.id,
        'sales_order',
        so.id,
        'order-due:' || so.id || ':requested'
      );
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_sales_order(
  _client_id uuid,
  _branch_id uuid,
  _order_source text,
  _requested_delivery_date date,
  _promised_delivery_date date,
  _priority text,
  _customer_notes text,
  _internal_notes text,
  _assigned_to uuid,
  _external_source_key text,
  _items jsonb,
  _confirm boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_id uuid;
  new_id uuid := gen_random_uuid();
  client_name text;
  branch_name text;
  item jsonb;
  product_row public.products%ROWTYPE;
  qty numeric;
  unit_value text;
  unit_price_value numeric;
BEGIN
  PERFORM public.assert_sales_order_operator();

  IF _external_source_key IS NOT NULL AND NULLIF(trim(_external_source_key), '') IS NOT NULL THEN
    SELECT id INTO existing_id
    FROM public.sales_orders
    WHERE external_source_key = trim(_external_source_key);
    IF existing_id IS NOT NULL THEN
      RETURN existing_id;
    END IF;
  END IF;

  IF _order_source NOT IN ('admin', 'customer_portal', 'whatsapp') THEN
    RAISE EXCEPTION 'Invalid order source';
  END IF;
  IF COALESCE(_priority, 'normal') NOT IN ('normal', 'high', 'urgent') THEN
    RAISE EXCEPTION 'Invalid priority';
  END IF;
  IF _requested_delivery_date IS NULL THEN
    RAISE EXCEPTION 'Requested delivery date is required';
  END IF;
  IF jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'At least one order item is required';
  END IF;

  SELECT legal_name INTO client_name
  FROM public.clients
  WHERE id = _client_id;
  IF client_name IS NULL THEN
    RAISE EXCEPTION 'Invalid client';
  END IF;

  IF _branch_id IS NOT NULL THEN
    SELECT branch_name INTO branch_name
    FROM public.branches
    WHERE id = _branch_id AND client_id = _client_id;
    IF branch_name IS NULL THEN
      RAISE EXCEPTION 'Branch does not belong to selected client';
    END IF;
  END IF;

  INSERT INTO public.sales_orders (
    id,
    order_number,
    client_id,
    branch_id,
    client_name_snapshot,
    branch_name_snapshot,
    order_source,
    external_source_key,
    requested_delivery_date,
    promised_delivery_date,
    priority,
    status,
    customer_notes,
    internal_notes,
    assigned_to,
    created_by,
    confirmed_by,
    confirmed_at
  )
  VALUES (
    new_id,
    public.generate_sales_order_number(),
    _client_id,
    _branch_id,
    client_name,
    branch_name,
    _order_source,
    NULLIF(trim(_external_source_key), ''),
    _requested_delivery_date,
    _promised_delivery_date,
    COALESCE(_priority, 'normal'),
    CASE WHEN _confirm THEN 'confirmed' ELSE 'draft' END,
    NULLIF(trim(_customer_notes), ''),
    NULLIF(trim(_internal_notes), ''),
    _assigned_to,
    auth.uid(),
    CASE WHEN _confirm THEN auth.uid() ELSE NULL END,
    CASE WHEN _confirm THEN now() ELSE NULL END
  );

  FOR item IN SELECT * FROM jsonb_array_elements(_items)
  LOOP
    SELECT * INTO product_row
    FROM public.products
    WHERE id = (item->>'product_id')::uuid
      AND is_active = true;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invalid product';
    END IF;

    qty := (item->>'quantity')::numeric;
    unit_value := trim(item->>'unit');
    unit_price_value := CASE
      WHEN item ? 'unit_price' AND item->>'unit_price' IS NOT NULL AND item->>'unit_price' <> ''
        THEN (item->>'unit_price')::numeric
      ELSE NULL
    END;

    IF qty <= 0 THEN
      RAISE EXCEPTION 'Quantity must be greater than zero';
    END IF;
    IF NULLIF(unit_value, '') IS NULL THEN
      RAISE EXCEPTION 'Unit is required';
    END IF;
    IF unit_price_value IS NOT NULL AND unit_price_value < 0 THEN
      RAISE EXCEPTION 'Unit price cannot be negative';
    END IF;

    INSERT INTO public.sales_order_items (
      sales_order_id,
      product_id,
      product_name_snapshot,
      quantity,
      unit,
      unit_price,
      notes
    )
    VALUES (
      new_id,
      product_row.id,
      product_row.name,
      qty,
      unit_value,
      unit_price_value,
      NULLIF(trim(item->>'notes'), '')
    );
  END LOOP;

  IF _confirm THEN
    PERFORM public.create_sales_order_notifications(new_id);
  END IF;

  RETURN new_id;
EXCEPTION
  WHEN unique_violation THEN
    IF _external_source_key IS NOT NULL AND NULLIF(trim(_external_source_key), '') IS NOT NULL THEN
      SELECT id INTO existing_id
      FROM public.sales_orders
      WHERE external_source_key = trim(_external_source_key);
      IF existing_id IS NOT NULL THEN
        RETURN existing_id;
      END IF;
    END IF;
    RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_sales_order(_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.assert_sales_order_operator();

  UPDATE public.sales_orders
  SET
    status = 'confirmed',
    confirmed_by = COALESCE(confirmed_by, auth.uid()),
    confirmed_at = COALESCE(confirmed_at, now()),
    updated_by = auth.uid()
  WHERE id = _order_id
    AND status = 'draft';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only draft orders can be confirmed';
  END IF;

  PERFORM public.create_sales_order_notifications(_order_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.move_sales_order_to_planning(_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.assert_sales_order_operator();

  UPDATE public.sales_orders
  SET status = 'planning', updated_by = auth.uid()
  WHERE id = _order_id
    AND status = 'confirmed';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only confirmed orders can move to planning';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_sales_order(_order_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.assert_sales_order_operator();

  IF NULLIF(trim(_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Cancellation reason is required';
  END IF;

  UPDATE public.sales_orders
  SET
    status = 'cancelled',
    cancelled_by = auth.uid(),
    cancelled_at = now(),
    cancellation_reason = trim(_reason),
    updated_by = auth.uid()
  WHERE id = _order_id
    AND status IN ('draft', 'confirmed', 'planning');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only draft, confirmed or planning orders can be cancelled';
  END IF;
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
      soi.product_id,
      soi.product_name_snapshot,
      soi.quantity,
      soi.unit
    FROM active_orders so
    JOIN public.sales_order_items soi ON soi.sales_order_id = so.id
  ),
  product_quantities AS (
    SELECT
      product_id,
      product_name_snapshot,
      unit,
      sum(quantity) AS quantity
    FROM active_items
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
      sum(quantity) AS quantity
    FROM active_items
    GROUP BY client_id, branch_id, client_name_snapshot, COALESCE(branch_name_snapshot, 'No branch'), product_id, product_name_snapshot, unit
  )
  SELECT jsonb_build_object(
    'as_of', _today,
    'orders_today', (SELECT count(*) FROM active_orders WHERE requested_delivery_date = _today),
    'orders_tomorrow', (SELECT count(*) FROM active_orders WHERE requested_delivery_date = _today + 1),
    'orders_next_3_days', (SELECT count(*) FROM active_orders WHERE requested_delivery_date BETWEEN _today AND _today + 2),
    'orders_next_7_days', (SELECT count(*) FROM active_orders WHERE requested_delivery_date BETWEEN _today AND _today + 6),
    'overdue_orders', (SELECT count(*) FROM active_orders WHERE requested_delivery_date < _today),
    'quantity_by_product', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'product_id', product_id,
          'product_name', product_name_snapshot,
          'unit', unit,
          'quantity', quantity
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
  affected_customer_branches jsonb
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
      soi.product_id,
      soi.product_name_snapshot,
      soi.quantity,
      soi.unit
    FROM public.sales_orders so
    JOIN public.sales_order_items soi ON soi.sales_order_id = so.id
    WHERE so.status = ANY(public.sales_order_active_statuses())
  )
  SELECT
    ai.product_id,
    ai.product_name_snapshot AS product_name,
    ai.unit,
    sum(ai.quantity) AS total_confirmed_demand,
    sum(ai.quantity) AS requested_quantity,
    0::numeric AS currently_allocated_quantity,
    0::numeric AS fulfilled_quantity,
    sum(ai.quantity) AS remaining_demand,
    min(ai.requested_delivery_date) AS earliest_requested_delivery,
    count(DISTINCT ai.order_id) AS order_count,
    jsonb_agg(
      DISTINCT jsonb_build_object(
        'client_id', ai.client_id,
        'branch_id', ai.branch_id,
        'client_name', ai.client_name_snapshot,
        'branch_name', COALESCE(ai.branch_name_snapshot, 'No branch')
      )
    ) AS affected_customer_branches
  FROM active_items ai
  GROUP BY ai.product_id, ai.product_name_snapshot, ai.unit
  ORDER BY min(ai.requested_delivery_date), ai.product_name_snapshot, ai.unit;
$$;

REVOKE ALL ON FUNCTION public.assert_sales_order_operator() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.generate_sales_order_number() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_sales_order_notifications(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_sales_order(uuid, uuid, text, date, date, text, text, text, uuid, text, jsonb, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.confirm_sales_order(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.move_sales_order_to_planning(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_sales_order(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sales_order_demand_summary(date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.product_demand(date) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_sales_order(uuid, uuid, text, date, date, text, text, text, uuid, text, jsonb, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_sales_order(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.move_sales_order_to_planning(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_sales_order(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sales_order_demand_summary(date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.product_demand(date) TO authenticated, service_role;
