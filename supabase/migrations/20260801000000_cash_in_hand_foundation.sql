-- Prompt 2, item B: Cash in Hand foundation.
--
-- Formula (owner-provided, final):
--   opening_balance
--   + approved client-payment credits (cash_ledger_entries, entry_type='client_payment_credit')
--   - expenses_total (existing public.expenses, unchanged behaviour, no approval workflow added)
--   - paid_salaries_total (existing public.employee_salaries, but only rows explicitly marked
--     paid - see the smallest-safe paid-state foundation added below)
--
-- This migration is additive only. No existing invoices/expenses/salaries rows are modified.

-- ---------------------------------------------------------------------
-- Opening balance singleton + append-only history.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cash_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opening_balance numeric NOT NULL DEFAULT 0,
  effective_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  reason text
);

CREATE UNIQUE INDEX IF NOT EXISTS cash_settings_singleton
  ON public.cash_settings ((true));

INSERT INTO public.cash_settings (id, opening_balance, effective_at, reason)
VALUES ('00000000-0000-4000-8000-000000000004', 0, now(), 'Initial safe default - opening balance not yet set by Admin')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.cash_settings_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  previous_opening_balance numeric NOT NULL,
  new_opening_balance numeric NOT NULL,
  effective_at timestamptz NOT NULL,
  changed_by uuid REFERENCES auth.users(id),
  changed_at timestamptz NOT NULL DEFAULT now(),
  reason text
);

CREATE INDEX IF NOT EXISTS idx_cash_settings_history_changed_at
  ON public.cash_settings_history (changed_at);

ALTER TABLE public.cash_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_settings_history ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.cash_settings FROM anon, authenticated;
REVOKE ALL ON public.cash_settings_history FROM anon, authenticated;
GRANT SELECT ON public.cash_settings TO authenticated;
GRANT SELECT ON public.cash_settings_history TO authenticated;
GRANT ALL ON public.cash_settings TO service_role;
GRANT ALL ON public.cash_settings_history TO service_role;

DROP POLICY IF EXISTS "Admin reads cash_settings" ON public.cash_settings;
CREATE POLICY "Admin reads cash_settings"
  ON public.cash_settings FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admin reads cash_settings_history" ON public.cash_settings_history;
CREATE POLICY "Admin reads cash_settings_history"
  ON public.cash_settings_history FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ---------------------------------------------------------------------
-- Auditable Cash in Hand ledger. Only two entry types needed for this
-- prompt: the singleton's own opening_balance/adjustment trail is kept in
-- cash_settings_history above (not duplicated here), so this ledger is
-- currently used only for client_payment_credit rows - kept as a generic
-- ledger (entry_type column) so a future adjustment type can be added
-- without a schema change.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cash_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_type text NOT NULL,
  amount numeric NOT NULL,
  payment_verification_request_id uuid REFERENCES public.payment_verification_requests(id) ON DELETE SET NULL,
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  source_key text NOT NULL,
  notes text,
  CONSTRAINT cash_ledger_entries_type_check CHECK (entry_type IN ('opening_balance', 'adjustment', 'client_payment_credit')),
  CONSTRAINT cash_ledger_entries_amount_positive CHECK (amount > 0)
);

-- Database-level duplicate guard: even a retried/concurrent approval call
-- can never create a second credit for the same source event.
CREATE UNIQUE INDEX IF NOT EXISTS cash_ledger_entries_source_key_unique
  ON public.cash_ledger_entries (source_key);

CREATE INDEX IF NOT EXISTS idx_cash_ledger_entries_type ON public.cash_ledger_entries (entry_type);
CREATE INDEX IF NOT EXISTS idx_cash_ledger_entries_created_at ON public.cash_ledger_entries (created_at);

ALTER TABLE public.cash_ledger_entries ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.cash_ledger_entries FROM anon, authenticated;
GRANT SELECT ON public.cash_ledger_entries TO authenticated;
GRANT ALL ON public.cash_ledger_entries TO service_role;

DROP POLICY IF EXISTS "Admin reads cash_ledger_entries" ON public.cash_ledger_entries;
CREATE POLICY "Admin reads cash_ledger_entries"
  ON public.cash_ledger_entries FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- No INSERT/UPDATE/DELETE grant to authenticated: the ledger is written
-- only by the SECURITY DEFINER approval RPC (added in the next migration)
-- and by service_role.

-- ---------------------------------------------------------------------
-- Smallest safe paid-state foundation for employee_salaries.
--
-- Inspection result: employee_salaries has NO existing paid/completed
-- status field and NO stored net-salary column - "net salary" is
-- currently only computed client-side in salaries.tsx
-- (net = gross_salary - income_tax - deductions(gross/working_days*absent)
-- - advance_taken; deductions uses Math.round). There is no "overtime"
-- field anywhere in this schema, so there is nothing to double-count.
--
-- Per explicit instruction: do not guess a paid state. Add the smallest
-- safe foundation instead. New rows and all existing rows default to
-- paid = false, so "salary creation alone must not subtract money" holds
-- automatically, and existing historical salary rows do not silently
-- start subtracting from Cash in Hand until an Admin explicitly marks
-- them paid.
-- ---------------------------------------------------------------------

ALTER TABLE public.employee_salaries
  ADD COLUMN IF NOT EXISTS paid boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS paid_by uuid REFERENCES auth.users(id);

ALTER TABLE public.employee_salaries
  DROP CONSTRAINT IF EXISTS employee_salaries_paid_state_check;
ALTER TABLE public.employee_salaries
  ADD CONSTRAINT employee_salaries_paid_state_check CHECK (
    (paid = false AND paid_at IS NULL AND paid_by IS NULL)
    OR
    (paid = true AND paid_at IS NOT NULL AND paid_by IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_employee_salaries_paid ON public.employee_salaries (paid);

-- Mirrors the existing client-side formula in salaries.tsx exactly
-- (calcDeductions + calcNet), so the DB never invents a different number
-- for the same salary row. IMMUTABLE + no side effects.
CREATE OR REPLACE FUNCTION public.calculate_salary_net_amount(
  _gross_salary numeric,
  _income_tax numeric,
  _total_working_days integer,
  _absent_days integer,
  _advance_taken numeric
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(_gross_salary, 0)
    - COALESCE(_income_tax, 0)
    - CASE
        WHEN COALESCE(_total_working_days, 0) = 0 THEN 0
        ELSE round((COALESCE(_gross_salary, 0) / _total_working_days) * COALESCE(_absent_days, 0))
      END
    - COALESCE(_advance_taken, 0)
$$;

REVOKE ALL ON FUNCTION public.calculate_salary_net_amount(numeric, numeric, integer, integer, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calculate_salary_net_amount(numeric, numeric, integer, integer, numeric) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- Admin-only RPC to set the opening balance. Atomically updates the
-- singleton and appends a history row. No direct UPDATE grant exists on
-- cash_settings for authenticated, so this RPC is the only write path.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_cash_opening_balance(
  _opening_balance numeric,
  _effective_at timestamptz DEFAULT now(),
  _reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_row public.cash_settings%ROWTYPE;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  IF _opening_balance IS NULL THEN
    RAISE EXCEPTION 'Opening balance is required';
  END IF;

  SELECT * INTO current_row FROM public.cash_settings LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cash settings singleton row is missing';
  END IF;

  INSERT INTO public.cash_settings_history (
    previous_opening_balance, new_opening_balance, effective_at, changed_by, reason
  ) VALUES (
    current_row.opening_balance, _opening_balance, COALESCE(_effective_at, now()), auth.uid(), _reason
  );

  UPDATE public.cash_settings
  SET opening_balance = _opening_balance,
      effective_at = COALESCE(_effective_at, now()),
      updated_by = auth.uid(),
      updated_at = now(),
      reason = _reason
  WHERE id = current_row.id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_cash_opening_balance(numeric, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_cash_opening_balance(numeric, timestamptz, text) TO authenticated;

-- ---------------------------------------------------------------------
-- Admin-only RPC to mark a salary row paid. Marking paid is the only
-- action that makes a salary subtract from Cash in Hand; creation/edit
-- alone never does.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mark_salary_paid(_salary_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row_exists boolean;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.employee_salaries WHERE id = _salary_id AND paid = false FOR UPDATE
  ) INTO row_exists;

  IF NOT row_exists THEN
    RAISE EXCEPTION 'Salary row not found or already marked paid';
  END IF;

  UPDATE public.employee_salaries
  SET paid = true, paid_at = now(), paid_by = auth.uid()
  WHERE id = _salary_id;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_salary_paid(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_salary_paid(uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- Shared Cash in Hand calculation. Admin-only (employee_salaries itself
-- is already Admin-only readable; this aggregate must not leak salary
-- totals to non-Admin roles either).
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_cash_in_hand_summary()
RETURNS TABLE (
  opening_balance numeric,
  client_payment_credits numeric,
  expenses_total numeric,
  paid_salaries_total numeric,
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
  v_salaries numeric;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT cs.opening_balance INTO v_opening FROM public.cash_settings cs LIMIT 1;
  v_opening := COALESCE(v_opening, 0);

  SELECT COALESCE(SUM(amount), 0) INTO v_credits
  FROM public.cash_ledger_entries
  WHERE entry_type = 'client_payment_credit';

  SELECT COALESCE(SUM(price), 0) INTO v_expenses FROM public.expenses;

  SELECT COALESCE(SUM(public.calculate_salary_net_amount(
    gross_salary, income_tax, total_working_days, absent_days, advance_taken
  )), 0) INTO v_salaries
  FROM public.employee_salaries
  WHERE paid = true;

  RETURN QUERY SELECT
    v_opening,
    v_credits,
    v_expenses,
    v_salaries,
    v_opening + v_credits - v_expenses - v_salaries;
END;
$$;

REVOKE ALL ON FUNCTION public.get_cash_in_hand_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cash_in_hand_summary() TO authenticated;
