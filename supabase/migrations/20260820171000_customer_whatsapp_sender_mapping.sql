CREATE TABLE public.customer_whatsapp_senders (
  sender_normalized text PRIMARY KEY CHECK (sender_normalized ~ '^923[0-9]{9}$'),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);
ALTER TABLE public.customer_whatsapp_senders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage customer WhatsApp senders" ON public.customer_whatsapp_senders FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
GRANT ALL ON public.customer_whatsapp_senders TO service_role;

CREATE OR REPLACE FUNCTION public.create_whatsapp_customer_order(_sender_normalized text,_requested_delivery_date date,_items jsonb,_external_source_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE sender public.customer_whatsapp_senders; existing_id uuid; new_id uuid:=gen_random_uuid(); item jsonb; product_row public.products%ROWTYPE; branch_name text; client_name text;
BEGIN
 SELECT * INTO sender FROM public.customer_whatsapp_senders WHERE sender_normalized=_sender_normalized AND is_active;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','unknown_sender'); END IF;
 IF sender.branch_id IS NULL THEN RETURN jsonb_build_object('status','ambiguous_branch'); END IF;
 IF NULLIF(trim(_external_source_key),'') IS NOT NULL THEN SELECT id INTO existing_id FROM public.sales_orders WHERE external_source_key=trim(_external_source_key); IF existing_id IS NOT NULL THEN RETURN jsonb_build_object('status','duplicate','id',existing_id); END IF; END IF;
 IF jsonb_typeof(_items)<>'array' OR jsonb_array_length(_items)=0 THEN RETURN jsonb_build_object('status','invalid'); END IF;
 SELECT legal_name INTO client_name FROM public.clients WHERE id=sender.client_id; SELECT branch_name INTO branch_name FROM public.branches WHERE id=sender.branch_id AND client_id=sender.client_id; IF branch_name IS NULL THEN RETURN jsonb_build_object('status','ambiguous_branch'); END IF;
 INSERT INTO public.sales_orders(id,order_number,client_id,branch_id,client_name_snapshot,branch_name_snapshot,order_source,external_source_key,requested_delivery_date,priority,status,created_by) VALUES(new_id,public.generate_sales_order_number(),sender.client_id,sender.branch_id,client_name,branch_name,'whatsapp',trim(_external_source_key),_requested_delivery_date,'normal','draft',NULL);
 FOR item IN SELECT * FROM jsonb_array_elements(_items) LOOP SELECT * INTO product_row FROM public.products WHERE id=(item->>'product_id')::uuid AND is_active; IF NOT FOUND OR (item->>'quantity')::numeric<=0 THEN RAISE EXCEPTION 'Invalid order'; END IF; INSERT INTO public.sales_order_items(sales_order_id,product_id,product_name_snapshot,quantity,unit) VALUES(new_id,product_row.id,product_row.name,(item->>'quantity')::numeric,COALESCE(NULLIF(trim(item->>'unit'),''),'packs')); END LOOP;
 IF to_regprocedure('public.create_notification_for_roles(public.app_role[], text, text, text, text, text, text, uuid, text)') IS NOT NULL THEN PERFORM public.create_notification_for_roles(ARRAY['admin'::public.app_role,'moderator'::public.app_role],'operational_alerts','Medium','New Customer Order','A WhatsApp customer order is ready for review.','/orders?order='||new_id,'sales_order',new_id,'customer-order:'||new_id); END IF;
 RETURN jsonb_build_object('status','created','id',new_id);
EXCEPTION WHEN unique_violation THEN SELECT id INTO existing_id FROM public.sales_orders WHERE external_source_key=trim(_external_source_key); RETURN jsonb_build_object('status','duplicate','id',existing_id); END; $$;
REVOKE ALL ON FUNCTION public.create_whatsapp_customer_order(text,date,jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_whatsapp_customer_order(text,date,jsonb,text) TO service_role;
