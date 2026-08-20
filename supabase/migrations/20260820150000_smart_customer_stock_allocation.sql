-- Advisory allocation only: this migration never creates invoices, ledger rows, or receivables.
CREATE TABLE IF NOT EXISTS public.allocation_minimum_delivery_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES public.products(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE CASCADE,
  minimum_useful_quantity numeric NOT NULL CHECK (minimum_useful_quantity > 0),
  unit text NOT NULL,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (product_id IS NOT NULL OR client_id IS NOT NULL OR branch_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS public.stock_allocation_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_date date NOT NULL DEFAULT current_date,
  strategy text NOT NULL DEFAULT 'fair_share' CHECK (strategy IN ('fair_share','oldest_first','priority_weighted')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','partially_executed','completed','cancelled')),
  notes text,
  generated_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  approved_by uuid REFERENCES auth.users(id),
  responsible_operator uuid REFERENCES auth.users(id),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES auth.users(id)
);

CREATE TABLE IF NOT EXISTS public.stock_allocation_plan_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  allocation_plan_id uuid NOT NULL REFERENCES public.stock_allocation_plans(id) ON DELETE CASCADE,
  sales_order_id uuid NOT NULL REFERENCES public.sales_orders(id),
  sales_order_item_id uuid NOT NULL REFERENCES public.sales_order_items(id),
  order_number_snapshot text NOT NULL,
  product_id uuid NOT NULL REFERENCES public.products(id),
  product_name_snapshot text NOT NULL,
  client_name_snapshot text NOT NULL,
  branch_name_snapshot text,
  unit text NOT NULL,
  waiting_days integer NOT NULL DEFAULT 0 CHECK (waiting_days >= 0),
  remaining_quantity numeric NOT NULL CHECK (remaining_quantity >= 0),
  minimum_viable_quantity numeric,
  original_suggested_quantity numeric NOT NULL CHECK (original_suggested_quantity >= 0),
  approved_quantity numeric CHECK (approved_quantity >= 0),
  score numeric NOT NULL,
  reason text NOT NULL,
  priority text NOT NULL,
  requested_delivery_date date NOT NULL,
  promised_delivery_date date,
  planned_delivery_date date NOT NULL,
  fulfillment_id uuid REFERENCES public.sales_order_fulfillments(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (original_suggested_quantity <= remaining_quantity),
  CHECK (approved_quantity IS NULL OR approved_quantity <= remaining_quantity)
);

CREATE INDEX IF NOT EXISTS idx_stock_allocation_plans_status ON public.stock_allocation_plans(status, plan_date DESC);
CREATE INDEX IF NOT EXISTS idx_stock_allocation_plan_items_product ON public.stock_allocation_plan_items(product_id, unit);
CREATE INDEX IF NOT EXISTS idx_stock_allocation_plan_items_order ON public.stock_allocation_plan_items(sales_order_id, sales_order_item_id);

ALTER TABLE public.allocation_minimum_delivery_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_allocation_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_allocation_plan_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.allocation_minimum_delivery_policies, public.stock_allocation_plans, public.stock_allocation_plan_items FROM anon;
GRANT SELECT ON public.allocation_minimum_delivery_policies, public.stock_allocation_plans, public.stock_allocation_plan_items TO authenticated;
GRANT ALL ON public.allocation_minimum_delivery_policies, public.stock_allocation_plans, public.stock_allocation_plan_items TO service_role;
DROP POLICY IF EXISTS "Allocation operators read policies" ON public.allocation_minimum_delivery_policies;
CREATE POLICY "Allocation operators read policies" ON public.allocation_minimum_delivery_policies FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'moderator'));
DROP POLICY IF EXISTS "Allocation admins manage policies" ON public.allocation_minimum_delivery_policies;
CREATE POLICY "Allocation admins manage policies" ON public.allocation_minimum_delivery_policies FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
DROP POLICY IF EXISTS "Allocation operators read plans" ON public.stock_allocation_plans;
CREATE POLICY "Allocation operators read plans" ON public.stock_allocation_plans FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'moderator'));
DROP POLICY IF EXISTS "Allocation operators read plan items" ON public.stock_allocation_plan_items;
CREATE POLICY "Allocation operators read plan items" ON public.stock_allocation_plan_items FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'moderator'));

CREATE OR REPLACE FUNCTION public.assert_allocation_operator()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'moderator')) THEN RAISE EXCEPTION 'Forbidden'; END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.create_stock_allocation_plan(_plan_date date, _strategy text, _notes text, _items jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid := gen_random_uuid(); item jsonb;
BEGIN
  PERFORM public.assert_allocation_operator();
  IF _strategy NOT IN ('fair_share','oldest_first','priority_weighted') THEN RAISE EXCEPTION 'Invalid allocation strategy'; END IF;
  IF jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items)=0 THEN RAISE EXCEPTION 'At least one allocation item is required'; END IF;
  INSERT INTO public.stock_allocation_plans(id,plan_date,strategy,notes,created_by) VALUES(v_id,COALESCE(_plan_date,current_date),_strategy,NULLIF(trim(_notes),''),auth.uid());
  FOR item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    IF (item->>'suggested_quantity')::numeric < 0 OR (item->>'suggested_quantity')::numeric > (item->>'remaining_quantity')::numeric THEN RAISE EXCEPTION 'Suggested quantity exceeds remaining demand'; END IF;
    INSERT INTO public.stock_allocation_plan_items(allocation_plan_id,sales_order_id,sales_order_item_id,order_number_snapshot,product_id,product_name_snapshot,client_name_snapshot,branch_name_snapshot,unit,waiting_days,remaining_quantity,minimum_viable_quantity,original_suggested_quantity,score,reason,priority,requested_delivery_date,promised_delivery_date,planned_delivery_date)
    VALUES(v_id,(item->>'sales_order_id')::uuid,(item->>'sales_order_item_id')::uuid,item->>'order_number',(item->>'product_id')::uuid,item->>'product_name',item->>'client_name',NULLIF(item->>'branch_name',''),item->>'unit',COALESCE((item->>'waiting_days')::integer,0),(item->>'remaining_quantity')::numeric,CASE WHEN NULLIF(item->>'minimum_viable_quantity','') IS NULL THEN NULL ELSE (item->>'minimum_viable_quantity')::numeric END,(item->>'suggested_quantity')::numeric,(item->>'score')::numeric,item->>'reason',item->>'priority',(item->>'requested_delivery_date')::date,CASE WHEN NULLIF(item->>'promised_delivery_date','') IS NULL THEN NULL ELSE (item->>'promised_delivery_date')::date END,(item->>'planned_delivery_date')::date);
  END LOOP;
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.approve_stock_allocation_plan(_plan_id uuid, _items jsonb DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE item jsonb;
BEGIN
  PERFORM public.assert_allocation_operator();
  IF EXISTS (SELECT 1 FROM public.stock_allocation_plans WHERE id=_plan_id AND status='approved') THEN RETURN; END IF;
  IF _items IS NOT NULL THEN
    FOR item IN SELECT * FROM jsonb_array_elements(_items) LOOP
      UPDATE public.stock_allocation_plan_items SET approved_quantity=(item->>'approved_quantity')::numeric, planned_delivery_date=COALESCE((item->>'planned_delivery_date')::date,planned_delivery_date)
      WHERE id=(item->>'id')::uuid AND allocation_plan_id=_plan_id AND (item->>'approved_quantity')::numeric BETWEEN 0 AND remaining_quantity;
      IF NOT FOUND THEN RAISE EXCEPTION 'Invalid approved allocation quantity'; END IF;
    END LOOP;
  END IF;
  UPDATE public.stock_allocation_plan_items SET approved_quantity=COALESCE(approved_quantity,original_suggested_quantity) WHERE allocation_plan_id=_plan_id;
  UPDATE public.stock_allocation_plans SET status='approved',approved_at=now(),approved_by=auth.uid() WHERE id=_plan_id AND status='draft';
  IF NOT FOUND THEN RAISE EXCEPTION 'Only draft allocation plans can be approved'; END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.cancel_stock_allocation_plan(_plan_id uuid, _notes text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM public.assert_allocation_operator();
  UPDATE public.stock_allocation_plans SET status='cancelled',notes=COALESCE(NULLIF(trim(_notes),''),notes),cancelled_at=now(),cancelled_by=auth.uid() WHERE id=_plan_id AND status IN ('draft','approved','partially_executed');
  IF NOT FOUND THEN RAISE EXCEPTION 'Allocation plan cannot be cancelled'; END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.scan_stock_allocation_notifications()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE rec record; n integer:=0; c integer;
BEGIN
  PERFORM public.assert_allocation_operator();
  IF to_regprocedure('public.create_notification_for_roles(public.app_role[], text, text, text, text, text, text, uuid, text)') IS NULL THEN RETURN 0; END IF;
  FOR rec IN SELECT p.id,p.plan_date FROM public.stock_allocation_plans p WHERE p.status='draft' LOOP
    SELECT count(*) INTO c FROM public.create_notification_for_roles(ARRAY['admin'::public.app_role,'moderator'::public.app_role],'operational_alerts','Medium','Stock Allocation Requires Approval','A draft stock allocation plan is ready for operational review.','/allocation-delivery-plan','stock_allocation_plan',rec.id,'allocation-approval:'||rec.id::text); n:=n+c;
  END LOOP;
  FOR rec IN SELECT i.*,p.status FROM public.stock_allocation_plan_items i JOIN public.stock_allocation_plans p ON p.id=i.allocation_plan_id WHERE p.status IN ('draft','approved') AND COALESCE(i.approved_quantity,i.original_suggested_quantity)<i.remaining_quantity LOOP
    SELECT count(*) INTO c FROM public.create_notification_for_roles(ARRAY['admin'::public.app_role,'moderator'::public.app_role],'operational_alerts',CASE WHEN rec.requested_delivery_date<=current_date THEN 'High' ELSE 'Medium' END,'Customer Allocation Shortfall',rec.order_number_snapshot||' remains partially unfulfilled for '||rec.product_name_snapshot||'.','/allocation-delivery-plan','stock_allocation_item',rec.id,'allocation-shortfall:'||rec.id::text); n:=n+c;
  END LOOP;
  RETURN n;
END; $$;

REVOKE ALL ON FUNCTION public.assert_allocation_operator() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.create_stock_allocation_plan(date,text,text,jsonb) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.approve_stock_allocation_plan(uuid,jsonb) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.cancel_stock_allocation_plan(uuid,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.scan_stock_allocation_notifications() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_stock_allocation_plan(date,text,text,jsonb),public.approve_stock_allocation_plan(uuid,jsonb),public.cancel_stock_allocation_plan(uuid,text),public.scan_stock_allocation_notifications() TO authenticated,service_role;
