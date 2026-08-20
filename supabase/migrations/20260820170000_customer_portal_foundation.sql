-- Customer access is additive and separate from internal CRM identities.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'customer';

CREATE TABLE public.customer_portal_identities (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);
CREATE TABLE public.customer_portal_branch_access (
  user_id uuid NOT NULL REFERENCES public.customer_portal_identities(user_id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  PRIMARY KEY(user_id, branch_id)
);
CREATE TABLE public.customer_product_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE CASCADE,
  alias text NOT NULL,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX customer_product_aliases_unique ON public.customer_product_aliases(client_id, branch_id, lower(alias)) NULLS NOT DISTINCT;
ALTER TABLE public.customer_portal_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_portal_branch_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_product_aliases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Customer identity self read" ON public.customer_portal_identities FOR SELECT TO authenticated USING (user_id=auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Customer branch self read" ON public.customer_portal_branch_access FOR SELECT TO authenticated USING (user_id=auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Customer aliases self read" ON public.customer_product_aliases FOR SELECT TO authenticated USING (client_id=(SELECT client_id FROM public.customer_portal_identities WHERE user_id=auth.uid()) OR public.has_role(auth.uid(),'admin'));

CREATE OR REPLACE FUNCTION public.assert_customer_portal_identity(_branch_id uuid DEFAULT NULL)
RETURNS public.customer_portal_identities LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE identity public.customer_portal_identities;
BEGIN
 SELECT * INTO identity FROM public.customer_portal_identities WHERE user_id=auth.uid() AND is_active;
 IF NOT FOUND OR NOT public.has_role(auth.uid(),'customer') THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 IF _branch_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.customer_portal_branch_access WHERE user_id=auth.uid() AND branch_id=_branch_id) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 RETURN identity;
END; $$;

CREATE OR REPLACE FUNCTION public.create_customer_portal_order(_branch_id uuid,_requested_delivery_date date,_customer_notes text,_items jsonb,_external_source_key text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE identity public.customer_portal_identities; existing_id uuid; new_id uuid:=gen_random_uuid(); item jsonb; product_row public.products%ROWTYPE; branch_name text;
BEGIN
 identity:=public.assert_customer_portal_identity(_branch_id);
 IF jsonb_typeof(_items)<>'array' OR jsonb_array_length(_items)=0 THEN RAISE EXCEPTION 'Invalid order'; END IF;
 IF NULLIF(trim(_external_source_key),'') IS NOT NULL THEN SELECT id INTO existing_id FROM public.sales_orders WHERE external_source_key=trim(_external_source_key); IF existing_id IS NOT NULL THEN RETURN existing_id; END IF; END IF;
 SELECT branch_name INTO branch_name FROM public.branches WHERE id=_branch_id AND client_id=identity.client_id; IF branch_name IS NULL THEN RAISE EXCEPTION 'Forbidden'; END IF;
 INSERT INTO public.sales_orders(id,order_number,client_id,branch_id,client_name_snapshot,branch_name_snapshot,order_source,external_source_key,requested_delivery_date,priority,status,customer_notes,created_by) SELECT new_id,public.generate_sales_order_number(),identity.client_id,_branch_id,c.legal_name,branch_name,'customer_portal',NULLIF(trim(_external_source_key),''),_requested_delivery_date,'normal','draft',NULLIF(trim(_customer_notes),''),auth.uid() FROM public.clients c WHERE c.id=identity.client_id;
 FOR item IN SELECT * FROM jsonb_array_elements(_items) LOOP
   SELECT * INTO product_row FROM public.products WHERE id=(item->>'product_id')::uuid AND is_active; IF NOT FOUND OR (item->>'quantity')::numeric<=0 THEN RAISE EXCEPTION 'Invalid order'; END IF;
   INSERT INTO public.sales_order_items(sales_order_id,product_id,product_name_snapshot,quantity,unit) VALUES(new_id,product_row.id,product_row.name,(item->>'quantity')::numeric,COALESCE(NULLIF(trim(item->>'unit'),''),'packs'));
 END LOOP;
 IF to_regprocedure('public.create_notification_for_roles(public.app_role[], text, text, text, text, text, text, uuid, text)') IS NOT NULL THEN PERFORM public.create_notification_for_roles(ARRAY['admin'::public.app_role,'moderator'::public.app_role],'operational_alerts','Medium','New Customer Order','A customer order is ready for review.','/orders?order='||new_id,'sales_order',new_id,'customer-order:'||new_id); END IF;
 RETURN new_id;
EXCEPTION WHEN unique_violation THEN SELECT id INTO existing_id FROM public.sales_orders WHERE external_source_key=trim(_external_source_key); RETURN existing_id;
END; $$;
REVOKE ALL ON FUNCTION public.assert_customer_portal_identity(uuid),public.create_customer_portal_order(uuid,date,text,jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_customer_portal_order(uuid,date,text,jsonb,text) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.get_customer_portal_data()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE identity public.customer_portal_identities; result jsonb;
BEGIN
 identity:=public.assert_customer_portal_identity();
 SELECT jsonb_build_object(
  'branches',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',b.id,'branch_name',b.branch_name) ORDER BY b.branch_name) FROM public.branches b JOIN public.customer_portal_branch_access a ON a.branch_id=b.id WHERE a.user_id=auth.uid()),'[]'::jsonb),
  'products',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.name) ORDER BY p.name) FROM public.products p WHERE p.is_active),'[]'::jsonb),
  'orders',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',so.id,'order_number',so.order_number,'branch_id',so.branch_id,'requested_delivery_date',so.requested_delivery_date,'customer_status',CASE so.status WHEN 'draft' THEN 'Order Received' WHEN 'confirmed' THEN 'Confirmed' WHEN 'planning' THEN 'Preparing' WHEN 'allocated' THEN 'Ready / Planned' WHEN 'ready' THEN 'Ready / Planned' WHEN 'dispatched' THEN 'Dispatched' WHEN 'delivered' THEN 'Delivered' WHEN 'receiving_confirmed' THEN 'Receiving Confirmed' WHEN 'completed' THEN 'Completed' ELSE 'Order Received' END,'items',(SELECT jsonb_agg(jsonb_build_object('product_id',i.product_id,'quantity',i.quantity,'unit',i.unit)) FROM public.sales_order_items i WHERE i.sales_order_id=so.id)) ORDER BY so.created_at DESC) FROM public.sales_orders so WHERE so.client_id=identity.client_id AND (so.branch_id IS NULL OR EXISTS(SELECT 1 FROM public.customer_portal_branch_access a WHERE a.user_id=auth.uid() AND a.branch_id=so.branch_id))),'[]'::jsonb),
  'invoices',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',i.id,'invoice_no',i.invoice_no,'amount',i.amount,'amount_received',i.amount_received,'payment_status',i.payment_status,'due_date',i.due_date,'receiving_status',i.receiving_status) ORDER BY i.date DESC) FROM public.invoices i WHERE i.client_id=identity.client_id AND (i.branch_id IS NULL OR EXISTS(SELECT 1 FROM public.customer_portal_branch_access a WHERE a.user_id=auth.uid() AND a.branch_id=i.branch_id)) AND COALESCE(i.is_deleted,false)=false AND COALESCE(i.receiving_status,'legacy_collectible')<>'awaiting_receiving'),'[]'::jsonb),
  'summary',jsonb_build_object('outstanding',COALESCE((SELECT sum(GREATEST(COALESCE(i.amount,0)-COALESCE(i.amount_received,0),0)) FROM public.invoices i WHERE i.client_id=identity.client_id AND COALESCE(i.is_deleted,false)=false AND COALESCE(i.receiving_status,'legacy_collectible')<>'awaiting_receiving' AND COALESCE(i.payment_status::text,'')<>'Done'),0),'payable_invoices',COALESCE((SELECT count(*) FROM public.invoices i WHERE i.client_id=identity.client_id AND COALESCE(i.is_deleted,false)=false AND COALESCE(i.receiving_status,'legacy_collectible')<>'awaiting_receiving' AND COALESCE(i.payment_status::text,'')<>'Done'),0),'verified_payments',COALESCE((SELECT count(*) FROM public.invoices i WHERE i.client_id=identity.client_id AND COALESCE(i.amount_received,0)>0),0))
 ) INTO result; RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.get_customer_portal_data() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_customer_portal_data() TO authenticated;
