-- Phase 1: strict, auditable Cash in Hand ledger.
--
-- Goal: every real cash movement creates exactly ONE linked
-- cash_ledger_entries row - no fake calculations, no duplicate
-- deductions, no double credits.
--
-- Pre-migration live state (verified via read-only introspection before
-- writing this migration, NEW project uclo...mbud only):
--   cash_ledger_entries = 1 (one real, already-approved client payment -
--     created correctly by approve_payment_verification_request(), never
--     altered by this migration)
--   expenses = 576 (0 rows with price <= 0)
--   employee_salaries = 6 (0 marked paid)
--   credit_inventory_purchases = 0
--
-- This migration:
--   1. Widens cash_ledger_entries: adds entry types 'expense',
--      'inventory_purchase', 'salary_payment'; adds a `direction`
--      (credit/debit) column; adds nullable link columns (expense_id,
--      credit_purchase_id, salary_id) alongside the existing ones.
--   2. Enforces deterministic source linkage via the immutable
--      `source_key` text prefix, NOT via NOT NULL FK columns - the
--      existing client_payment_credit FK columns are intentionally
--      nullable (ON DELETE SET NULL), so a ledger row survives deletion
--      of its originating request row. The live table already has
--      exactly this case in production (the one real row's
--      payment_verification_request_id is NULL because that request row
--      was later deleted, while its source_key - the permanent origin
--      proof - is untouched). A NOT NULL FK requirement would have broken
--      on this real row.
--   3. Backfills existing expenses (deterministic 1:1, safe - every
--      expense row unconditionally represents a real recorded spend
--      already, per existing app behavior) into the ledger. Does NOT
--      backfill historical invoice "Done" status into client_payment_credit
--      - there is no reliable record of who approved those or whether they
--      were genuinely paid, so fabricating ledger entries for them would
--      violate "do not fabricate ledger entries where payment status
--      cannot be proven."
--   4. Adds a trigger keeping expenses <-> ledger in exact sync on
--      insert/update(price)/delete - zero application-code changes
--      required, existing expense permissions/workflow untouched.
--   5. Redefines get_cash_in_hand_summary() (DROP+CREATE - return shape
--      changed) to compute purely from the ledger.
--   6. Redefines mark_salary_paid() and mark_credit_inventory_purchase_paid()
--      to each create exactly one linked, idempotent debit.
--   7. Adds `payment_mode` ('cash'/'credit') to credit_inventory_purchases
--      and redefines create_credit_inventory_purchase() to: update
--      inventory stock the same way the existing Stock In/Out UI already
--      does (stock_movements insert + inventory.current_stock update) for
--      both modes, and for cash mode only, create the purchase already
--      paid with its debit in the same transaction.

-- ---------------------------------------------------------------------
-- 1. Widen cash_ledger_entries
-- ---------------------------------------------------------------------

ALTER TABLE public.cash_ledger_entries DROP CONSTRAINT IF EXISTS cash_ledger_entries_type_check;
ALTER TABLE public.cash_ledger_entries ADD CONSTRAINT cash_ledger_entries_type_check CHECK (
  entry_type IN (
    'opening_balance', 'adjustment', 'client_payment_credit',
    'expense', 'inventory_purchase', 'salary_payment'
  )
);

ALTER TABLE public.cash_ledger_entries
  ADD COLUMN IF NOT EXISTS expense_id uuid REFERENCES public.expenses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS credit_purchase_id uuid REFERENCES public.credit_inventory_purchases(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS salary_id uuid REFERENCES public.employee_salaries(id) ON DELETE SET NULL;

-- The one existing real row is a client_payment_credit, correctly
-- 'credit' - backfill via a temporary default, then require every future
-- insert to state direction explicitly (no silent default).
ALTER TABLE public.cash_ledger_entries ADD COLUMN IF NOT EXISTS direction text NOT NULL DEFAULT 'credit';
ALTER TABLE public.cash_ledger_entries ALTER COLUMN direction DROP DEFAULT;

ALTER TABLE public.cash_ledger_entries DROP CONSTRAINT IF EXISTS cash_ledger_entries_direction_check;
ALTER TABLE public.cash_ledger_entries ADD CONSTRAINT cash_ledger_entries_direction_check
  CHECK (direction IN ('credit', 'debit'));

ALTER TABLE public.cash_ledger_entries DROP CONSTRAINT IF EXISTS cash_ledger_entries_type_direction_check;
ALTER TABLE public.cash_ledger_entries ADD CONSTRAINT cash_ledger_entries_type_direction_check CHECK (
  (entry_type = 'client_payment_credit' AND direction = 'credit')
  OR (entry_type IN ('expense', 'inventory_purchase', 'salary_payment') AND direction = 'debit')
  OR (entry_type IN ('adjustment', 'opening_balance'))
);

ALTER TABLE public.cash_ledger_entries DROP CONSTRAINT IF EXISTS cash_ledger_entries_source_key_prefix_check;
ALTER TABLE public.cash_ledger_entries ADD CONSTRAINT cash_ledger_entries_source_key_prefix_check CHECK (
  (entry_type = 'client_payment_credit' AND source_key LIKE 'payment_verification_request:%')
  OR (entry_type = 'expense' AND source_key LIKE 'expense:%')
  OR (entry_type = 'inventory_purchase' AND source_key LIKE 'credit_inventory_purchase:%')
  OR (entry_type = 'salary_payment' AND source_key LIKE 'employee_salary:%')
  OR (entry_type IN ('adjustment', 'opening_balance'))
);

CREATE INDEX IF NOT EXISTS idx_cash_ledger_entries_expense_id ON public.cash_ledger_entries (expense_id);
CREATE INDEX IF NOT EXISTS idx_cash_ledger_entries_credit_purchase_id ON public.cash_ledger_entries (credit_purchase_id);
CREATE INDEX IF NOT EXISTS idx_cash_ledger_entries_salary_id ON public.cash_ledger_entries (salary_id);

-- ---------------------------------------------------------------------
-- 2. Backfill existing expenses into the ledger (deterministic, safe -
--    every expense row already unconditionally represents a real spend
--    in existing app behavior; skips non-positive prices defensively,
--    though none currently exist).
-- ---------------------------------------------------------------------

INSERT INTO public.cash_ledger_entries (
  entry_type, direction, amount, expense_id, created_by, created_at, source_key, notes
)
SELECT
  'expense', 'debit', e.price, e.id, e.created_by, COALESCE(e.created_at, now()),
  'expense:' || e.id::text,
  'Backfilled from existing expense row'
FROM public.expenses e
WHERE e.price > 0
  AND NOT EXISTS (SELECT 1 FROM public.cash_ledger_entries l WHERE l.expense_id = e.id)
ON CONFLICT (source_key) DO NOTHING;

-- ---------------------------------------------------------------------
-- 3. Trigger: keep expenses <-> ledger in exact 1:1 sync. No application
--    code change required - existing insert/update/delete from the
--    Expenses page continues to work exactly as before.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sync_expense_cash_ledger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.cash_ledger_entries WHERE expense_id = OLD.id;
    RETURN OLD;
  END IF;

  IF NEW.price IS NULL OR NEW.price <= 0 THEN
    -- No real cash movement to record; remove any stale linked entry
    -- (e.g. price corrected down to zero/negative).
    DELETE FROM public.cash_ledger_entries WHERE expense_id = NEW.id;
    RETURN NEW;
  END IF;

  INSERT INTO public.cash_ledger_entries (
    entry_type, direction, amount, expense_id, created_by, created_at, source_key, notes
  ) VALUES (
    'expense', 'debit', NEW.price, NEW.id, NEW.created_by, COALESCE(NEW.created_at, now()),
    'expense:' || NEW.id::text, NEW.item
  )
  ON CONFLICT (source_key) DO UPDATE
  SET amount = EXCLUDED.amount, notes = EXCLUDED.notes;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_expense_cash_ledger() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS expenses_sync_cash_ledger ON public.expenses;
CREATE TRIGGER expenses_sync_cash_ledger
  AFTER INSERT OR UPDATE OF price OR DELETE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.sync_expense_cash_ledger();

-- ---------------------------------------------------------------------
-- 4. get_cash_in_hand_summary(): now computed purely from the ledger.
--    Return shape changed (2 new columns) - requires DROP first.
-- ---------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.get_cash_in_hand_summary();

CREATE FUNCTION public.get_cash_in_hand_summary()
RETURNS TABLE (
  opening_balance numeric,
  client_payment_credits numeric,
  expenses_total numeric,
  inventory_purchases_paid_total numeric,
  paid_salaries_total numeric,
  adjustments_total numeric,
  cash_in_hand numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_opening numeric;
  v_credits numeric;
  v_expenses numeric;
  v_inventory numeric;
  v_salaries numeric;
  v_adjustments numeric;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT cs.opening_balance INTO v_opening FROM public.cash_settings cs LIMIT 1;
  v_opening := COALESCE(v_opening, 0);

  SELECT COALESCE(SUM(amount), 0) INTO v_credits
  FROM public.cash_ledger_entries WHERE entry_type = 'client_payment_credit';

  SELECT COALESCE(SUM(amount), 0) INTO v_expenses
  FROM public.cash_ledger_entries WHERE entry_type = 'expense';

  SELECT COALESCE(SUM(amount), 0) INTO v_inventory
  FROM public.cash_ledger_entries WHERE entry_type = 'inventory_purchase';

  SELECT COALESCE(SUM(amount), 0) INTO v_salaries
  FROM public.cash_ledger_entries WHERE entry_type = 'salary_payment';

  SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END), 0) INTO v_adjustments
  FROM public.cash_ledger_entries WHERE entry_type = 'adjustment';

  RETURN QUERY SELECT
    v_opening, v_credits, v_expenses, v_inventory, v_salaries, v_adjustments,
    v_opening + v_credits - v_expenses - v_inventory - v_salaries + v_adjustments;
END;
$$;

REVOKE ALL ON FUNCTION public.get_cash_in_hand_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cash_in_hand_summary() TO authenticated;

-- ---------------------------------------------------------------------
-- 5. mark_salary_paid(): now also creates exactly one linked debit,
--    idempotently (source_key unique index + status guard = two
--    independent layers against a double deduction).
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mark_salary_paid(_salary_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.employee_salaries%ROWTYPE;
  v_net numeric;
  v_ledger_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT * INTO v_row FROM public.employee_salaries WHERE id = _salary_id AND paid = false FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Salary row not found or already marked paid';
  END IF;

  v_net := public.calculate_salary_net_amount(
    v_row.gross_salary, v_row.income_tax, v_row.total_working_days, v_row.absent_days, v_row.advance_taken
  );
  IF v_net <= 0 THEN
    RAISE EXCEPTION 'Calculated net salary must be positive to mark paid';
  END IF;

  INSERT INTO public.cash_ledger_entries (
    entry_type, direction, amount, salary_id, created_by, source_key
  ) VALUES (
    'salary_payment', 'debit', v_net, _salary_id, auth.uid(), 'employee_salary:' || _salary_id::text
  )
  ON CONFLICT (source_key) DO NOTHING
  RETURNING id INTO v_ledger_id;

  IF v_ledger_id IS NULL THEN
    RAISE EXCEPTION 'A cash debit already exists for this salary payment';
  END IF;

  UPDATE public.employee_salaries
  SET paid = true, paid_at = now(), paid_by = auth.uid()
  WHERE id = _salary_id;
END;
$$;

-- ---------------------------------------------------------------------
-- 6. mark_credit_inventory_purchase_paid(): now also creates exactly one
--    linked debit, idempotently.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mark_credit_inventory_purchase_paid(_purchase_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.credit_inventory_purchases%ROWTYPE;
  v_ledger_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT * INTO v_row FROM public.credit_inventory_purchases WHERE id = _purchase_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Credit inventory purchase not found';
  END IF;
  IF v_row.status <> 'unpaid' THEN
    RAISE EXCEPTION 'Only unpaid purchases can be marked paid';
  END IF;

  INSERT INTO public.cash_ledger_entries (
    entry_type, direction, amount, credit_purchase_id, created_by, source_key
  ) VALUES (
    'inventory_purchase', 'debit', v_row.amount_due, _purchase_id, auth.uid(),
    'credit_inventory_purchase:' || _purchase_id::text
  )
  ON CONFLICT (source_key) DO NOTHING
  RETURNING id INTO v_ledger_id;

  IF v_ledger_id IS NULL THEN
    RAISE EXCEPTION 'A cash debit already exists for this purchase';
  END IF;

  UPDATE public.credit_inventory_purchases
  SET status = 'paid', paid_at = now()
  WHERE id = _purchase_id;
END;
$$;

-- ---------------------------------------------------------------------
-- 7. Cash vs credit inventory purchases.
-- ---------------------------------------------------------------------

ALTER TABLE public.credit_inventory_purchases
  ADD COLUMN IF NOT EXISTS payment_mode text NOT NULL DEFAULT 'credit';

ALTER TABLE public.credit_inventory_purchases DROP CONSTRAINT IF EXISTS credit_inventory_purchases_payment_mode_check;
ALTER TABLE public.credit_inventory_purchases ADD CONSTRAINT credit_inventory_purchases_payment_mode_check
  CHECK (payment_mode IN ('cash', 'credit'));

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
  _payment_mode text DEFAULT 'credit'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id uuid;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'staff'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  IF _supplier_name IS NULL OR length(trim(_supplier_name)) = 0 THEN
    RAISE EXCEPTION 'Supplier name is required';
  END IF;
  IF _item_name_snapshot IS NULL OR length(trim(_item_name_snapshot)) = 0 THEN
    RAISE EXCEPTION 'Item name is required';
  END IF;
  IF _amount_due IS NULL OR _amount_due <= 0 THEN
    RAISE EXCEPTION 'Amount due must be positive';
  END IF;
  IF _due_at IS NULL THEN
    RAISE EXCEPTION 'Due date/time is required';
  END IF;
  IF _payment_mode NOT IN ('cash', 'credit') THEN
    RAISE EXCEPTION 'Payment mode must be cash or credit';
  END IF;

  INSERT INTO public.credit_inventory_purchases (
    supplier_name, inventory_item_id, item_name_snapshot, quantity, unit,
    amount_due, due_at, notes, created_by, reminder_lead_hours, payment_mode,
    status, paid_at
  ) VALUES (
    trim(_supplier_name), _inventory_item_id, trim(_item_name_snapshot), _quantity, _unit,
    _amount_due, _due_at, _notes, auth.uid(), COALESCE(_reminder_lead_hours, 24), _payment_mode,
    CASE WHEN _payment_mode = 'cash' THEN 'paid' ELSE 'unpaid' END,
    CASE WHEN _payment_mode = 'cash' THEN now() ELSE NULL END
  )
  RETURNING id INTO new_id;

  -- Goods are received now regardless of payment mode - update stock the
  -- same way the existing Stock In/Out UI already does, only when a real
  -- inventory item + quantity were both provided.
  IF _inventory_item_id IS NOT NULL AND _quantity IS NOT NULL AND _quantity > 0 THEN
    INSERT INTO public.stock_movements (inventory_id, movement_type, quantity, movement_date, notes)
    VALUES (
      _inventory_item_id, 'Stock In', _quantity, CURRENT_DATE,
      (CASE WHEN _payment_mode = 'cash' THEN 'Cash' ELSE 'Credit' END) || ' inventory purchase: ' || trim(_item_name_snapshot)
    );

    UPDATE public.inventory
    SET current_stock = COALESCE(current_stock, 0) + _quantity
    WHERE id = _inventory_item_id;
  END IF;

  -- Cash purchases debit Cash in Hand immediately (the purchase is
  -- created already paid, above). Credit purchases never debit here -
  -- only mark_credit_inventory_purchase_paid() does, later.
  IF _payment_mode = 'cash' THEN
    INSERT INTO public.cash_ledger_entries (
      entry_type, direction, amount, credit_purchase_id, created_by, source_key
    ) VALUES (
      'inventory_purchase', 'debit', _amount_due, new_id, auth.uid(),
      'credit_inventory_purchase:' || new_id::text
    );
  END IF;

  RETURN new_id;
END;
$$;

-- ---------------------------------------------------------------------
-- 8. approve_payment_verification_request(): the ledger's `direction`
--    column (added in step 1 above) is NOT NULL with no default, so this
--    existing function's INSERT must be updated to set it explicitly.
--    Everything else in this function is unchanged from Prompt 2.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.approve_payment_verification_request(
  _request_id uuid,
  _selected_invoice_id uuid DEFAULT NULL
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
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT * INTO req
  FROM public.payment_verification_requests
  WHERE id = _request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment verification request not found';
  END IF;

  IF req.status NOT IN ('pending', 'unresolved') THEN
    RAISE EXCEPTION 'Payment verification request has already been reviewed';
  END IF;

  IF req.approved_cash_entry_id IS NOT NULL THEN
    RAISE EXCEPTION 'This request is already linked to a cash entry';
  END IF;

  IF req.client_id IS NULL THEN
    RAISE EXCEPTION 'Payment verification request has no matched client';
  END IF;

  target_invoice_id := COALESCE(_selected_invoice_id, req.invoice_id);

  IF target_invoice_id IS NULL THEN
    RAISE EXCEPTION 'Payment verification request has no invoice selected';
  END IF;

  SELECT * INTO invoice_row
  FROM public.invoices
  WHERE id = target_invoice_id
    AND COALESCE(is_deleted, false) = false
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected invoice not found';
  END IF;

  IF invoice_row.client_id IS DISTINCT FROM req.client_id THEN
    RAISE EXCEPTION 'Selected invoice does not belong to the matched client';
  END IF;

  IF invoice_row.payment_status = 'Done'::public.payment_status_enum THEN
    RAISE EXCEPTION 'Selected invoice is already paid';
  END IF;

  IF req.claimed_amount IS NULL THEN
    RAISE EXCEPTION 'Claimed amount is not set on this request';
  END IF;

  IF req.claimed_amount <= 0 THEN
    RAISE EXCEPTION 'Claimed amount must be positive';
  END IF;

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
  SET status = 'cancelled',
      error_code = 'payment_verified',
      error_message = 'Payment verified by admin; future reminders cancelled'
  WHERE invoice_id = target_invoice_id
    AND status IN ('pending', 'approved', 'processing');

  INSERT INTO public.cash_ledger_entries (
    entry_type, direction, amount, payment_verification_request_id, invoice_id, client_id, created_by, source_key
  ) VALUES (
    'client_payment_credit', 'credit', req.claimed_amount, _request_id, target_invoice_id, req.client_id, auth.uid(),
    'payment_verification_request:' || _request_id::text
  )
  ON CONFLICT (source_key) DO NOTHING
  RETURNING id INTO ledger_id;

  IF ledger_id IS NULL THEN
    RAISE EXCEPTION 'A cash credit already exists for this payment verification request';
  END IF;

  UPDATE public.payment_verification_requests
  SET invoice_id = target_invoice_id,
      status = 'approved',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      approved_cash_entry_id = ledger_id
  WHERE id = _request_id;
END;
$$;
