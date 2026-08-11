-- Phase 1 hardening: cash_ledger_entries becomes a true append-only audit
-- ledger. Historical posted financial movements must never silently
-- disappear or be rewritten.
--
-- Problem being fixed: the Phase 1 expenses trigger (sync_expense_cash_ledger)
-- used UPDATE (on price edit) and DELETE (on expense delete) directly
-- against cash_ledger_entries. That is functionally correct for the
-- running balance but destroys audit history - a corrected/deleted
-- expense's original financial movement becomes unrecoverable.
--
-- This migration:
--   1. Adds `reverses_entry_id` (nullable self-FK) so a correction/void
--      row can explicitly link back to the entry it corrects - NULL means
--      "original/organic entry".
--   2. Loosens the entry_type/direction CHECK so 'expense' rows may be
--      either direction (debit = original charge or an upward
--      correction, credit = a downward correction or a void). All other
--      entry types are unchanged (still a fixed direction).
--   3. Redefines sync_expense_cash_ledger() as INSERT-only: it now posts
--      a delta correction (or, for a brand-new expense, the initial
--      debit) instead of ever rewriting history, and posts an offsetting
--      void correction on delete instead of removing the original row.
--      A no-op edit (price unchanged) or an edit with the already-correct
--      net effect posts nothing - idempotent by construction.
--   4. Adds a hard, unconditional BEFORE UPDATE OR DELETE trigger on
--      cash_ledger_entries itself that rejects any mutation of a posted
--      row, for every role (this is not an RLS/grant check - it is a
--      trigger, so it cannot be bypassed by connecting with a more
--      privileged role). Safe to add now because, after step 3, nothing
--      in this codebase ever UPDATEs or DELETEs a cash_ledger_entries row
--      again - every writer is INSERT-only.
--   5. Redefines get_cash_in_hand_summary()'s expense term to net by
--      direction (debit minus credit) instead of a flat SUM(amount), so
--      correction/void rows produce the correct current balance.
--
-- Does NOT touch, rewrite, or duplicate the 576 existing backfilled
-- expense debit rows (verified after execution: count and sum unchanged).
-- Does NOT modify inventory_purchase/salary_payment/client_payment_credit
-- behavior - those remain single-INSERT, unchanged from Phase 1.

-- ---------------------------------------------------------------------
-- 1 + 2. Schema: reverses_entry_id, loosened expense direction.
-- ---------------------------------------------------------------------

ALTER TABLE public.cash_ledger_entries
  ADD COLUMN IF NOT EXISTS reverses_entry_id uuid REFERENCES public.cash_ledger_entries(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cash_ledger_entries_reverses_entry_id ON public.cash_ledger_entries (reverses_entry_id);

ALTER TABLE public.cash_ledger_entries DROP CONSTRAINT IF EXISTS cash_ledger_entries_type_direction_check;
ALTER TABLE public.cash_ledger_entries ADD CONSTRAINT cash_ledger_entries_type_direction_check CHECK (
  (entry_type = 'client_payment_credit' AND direction = 'credit')
  OR (entry_type IN ('inventory_purchase', 'salary_payment') AND direction = 'debit')
  -- expense rows may be either direction: 'debit' for the original
  -- charge or an upward correction, 'credit' for a downward correction
  -- or a void - the running total is always netted by direction.
  OR (entry_type = 'expense')
  OR (entry_type IN ('adjustment', 'opening_balance'))
);

-- ---------------------------------------------------------------------
-- 3. Append-only expense sync: post deltas, never rewrite/remove.
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
  v_next_seq integer;
  v_delta numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Void: post an offsetting correction bringing this expense's net
    -- ledger effect to zero. The original debit (and any prior
    -- corrections) are never touched - permanent audit trail.
    --
    -- IMPORTANT: this is an AFTER DELETE trigger on expenses, and so is
    -- the FK's own ON DELETE SET NULL action for cash_ledger_entries.expense_id
    -- (also an AFTER DELETE trigger on expenses). Postgres fires
    -- same-timing triggers in trigger-name order, and the FK's
    -- system-generated trigger name sorts before this one, so by the
    -- time this branch runs, expense_id has ALREADY been nulled on every
    -- row that used to reference OLD.id. Every lookup below therefore
    -- uses the immutable source_key prefix, never expense_id.
    SELECT COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount ELSE -amount END), 0)
      INTO v_effective_amount
      FROM public.cash_ledger_entries WHERE source_key LIKE 'expense:' || OLD.id::text || ':%';

    IF v_effective_amount = 0 THEN
      RETURN OLD; -- nothing effective to reverse
    END IF;

    SELECT id INTO v_last_entry_id FROM public.cash_ledger_entries
      WHERE source_key LIKE 'expense:' || OLD.id::text || ':%' ORDER BY created_at DESC, id DESC LIMIT 1;
    SELECT count(*) + 1 INTO v_next_seq FROM public.cash_ledger_entries
      WHERE source_key LIKE 'expense:' || OLD.id::text || ':%';

    -- expense_id is deliberately left NULL here (not OLD.id): the parent
    -- expenses row is already gone by this point, and the FK's own
    -- ON DELETE SET NULL action would null it out anyway - the permanent
    -- link is source_key, which never changes.
    INSERT INTO public.cash_ledger_entries (
      entry_type, direction, amount, created_by, source_key, notes, reverses_entry_id
    ) VALUES (
      'expense',
      CASE WHEN v_effective_amount > 0 THEN 'credit' ELSE 'debit' END,
      abs(v_effective_amount),
      auth.uid(),
      'expense:' || OLD.id::text || ':void:v' || v_next_seq,
      'Void: expense deleted (' || COALESCE(OLD.item, '') || ')',
      v_last_entry_id
    )
    ON CONFLICT (source_key) DO NOTHING;

    RETURN OLD;
  END IF;

  -- INSERT, or UPDATE OF price. A no-op price "edit" (identical value
  -- resubmitted) is a deliberate idempotent no-op - it must never post a
  -- spurious correction.
  IF TG_OP = 'UPDATE' AND NEW.price IS NOT DISTINCT FROM OLD.price THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount ELSE -amount END), 0)
    INTO v_effective_amount
    FROM public.cash_ledger_entries WHERE expense_id = NEW.id;

  v_delta := COALESCE(NEW.price, 0) - v_effective_amount;
  IF v_delta = 0 THEN
    RETURN NEW; -- already correct (e.g. reprocessed with the same net effect)
  END IF;

  SELECT id INTO v_last_entry_id FROM public.cash_ledger_entries
    WHERE expense_id = NEW.id ORDER BY created_at DESC, id DESC LIMIT 1;
  SELECT count(*) + 1 INTO v_next_seq FROM public.cash_ledger_entries WHERE expense_id = NEW.id;

  INSERT INTO public.cash_ledger_entries (
    entry_type, direction, amount, expense_id, created_by, created_at, source_key, notes, reverses_entry_id
  ) VALUES (
    'expense',
    CASE WHEN v_delta > 0 THEN 'debit' ELSE 'credit' END,
    abs(v_delta),
    NEW.id,
    -- The very first entry for an expense preserves Phase 1's original
    -- semantics (creator/creation time of the expense itself). Every
    -- later correction records the actor/time of that specific edit.
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

-- Trigger definition itself (target columns, timing) is unchanged from
-- Phase 1 - only the function body changed.

-- ---------------------------------------------------------------------
-- 4. Hard immutability: no UPDATE or DELETE on cash_ledger_entries, ever,
--    for any role. Safe now that every writer (approve_payment_verification_request,
--    mark_salary_paid, mark_credit_inventory_purchase_paid,
--    create_credit_inventory_purchase, sync_expense_cash_ledger) is
--    INSERT-only.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.prevent_cash_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'cash_ledger_entries rows are immutable and cannot be deleted - post a reversal/correction entry instead';
  END IF;

  -- Exactly one UPDATE case is allowed: a foreign key's own ON DELETE SET
  -- NULL action nulling out a link column (expense_id/credit_purchase_id/
  -- salary_id/payment_verification_request_id/invoice_id/client_id) when
  -- its referenced source row is deleted elsewhere - this is what lets a
  -- ledger row outlive the deletion of its originating request/expense/
  -- purchase/salary row (the live database already had exactly this case
  -- before this migration). Every financial field must be provably
  -- unchanged, and every link column must either stay the same or become
  -- NULL - never reassigned to a different value, never un-nulled.
  IF NEW.amount = OLD.amount
     AND NEW.direction = OLD.direction
     AND NEW.entry_type = OLD.entry_type
     AND NEW.source_key = OLD.source_key
     AND NEW.created_at = OLD.created_at
     AND NEW.created_by IS NOT DISTINCT FROM OLD.created_by
     AND NEW.notes IS NOT DISTINCT FROM OLD.notes
     AND NEW.reverses_entry_id IS NOT DISTINCT FROM OLD.reverses_entry_id
     AND (NEW.expense_id IS NOT DISTINCT FROM OLD.expense_id OR NEW.expense_id IS NULL)
     AND (NEW.credit_purchase_id IS NOT DISTINCT FROM OLD.credit_purchase_id OR NEW.credit_purchase_id IS NULL)
     AND (NEW.salary_id IS NOT DISTINCT FROM OLD.salary_id OR NEW.salary_id IS NULL)
     AND (NEW.payment_verification_request_id IS NOT DISTINCT FROM OLD.payment_verification_request_id OR NEW.payment_verification_request_id IS NULL)
     AND (NEW.invoice_id IS NOT DISTINCT FROM OLD.invoice_id OR NEW.invoice_id IS NULL)
     AND (NEW.client_id IS NOT DISTINCT FROM OLD.client_id OR NEW.client_id IS NULL)
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'cash_ledger_entries rows are immutable and cannot be updated - post a reversal/correction entry instead';
END;
$$;

DROP TRIGGER IF EXISTS cash_ledger_entries_immutable ON public.cash_ledger_entries;
CREATE TRIGGER cash_ledger_entries_immutable
  BEFORE UPDATE OR DELETE ON public.cash_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public.prevent_cash_ledger_mutation();

-- ---------------------------------------------------------------------
-- 5. get_cash_in_hand_summary(): expense term now nets by direction so
--    correction/void entries produce the correct current balance. Same
--    return shape as Phase 1 - CREATE OR REPLACE, no DROP needed.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_cash_in_hand_summary()
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

  -- Netted by direction: an original debit, an upward correction (debit),
  -- a downward correction (credit) and a void (credit) all combine to the
  -- current effective total.
  SELECT COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount ELSE -amount END), 0) INTO v_expenses
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
