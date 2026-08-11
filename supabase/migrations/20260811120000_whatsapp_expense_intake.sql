-- Phase 2: trusted WhatsApp expense intake, integrated with the Phase 1
-- immutable cash ledger. WhatsApp code never writes to
-- cash_ledger_entries - it only ever inserts ordinary `expenses` rows
-- through this migration's RPC, and the existing
-- sync_expense_cash_ledger() trigger (unchanged) does the rest, exactly
-- as it already does for every manually-entered expense.
--
-- Pre-migration live state (verified via read-only introspection):
-- expenses=576, cash_ledger_entries=577 (1 real client payment + 576
-- expense debits, all backfilled/created by Phase 1/1.1). Nothing here
-- rewrites or duplicates any of those rows.

-- ---------------------------------------------------------------------
-- 1. Minimal audit-origin columns on expenses. Nullable, no default
--    change to existing behavior - the CRM's own manual expense entry
--    (expenses.tsx) is completely unaffected and continues to leave
--    these NULL, exactly as it already leaves category/subcategory/
--    added_by NULL today.
-- ---------------------------------------------------------------------

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS source_message_id text,
  ADD COLUMN IF NOT EXISTS source_sender text;

ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_source_check;
ALTER TABLE public.expenses ADD CONSTRAINT expenses_source_check
  CHECK (source IS NULL OR source IN ('whatsapp'));

CREATE INDEX IF NOT EXISTS idx_expenses_source_message_id ON public.expenses (source_message_id)
  WHERE source_message_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 2. Inbound WhatsApp expense-intake audit/dedup table. One row per
--    distinct provider_message_id, claimed atomically - this is what
--    makes duplicate delivery and concurrent duplicate processing safe,
--    independent of (and in addition to) the worker's own parsing.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.whatsapp_expense_intake (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_message_id text NOT NULL,
  sender_normalized text NOT NULL,
  raw_body text NOT NULL,
  message_type text NOT NULL,
  processing_status text NOT NULL DEFAULT 'pending',
  created_expense_ids uuid[],
  result_summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  CONSTRAINT whatsapp_expense_intake_message_type_check CHECK (message_type IN ('single', 'list')),
  CONSTRAINT whatsapp_expense_intake_status_check CHECK (processing_status IN ('pending', 'completed', 'failed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_expense_intake_provider_message_id_unique
  ON public.whatsapp_expense_intake (provider_message_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_expense_intake_created_at ON public.whatsapp_expense_intake (created_at);

ALTER TABLE public.whatsapp_expense_intake ENABLE ROW LEVEL SECURITY;

-- Same pattern as every other Chunk/Prompt table: explicit REVOKE before
-- GRANT (this project's Supabase instance auto-grants ALL to
-- authenticated/anon on new tables by database-level default privilege -
-- see the Chunk 3 grant-hardening migration).
REVOKE ALL ON public.whatsapp_expense_intake FROM anon, authenticated;
GRANT SELECT ON public.whatsapp_expense_intake TO authenticated;
GRANT ALL ON public.whatsapp_expense_intake TO service_role;

DROP POLICY IF EXISTS "Admin reads whatsapp_expense_intake" ON public.whatsapp_expense_intake;
CREATE POLICY "Admin reads whatsapp_expense_intake"
  ON public.whatsapp_expense_intake FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- No INSERT/UPDATE/DELETE grant to authenticated - all writes go through
-- create_expenses_from_whatsapp() below (SECURITY DEFINER), called only
-- by the worker's service-role connection.

-- ---------------------------------------------------------------------
-- 3. create_expenses_from_whatsapp(): the only way WhatsApp-originated
--    text can ever create an expense. Re-validates the trusted sender
--    and every item server-side (never trusts the worker alone),
--    atomically claims provider_message_id, and - critically - never
--    touches cash_ledger_entries. It inserts plain `expenses` rows only;
--    the existing, unmodified sync_expense_cash_ledger() trigger is what
--    actually posts the ledger debit, exactly as for a manually-entered
--    expense.
-- ---------------------------------------------------------------------

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
  v_trusted_sender constant text := '923152918780';
  v_intake_id uuid;
  v_existing public.whatsapp_expense_intake%ROWTYPE;
  v_item jsonb;
  v_desc text;
  v_amount numeric;
  v_expense_id uuid;
  v_expense_ids uuid[] := '{}';
  v_total numeric := 0;
  v_count integer := 0;
  v_message_type text;
BEGIN
  IF _provider_message_id IS NULL OR length(trim(_provider_message_id)) = 0 THEN
    RAISE EXCEPTION 'A provider message id is required';
  END IF;

  -- Defense in depth: re-validate the trusted sender here even though the
  -- worker already filters before ever calling this function - "do not
  -- trust worker-only authorization". No expense insert, no cash ledger
  -- mutation, no financial data disclosure for anyone else.
  IF _sender_normalized IS DISTINCT FROM v_trusted_sender THEN
    RAISE EXCEPTION 'Untrusted sender';
  END IF;

  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'No expense items provided';
  END IF;

  -- Validate every item BEFORE writing anything at all - "all lines must
  -- validate before ANY rows are inserted". A single malformed item
  -- aborts the whole call with nothing ever persisted, not even an audit
  -- row for this attempt.
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
  END LOOP;

  v_message_type := CASE WHEN jsonb_array_length(_items) > 1 THEN 'list' ELSE 'single' END;

  -- Atomic claim. Postgres serializes concurrent INSERTs on the same
  -- unique key: exactly one caller ever wins this for a given
  -- provider_message_id, whether the duplicate arrives as a retried
  -- redelivery or as a genuinely concurrent second call.
  INSERT INTO public.whatsapp_expense_intake (
    provider_message_id, sender_normalized, raw_body, message_type, processing_status
  ) VALUES (
    _provider_message_id, _sender_normalized, _raw_body, v_message_type, 'pending'
  )
  ON CONFLICT (provider_message_id) DO NOTHING
  RETURNING id INTO v_intake_id;

  IF v_intake_id IS NULL THEN
    -- Already processed (or a concurrent call already won the claim) -
    -- return the prior result safely. Never re-insert, never error.
    SELECT * INTO v_existing FROM public.whatsapp_expense_intake
      WHERE provider_message_id = _provider_message_id;

    SELECT COALESCE(SUM(e.price), 0) INTO v_total
      FROM public.expenses e WHERE e.id = ANY(COALESCE(v_existing.created_expense_ids, '{}'::uuid[]));

    RETURN QUERY SELECT 'duplicate'::text, COALESCE(v_existing.created_expense_ids, '{}'::uuid[]), v_total;
    RETURN;
  END IF;

  -- Insert through the canonical expense path - one plain INSERT per
  -- item, identical in shape to a manual CRM entry. This is the ONLY
  -- write this function makes to financial data; cash_ledger_entries is
  -- never touched here.
  FOR v_item IN SELECT * FROM jsonb_array_elements(_items)
  LOOP
    v_desc := trim(v_item->>'description');
    v_amount := (v_item->>'amount')::numeric;

    INSERT INTO public.expenses (item, price, date, source, source_message_id, source_sender)
    VALUES (v_desc, v_amount, CURRENT_DATE, 'whatsapp', _provider_message_id, _sender_normalized)
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

-- Called only by the worker's service-role connection - never by a
-- browser session, so no EXECUTE grant to authenticated.
REVOKE ALL ON FUNCTION public.create_expenses_from_whatsapp(text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_expenses_from_whatsapp(text, text, text, jsonb) TO service_role;

-- ---------------------------------------------------------------------
-- 4. Stale RPC cleanup: drop the obsolete 9-argument
--    create_credit_inventory_purchase overload left over from before
--    Phase 1 added payment_mode. The app (src/lib/credit-purchases.functions.ts)
--    always calls with named arguments including _payment_mode, so it
--    already resolves to the 10-argument version - this is metadata-only
--    cleanup, no data is touched.
-- ---------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.create_credit_inventory_purchase(
  text, text, numeric, timestamptz, uuid, numeric, text, text, integer
);
