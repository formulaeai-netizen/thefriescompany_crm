-- Make the trusted WhatsApp expense-intake sender configurable from
-- Settings -> WhatsApp Routing instead of keeping it hardcoded in the
-- worker and database RPC.
--
-- Safe default: seed the new flow to the previous hardcoded sender so
-- existing behavior is unchanged until an Admin explicitly updates it.

ALTER TABLE public.whatsapp_routing_numbers DROP CONSTRAINT IF EXISTS whatsapp_routing_numbers_flow_key_check;
ALTER TABLE public.whatsapp_routing_numbers ADD CONSTRAINT whatsapp_routing_numbers_flow_key_check CHECK (
  flow_key IN ('wastage_alerts', 'stock_audit_alerts', 'credit_purchase_reminders', 'expense_intake_sender')
);

INSERT INTO public.whatsapp_routing_numbers (flow_key, recipient_phone_normalized)
VALUES ('expense_intake_sender', '923152918780')
ON CONFLICT (flow_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.set_whatsapp_routing_number(_flow_key text, _recipient_phone text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  IF _flow_key NOT IN ('wastage_alerts', 'stock_audit_alerts', 'credit_purchase_reminders', 'expense_intake_sender') THEN
    RAISE EXCEPTION 'Unknown WhatsApp routing flow: %', _flow_key;
  END IF;

  normalized := public.normalize_pk_whatsapp_phone(_recipient_phone);
  IF normalized IS NULL THEN
    RAISE EXCEPTION 'Recipient phone number could not be normalized to a valid Pakistan WhatsApp number';
  END IF;

  INSERT INTO public.whatsapp_routing_numbers (flow_key, recipient_phone_normalized, updated_by)
  VALUES (_flow_key, normalized, auth.uid())
  ON CONFLICT (flow_key) DO UPDATE
  SET recipient_phone_normalized = EXCLUDED.recipient_phone_normalized,
      updated_by = auth.uid(),
      updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.set_whatsapp_routing_number(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_whatsapp_routing_number(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_expenses_from_whatsapp(
  _provider_message_id text,
  _sender_normalized text,
  _raw_body text,
  _items jsonb
)
RETURNS TABLE (status text, expense_ids uuid[], total_amount numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trusted_sender text;
  v_intake_id uuid;
  v_existing public.whatsapp_expense_intake%ROWTYPE;
  v_item jsonb;
  v_desc text;
  v_amount numeric;
  v_expense_date date;
  v_expense_id uuid;
  v_expense_ids uuid[] := '{}';
  v_total numeric := 0;
  v_count integer := 0;
  v_message_type text;
BEGIN
  IF _provider_message_id IS NULL OR length(trim(_provider_message_id)) = 0 THEN
    RAISE EXCEPTION 'A provider message id is required';
  END IF;

  SELECT recipient_phone_normalized INTO v_trusted_sender
  FROM public.whatsapp_routing_numbers
  WHERE flow_key = 'expense_intake_sender';

  IF v_trusted_sender IS NULL THEN
    RAISE EXCEPTION 'Expense intake sender is not configured';
  END IF;

  -- Defense in depth: re-validate the configured trusted sender here
  -- even though the worker already filters before calling this function.
  IF _sender_normalized IS DISTINCT FROM v_trusted_sender THEN
    RAISE EXCEPTION 'Untrusted sender';
  END IF;

  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'No expense items provided';
  END IF;

  -- Validate every item BEFORE writing anything at all. A single malformed
  -- item aborts the whole call with no expense or audit row persisted.
  FOR v_item IN SELECT * FROM jsonb_array_elements(_items)
  LOOP
    v_desc := v_item->>'description';
    v_amount := NULLIF(v_item->>'amount', '')::numeric;
    IF v_desc IS NULL OR length(trim(v_desc)) = 0 THEN
      RAISE EXCEPTION 'Every expense item requires a description';
    END IF;
    IF v_amount IS NULL OR v_amount <= 0 THEN
      RAISE EXCEPTION 'Every expense item requires a positive amount';
    END IF;
    IF NULLIF(v_item->>'expense_date', '') IS NOT NULL THEN
      v_expense_date := (v_item->>'expense_date')::date;
    END IF;
  END LOOP;

  v_message_type := CASE WHEN jsonb_array_length(_items) > 1 THEN 'list' ELSE 'single' END;

  INSERT INTO public.whatsapp_expense_intake (
    provider_message_id, sender_normalized, raw_body, message_type, processing_status
  ) VALUES (
    _provider_message_id, _sender_normalized, _raw_body, v_message_type, 'pending'
  )
  ON CONFLICT (provider_message_id) DO NOTHING
  RETURNING id INTO v_intake_id;

  IF v_intake_id IS NULL THEN
    SELECT * INTO v_existing FROM public.whatsapp_expense_intake
      WHERE provider_message_id = _provider_message_id;

    SELECT COALESCE(SUM(e.price), 0) INTO v_total
      FROM public.expenses e WHERE e.id = ANY(COALESCE(v_existing.created_expense_ids, '{}'::uuid[]));

    RETURN QUERY SELECT 'duplicate'::text, COALESCE(v_existing.created_expense_ids, '{}'::uuid[]), v_total;
    RETURN;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items)
  LOOP
    v_desc := trim(v_item->>'description');
    v_amount := (v_item->>'amount')::numeric;
    v_expense_date := COALESCE(NULLIF(v_item->>'expense_date', '')::date, CURRENT_DATE);

    INSERT INTO public.expenses (item, price, date, source, source_message_id, source_sender)
    VALUES (v_desc, v_amount, v_expense_date, 'whatsapp', _provider_message_id, _sender_normalized)
    RETURNING id INTO v_expense_id;

    v_expense_ids := v_expense_ids || v_expense_id;
    v_total := v_total + v_amount;
    v_count := v_count + 1;
  END LOOP;

  UPDATE public.whatsapp_expense_intake
  SET processing_status = 'completed',
      processed_at = now(),
      created_expense_ids = v_expense_ids,
      result_summary = 'Created ' || v_count || ' expense(s) totaling ' || v_total
  WHERE id = v_intake_id;

  RETURN QUERY SELECT 'created'::text, v_expense_ids, v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.create_expenses_from_whatsapp(text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_expenses_from_whatsapp(text, text, text, jsonb) TO service_role;
