-- Phase 4A: account-based financial ledger.
--
-- Safety policy:
--   * Existing cash_ledger_entries history remains append-only.
--   * Every pre-Phase-4A ledger row is deterministically attributed to
--     Cash in Hand because the previous system had only one money account.
--   * Cash in Bank starts at 0. No historical bank movement is invented.
--   * Future real movements must carry an account_id. Transfers are paired
--     immutable ledger rows and never count as P&L income/expense.

-- ---------------------------------------------------------------------
-- 1. Canonical financial accounts.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.financial_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_key text NOT NULL UNIQUE,
  name text NOT NULL,
  account_type text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  opening_balance numeric NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT financial_accounts_type_check CHECK (account_type IN ('cash', 'bank')),
  CONSTRAINT financial_accounts_opening_balance_check CHECK (opening_balance >= 0),
  CONSTRAINT financial_accounts_key_check CHECK (account_key IN ('cash_in_hand', 'cash_in_bank'))
);

CREATE UNIQUE INDEX IF NOT EXISTS financial_accounts_one_cash
  ON public.financial_accounts ((account_type)) WHERE account_type = 'cash' AND active;

CREATE INDEX IF NOT EXISTS idx_financial_accounts_active_type
  ON public.financial_accounts (active, account_type);

ALTER TABLE public.financial_accounts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.financial_accounts FROM anon, authenticated;
GRANT SELECT ON public.financial_accounts TO authenticated;
GRANT ALL ON public.financial_accounts TO service_role;

DROP POLICY IF EXISTS "Admins read financial_accounts" ON public.financial_accounts;
CREATE POLICY "Admins read financial_accounts"
  ON public.financial_accounts FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP TRIGGER IF EXISTS financial_accounts_touch_updated_at ON public.financial_accounts;
CREATE TRIGGER financial_accounts_touch_updated_at
  BEFORE UPDATE ON public.financial_accounts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.financial_accounts (account_key, name, account_type, opening_balance)
SELECT 'cash_in_hand', 'Cash in Hand', 'cash', COALESCE((SELECT opening_balance FROM public.cash_settings LIMIT 1), 0)
ON CONFLICT (account_key) DO NOTHING;

INSERT INTO public.financial_accounts (account_key, name, account_type, opening_balance)
VALUES ('cash_in_bank', 'Cash in Bank', 'bank', 0)
ON CONFLICT (account_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.require_financial_account(_account_id uuid)
RETURNS public.financial_accounts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account public.financial_accounts%ROWTYPE;
BEGIN
  IF _account_id IS NULL THEN
    RAISE EXCEPTION 'Financial account is required';
  END IF;

  SELECT * INTO v_account
  FROM public.financial_accounts
  WHERE id = _account_id AND active = true
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Financial account not found or inactive';
  END IF;

  IF v_account.account_type NOT IN ('cash', 'bank') THEN
    RAISE EXCEPTION 'Unsupported financial account type: %', v_account.account_type;
  END IF;

  RETURN v_account;
END;
$$;

REVOKE ALL ON FUNCTION public.require_financial_account(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Account-aware immutable ledger.
-- ---------------------------------------------------------------------

ALTER TABLE public.cash_ledger_entries
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.financial_accounts(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_cash_ledger_entries_account_id
  ON public.cash_ledger_entries (account_id);

ALTER TABLE public.cash_ledger_entries DROP CONSTRAINT IF EXISTS cash_ledger_entries_type_check;
ALTER TABLE public.cash_ledger_entries ADD CONSTRAINT cash_ledger_entries_type_check CHECK (
  entry_type IN (
    'opening_balance', 'adjustment', 'client_payment_credit',
    'expense', 'inventory_purchase', 'salary_payment', 'salary_advance',
    'account_transfer'
  )
);

ALTER TABLE public.cash_ledger_entries DROP CONSTRAINT IF EXISTS cash_ledger_entries_type_direction_check;
ALTER TABLE public.cash_ledger_entries ADD CONSTRAINT cash_ledger_entries_type_direction_check CHECK (
  (entry_type = 'client_payment_credit' AND direction = 'credit')
  OR (entry_type IN ('inventory_purchase', 'salary_payment', 'salary_advance') AND direction = 'debit')
  OR (entry_type IN ('expense', 'account_transfer'))
  OR (entry_type IN ('adjustment', 'opening_balance'))
);

ALTER TABLE public.cash_ledger_entries DROP CONSTRAINT IF EXISTS cash_ledger_entries_source_key_prefix_check;
ALTER TABLE public.cash_ledger_entries ADD CONSTRAINT cash_ledger_entries_source_key_prefix_check CHECK (
  (entry_type = 'client_payment_credit' AND source_key LIKE 'payment_verification_request:%')
  OR (entry_type = 'expense' AND source_key LIKE 'expense:%')
  OR (entry_type = 'inventory_purchase' AND source_key LIKE 'credit_inventory_purchase:%')
  OR (entry_type = 'salary_payment' AND source_key LIKE 'employee_salary:%')
  OR (entry_type = 'salary_advance' AND source_key LIKE 'salary_advance:%')
  OR (entry_type = 'account_transfer' AND source_key LIKE 'account_transfer:%')
  OR (entry_type IN ('adjustment', 'opening_balance'))
);

CREATE OR REPLACE FUNCTION public.prevent_cash_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'cash_ledger_entries rows are immutable and cannot be deleted - post a reversal/correction entry instead';
  END IF;

  IF NEW.amount = OLD.amount
     AND NEW.direction = OLD.direction
     AND NEW.entry_type = OLD.entry_type
     AND NEW.source_key = OLD.source_key
     AND NEW.created_at = OLD.created_at
     AND NEW.created_by IS NOT DISTINCT FROM OLD.created_by
     AND NEW.notes IS NOT DISTINCT FROM OLD.notes
     AND NEW.reverses_entry_id IS NOT DISTINCT FROM OLD.reverses_entry_id
     AND (NEW.account_id IS NOT DISTINCT FROM OLD.account_id OR (OLD.account_id IS NULL AND NEW.account_id IS NOT NULL))
     AND (NEW.expense_id IS NOT DISTINCT FROM OLD.expense_id OR NEW.expense_id IS NULL)
     AND (NEW.credit_purchase_id IS NOT DISTINCT FROM OLD.credit_purchase_id OR NEW.credit_purchase_id IS NULL)
     AND (NEW.salary_id IS NOT DISTINCT FROM OLD.salary_id OR NEW.salary_id IS NULL)
     AND (NEW.salary_advance_id IS NOT DISTINCT FROM OLD.salary_advance_id OR NEW.salary_advance_id IS NULL)
     AND (NEW.payment_verification_request_id IS NOT DISTINCT FROM OLD.payment_verification_request_id OR NEW.payment_verification_request_id IS NULL)
     AND (NEW.invoice_id IS NOT DISTINCT FROM OLD.invoice_id OR NEW.invoice_id IS NULL)
     AND (NEW.client_id IS NOT DISTINCT FROM OLD.client_id OR NEW.client_id IS NULL)
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'cash_ledger_entries rows are immutable and cannot be updated - post a reversal/correction entry instead';
END;
$$;

UPDATE public.cash_ledger_entries
SET account_id = (SELECT id FROM public.financial_accounts WHERE account_key = 'cash_in_hand')
WHERE account_id IS NULL;

ALTER TABLE public.cash_ledger_entries
  ALTER COLUMN account_id SET NOT NULL;

-- ---------------------------------------------------------------------
-- 3. Source table permanent account-choice columns.
-- ---------------------------------------------------------------------

ALTER TABLE public.payment_verification_requests
  ADD COLUMN IF NOT EXISTS approved_account_id uuid REFERENCES public.financial_accounts(id) ON DELETE RESTRICT;

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS paid_from_account_id uuid REFERENCES public.financial_accounts(id) ON DELETE RESTRICT;

ALTER TABLE public.credit_inventory_purchases
  ADD COLUMN IF NOT EXISTS paid_from_account_id uuid REFERENCES public.financial_accounts(id) ON DELETE RESTRICT;

ALTER TABLE public.employee_salaries
  ADD COLUMN IF NOT EXISTS paid_from_account_id uuid REFERENCES public.financial_accounts(id) ON DELETE RESTRICT;

ALTER TABLE public.salary_advances
  ADD COLUMN IF NOT EXISTS paid_from_account_id uuid REFERENCES public.financial_accounts(id) ON DELETE RESTRICT;

UPDATE public.payment_verification_requests r
SET approved_account_id = l.account_id
FROM public.cash_ledger_entries l
WHERE r.approved_cash_entry_id = l.id
  AND r.approved_account_id IS NULL;

UPDATE public.expenses
SET paid_from_account_id = (SELECT id FROM public.financial_accounts WHERE account_key = 'cash_in_hand')
WHERE paid_from_account_id IS NULL;

UPDATE public.credit_inventory_purchases p
SET paid_from_account_id = l.account_id
FROM public.cash_ledger_entries l
WHERE l.credit_purchase_id = p.id
  AND p.paid_from_account_id IS NULL;

UPDATE public.employee_salaries s
SET paid_from_account_id = l.account_id
FROM public.cash_ledger_entries l
WHERE l.salary_id = s.id
  AND s.paid_from_account_id IS NULL;

UPDATE public.salary_advances a
SET paid_from_account_id = l.account_id
FROM public.cash_ledger_entries l
WHERE l.salary_advance_id = a.id
  AND a.paid_from_account_id IS NULL;

ALTER TABLE public.expenses
  ALTER COLUMN paid_from_account_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_expenses_paid_from_account_id ON public.expenses (paid_from_account_id);
CREATE INDEX IF NOT EXISTS idx_payment_verification_requests_approved_account_id ON public.payment_verification_requests (approved_account_id);
CREATE INDEX IF NOT EXISTS idx_credit_inventory_purchases_paid_from_account_id ON public.credit_inventory_purchases (paid_from_account_id);
CREATE INDEX IF NOT EXISTS idx_employee_salaries_paid_from_account_id ON public.employee_salaries (paid_from_account_id);
CREATE INDEX IF NOT EXISTS idx_salary_advances_paid_from_account_id ON public.salary_advances (paid_from_account_id);

CREATE OR REPLACE FUNCTION public.prevent_expense_account_rewrite()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.paid_from_account_id IS DISTINCT FROM OLD.paid_from_account_id
     AND EXISTS (SELECT 1 FROM public.cash_ledger_entries WHERE source_key LIKE 'expense:' || OLD.id::text || ':%')
  THEN
    RAISE EXCEPTION 'Posted expense account cannot be changed; void/repost the expense instead';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS expenses_prevent_account_rewrite ON public.expenses;
CREATE TRIGGER expenses_prevent_account_rewrite
  BEFORE UPDATE OF paid_from_account_id ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.prevent_expense_account_rewrite();

-- ---------------------------------------------------------------------
-- 4. Account-aware expense sync and controlled expense RPCs.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sync_expense_cash_ledger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_effective_amount numeric;
  v_last_entry_id uuid;
  v_last_account_id uuid;
  v_next_seq integer;
  v_delta numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT
      COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount ELSE -amount END), 0),
      (array_agg(account_id ORDER BY created_at DESC, id DESC))[1]
    INTO v_effective_amount, v_last_account_id
    FROM public.cash_ledger_entries
    WHERE source_key LIKE 'expense:' || OLD.id::text || ':%';

    IF v_effective_amount = 0 THEN
      RETURN OLD;
    END IF;

    SELECT id INTO v_last_entry_id FROM public.cash_ledger_entries
      WHERE source_key LIKE 'expense:' || OLD.id::text || ':%' ORDER BY created_at DESC, id DESC LIMIT 1;
    SELECT count(*) + 1 INTO v_next_seq FROM public.cash_ledger_entries
      WHERE source_key LIKE 'expense:' || OLD.id::text || ':%';

    INSERT INTO public.cash_ledger_entries (
      entry_type, direction, amount, account_id, created_by, source_key, notes, reverses_entry_id
    ) VALUES (
      'expense',
      CASE WHEN v_effective_amount > 0 THEN 'credit' ELSE 'debit' END,
      abs(v_effective_amount),
      v_last_account_id,
      auth.uid(),
      'expense:' || OLD.id::text || ':void:v' || v_next_seq,
      'Void: expense deleted (' || COALESCE(OLD.item, '') || ')',
      v_last_entry_id
    )
    ON CONFLICT (source_key) DO NOTHING;

    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.price IS NOT DISTINCT FROM OLD.price THEN
    RETURN NEW;
  END IF;

  PERFORM public.require_financial_account(NEW.paid_from_account_id);

  SELECT COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount ELSE -amount END), 0)
    INTO v_effective_amount
    FROM public.cash_ledger_entries
    WHERE source_key LIKE 'expense:' || NEW.id::text || ':%';

  v_delta := COALESCE(NEW.price, 0) - v_effective_amount;
  IF v_delta = 0 THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_last_entry_id FROM public.cash_ledger_entries
    WHERE source_key LIKE 'expense:' || NEW.id::text || ':%' ORDER BY created_at DESC, id DESC LIMIT 1;
  SELECT count(*) + 1 INTO v_next_seq FROM public.cash_ledger_entries
    WHERE source_key LIKE 'expense:' || NEW.id::text || ':%';

  INSERT INTO public.cash_ledger_entries (
    entry_type, direction, amount, account_id, expense_id, created_by, created_at, source_key, notes, reverses_entry_id
  ) VALUES (
    'expense',
    CASE WHEN v_delta > 0 THEN 'debit' ELSE 'credit' END,
    abs(v_delta),
    NEW.paid_from_account_id,
    NEW.id,
    CASE WHEN v_last_entry_id IS NULL THEN NEW.created_by ELSE auth.uid() END,
    CASE WHEN v_last_entry_id IS NULL THEN COALESCE(NEW.created_at, now()) ELSE now() END,
    'expense:' || NEW.id::text || ':v' || v_next_seq,
    CASE
      WHEN TG_OP = 'INSERT' THEN NEW.item
      ELSE 'Correction: expense amount changed to ' || NEW.price::text
    END,
    v_last_entry_id
  )
  ON CONFLICT (source_key) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_expense(
  _item text,
  _price numeric,
  _date date,
  _category text,
  _subcategory text,
  _added_by text,
  _paid_from_account_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  PERFORM public.require_financial_account(_paid_from_account_id);
  IF _item IS NULL OR length(trim(_item)) = 0 THEN RAISE EXCEPTION 'Item is required'; END IF;
  IF _price IS NULL OR _price <= 0 THEN RAISE EXCEPTION 'Price must be positive'; END IF;

  INSERT INTO public.expenses (item, price, date, category, subcategory, added_by, created_by, paid_from_account_id)
  VALUES (trim(_item), _price, COALESCE(_date, CURRENT_DATE), _category, _subcategory, _added_by, auth.uid(), _paid_from_account_id)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_expense(
  _expense_id uuid,
  _item text,
  _price numeric,
  _date date,
  _category text,
  _subcategory text,
  _added_by text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  SELECT id INTO v_status FROM public.expenses WHERE id = _expense_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expense not found'; END IF;
  IF _item IS NULL OR length(trim(_item)) = 0 THEN RAISE EXCEPTION 'Item is required'; END IF;
  IF _price IS NULL OR _price <= 0 THEN RAISE EXCEPTION 'Price must be positive'; END IF;

  UPDATE public.expenses
  SET item = trim(_item),
      price = _price,
      date = COALESCE(_date, date),
      category = _category,
      subcategory = _subcategory,
      added_by = _added_by
  WHERE id = _expense_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_expense(_expense_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  DELETE FROM public.expenses WHERE id = _expense_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expense not found'; END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.create_expense(text, numeric, date, text, text, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_expense(uuid, text, numeric, date, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_expense(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_expense(text, numeric, date, text, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_expense(uuid, text, numeric, date, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_expense(uuid) TO authenticated;

-- WhatsApp expense intake deterministically defaults to Cash in Hand.
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
  v_cash_account_id uuid;
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

  IF _sender_normalized IS DISTINCT FROM v_trusted_sender THEN
    RAISE EXCEPTION 'Untrusted sender';
  END IF;

  SELECT id INTO v_cash_account_id FROM public.financial_accounts WHERE account_key = 'cash_in_hand' AND active = true;
  IF v_cash_account_id IS NULL THEN
    RAISE EXCEPTION 'Cash in Hand account is not configured';
  END IF;

  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'No expense items provided';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items)
  LOOP
    v_desc := v_item->>'description';
    v_amount := NULLIF(v_item->>'amount', '')::numeric;
    IF v_desc IS NULL OR length(trim(v_desc)) = 0 THEN RAISE EXCEPTION 'Every expense item requires a description'; END IF;
    IF v_amount IS NULL OR v_amount <= 0 THEN RAISE EXCEPTION 'Every expense item requires a positive amount'; END IF;
    IF NULLIF(v_item->>'expense_date', '') IS NOT NULL THEN v_expense_date := (v_item->>'expense_date')::date; END IF;
  END LOOP;

  v_message_type := CASE WHEN jsonb_array_length(_items) > 1 THEN 'list' ELSE 'single' END;

  INSERT INTO public.whatsapp_expense_intake (provider_message_id, sender_normalized, raw_body, message_type, processing_status)
  VALUES (_provider_message_id, _sender_normalized, _raw_body, v_message_type, 'pending')
  ON CONFLICT (provider_message_id) DO NOTHING
  RETURNING id INTO v_intake_id;

  IF v_intake_id IS NULL THEN
    SELECT * INTO v_existing FROM public.whatsapp_expense_intake WHERE provider_message_id = _provider_message_id;
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

    INSERT INTO public.expenses (item, price, date, source, source_message_id, source_sender, paid_from_account_id)
    VALUES (v_desc, v_amount, v_expense_date, 'whatsapp', _provider_message_id, _sender_normalized, v_cash_account_id)
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

-- ---------------------------------------------------------------------
-- 5. Account-aware payment verification, inventory and payroll.
-- ---------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.approve_payment_verification_request(uuid, uuid);
CREATE OR REPLACE FUNCTION public.approve_payment_verification_request(
  _request_id uuid,
  _selected_invoice_id uuid DEFAULT NULL,
  _account_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  req public.payment_verification_requests%ROWTYPE;
  target_invoice_id uuid;
  invoice_row public.invoices%ROWTYPE;
  outstanding_amount numeric;
  ledger_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  PERFORM public.require_financial_account(_account_id);

  SELECT * INTO req FROM public.payment_verification_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment verification request not found'; END IF;
  IF req.status NOT IN ('pending', 'unresolved') THEN RAISE EXCEPTION 'Payment verification request has already been reviewed'; END IF;
  IF req.approved_cash_entry_id IS NOT NULL THEN RAISE EXCEPTION 'This request is already linked to a cash entry'; END IF;
  IF req.client_id IS NULL THEN RAISE EXCEPTION 'Payment verification request has no matched client'; END IF;

  target_invoice_id := COALESCE(_selected_invoice_id, req.invoice_id);
  IF target_invoice_id IS NULL THEN RAISE EXCEPTION 'Payment verification request has no invoice selected'; END IF;

  SELECT * INTO invoice_row FROM public.invoices
  WHERE id = target_invoice_id AND COALESCE(is_deleted, false) = false
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Selected invoice not found'; END IF;
  IF invoice_row.client_id IS DISTINCT FROM req.client_id THEN RAISE EXCEPTION 'Selected invoice does not belong to the matched client'; END IF;
  IF invoice_row.payment_status = 'Done'::public.payment_status_enum THEN RAISE EXCEPTION 'Selected invoice is already paid'; END IF;
  IF req.claimed_amount IS NULL OR req.claimed_amount <= 0 THEN RAISE EXCEPTION 'Claimed amount must be positive'; END IF;

  outstanding_amount := GREATEST(COALESCE(invoice_row.amount, 0) - COALESCE(invoice_row.amount_received, 0), 0);
  IF req.claimed_amount <> outstanding_amount THEN
    RAISE EXCEPTION 'Claimed amount % does not match invoice outstanding amount %', req.claimed_amount, outstanding_amount;
  END IF;

  UPDATE public.invoices
  SET payment_status = 'Done'::public.payment_status_enum,
      amount_received = COALESCE(invoice_row.amount, 0),
      reminder_sent = false,
      total_reminders_sent = 0
  WHERE id = target_invoice_id;

  UPDATE public.invoice_reminders
  SET status = 'cancelled', error_code = 'payment_verified',
      error_message = 'Payment verified by admin; future reminders cancelled'
  WHERE invoice_id = target_invoice_id AND status IN ('pending', 'approved', 'processing');

  INSERT INTO public.cash_ledger_entries (
    entry_type, direction, amount, account_id, payment_verification_request_id, invoice_id, client_id, created_by, source_key
  ) VALUES (
    'client_payment_credit', 'credit', req.claimed_amount, _account_id, _request_id, target_invoice_id, req.client_id, auth.uid(),
    'payment_verification_request:' || _request_id::text
  )
  ON CONFLICT (source_key) DO NOTHING
  RETURNING id INTO ledger_id;

  IF ledger_id IS NULL THEN RAISE EXCEPTION 'A cash credit already exists for this payment verification request'; END IF;

  UPDATE public.payment_verification_requests
  SET invoice_id = target_invoice_id,
      status = 'approved',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      approved_cash_entry_id = ledger_id,
      approved_account_id = _account_id
  WHERE id = _request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_payment_verification_request(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_payment_verification_request(uuid, uuid, uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.create_credit_inventory_purchase(text, text, numeric, timestamptz, uuid, numeric, text, text, integer, text);
DROP FUNCTION IF EXISTS public.create_credit_inventory_purchase(text, text, numeric, timestamptz, uuid, numeric, text, text, integer);
CREATE OR REPLACE FUNCTION public.create_credit_inventory_purchase(
  _supplier_name text,
  _item_name_snapshot text,
  _amount_due numeric,
  _due_at timestamptz,
  _inventory_item_id uuid DEFAULT NULL,
  _quantity numeric DEFAULT NULL,
  _unit text DEFAULT NULL,
  _notes text DEFAULT NULL,
  _reminder_lead_hours integer DEFAULT 24,
  _payment_mode text DEFAULT 'credit',
  _paid_from_account_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id uuid;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'staff'::public.app_role)) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF _supplier_name IS NULL OR length(trim(_supplier_name)) = 0 THEN RAISE EXCEPTION 'Supplier name is required'; END IF;
  IF _item_name_snapshot IS NULL OR length(trim(_item_name_snapshot)) = 0 THEN RAISE EXCEPTION 'Item name is required'; END IF;
  IF _amount_due IS NULL OR _amount_due <= 0 THEN RAISE EXCEPTION 'Amount due must be positive'; END IF;
  IF _due_at IS NULL THEN RAISE EXCEPTION 'Due date/time is required'; END IF;
  IF _payment_mode NOT IN ('cash', 'credit') THEN RAISE EXCEPTION 'Payment mode must be cash or credit'; END IF;
  IF _payment_mode = 'cash' THEN PERFORM public.require_financial_account(_paid_from_account_id); END IF;

  INSERT INTO public.credit_inventory_purchases (
    supplier_name, inventory_item_id, item_name_snapshot, quantity, unit,
    amount_due, due_at, notes, created_by, reminder_lead_hours, payment_mode,
    status, paid_at, paid_from_account_id
  ) VALUES (
    trim(_supplier_name), _inventory_item_id, trim(_item_name_snapshot), _quantity, _unit,
    _amount_due, _due_at, _notes, auth.uid(), COALESCE(_reminder_lead_hours, 24), _payment_mode,
    CASE WHEN _payment_mode = 'cash' THEN 'paid' ELSE 'unpaid' END,
    CASE WHEN _payment_mode = 'cash' THEN now() ELSE NULL END,
    CASE WHEN _payment_mode = 'cash' THEN _paid_from_account_id ELSE NULL END
  )
  RETURNING id INTO new_id;

  IF _inventory_item_id IS NOT NULL AND _quantity IS NOT NULL AND _quantity > 0 THEN
    INSERT INTO public.stock_movements (inventory_id, movement_type, quantity, movement_date, notes)
    VALUES (_inventory_item_id, 'Stock In', _quantity, CURRENT_DATE,
      (CASE WHEN _payment_mode = 'cash' THEN 'Cash' ELSE 'Credit' END) || ' inventory purchase: ' || trim(_item_name_snapshot));

    UPDATE public.inventory SET current_stock = COALESCE(current_stock, 0) + _quantity WHERE id = _inventory_item_id;
  END IF;

  IF _payment_mode = 'cash' THEN
    INSERT INTO public.cash_ledger_entries (entry_type, direction, amount, account_id, credit_purchase_id, created_by, source_key)
    VALUES ('inventory_purchase', 'debit', _amount_due, _paid_from_account_id, new_id, auth.uid(), 'credit_inventory_purchase:' || new_id::text);
  END IF;

  RETURN new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_credit_inventory_purchase(text, text, numeric, timestamptz, uuid, numeric, text, text, integer, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_credit_inventory_purchase(text, text, numeric, timestamptz, uuid, numeric, text, text, integer, text, uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.mark_credit_inventory_purchase_paid(uuid);
CREATE OR REPLACE FUNCTION public.mark_credit_inventory_purchase_paid(_purchase_id uuid, _paid_from_account_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.credit_inventory_purchases%ROWTYPE;
  v_ledger_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  PERFORM public.require_financial_account(_paid_from_account_id);

  SELECT * INTO v_row FROM public.credit_inventory_purchases WHERE id = _purchase_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Credit inventory purchase not found'; END IF;
  IF v_row.status <> 'unpaid' THEN RAISE EXCEPTION 'Only unpaid purchases can be marked paid'; END IF;

  INSERT INTO public.cash_ledger_entries (entry_type, direction, amount, account_id, credit_purchase_id, created_by, source_key)
  VALUES ('inventory_purchase', 'debit', v_row.amount_due, _paid_from_account_id, _purchase_id, auth.uid(), 'credit_inventory_purchase:' || _purchase_id::text)
  ON CONFLICT (source_key) DO NOTHING
  RETURNING id INTO v_ledger_id;

  IF v_ledger_id IS NULL THEN RAISE EXCEPTION 'A cash debit already exists for this purchase'; END IF;

  UPDATE public.credit_inventory_purchases
  SET status = 'paid', paid_at = now(), paid_from_account_id = _paid_from_account_id
  WHERE id = _purchase_id;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_credit_inventory_purchase_paid(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_credit_inventory_purchase_paid(uuid, uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.mark_payroll_paid(uuid);
CREATE OR REPLACE FUNCTION public.mark_payroll_paid(_payroll_id uuid, _paid_from_account_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.employee_salaries%ROWTYPE;
  v_ledger_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  PERFORM public.require_financial_account(_paid_from_account_id);

  SELECT * INTO v_row FROM public.employee_salaries WHERE id = _payroll_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payroll row not found'; END IF;
  IF v_row.status <> 'finalized' THEN RAISE EXCEPTION 'Only a finalized payroll record can be marked paid (current status: %)', v_row.status; END IF;
  IF v_row.net_salary <= 0 THEN RAISE EXCEPTION 'Net salary must be positive to mark paid'; END IF;

  INSERT INTO public.cash_ledger_entries (entry_type, direction, amount, account_id, salary_id, created_by, source_key)
  VALUES ('salary_payment', 'debit', v_row.net_salary, _paid_from_account_id, _payroll_id, auth.uid(), 'employee_salary:' || _payroll_id::text)
  ON CONFLICT (source_key) DO NOTHING
  RETURNING id INTO v_ledger_id;

  IF v_ledger_id IS NULL THEN RAISE EXCEPTION 'A cash debit already exists for this salary payment'; END IF;

  UPDATE public.employee_salaries
  SET status = 'paid', paid = true, paid_at = now(), paid_by = auth.uid(), paid_from_account_id = _paid_from_account_id
  WHERE id = _payroll_id;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_payroll_paid(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_payroll_paid(uuid, uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.create_salary_advance(uuid, numeric, date, text);
CREATE OR REPLACE FUNCTION public.create_salary_advance(
  _employee_ref_id uuid,
  _amount numeric,
  _advance_date date DEFAULT CURRENT_DATE,
  _notes text DEFAULT NULL,
  _paid_from_account_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_employee public.employees%ROWTYPE;
  v_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  PERFORM public.require_financial_account(_paid_from_account_id);
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'Advance amount must be positive'; END IF;

  SELECT * INTO v_employee FROM public.employees WHERE id = _employee_ref_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found'; END IF;

  INSERT INTO public.salary_advances (employee_ref_id, amount, advance_date, notes, created_by, paid_from_account_id)
  VALUES (_employee_ref_id, _amount, COALESCE(_advance_date, CURRENT_DATE), _notes, auth.uid(), _paid_from_account_id)
  RETURNING id INTO v_id;

  INSERT INTO public.cash_ledger_entries (entry_type, direction, amount, account_id, salary_advance_id, created_by, source_key, notes)
  VALUES ('salary_advance', 'debit', _amount, _paid_from_account_id, v_id, auth.uid(), 'salary_advance:' || v_id::text,
    'Salary advance to ' || v_employee.full_name);

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_salary_advance(uuid, numeric, date, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_salary_advance(uuid, numeric, date, text, uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- 6. Internal cash/bank transfers.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.account_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_account_id uuid NOT NULL REFERENCES public.financial_accounts(id) ON DELETE RESTRICT,
  to_account_id uuid NOT NULL REFERENCES public.financial_accounts(id) ON DELETE RESTRICT,
  amount numeric NOT NULL,
  transfer_date date NOT NULL DEFAULT CURRENT_DATE,
  reference text NOT NULL,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_transfers_amount_positive CHECK (amount > 0),
  CONSTRAINT account_transfers_distinct_accounts CHECK (from_account_id <> to_account_id),
  CONSTRAINT account_transfers_reference_required CHECK (length(trim(reference)) > 0)
);

ALTER TABLE public.account_transfers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_transfers FROM anon, authenticated;
GRANT SELECT ON public.account_transfers TO authenticated;
GRANT ALL ON public.account_transfers TO service_role;

DROP POLICY IF EXISTS "Admins read account_transfers" ON public.account_transfers;
CREATE POLICY "Admins read account_transfers"
  ON public.account_transfers FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

ALTER TABLE public.cash_ledger_entries
  ADD COLUMN IF NOT EXISTS account_transfer_id uuid REFERENCES public.account_transfers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cash_ledger_entries_account_transfer_id ON public.cash_ledger_entries (account_transfer_id);

CREATE OR REPLACE FUNCTION public.prevent_cash_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'cash_ledger_entries rows are immutable and cannot be deleted - post a reversal/correction entry instead';
  END IF;

  IF NEW.amount = OLD.amount
     AND NEW.direction = OLD.direction
     AND NEW.entry_type = OLD.entry_type
     AND NEW.source_key = OLD.source_key
     AND NEW.created_at = OLD.created_at
     AND NEW.created_by IS NOT DISTINCT FROM OLD.created_by
     AND NEW.notes IS NOT DISTINCT FROM OLD.notes
     AND NEW.reverses_entry_id IS NOT DISTINCT FROM OLD.reverses_entry_id
     AND (NEW.account_id IS NOT DISTINCT FROM OLD.account_id OR (OLD.account_id IS NULL AND NEW.account_id IS NOT NULL))
     AND (NEW.expense_id IS NOT DISTINCT FROM OLD.expense_id OR NEW.expense_id IS NULL)
     AND (NEW.credit_purchase_id IS NOT DISTINCT FROM OLD.credit_purchase_id OR NEW.credit_purchase_id IS NULL)
     AND (NEW.salary_id IS NOT DISTINCT FROM OLD.salary_id OR NEW.salary_id IS NULL)
     AND (NEW.salary_advance_id IS NOT DISTINCT FROM OLD.salary_advance_id OR NEW.salary_advance_id IS NULL)
     AND (NEW.account_transfer_id IS NOT DISTINCT FROM OLD.account_transfer_id OR NEW.account_transfer_id IS NULL)
     AND (NEW.payment_verification_request_id IS NOT DISTINCT FROM OLD.payment_verification_request_id OR NEW.payment_verification_request_id IS NULL)
     AND (NEW.invoice_id IS NOT DISTINCT FROM OLD.invoice_id OR NEW.invoice_id IS NULL)
     AND (NEW.client_id IS NOT DISTINCT FROM OLD.client_id OR NEW.client_id IS NULL)
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'cash_ledger_entries rows are immutable and cannot be updated - post a reversal/correction entry instead';
END;
$$;

CREATE OR REPLACE FUNCTION public.create_account_transfer(
  _from_account_id uuid,
  _to_account_id uuid,
  _amount numeric,
  _transfer_date date,
  _reference text,
  _notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  PERFORM public.require_financial_account(_from_account_id);
  PERFORM public.require_financial_account(_to_account_id);
  IF _from_account_id = _to_account_id THEN RAISE EXCEPTION 'Source and destination accounts must be different'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'Transfer amount must be positive'; END IF;
  IF _reference IS NULL OR length(trim(_reference)) = 0 THEN RAISE EXCEPTION 'Transfer reference/notes are required'; END IF;

  INSERT INTO public.account_transfers (from_account_id, to_account_id, amount, transfer_date, reference, notes, created_by)
  VALUES (_from_account_id, _to_account_id, _amount, COALESCE(_transfer_date, CURRENT_DATE), trim(_reference), _notes, auth.uid())
  RETURNING id INTO v_id;

  INSERT INTO public.cash_ledger_entries (entry_type, direction, amount, account_id, account_transfer_id, created_by, source_key, notes)
  VALUES
    ('account_transfer', 'debit', _amount, _from_account_id, v_id, auth.uid(), 'account_transfer:' || v_id::text || ':out', trim(_reference)),
    ('account_transfer', 'credit', _amount, _to_account_id, v_id, auth.uid(), 'account_transfer:' || v_id::text || ':in', trim(_reference));

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_account_transfer(uuid, uuid, numeric, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_account_transfer(uuid, uuid, numeric, date, text, text) TO authenticated;

-- ---------------------------------------------------------------------
-- 7. Canonical balance, P&L and owner dashboard RPCs.
-- ---------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.get_cash_in_hand_summary();

CREATE FUNCTION public.get_cash_in_hand_summary()
RETURNS TABLE (
  opening_balance numeric,
  client_payment_credits numeric,
  expenses_total numeric,
  inventory_purchases_paid_total numeric,
  paid_salaries_total numeric,
  salary_advances_paid_total numeric,
  account_transfers_total numeric,
  adjustments_total numeric,
  cash_in_hand numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cash_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT id INTO v_cash_id FROM public.financial_accounts WHERE account_key = 'cash_in_hand';

  RETURN QUERY
  SELECT
    COALESCE((SELECT opening_balance FROM public.financial_accounts WHERE id = v_cash_id), 0),
    COALESCE(SUM(amount) FILTER (WHERE entry_type = 'client_payment_credit'), 0),
    COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount ELSE -amount END) FILTER (WHERE entry_type = 'expense'), 0),
    COALESCE(SUM(amount) FILTER (WHERE entry_type = 'inventory_purchase'), 0),
    COALESCE(SUM(amount) FILTER (WHERE entry_type = 'salary_payment'), 0),
    COALESCE(SUM(amount) FILTER (WHERE entry_type = 'salary_advance'), 0),
    COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END) FILTER (WHERE entry_type = 'account_transfer'), 0),
    COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END) FILTER (WHERE entry_type = 'adjustment'), 0),
    COALESCE((SELECT opening_balance FROM public.financial_accounts WHERE id = v_cash_id), 0)
      + COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END), 0)
  FROM public.cash_ledger_entries
  WHERE account_id = v_cash_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_cash_in_hand_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cash_in_hand_summary() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_financial_account_balances()
RETURNS TABLE (
  account_id uuid,
  account_key text,
  name text,
  account_type text,
  opening_balance numeric,
  credits numeric,
  debits numeric,
  balance numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN RAISE EXCEPTION 'Forbidden'; END IF;

  RETURN QUERY
  SELECT
    a.id, a.account_key, a.name, a.account_type, a.opening_balance,
    COALESCE(SUM(l.amount) FILTER (WHERE l.direction = 'credit'), 0) AS credits,
    COALESCE(SUM(l.amount) FILTER (WHERE l.direction = 'debit'), 0) AS debits,
    a.opening_balance
      + COALESCE(SUM(CASE WHEN l.direction = 'credit' THEN l.amount ELSE -l.amount END), 0) AS balance
  FROM public.financial_accounts a
  LEFT JOIN public.cash_ledger_entries l ON l.account_id = a.id
  WHERE a.active = true
  GROUP BY a.id, a.account_key, a.name, a.account_type, a.opening_balance
  ORDER BY CASE a.account_key WHEN 'cash_in_hand' THEN 1 WHEN 'cash_in_bank' THEN 2 ELSE 3 END;
END;
$$;

REVOKE ALL ON FUNCTION public.get_financial_account_balances() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_financial_account_balances() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_profit_and_loss_summary(_start_date date, _end_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_revenue numeric;
  v_expenses numeric;
  v_payroll numeric;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _start_date IS NULL OR _end_date IS NULL OR _end_date < _start_date THEN RAISE EXCEPTION 'Invalid P&L period'; END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_revenue
  FROM public.invoices
  WHERE COALESCE(is_deleted, false) = false
    AND COALESCE(delivery_date, date, created_at::date) BETWEEN _start_date AND _end_date;

  SELECT COALESCE(SUM(price), 0) INTO v_expenses
  FROM public.expenses
  WHERE date BETWEEN _start_date AND _end_date;

  SELECT COALESCE(SUM(net_salary), 0) INTO v_payroll
  FROM public.employee_salaries
  WHERE status IN ('finalized', 'paid')
    AND make_date(period_year, period_month, 1) BETWEEN date_trunc('month', _start_date)::date AND date_trunc('month', _end_date)::date;

  RETURN jsonb_build_object(
    'policy', 'Accrual-lite from provable CRM operations: revenue is invoice amount by delivery/date, expenses are recorded expense dates, payroll cost is finalized/paid payroll period. Collections and cash/bank timing are separate and transfers are excluded.',
    'revenue', v_revenue,
    'cogs', null,
    'cogs_status', 'unavailable: no reliable per-unit COGS/inventory cost basis exists yet',
    'gross_profit', null,
    'operating_expenses', v_expenses,
    'payroll_expense', v_payroll,
    'net_profit', v_revenue - v_expenses - v_payroll
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_profit_and_loss_summary(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_profit_and_loss_summary(date, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_owner_business_health(_start_date date, _end_date date, _prev_start_date date, _prev_end_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cash numeric := 0;
  v_bank numeric := 0;
  v_receivable numeric := 0;
  v_overdue_receivable numeric := 0;
  v_overdue_invoice_count integer := 0;
  v_supplier_payable numeric := 0;
  v_supplier_overdue numeric := 0;
  v_supplier_due_soon numeric := 0;
  v_payroll_payable numeric := 0;
  v_low_stock integer := 0;
  v_stock_alerts integer := 0;
  v_ops_alerts integer := 0;
  v_pnl jsonb;
  v_prev_pnl jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN RAISE EXCEPTION 'Forbidden'; END IF;

  SELECT COALESCE(MAX(balance) FILTER (WHERE account_key = 'cash_in_hand'), 0),
         COALESCE(MAX(balance) FILTER (WHERE account_key = 'cash_in_bank'), 0)
  INTO v_cash, v_bank
  FROM public.get_financial_account_balances();

  SELECT
    COALESCE(SUM(GREATEST(COALESCE(amount, 0) - COALESCE(amount_received, 0), 0)), 0),
    COALESCE(SUM(GREATEST(COALESCE(amount, 0) - COALESCE(amount_received, 0), 0)) FILTER (WHERE due_date < CURRENT_DATE), 0),
    COUNT(*) FILTER (WHERE due_date < CURRENT_DATE AND GREATEST(COALESCE(amount, 0) - COALESCE(amount_received, 0), 0) > 0)
  INTO v_receivable, v_overdue_receivable, v_overdue_invoice_count
  FROM public.invoices
  WHERE COALESCE(is_deleted, false) = false
    AND payment_status <> 'Done'::public.payment_status_enum;

  SELECT
    COALESCE(SUM(amount_due) FILTER (WHERE status = 'unpaid'), 0),
    COALESCE(SUM(amount_due) FILTER (WHERE status = 'unpaid' AND due_at < now()), 0),
    COALESCE(SUM(amount_due) FILTER (WHERE status = 'unpaid' AND due_at >= now() AND due_at <= now() + interval '7 days'), 0)
  INTO v_supplier_payable, v_supplier_overdue, v_supplier_due_soon
  FROM public.credit_inventory_purchases;

  SELECT COALESCE(SUM(net_salary), 0) INTO v_payroll_payable
  FROM public.employee_salaries
  WHERE status = 'finalized';

  SELECT COUNT(*) INTO v_low_stock FROM public.inventory WHERE COALESCE(current_stock, 0) <= COALESCE(minimum_stock, 0);
  SELECT COUNT(*) INTO v_stock_alerts FROM public.operational_alerts WHERE status = 'open' AND alert_type = 'stock_variance';
  SELECT COUNT(*) INTO v_ops_alerts FROM public.operational_alerts WHERE status = 'open';

  v_pnl := public.get_profit_and_loss_summary(_start_date, _end_date);
  v_prev_pnl := public.get_profit_and_loss_summary(_prev_start_date, _prev_end_date);

  RETURN jsonb_build_object(
    'financial_position', jsonb_build_object(
      'cash_in_hand', v_cash,
      'cash_in_bank', v_bank,
      'total_liquid_funds', v_cash + v_bank,
      'accounts_receivable', v_receivable,
      'overdue_receivables', v_overdue_receivable,
      'overdue_invoice_count', v_overdue_invoice_count,
      'supplier_credit_payables', v_supplier_payable,
      'supplier_due_soon', v_supplier_due_soon,
      'supplier_overdue', v_supplier_overdue,
      'payroll_payable', v_payroll_payable,
      'inventory_value', null,
      'inventory_value_status', 'unavailable: inventory rows do not carry reliable cost valuation'
    ),
    'performance', v_pnl,
    'previous_period', v_prev_pnl,
    'operations', jsonb_build_object(
      'low_stock_count', v_low_stock,
      'stock_audit_variance_alerts', v_stock_alerts,
      'unresolved_operational_alerts', v_ops_alerts
    ),
    'direction', jsonb_build_object(
      'liquid_funds', jsonb_build_object('current', v_cash + v_bank, 'previous', null, 'status', 'point-in-time only until historical account snapshots are added'),
      'expenses_change_pct', CASE WHEN (v_prev_pnl->>'operating_expenses')::numeric = 0 THEN null ELSE round((((v_pnl->>'operating_expenses')::numeric - (v_prev_pnl->>'operating_expenses')::numeric) / abs((v_prev_pnl->>'operating_expenses')::numeric)) * 100, 2) END,
      'receivables', jsonb_build_object('current', v_receivable, 'previous', null, 'status', 'point-in-time only'),
      'payables', jsonb_build_object('current', v_supplier_payable + v_payroll_payable, 'previous', null, 'status', 'point-in-time only'),
      'net_profit_positive', (v_pnl->>'net_profit')::numeric >= 0
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_owner_business_health(date, date, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_owner_business_health(date, date, date, date) TO authenticated;
