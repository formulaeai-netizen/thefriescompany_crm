-- Phase 5D: Demand-driven production planning + BOM/recipe foundation.
-- Additive only. This migration does not mutate Cash/Bank, AR, customer
-- ledger, purchases, WhatsApp, Push, or AI Watchdog state.

CREATE OR REPLACE FUNCTION public.assert_production_planning_operator()
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

CREATE OR REPLACE FUNCTION public.assert_production_recipe_admin()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_production_actual_operator()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'moderator'::public.app_role)
    OR public.has_role(auth.uid(), 'staff'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.product_recipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finished_product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  name text NOT NULL DEFAULT 'Default recipe',
  version text,
  output_quantity numeric NOT NULL,
  output_unit text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT product_recipes_output_quantity_check CHECK (output_quantity > 0),
  CONSTRAINT product_recipes_output_unit_check CHECK (NULLIF(trim(output_unit), '') IS NOT NULL),
  CONSTRAINT product_recipes_name_check CHECK (NULLIF(trim(name), '') IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_product_recipes_one_active
  ON public.product_recipes (finished_product_id, lower(trim(output_unit)))
  WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_product_recipes_product
  ON public.product_recipes (finished_product_id, active);

CREATE TABLE IF NOT EXISTS public.product_recipe_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id uuid NOT NULL REFERENCES public.product_recipes(id) ON DELETE CASCADE,
  inventory_item_id uuid NOT NULL REFERENCES public.inventory(id) ON DELETE RESTRICT,
  quantity_required numeric NOT NULL,
  unit text NOT NULL,
  wastage_buffer_percent numeric,
  supplier_name text,
  supplier_lead_time_hours integer,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_recipe_items_quantity_check CHECK (quantity_required > 0),
  CONSTRAINT product_recipe_items_unit_check CHECK (NULLIF(trim(unit), '') IS NOT NULL),
  CONSTRAINT product_recipe_items_buffer_check CHECK (
    wastage_buffer_percent IS NULL OR (wastage_buffer_percent >= 0 AND wastage_buffer_percent <= 100)
  ),
  CONSTRAINT product_recipe_items_lead_time_check CHECK (
    supplier_lead_time_hours IS NULL OR (supplier_lead_time_hours >= 0 AND supplier_lead_time_hours <= 8760)
  )
);

CREATE INDEX IF NOT EXISTS idx_product_recipe_items_recipe
  ON public.product_recipe_items (recipe_id);
CREATE INDEX IF NOT EXISTS idx_product_recipe_items_inventory
  ON public.product_recipe_items (inventory_item_id);

CREATE TABLE IF NOT EXISTS public.production_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_date date NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finalized_at timestamptz,
  finalized_by uuid,
  responsible_user uuid,
  notes text,
  CONSTRAINT production_plans_status_check CHECK (
    status IN ('draft', 'finalized', 'in_progress', 'completed', 'cancelled')
  ),
  CONSTRAINT production_plans_finalized_check CHECK (
    status NOT IN ('finalized','in_progress','completed') OR finalized_at IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_production_plans_date_status
  ON public.production_plans (plan_date, status);
CREATE INDEX IF NOT EXISTS idx_production_plans_responsible
  ON public.production_plans (responsible_user)
  WHERE responsible_user IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.production_plan_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_plan_id uuid NOT NULL REFERENCES public.production_plans(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  product_name_snapshot text NOT NULL,
  demand_quantity numeric NOT NULL DEFAULT 0,
  delivered_quantity_snapshot numeric NOT NULL DEFAULT 0,
  finished_stock_available_snapshot numeric NOT NULL DEFAULT 0,
  planned_production_quantity numeric NOT NULL DEFAULT 0,
  actual_production_quantity numeric,
  shortage_quantity numeric NOT NULL DEFAULT 0,
  unit text NOT NULL,
  earliest_delivery_deadline date,
  source_demand_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  actual_source text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT production_plan_items_quantity_check CHECK (
    demand_quantity >= 0
    AND delivered_quantity_snapshot >= 0
    AND finished_stock_available_snapshot >= 0
    AND planned_production_quantity >= 0
    AND shortage_quantity >= 0
    AND (actual_production_quantity IS NULL OR actual_production_quantity >= 0)
  ),
  CONSTRAINT production_plan_items_unit_check CHECK (NULLIF(trim(unit), '') IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_production_plan_items_plan
  ON public.production_plan_items (production_plan_id);
CREATE INDEX IF NOT EXISTS idx_production_plan_items_product
  ON public.production_plan_items (product_id);

DROP TRIGGER IF EXISTS set_product_recipes_updated_at ON public.product_recipes;
CREATE TRIGGER set_product_recipes_updated_at
  BEFORE UPDATE ON public.product_recipes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_production_plans_updated_at ON public.production_plans;
CREATE TRIGGER set_production_plans_updated_at
  BEFORE UPDATE ON public.production_plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_production_plan_items_updated_at ON public.production_plan_items;
CREATE TRIGGER set_production_plan_items_updated_at
  BEFORE UPDATE ON public.production_plan_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.daily_production
  ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS production_plan_item_id uuid REFERENCES public.production_plan_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_daily_production_product_date
  ON public.daily_production (product_id, date)
  WHERE product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_daily_production_plan_item
  ON public.daily_production (production_plan_item_id)
  WHERE production_plan_item_id IS NOT NULL;

ALTER TABLE public.product_recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_recipe_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_plan_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.product_recipes, public.product_recipe_items, public.production_plans, public.production_plan_items
  FROM anon, authenticated;
GRANT SELECT ON public.product_recipes, public.product_recipe_items, public.production_plans, public.production_plan_items
  TO authenticated;
GRANT ALL ON public.product_recipes, public.product_recipe_items, public.production_plans, public.production_plan_items
  TO service_role;

DROP POLICY IF EXISTS "Operational users read product recipes" ON public.product_recipes;
CREATE POLICY "Operational users read product recipes"
  ON public.product_recipes FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'moderator'::public.app_role)
  );

DROP POLICY IF EXISTS "Operational users read product recipe items" ON public.product_recipe_items;
CREATE POLICY "Operational users read product recipe items"
  ON public.product_recipe_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.product_recipes r
      WHERE r.id = product_recipe_items.recipe_id
        AND (
          public.has_role(auth.uid(), 'admin'::public.app_role)
          OR public.has_role(auth.uid(), 'moderator'::public.app_role)
        )
    )
  );

DROP POLICY IF EXISTS "Production users read plans" ON public.production_plans;
CREATE POLICY "Production users read plans"
  ON public.production_plans FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'moderator'::public.app_role)
    OR (public.has_role(auth.uid(), 'staff'::public.app_role) AND responsible_user = auth.uid())
  );

DROP POLICY IF EXISTS "Production users read plan items" ON public.production_plan_items;
CREATE POLICY "Production users read plan items"
  ON public.production_plan_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.production_plans p
      WHERE p.id = production_plan_items.production_plan_id
        AND (
          public.has_role(auth.uid(), 'admin'::public.app_role)
          OR public.has_role(auth.uid(), 'moderator'::public.app_role)
          OR (public.has_role(auth.uid(), 'staff'::public.app_role) AND p.responsible_user = auth.uid())
        )
    )
  );

CREATE OR REPLACE FUNCTION public.production_planning_requirements(
  _start_date date DEFAULT current_date,
  _days integer DEFAULT 1
)
RETURNS TABLE (
  product_id uuid,
  product_name text,
  unit text,
  confirmed_demand numeric,
  already_delivered numeric,
  remaining_demand numeric,
  finished_stock_available numeric,
  production_required numeric,
  planned_production_quantity numeric,
  predicted_shortfall numeric,
  affected_order_count bigint,
  affected_customer_branches jsonb,
  earliest_delivery_deadline date,
  window_start date,
  window_end date,
  stock_source text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH bounds AS (
    SELECT
      COALESCE(_start_date, current_date) AS start_date,
      COALESCE(_start_date, current_date) + (LEAST(GREATEST(COALESCE(_days, 1), 1), 30) - 1) AS end_date
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
    FROM public.sales_orders so
    JOIN public.sales_order_items soi ON soi.sales_order_id = so.id
    CROSS JOIN bounds b
    WHERE so.status = ANY(public.sales_order_active_statuses())
      AND so.requested_delivery_date BETWEEN b.start_date AND b.end_date
  ),
  fulfilled AS (
    SELECT
      foi.sales_order_item_id,
      COALESCE(SUM(foi.delivered_quantity) FILTER (WHERE f.status NOT IN ('cancelled', 'failed')), 0) AS delivered_quantity
    FROM public.sales_order_fulfillment_items foi
    JOIN public.sales_order_fulfillments f ON f.id = foi.fulfillment_id
    GROUP BY foi.sales_order_item_id
  ),
  demand AS (
    SELECT
      ai.product_id,
      ai.product_name_snapshot AS product_name,
      ai.unit,
      SUM(ai.quantity) AS confirmed_demand,
      SUM(COALESCE(f.delivered_quantity, 0)) AS already_delivered,
      SUM(GREATEST(ai.quantity - COALESCE(f.delivered_quantity, 0), 0)) AS remaining_demand,
      COUNT(DISTINCT ai.order_id) AS affected_order_count,
      MIN(ai.requested_delivery_date) AS earliest_delivery_deadline,
      jsonb_agg(
        DISTINCT jsonb_build_object(
          'client_id', ai.client_id,
          'branch_id', ai.branch_id,
          'client_name', ai.client_name_snapshot,
          'branch_name', COALESCE(ai.branch_name_snapshot, 'No branch')
        )
      ) AS affected_customer_branches
    FROM active_items ai
    LEFT JOIN fulfilled f ON f.sales_order_item_id = ai.sales_order_item_id
    GROUP BY ai.product_id, ai.product_name_snapshot, ai.unit
  ),
  stock AS (
    SELECT
      d.product_id,
      d.unit,
      COALESCE(SUM(i.current_stock), 0) AS available_stock
    FROM demand d
    LEFT JOIN public.inventory i
      ON lower(trim(i.item_name)) = lower(trim(d.product_name))
     AND lower(trim(i.unit)) = lower(trim(d.unit))
    GROUP BY d.product_id, d.unit
  ),
  planned AS (
    SELECT
      ppi.product_id,
      ppi.unit,
      COALESCE(SUM(ppi.planned_production_quantity), 0) AS planned_quantity
    FROM public.production_plan_items ppi
    JOIN public.production_plans pp ON pp.id = ppi.production_plan_id
    CROSS JOIN bounds b
    WHERE pp.status IN ('draft', 'finalized', 'in_progress')
      AND pp.plan_date BETWEEN b.start_date AND b.end_date
    GROUP BY ppi.product_id, ppi.unit
  )
  SELECT
    d.product_id,
    d.product_name,
    d.unit,
    d.confirmed_demand,
    d.already_delivered,
    d.remaining_demand,
    COALESCE(s.available_stock, 0) AS finished_stock_available,
    GREATEST(d.remaining_demand - COALESCE(s.available_stock, 0), 0) AS production_required,
    COALESCE(pl.planned_quantity, 0) AS planned_production_quantity,
    GREATEST(GREATEST(d.remaining_demand - COALESCE(s.available_stock, 0), 0) - COALESCE(pl.planned_quantity, 0), 0) AS predicted_shortfall,
    d.affected_order_count,
    d.affected_customer_branches,
    d.earliest_delivery_deadline,
    b.start_date AS window_start,
    b.end_date AS window_end,
    'inventory.item_name + unit matched to products.name + demand unit'::text AS stock_source
  FROM demand d
  CROSS JOIN bounds b
  LEFT JOIN stock s ON s.product_id = d.product_id AND s.unit = d.unit
  LEFT JOIN planned pl ON pl.product_id = d.product_id AND pl.unit = d.unit
  ORDER BY d.earliest_delivery_deadline, d.product_name, d.unit;
$$;

CREATE OR REPLACE FUNCTION public.production_planning_raw_requirements(
  _start_date date DEFAULT current_date,
  _days integer DEFAULT 1
)
RETURNS TABLE (
  product_id uuid,
  product_name text,
  product_unit text,
  production_required numeric,
  planned_production_quantity numeric,
  planning_quantity numeric,
  recipe_id uuid,
  recipe_status text,
  raw_material_id uuid,
  raw_material_name text,
  raw_material_unit text,
  required_quantity numeric,
  available_quantity numeric,
  safety_stock numeric,
  shortage_quantity numeric,
  reorder_recommendation text,
  suggested_order_quantity numeric,
  supplier_name text,
  supplier_lead_time_hours integer,
  required_by date,
  reason text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH req AS (
    SELECT *, GREATEST(production_required, planned_production_quantity) AS planning_quantity
    FROM public.production_planning_requirements(_start_date, _days)
  ),
  active_recipe AS (
    SELECT DISTINCT ON (r.finished_product_id, lower(trim(r.output_unit)))
      r.*
    FROM public.product_recipes r
    WHERE r.active = true
    ORDER BY r.finished_product_id, lower(trim(r.output_unit)), r.updated_at DESC
  ),
  raw AS (
    SELECT
      req.product_id,
      req.product_name,
      req.unit AS product_unit,
      req.production_required,
      req.planned_production_quantity,
      req.planning_quantity,
      r.id AS recipe_id,
      CASE WHEN r.id IS NULL THEN 'recipe_not_configured' ELSE 'configured' END AS recipe_status,
      ri.inventory_item_id AS raw_material_id,
      inv.item_name AS raw_material_name,
      ri.unit AS raw_material_unit,
      CASE
        WHEN r.id IS NULL THEN NULL
        ELSE (req.planning_quantity / r.output_quantity)
          * ri.quantity_required
          * (1 + COALESCE(ri.wastage_buffer_percent, 0) / 100)
      END AS required_quantity,
      CASE
        WHEN inv.id IS NULL OR lower(trim(inv.unit)) <> lower(trim(ri.unit)) THEN NULL
        ELSE COALESCE(inv.current_stock, 0)
      END AS available_quantity,
      CASE
        WHEN inv.id IS NULL OR lower(trim(inv.unit)) <> lower(trim(ri.unit)) THEN NULL
        ELSE COALESCE(inv.minimum_stock, 0)
      END AS safety_stock,
      ri.supplier_name,
      ri.supplier_lead_time_hours,
      req.earliest_delivery_deadline AS required_by,
      inv.unit AS inventory_unit
    FROM req
    LEFT JOIN active_recipe r
      ON r.finished_product_id = req.product_id
     AND lower(trim(r.output_unit)) = lower(trim(req.unit))
    LEFT JOIN public.product_recipe_items ri ON ri.recipe_id = r.id
    LEFT JOIN public.inventory inv ON inv.id = ri.inventory_item_id
  )
  SELECT
    raw.product_id,
    raw.product_name,
    raw.product_unit,
    raw.production_required,
    raw.planned_production_quantity,
    raw.planning_quantity,
    raw.recipe_id,
    raw.recipe_status,
    raw.raw_material_id,
    raw.raw_material_name,
    raw.raw_material_unit,
    raw.required_quantity,
    raw.available_quantity,
    raw.safety_stock,
    CASE
      WHEN raw.recipe_status = 'recipe_not_configured' THEN NULL
      WHEN raw.available_quantity IS NULL THEN NULL
      ELSE GREATEST(raw.required_quantity + COALESCE(raw.safety_stock, 0) - raw.available_quantity, 0)
    END AS shortage_quantity,
    CASE
      WHEN raw.recipe_status = 'recipe_not_configured' THEN 'Recipe Required'
      WHEN raw.available_quantity IS NULL THEN 'Check Unit'
      WHEN GREATEST(raw.required_quantity + COALESCE(raw.safety_stock, 0) - raw.available_quantity, 0) > 0 THEN
        CASE
          WHEN raw.available_quantity < raw.required_quantity THEN 'Order Now / Critical'
          ELSE 'Order Soon'
        END
      WHEN raw.available_quantity <= COALESCE(raw.safety_stock, 0) THEN 'Monitor'
      ELSE 'No Action'
    END AS reorder_recommendation,
    CASE
      WHEN raw.recipe_status = 'recipe_not_configured' OR raw.available_quantity IS NULL THEN NULL
      ELSE GREATEST(raw.required_quantity + COALESCE(raw.safety_stock, 0) - raw.available_quantity, 0)
    END AS suggested_order_quantity,
    raw.supplier_name,
    raw.supplier_lead_time_hours,
    raw.required_by,
    CASE
      WHEN raw.recipe_status = 'recipe_not_configured' THEN 'Raw-material requirement unavailable - recipe not configured.'
      WHEN raw.available_quantity IS NULL THEN 'Raw material inventory unit does not match configured recipe unit.'
      WHEN GREATEST(raw.required_quantity + COALESCE(raw.safety_stock, 0) - raw.available_quantity, 0) > 0 THEN
        'Required quantity plus safety stock exceeds available raw material.'
      ELSE 'Raw material position is sufficient for this planning window.'
    END AS reason
  FROM raw
  ORDER BY raw.required_by, raw.product_name, raw.raw_material_name NULLS FIRST;
$$;

CREATE OR REPLACE FUNCTION public.create_or_replace_product_recipe(
  _recipe_id uuid,
  _finished_product_id uuid,
  _name text,
  _version text,
  _output_quantity numeric,
  _output_unit text,
  _active boolean,
  _items jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_recipe_id uuid := COALESCE(_recipe_id, gen_random_uuid());
  item jsonb;
BEGIN
  PERFORM public.assert_production_recipe_admin();

  IF _finished_product_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.products WHERE id = _finished_product_id AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Active finished product is required';
  END IF;
  IF _output_quantity IS NULL OR _output_quantity <= 0 THEN
    RAISE EXCEPTION 'Recipe output quantity must be greater than zero';
  END IF;
  IF NULLIF(trim(_output_unit), '') IS NULL THEN
    RAISE EXCEPTION 'Recipe output unit is required';
  END IF;
  IF jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'At least one raw material is required';
  END IF;

  IF COALESCE(_active, true) THEN
    UPDATE public.product_recipes
    SET active = false, updated_by = auth.uid()
    WHERE finished_product_id = _finished_product_id
      AND lower(trim(output_unit)) = lower(trim(_output_unit))
      AND id <> new_recipe_id;
  END IF;

  INSERT INTO public.product_recipes (
    id, finished_product_id, name, version, output_quantity, output_unit,
    active, created_by, updated_by
  )
  VALUES (
    new_recipe_id,
    _finished_product_id,
    COALESCE(NULLIF(trim(_name), ''), 'Default recipe'),
    NULLIF(trim(_version), ''),
    _output_quantity,
    trim(_output_unit),
    COALESCE(_active, true),
    auth.uid(),
    auth.uid()
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    version = EXCLUDED.version,
    output_quantity = EXCLUDED.output_quantity,
    output_unit = EXCLUDED.output_unit,
    active = EXCLUDED.active,
    updated_by = auth.uid();

  DELETE FROM public.product_recipe_items WHERE recipe_id = new_recipe_id;

  FOR item IN SELECT * FROM jsonb_array_elements(_items)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.inventory WHERE id = (item->>'inventory_item_id')::uuid
    ) THEN
      RAISE EXCEPTION 'Invalid raw material inventory item';
    END IF;
    IF (item->>'quantity_required')::numeric <= 0 THEN
      RAISE EXCEPTION 'Raw material quantity must be greater than zero';
    END IF;
    IF NULLIF(trim(item->>'unit'), '') IS NULL THEN
      RAISE EXCEPTION 'Raw material unit is required';
    END IF;

    INSERT INTO public.product_recipe_items (
      recipe_id,
      inventory_item_id,
      quantity_required,
      unit,
      wastage_buffer_percent,
      supplier_name,
      supplier_lead_time_hours,
      notes
    )
    VALUES (
      new_recipe_id,
      (item->>'inventory_item_id')::uuid,
      (item->>'quantity_required')::numeric,
      trim(item->>'unit'),
      CASE WHEN item ? 'wastage_buffer_percent' AND NULLIF(item->>'wastage_buffer_percent', '') IS NOT NULL
        THEN (item->>'wastage_buffer_percent')::numeric ELSE NULL END,
      NULLIF(trim(item->>'supplier_name'), ''),
      CASE WHEN item ? 'supplier_lead_time_hours' AND NULLIF(item->>'supplier_lead_time_hours', '') IS NOT NULL
        THEN (item->>'supplier_lead_time_hours')::integer ELSE NULL END,
      NULLIF(trim(item->>'notes'), '')
    );
  END LOOP;

  RETURN new_recipe_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.deactivate_product_recipe(_recipe_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.assert_production_recipe_admin();
  UPDATE public.product_recipes
  SET active = false, updated_by = auth.uid()
  WHERE id = _recipe_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recipe not found';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_production_plan(
  _plan_date date,
  _responsible_user uuid,
  _notes text,
  _items jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_plan_id uuid := gen_random_uuid();
  item jsonb;
  product_row public.products%ROWTYPE;
BEGIN
  PERFORM public.assert_production_planning_operator();

  IF _plan_date IS NULL THEN
    RAISE EXCEPTION 'Plan date is required';
  END IF;
  IF jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'At least one production plan item is required';
  END IF;

  INSERT INTO public.production_plans (id, plan_date, responsible_user, notes, created_by)
  VALUES (new_plan_id, _plan_date, _responsible_user, NULLIF(trim(_notes), ''), auth.uid());

  FOR item IN SELECT * FROM jsonb_array_elements(_items)
  LOOP
    SELECT * INTO product_row FROM public.products WHERE id = (item->>'product_id')::uuid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invalid product';
    END IF;
    IF (item->>'planned_production_quantity')::numeric < 0 THEN
      RAISE EXCEPTION 'Planned production cannot be negative';
    END IF;

    INSERT INTO public.production_plan_items (
      production_plan_id,
      product_id,
      product_name_snapshot,
      demand_quantity,
      delivered_quantity_snapshot,
      finished_stock_available_snapshot,
      planned_production_quantity,
      shortage_quantity,
      unit,
      earliest_delivery_deadline,
      source_demand_metadata,
      notes
    )
    VALUES (
      new_plan_id,
      product_row.id,
      product_row.name,
      COALESCE((item->>'demand_quantity')::numeric, 0),
      COALESCE((item->>'delivered_quantity_snapshot')::numeric, 0),
      COALESCE((item->>'finished_stock_available_snapshot')::numeric, 0),
      (item->>'planned_production_quantity')::numeric,
      GREATEST(
        COALESCE((item->>'demand_quantity')::numeric, 0)
        - COALESCE((item->>'finished_stock_available_snapshot')::numeric, 0)
        - (item->>'planned_production_quantity')::numeric,
        0
      ),
      trim(item->>'unit'),
      CASE WHEN item ? 'earliest_delivery_deadline' AND NULLIF(item->>'earliest_delivery_deadline', '') IS NOT NULL
        THEN (item->>'earliest_delivery_deadline')::date ELSE NULL END,
      COALESCE(item->'source_demand_metadata', '{}'::jsonb),
      NULLIF(trim(item->>'notes'), '')
    );
  END LOOP;

  RETURN new_plan_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_production_plan(_plan_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.assert_production_planning_operator();
  UPDATE public.production_plans
  SET status = 'finalized', finalized_at = now(), finalized_by = auth.uid()
  WHERE id = _plan_id AND status = 'draft';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only draft production plans can be finalized';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_production_plan_in_progress(_plan_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.assert_production_planning_operator();
  UPDATE public.production_plans
  SET status = 'in_progress', finalized_at = COALESCE(finalized_at, now()), finalized_by = COALESCE(finalized_by, auth.uid())
  WHERE id = _plan_id AND status IN ('draft', 'finalized');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Production plan cannot move to in progress';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_production_plan(_plan_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.assert_production_planning_operator();
  PERFORM public.refresh_production_plan_actuals(_plan_id);
  UPDATE public.production_plans
  SET status = 'completed'
  WHERE id = _plan_id AND status IN ('finalized', 'in_progress');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only finalized or in-progress production plans can be completed';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_production_plan_actuals(_plan_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.assert_production_actual_operator();

  UPDATE public.production_plan_items ppi
  SET
    actual_production_quantity = actuals.actual_quantity,
    actual_source = actuals.actual_source
  FROM (
    SELECT
      ppi_inner.id,
      COALESCE(SUM(COALESCE(dp.actual_packs_produced, dp.packs_produced)), 0) AS actual_quantity,
      'daily_production.production_plan_item_id/product_id/date'::text AS actual_source
    FROM public.production_plan_items ppi_inner
    JOIN public.production_plans pp ON pp.id = ppi_inner.production_plan_id
    LEFT JOIN public.daily_production dp
      ON dp.production_plan_item_id = ppi_inner.id
      OR (
        dp.production_plan_item_id IS NULL
        AND dp.product_id = ppi_inner.product_id
        AND dp.date = pp.plan_date
        AND lower(trim(ppi_inner.unit)) IN ('pack','packs','packet','packets')
      )
    WHERE ppi_inner.production_plan_id = _plan_id
    GROUP BY ppi_inner.id
  ) actuals
  WHERE ppi.id = actuals.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_production_plan(_plan_id uuid, _notes text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.assert_production_planning_operator();
  UPDATE public.production_plans
  SET status = 'cancelled', notes = COALESCE(NULLIF(trim(_notes), ''), notes)
  WHERE id = _plan_id AND status IN ('draft', 'finalized');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only draft or finalized production plans can be cancelled';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.scan_production_planning_notifications(
  _start_date date DEFAULT current_date,
  _days integer DEFAULT 1
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_count integer := 0;
  rec record;
  note_count integer;
BEGIN
  PERFORM public.assert_production_planning_operator();

  IF to_regprocedure('public.create_notification_for_roles(public.app_role[], text, text, text, text, text, text, uuid, text)') IS NULL THEN
    RETURN 0;
  END IF;

  FOR rec IN
    SELECT *
    FROM public.production_planning_requirements(_start_date, _days)
    WHERE predicted_shortfall > 0
  LOOP
    SELECT COUNT(*) INTO note_count
    FROM public.create_notification_for_roles(
      ARRAY['admin'::public.app_role, 'moderator'::public.app_role],
      'operational_alerts',
      CASE WHEN rec.earliest_delivery_deadline <= current_date THEN 'High' ELSE 'Medium' END,
      'Production Shortfall Risk',
      rec.product_name || ' committed demand exceeds finished stock plus planned production by ' || rec.predicted_shortfall::text || ' ' || rec.unit || '.',
      '/production-planning',
      'production_planning',
      rec.product_id,
      'production-shortfall:' || rec.product_id::text || ':' || rec.window_start::text || ':' || rec.window_end::text || ':' || rec.unit
    );
    inserted_count := inserted_count + note_count;
  END LOOP;

  FOR rec IN
    SELECT *
    FROM public.production_planning_raw_requirements(_start_date, _days)
    WHERE shortage_quantity > 0
  LOOP
    SELECT COUNT(*) INTO note_count
    FROM public.create_notification_for_roles(
      ARRAY['admin'::public.app_role, 'moderator'::public.app_role],
      'operational_alerts',
      'High',
      'Raw Material Shortage',
      rec.raw_material_name || ' is short by ' || rec.shortage_quantity::text || ' ' || rec.raw_material_unit || ' for ' || rec.product_name || '.',
      '/production-planning',
      'production_planning',
      rec.product_id,
      'raw-material-shortage:' || rec.product_id::text || ':' || rec.raw_material_id::text || ':' || COALESCE(rec.required_by::text, _start_date::text)
    );
    inserted_count := inserted_count + note_count;
  END LOOP;

  RETURN inserted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_production_planning_operator() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assert_production_recipe_admin() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assert_production_actual_operator() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_or_replace_product_recipe(uuid, uuid, text, text, numeric, text, boolean, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.deactivate_product_recipe(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_production_plan(date, uuid, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.finalize_production_plan(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_production_plan_in_progress(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_production_plan(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.refresh_production_plan_actuals(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_production_plan(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.scan_production_planning_notifications(date, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.production_planning_requirements(date, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.production_planning_raw_requirements(date, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_or_replace_product_recipe(uuid, uuid, text, text, numeric, text, boolean, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.deactivate_product_recipe(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_production_plan(date, uuid, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finalize_production_plan(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_production_plan_in_progress(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_production_plan(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refresh_production_plan_actuals(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_production_plan(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.scan_production_planning_notifications(date, integer) TO authenticated, service_role;
