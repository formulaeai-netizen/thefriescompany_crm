-- Phase 3: production-grade Payroll / Salaries.
--
-- Pre-migration live state (verified via read-only introspection,
-- NEW project uclo...mbud only): employee_salaries = 6 rows, all
-- month='2026-08', all paid=false (zero salary_payment cash ledger rows
-- exist yet - zero risk of disturbing any real cash-affecting history).
-- No `employees` table exists; employee identity today is just the free
-- text employee_id/employee_name pair on employee_salaries itself.
--
-- Design summary (see final Phase 3 report for the full write-up):
--   1. New `employees` table = payroll settings anchor (base_salary,
--      standard_working_days, overtime_rate, fixed_allowance...),
--      backfilled 1:1 from the 6 existing distinct employee_id rows.
--   2. `employee_salaries` widened additively (same pattern as every
--      prior phase) with a draft/finalized/paid/cancelled lifecycle,
--      attendance-ready fields, and canonical earnings/deductions
--      columns. No existing column is dropped, renamed, or rewritten.
--      All 6 existing rows keep their original gross_salary and get a
--      backfilled net_salary using the OLD formula (calculate_salary_net_amount)
--      - never the new canonical one - so their historical numbers do
--      not change. New breakdown-only fields (base_earned, overtime,
--      etc.) are left at 0 for these rows (never fabricated) until an
--      Admin re-saves them through the new Draft form, which recomputes
--      everything canonically.
--   3. `salary_advances` + `payroll_advance_links`: advances are modeled
--      as real cash-out events at disbursal time (entry_type
--      'salary_advance', its own single-INSERT fixed-direction debit,
--      exactly like salary_payment/inventory_purchase). Outstanding
--      balance is DERIVED (advance.amount minus the sum of its non-cancelled
--      payroll links), never a separately-mutated column - this makes
--      "no double deduction on retry" and "cancelling a payroll restores
--      the advance" both true by construction, not by extra guard logic.
--   4. All financial mutation goes through SECURITY DEFINER RPCs only -
--      direct INSERT/UPDATE/DELETE grants on employee_salaries are
--      revoked from `authenticated` in this migration (previously they
--      were wide open to any admin session), closing a real gap where a
--      paid/finalized row could otherwise be edited directly from the
--      browser, bypassing the new lifecycle entirely.
--   5. get_cash_in_hand_summary() gains one more distinguishable column,
--      salary_advances_paid_total (DROP+CREATE, return shape changed).

-- =======================================================================
-- 1. employees: payroll settings anchor.
-- =======================================================================

CREATE TABLE IF NOT EXISTS public.employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_code text NOT NULL,
  full_name text NOT NULL,
  designation text,
  department text,
  base_salary numeric NOT NULL DEFAULT 0,
  standard_working_days integer NOT NULL DEFAULT 26,
  standard_daily_hours numeric,
  overtime_rate numeric NOT NULL DEFAULT 0,
  fixed_allowance numeric NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employees_base_salary_nonneg CHECK (base_salary >= 0),
  CONSTRAINT employees_standard_working_days_positive CHECK (standard_working_days > 0),
  CONSTRAINT employees_standard_daily_hours_positive CHECK (standard_daily_hours IS NULL OR standard_daily_hours > 0),
  CONSTRAINT employees_overtime_rate_nonneg CHECK (overtime_rate >= 0),
  CONSTRAINT employees_fixed_allowance_nonneg CHECK (fixed_allowance >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS employees_employee_code_unique ON public.employees (employee_code);

ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.employees FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.employees TO authenticated;
GRANT ALL ON public.employees TO service_role;

DROP POLICY IF EXISTS "Admins can view employees" ON public.employees;
CREATE POLICY "Admins can view employees"
  ON public.employees FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins can insert employees" ON public.employees;
CREATE POLICY "Admins can insert employees"
  ON public.employees FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins can update employees" ON public.employees;
CREATE POLICY "Admins can update employees"
  ON public.employees FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- No DELETE policy/grant - deactivate via is_active instead of losing the
-- settings row a payroll record's employee_ref_id may still point to.

DROP TRIGGER IF EXISTS employees_touch_updated_at ON public.employees;
CREATE TRIGGER employees_touch_updated_at
  BEFORE UPDATE ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Backfill: one employees row per distinct existing employee_id, using
-- each employee's most recent employee_salaries row for name/designation/
-- department/working-days. base_salary is seeded from basic_salary if it
-- was actually used (>0), else from gross_salary (5 of the 6 existing
-- rows recorded the real base pay under gross_salary with basic_salary
-- left at 0) - a deterministic, documented default, editable by Admin
-- immediately afterward.
INSERT INTO public.employees (employee_code, full_name, designation, department, base_salary, standard_working_days)
SELECT DISTINCT ON (es.employee_id)
  es.employee_id,
  es.employee_name,
  es.designation,
  es.department,
  COALESCE(NULLIF(es.basic_salary, 0), es.gross_salary, 0),
  COALESCE(NULLIF(es.total_working_days, 0), 26)
FROM public.employee_salaries es
ORDER BY es.employee_id, es.created_at DESC
ON CONFLICT (employee_code) DO NOTHING;

-- =======================================================================
-- 2. employee_salaries: widen additively into a full payroll record.
-- =======================================================================

ALTER TABLE public.employee_salaries
  ADD COLUMN IF NOT EXISTS employee_ref_id uuid REFERENCES public.employees(id),
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS present_days integer,
  ADD COLUMN IF NOT EXISTS paid_leave_days integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unpaid_leave_days integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overtime_hours numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overtime_rate numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overtime_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS base_salary_used numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS base_earned numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bonus numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS allowances numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS commission numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_earnings numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unpaid_leave_deduction numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS advance_deduction numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_deduction numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_deductions numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS manual_adjustment numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS manual_adjustment_reason text,
  ADD COLUMN IF NOT EXISTS net_salary numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS finalized_at timestamptz,
  ADD COLUMN IF NOT EXISTS finalized_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS cancel_reason text;

-- Period fields, derived from the existing `month` ('YYYY-MM') column -
-- one canonical period key, two typed columns for querying/reporting.
ALTER TABLE public.employee_salaries
  ADD COLUMN IF NOT EXISTS period_year integer GENERATED ALWAYS AS (split_part(month, '-', 1)::integer) STORED,
  ADD COLUMN IF NOT EXISTS period_month integer GENERATED ALWAYS AS (split_part(month, '-', 2)::integer) STORED;

-- Validation: no negative days/hours/amounts. Manual adjustment is the one
-- deliberately signed field (it can be a positive or negative correction).
ALTER TABLE public.employee_salaries DROP CONSTRAINT IF EXISTS employee_salaries_status_check;
ALTER TABLE public.employee_salaries ADD CONSTRAINT employee_salaries_status_check
  CHECK (status IN ('draft', 'finalized', 'paid', 'cancelled'));

ALTER TABLE public.employee_salaries DROP CONSTRAINT IF EXISTS employee_salaries_status_paid_consistency_check;
ALTER TABLE public.employee_salaries ADD CONSTRAINT employee_salaries_status_paid_consistency_check
  CHECK ((status = 'paid') = (paid = true));

ALTER TABLE public.employee_salaries DROP CONSTRAINT IF EXISTS employee_salaries_status_finalized_check;
ALTER TABLE public.employee_salaries ADD CONSTRAINT employee_salaries_status_finalized_check
  CHECK (status NOT IN ('finalized', 'paid') OR (finalized_at IS NOT NULL AND finalized_by IS NOT NULL));

ALTER TABLE public.employee_salaries DROP CONSTRAINT IF EXISTS employee_salaries_status_cancelled_check;
ALTER TABLE public.employee_salaries ADD CONSTRAINT employee_salaries_status_cancelled_check
  CHECK (status <> 'cancelled' OR (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND paid = false));

ALTER TABLE public.employee_salaries DROP CONSTRAINT IF EXISTS employee_salaries_manual_adjustment_reason_check;
ALTER TABLE public.employee_salaries ADD CONSTRAINT employee_salaries_manual_adjustment_reason_check
  CHECK (manual_adjustment = 0 OR (manual_adjustment_reason IS NOT NULL AND length(trim(manual_adjustment_reason)) > 0));

ALTER TABLE public.employee_salaries DROP CONSTRAINT IF EXISTS employee_salaries_nonneg_check;
ALTER TABLE public.employee_salaries ADD CONSTRAINT employee_salaries_nonneg_check CHECK (
  (present_days IS NULL OR present_days >= 0)
  AND paid_leave_days >= 0
  AND unpaid_leave_days >= 0
  AND absent_days >= 0
  AND overtime_hours >= 0
  AND overtime_rate >= 0
  AND overtime_amount >= 0
  AND base_salary_used >= 0
  AND base_earned >= 0
  AND bonus >= 0
  AND allowances >= 0
  AND commission >= 0
  AND other_earnings >= 0
  AND unpaid_leave_deduction >= 0
  AND advance_deduction >= 0
  AND other_deduction >= 0
  AND total_deductions >= 0
);

-- One normal (non-cancelled) payroll record per employee per period.
-- Applies only once employee_ref_id is populated (new rows always have
-- it; legacy rows are backfilled below before this index is created).
CREATE UNIQUE INDEX IF NOT EXISTS employee_salaries_one_per_employee_period
  ON public.employee_salaries (employee_ref_id, month)
  WHERE status <> 'cancelled' AND employee_ref_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_employee_salaries_status ON public.employee_salaries (status);
CREATE INDEX IF NOT EXISTS idx_employee_salaries_employee_ref_id ON public.employee_salaries (employee_ref_id);
CREATE INDEX IF NOT EXISTS idx_employee_salaries_period ON public.employee_salaries (period_year, period_month);

-- Backfill the 6 existing rows: link to the new employees table and mark
-- them 'draft' (matches their real paid=false state - creation alone
-- never affected Cash in Hand before, so 'draft' is the accurate
-- pre-Phase-3 equivalent, not a guess). gross_salary is left completely
-- untouched. net_salary is backfilled using the OLD formula only
-- (calculate_salary_net_amount, unchanged) so the historical number shown
-- does not change. New breakdown-only fields are intentionally left at
-- their 0 default - that data was never captured and is not fabricated
-- here; base_salary_used is the one exception, seeded the same
-- deterministic way as the employees.base_salary backfill above, purely
-- as an informational carryover (it does not feed into the preserved
-- gross_salary/net_salary values below).
UPDATE public.employee_salaries es
SET employee_ref_id = e.id,
    status = CASE WHEN es.paid THEN 'paid' ELSE 'draft' END,
    base_salary_used = COALESCE(NULLIF(es.basic_salary, 0), es.gross_salary, 0),
    net_salary = public.calculate_salary_net_amount(
      es.gross_salary, es.income_tax, es.total_working_days, es.absent_days, es.advance_taken
    ),
    notes = 'Legacy pre-Phase-3 row: imported as-is. New payroll breakdown fields ' ||
            '(base earned, overtime, bonus, allowances, commission, unpaid-leave/other deductions) ' ||
            'were not tracked historically and are left at 0, not fabricated. ' ||
            'gross_salary/net_salary preserve the original pre-Phase-3 formula.'
FROM public.employees e
WHERE e.employee_code = es.employee_id
  AND es.employee_ref_id IS NULL;

-- =======================================================================
-- 3. Salary advances: a real cash-out event at disbursal time, plus an
--    append-only, derived-outstanding link to whichever payroll row(s)
--    later deduct it from payable salary.
-- =======================================================================

CREATE TABLE IF NOT EXISTS public.salary_advances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_ref_id uuid NOT NULL REFERENCES public.employees(id),
  amount numeric NOT NULL,
  advance_date date NOT NULL DEFAULT CURRENT_DATE,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT salary_advances_amount_positive CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS idx_salary_advances_employee_ref_id ON public.salary_advances (employee_ref_id);

ALTER TABLE public.salary_advances ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.salary_advances FROM anon, authenticated;
GRANT SELECT ON public.salary_advances TO authenticated;
GRANT ALL ON public.salary_advances TO service_role;

DROP POLICY IF EXISTS "Admins can view salary_advances" ON public.salary_advances;
CREATE POLICY "Admins can view salary_advances"
  ON public.salary_advances FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- No direct INSERT/UPDATE/DELETE grant - creation always goes through
-- create_salary_advance() below, which also posts the linked cash debit
-- in the same transaction. Never mutated or deleted afterward - it is
-- itself a financial history row.

CREATE TABLE IF NOT EXISTS public.payroll_advance_links (
  payroll_id uuid NOT NULL REFERENCES public.employee_salaries(id),
  advance_id uuid NOT NULL REFERENCES public.salary_advances(id),
  amount numeric NOT NULL,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (payroll_id, advance_id),
  CONSTRAINT payroll_advance_links_amount_positive CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS idx_payroll_advance_links_advance_id ON public.payroll_advance_links (advance_id);

ALTER TABLE public.payroll_advance_links ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.payroll_advance_links FROM anon, authenticated;
GRANT SELECT ON public.payroll_advance_links TO authenticated;
GRANT ALL ON public.payroll_advance_links TO service_role;

DROP POLICY IF EXISTS "Admins can view payroll_advance_links" ON public.payroll_advance_links;
CREATE POLICY "Admins can view payroll_advance_links"
  ON public.payroll_advance_links FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- =======================================================================
-- 4. cash_ledger_entries: add 'salary_advance' as a distinguishable,
--    fixed-direction (debit), single-INSERT entry type - same pattern as
--    salary_payment/inventory_purchase, so the Phase 1.1 immutability
--    trigger's existing rules apply to it unchanged (any direction other
--    than debit for this type is rejected by the CHECK below; once
--    inserted, cash_ledger_entries_immutable forbids any UPDATE/DELETE
--    regardless of entry_type - nothing new required there).
-- =======================================================================

ALTER TABLE public.cash_ledger_entries
  ADD COLUMN IF NOT EXISTS salary_advance_id uuid REFERENCES public.salary_advances(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cash_ledger_entries_salary_advance_id ON public.cash_ledger_entries (salary_advance_id);

ALTER TABLE public.cash_ledger_entries DROP CONSTRAINT IF EXISTS cash_ledger_entries_type_check;
ALTER TABLE public.cash_ledger_entries ADD CONSTRAINT cash_ledger_entries_type_check CHECK (
  entry_type IN (
    'opening_balance', 'adjustment', 'client_payment_credit',
    'expense', 'inventory_purchase', 'salary_payment', 'salary_advance'
  )
);

ALTER TABLE public.cash_ledger_entries DROP CONSTRAINT IF EXISTS cash_ledger_entries_type_direction_check;
ALTER TABLE public.cash_ledger_entries ADD CONSTRAINT cash_ledger_entries_type_direction_check CHECK (
  (entry_type = 'client_payment_credit' AND direction = 'credit')
  OR (entry_type IN ('inventory_purchase', 'salary_payment', 'salary_advance') AND direction = 'debit')
  OR (entry_type = 'expense')
  OR (entry_type IN ('adjustment', 'opening_balance'))
);

ALTER TABLE public.cash_ledger_entries DROP CONSTRAINT IF EXISTS cash_ledger_entries_source_key_prefix_check;
ALTER TABLE public.cash_ledger_entries ADD CONSTRAINT cash_ledger_entries_source_key_prefix_check CHECK (
  (entry_type = 'client_payment_credit' AND source_key LIKE 'payment_verification_request:%')
  OR (entry_type = 'expense' AND source_key LIKE 'expense:%')
  OR (entry_type = 'inventory_purchase' AND source_key LIKE 'credit_inventory_purchase:%')
  OR (entry_type = 'salary_payment' AND source_key LIKE 'employee_salary:%')
  OR (entry_type = 'salary_advance' AND source_key LIKE 'salary_advance:%')
  OR (entry_type IN ('adjustment', 'opening_balance'))
);

-- =======================================================================
-- 4b. The Phase 1.1 immutability guard (prevent_cash_ledger_mutation)
--     explicitly lists every link column that is allowed to go from a
--     value to NULL (the FK's own ON DELETE SET NULL cascade) and rejects
--     any other change. It predates salary_advance_id, added just above -
--     without this update, that new column would not be protected by name
--     and its value could in theory be reassigned to an unrelated advance
--     by a future UPDATE without tripping the guard. Same rule as every
--     other link column: unchanged, or newly NULL - never reassigned,
--     never un-nulled.
-- =======================================================================

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

-- Trigger definition itself (target columns, timing) is unchanged - only
-- the function body changed, so no DROP/CREATE TRIGGER needed.

-- =======================================================================
-- 5. Canonical payroll calculation. Pure, IMMUTABLE, single source of
--    truth for both the draft-save preview and every locking action -
--    mirrored (not replaced) by src/lib/payroll.ts on the client for
--    instant UI feedback.
--
--    Policy (documented, exact):
--      daily_rate = base_salary / payroll_working_days (0 if working days = 0)
--      Paid leave is NEVER deducted (already covered by the full base salary).
--      Absence is folded INTO the unpaid-leave deduction (never a separate
--      absence_deduction line) - this is the deliberate policy choice that
--      makes double-deduction of the same day structurally impossible:
--        unpaid_leave_deduction = daily_rate * (unpaid_leave_days + absent_days)
--      base_earned = base_salary (the full snapshot amount; only reduced
--      via the deductions section below, never pre-reduced here).
--      overtime_amount = overtime_hours * overtime_rate (flat hourly rate -
--      no existing multiplier model was found anywhere in this project to
--      reuse).
--      gross_salary = base_earned + overtime_amount + bonus + allowances
--                     + commission + other_earnings
--      total_deductions = unpaid_leave_deduction + advance_deduction + other_deduction
--      net_salary = gross_salary - total_deductions + manual_adjustment
--      (manual_adjustment is the one deliberately signed line - a positive
--      value is an extra top-up, a negative value is an extra deduction -
--      always entered with a mandatory reason, enforced by a table CHECK).
-- =======================================================================

CREATE OR REPLACE FUNCTION public.calculate_payroll(
  _base_salary numeric,
  _payroll_working_days integer,
  _unpaid_leave_days integer,
  _absent_days integer,
  _overtime_hours numeric,
  _overtime_rate numeric,
  _bonus numeric,
  _allowances numeric,
  _commission numeric,
  _other_earnings numeric,
  _advance_deduction numeric,
  _other_deduction numeric,
  _manual_adjustment numeric
)
RETURNS TABLE (
  daily_rate numeric,
  unpaid_leave_deduction numeric,
  overtime_amount numeric,
  base_earned numeric,
  gross_salary numeric,
  total_deductions numeric,
  net_salary numeric
)
LANGUAGE sql
IMMUTABLE
AS $$
  WITH rate AS (
    SELECT CASE
      WHEN COALESCE(_payroll_working_days, 0) > 0 THEN COALESCE(_base_salary, 0) / _payroll_working_days
      ELSE 0
    END AS daily_rate
  ),
  parts AS (
    SELECT
      rate.daily_rate,
      round(rate.daily_rate * (COALESCE(_unpaid_leave_days, 0) + COALESCE(_absent_days, 0)), 2) AS unpaid_leave_deduction,
      round(COALESCE(_overtime_hours, 0) * COALESCE(_overtime_rate, 0), 2) AS overtime_amount,
      COALESCE(_base_salary, 0) AS base_earned
    FROM rate
  ),
  totals AS (
    SELECT
      parts.*,
      parts.base_earned + parts.overtime_amount
        + COALESCE(_bonus, 0) + COALESCE(_allowances, 0) + COALESCE(_commission, 0) + COALESCE(_other_earnings, 0) AS gross_salary,
      parts.unpaid_leave_deduction + COALESCE(_advance_deduction, 0) + COALESCE(_other_deduction, 0) AS total_deductions
    FROM parts
  )
  SELECT
    totals.daily_rate,
    totals.unpaid_leave_deduction,
    totals.overtime_amount,
    totals.base_earned,
    totals.gross_salary,
    totals.total_deductions,
    totals.gross_salary - totals.total_deductions + COALESCE(_manual_adjustment, 0) AS net_salary
  FROM totals
$$;

REVOKE ALL ON FUNCTION public.calculate_payroll(numeric, integer, integer, integer, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calculate_payroll(numeric, integer, integer, integer, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric) TO authenticated, service_role;

-- =======================================================================
-- 6. recompute_payroll_totals(): re-runs calculate_payroll() from the
--    row's own stored inputs and writes the computed columns back. Called
--    at the end of every draft mutation and once more at finalize time
--    (immediately before locking) so the finalized numbers are always
--    freshly derived from whatever inputs (including advance links) are
--    current at that moment - never stale.
-- =======================================================================

CREATE OR REPLACE FUNCTION public.recompute_payroll_totals(_payroll_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.employee_salaries%ROWTYPE;
  v_calc record;
  v_advance_deduction numeric;
BEGIN
  SELECT * INTO v_row FROM public.employee_salaries WHERE id = _payroll_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payroll row not found';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_advance_deduction
  FROM public.payroll_advance_links WHERE payroll_id = _payroll_id;

  SELECT * INTO v_calc FROM public.calculate_payroll(
    v_row.base_salary_used, v_row.total_working_days, v_row.unpaid_leave_days, v_row.absent_days,
    v_row.overtime_hours, v_row.overtime_rate, v_row.bonus, v_row.allowances, v_row.commission,
    v_row.other_earnings, v_advance_deduction, v_row.other_deduction, v_row.manual_adjustment
  );

  UPDATE public.employee_salaries
  SET advance_deduction = v_advance_deduction,
      base_earned = v_calc.base_earned,
      overtime_amount = v_calc.overtime_amount,
      unpaid_leave_deduction = v_calc.unpaid_leave_deduction,
      gross_salary = v_calc.gross_salary,
      total_deductions = v_calc.total_deductions,
      net_salary = v_calc.net_salary
  WHERE id = _payroll_id;
END;
$$;

REVOKE ALL ON FUNCTION public.recompute_payroll_totals(uuid) FROM PUBLIC, anon, authenticated;

-- =======================================================================
-- 7. Payroll lifecycle RPCs. Admin-only, mirroring the role check already
--    used by every financial RPC in this project.
-- =======================================================================

CREATE OR REPLACE FUNCTION public.save_payroll_draft(
  _payroll_id uuid,
  _employee_ref_id uuid,
  _month text,
  _base_salary_used numeric,
  _total_working_days integer,
  _present_days integer,
  _paid_leave_days integer,
  _unpaid_leave_days integer,
  _absent_days integer,
  _overtime_hours numeric,
  _overtime_rate numeric,
  _bonus numeric,
  _allowances numeric,
  _commission numeric,
  _other_earnings numeric,
  _other_deduction numeric,
  _manual_adjustment numeric,
  _manual_adjustment_reason text,
  _notes text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_employee public.employees%ROWTYPE;
  v_id uuid;
  v_current_status text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  IF _month IS NULL OR _month !~ '^\d{4}-\d{2}$' THEN
    RAISE EXCEPTION 'Month must be in YYYY-MM format';
  END IF;
  IF _total_working_days IS NULL OR _total_working_days <= 0 THEN
    RAISE EXCEPTION 'Total working days must be positive';
  END IF;
  IF COALESCE(_present_days, 0) < 0 OR COALESCE(_paid_leave_days, 0) < 0 OR COALESCE(_unpaid_leave_days, 0) < 0
     OR COALESCE(_absent_days, 0) < 0 OR COALESCE(_overtime_hours, 0) < 0 OR COALESCE(_overtime_rate, 0) < 0 THEN
    RAISE EXCEPTION 'Days, hours and rates cannot be negative';
  END IF;
  IF COALESCE(_bonus, 0) < 0 OR COALESCE(_allowances, 0) < 0 OR COALESCE(_commission, 0) < 0
     OR COALESCE(_other_earnings, 0) < 0 OR COALESCE(_other_deduction, 0) < 0 THEN
    RAISE EXCEPTION 'Earnings and deductions cannot be negative';
  END IF;
  IF _base_salary_used IS NOT NULL AND _base_salary_used < 0 THEN
    RAISE EXCEPTION 'Base salary cannot be negative';
  END IF;
  IF COALESCE(_manual_adjustment, 0) <> 0 AND (
    _manual_adjustment_reason IS NULL OR length(trim(_manual_adjustment_reason)) = 0
  ) THEN
    RAISE EXCEPTION 'A manual adjustment requires a reason';
  END IF;

  SELECT * INTO v_employee FROM public.employees WHERE id = _employee_ref_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  IF _payroll_id IS NULL THEN
    -- Friendly pre-check; the partial unique index is the authoritative
    -- backstop against a race between two concurrent creations.
    IF EXISTS (
      SELECT 1 FROM public.employee_salaries
      WHERE employee_ref_id = _employee_ref_id AND month = _month AND status <> 'cancelled'
    ) THEN
      RAISE EXCEPTION 'A payroll record already exists for this employee and period';
    END IF;

    INSERT INTO public.employee_salaries (
      month, employee_id, employee_name, designation, department,
      employee_ref_id, status, total_working_days, present_days, paid_leave_days,
      unpaid_leave_days, absent_days, overtime_hours, overtime_rate,
      base_salary_used, bonus, allowances, commission, other_earnings,
      other_deduction, manual_adjustment, manual_adjustment_reason, notes,
      created_by,
      -- legacy columns: keep populated/consistent for any old reads, but
      -- never used by the new canonical calculation.
      basic_salary, gross_salary, income_tax
    ) VALUES (
      _month, v_employee.employee_code, v_employee.full_name, v_employee.designation, v_employee.department,
      _employee_ref_id, 'draft', _total_working_days, _present_days, COALESCE(_paid_leave_days, 0),
      COALESCE(_unpaid_leave_days, 0), COALESCE(_absent_days, 0), COALESCE(_overtime_hours, 0), COALESCE(_overtime_rate, v_employee.overtime_rate),
      COALESCE(_base_salary_used, v_employee.base_salary), COALESCE(_bonus, 0), COALESCE(_allowances, 0), COALESCE(_commission, 0), COALESCE(_other_earnings, 0),
      COALESCE(_other_deduction, 0), COALESCE(_manual_adjustment, 0), _manual_adjustment_reason, _notes,
      auth.uid(),
      COALESCE(_base_salary_used, v_employee.base_salary), COALESCE(_base_salary_used, v_employee.base_salary), 0
    )
    RETURNING id INTO v_id;
  ELSE
    SELECT status INTO v_current_status FROM public.employee_salaries WHERE id = _payroll_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Payroll row not found';
    END IF;
    IF v_current_status <> 'draft' THEN
      RAISE EXCEPTION 'Only a draft payroll record can be edited (current status: %)', v_current_status;
    END IF;

    UPDATE public.employee_salaries
    SET month = _month,
        base_salary_used = COALESCE(_base_salary_used, base_salary_used),
        total_working_days = _total_working_days,
        present_days = _present_days,
        paid_leave_days = COALESCE(_paid_leave_days, 0),
        unpaid_leave_days = COALESCE(_unpaid_leave_days, 0),
        absent_days = COALESCE(_absent_days, 0),
        overtime_hours = COALESCE(_overtime_hours, 0),
        overtime_rate = COALESCE(_overtime_rate, overtime_rate),
        bonus = COALESCE(_bonus, 0),
        allowances = COALESCE(_allowances, 0),
        commission = COALESCE(_commission, 0),
        other_earnings = COALESCE(_other_earnings, 0),
        other_deduction = COALESCE(_other_deduction, 0),
        manual_adjustment = COALESCE(_manual_adjustment, 0),
        manual_adjustment_reason = _manual_adjustment_reason,
        notes = _notes
    WHERE id = _payroll_id;

    v_id := _payroll_id;
  END IF;

  PERFORM public.recompute_payroll_totals(v_id);

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_payroll_draft(
  uuid, uuid, text, numeric, integer, integer, integer, integer, integer, numeric, numeric,
  numeric, numeric, numeric, numeric, numeric, numeric, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_payroll_draft(
  uuid, uuid, text, numeric, integer, integer, integer, integer, integer, numeric, numeric,
  numeric, numeric, numeric, numeric, numeric, numeric, text, text
) TO authenticated;

CREATE OR REPLACE FUNCTION public.finalize_payroll(_payroll_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.employee_salaries%ROWTYPE;
  v_days_used integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT * INTO v_row FROM public.employee_salaries WHERE id = _payroll_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payroll row not found';
  END IF;
  IF v_row.status <> 'draft' THEN
    RAISE EXCEPTION 'Only a draft payroll record can be finalized (current status: %)', v_row.status;
  END IF;

  v_days_used := COALESCE(v_row.present_days, 0) + v_row.paid_leave_days + v_row.unpaid_leave_days + v_row.absent_days;
  IF v_row.present_days IS NOT NULL AND v_days_used > v_row.total_working_days THEN
    RAISE EXCEPTION 'Present + paid leave + unpaid leave + absent days (%) exceeds total working days (%)',
      v_days_used, v_row.total_working_days;
  END IF;

  -- Recompute one last time from current inputs (including any advance
  -- links) immediately before locking, so what gets paid later is always
  -- freshly derived, never stale.
  PERFORM public.recompute_payroll_totals(_payroll_id);
  SELECT * INTO v_row FROM public.employee_salaries WHERE id = _payroll_id;

  IF v_row.net_salary < 0 THEN
    RAISE EXCEPTION 'Net salary cannot be negative (calculated: %); adjust earnings/deductions before finalizing', v_row.net_salary;
  END IF;

  UPDATE public.employee_salaries
  SET status = 'finalized', finalized_at = now(), finalized_by = auth.uid()
  WHERE id = _payroll_id;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_payroll(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_payroll(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.revert_payroll_to_draft(_payroll_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT status INTO v_status FROM public.employee_salaries WHERE id = _payroll_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payroll row not found';
  END IF;
  IF v_status <> 'finalized' THEN
    RAISE EXCEPTION 'Only a finalized (not yet paid) payroll record can be reverted to draft (current status: %)', v_status;
  END IF;

  UPDATE public.employee_salaries
  SET status = 'draft', finalized_at = NULL, finalized_by = NULL
  WHERE id = _payroll_id;
END;
$$;

REVOKE ALL ON FUNCTION public.revert_payroll_to_draft(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revert_payroll_to_draft(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_payroll(_payroll_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF _reason IS NULL OR length(trim(_reason)) = 0 THEN
    RAISE EXCEPTION 'A cancellation reason is required';
  END IF;

  SELECT status INTO v_status FROM public.employee_salaries WHERE id = _payroll_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payroll row not found';
  END IF;
  IF v_status NOT IN ('draft', 'finalized') THEN
    RAISE EXCEPTION 'Only a draft or finalized (unpaid) payroll record can be cancelled (current status: %)', v_status;
  END IF;

  UPDATE public.employee_salaries
  SET status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = _reason
  WHERE id = _payroll_id;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_payroll(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_payroll(uuid, text) TO authenticated;

-- =======================================================================
-- 8. mark_payroll_paid(): supersedes mark_salary_paid() as the app's
--    Mark Paid action. Same safety guarantees, hardened further: requires
--    'finalized' status (so the number that gets paid is always the
--    locked, reviewed net_salary, never a live-editable one), still
--    exactly one linked debit via the same source_key + ON CONFLICT DO
--    NOTHING pattern. mark_salary_paid() itself is left in place,
--    unused, for rollback safety - nothing in the app calls it anymore.
-- =======================================================================

CREATE OR REPLACE FUNCTION public.mark_payroll_paid(_payroll_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.employee_salaries%ROWTYPE;
  v_ledger_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT * INTO v_row FROM public.employee_salaries WHERE id = _payroll_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payroll row not found';
  END IF;
  IF v_row.status <> 'finalized' THEN
    RAISE EXCEPTION 'Only a finalized payroll record can be marked paid (current status: %)', v_row.status;
  END IF;
  IF v_row.net_salary <= 0 THEN
    RAISE EXCEPTION 'Net salary must be positive to mark paid';
  END IF;

  INSERT INTO public.cash_ledger_entries (
    entry_type, direction, amount, salary_id, created_by, source_key
  ) VALUES (
    'salary_payment', 'debit', v_row.net_salary, _payroll_id, auth.uid(), 'employee_salary:' || _payroll_id::text
  )
  ON CONFLICT (source_key) DO NOTHING
  RETURNING id INTO v_ledger_id;

  IF v_ledger_id IS NULL THEN
    RAISE EXCEPTION 'A cash debit already exists for this salary payment';
  END IF;

  UPDATE public.employee_salaries
  SET status = 'paid', paid = true, paid_at = now(), paid_by = auth.uid()
  WHERE id = _payroll_id;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_payroll_paid(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_payroll_paid(uuid) TO authenticated;

-- =======================================================================
-- 9. Salary advances: create (cash-out now) + link to a draft payroll
--    (deduction only, no second cash effect).
-- =======================================================================

CREATE OR REPLACE FUNCTION public.create_salary_advance(
  _employee_ref_id uuid,
  _amount numeric,
  _advance_date date DEFAULT CURRENT_DATE,
  _notes text DEFAULT NULL
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
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'Advance amount must be positive';
  END IF;

  SELECT * INTO v_employee FROM public.employees WHERE id = _employee_ref_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  INSERT INTO public.salary_advances (employee_ref_id, amount, advance_date, notes, created_by)
  VALUES (_employee_ref_id, _amount, COALESCE(_advance_date, CURRENT_DATE), _notes, auth.uid())
  RETURNING id INTO v_id;

  -- The advance is cash physically given now - it creates its own cash
  -- debit immediately. A later payroll deduction (link_salary_advance_to_payroll)
  -- never creates a second one for the same advance.
  INSERT INTO public.cash_ledger_entries (
    entry_type, direction, amount, salary_advance_id, created_by, source_key, notes
  ) VALUES (
    'salary_advance', 'debit', _amount, v_id, auth.uid(), 'salary_advance:' || v_id::text,
    'Salary advance to ' || v_employee.full_name
  );

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_salary_advance(uuid, numeric, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_salary_advance(uuid, numeric, date, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.link_salary_advance_to_payroll(
  _payroll_id uuid,
  _advance_id uuid,
  _amount numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payroll public.employee_salaries%ROWTYPE;
  v_advance public.salary_advances%ROWTYPE;
  v_other_linked numeric;
  v_available numeric;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF _amount IS NULL OR _amount < 0 THEN
    RAISE EXCEPTION 'Amount cannot be negative';
  END IF;

  SELECT * INTO v_payroll FROM public.employee_salaries WHERE id = _payroll_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payroll row not found';
  END IF;
  IF v_payroll.status <> 'draft' THEN
    RAISE EXCEPTION 'Advance deductions can only be edited on a draft payroll record (current status: %)', v_payroll.status;
  END IF;

  SELECT * INTO v_advance FROM public.salary_advances WHERE id = _advance_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Salary advance not found';
  END IF;
  IF v_advance.employee_ref_id <> v_payroll.employee_ref_id THEN
    RAISE EXCEPTION 'This advance does not belong to the payroll record''s employee';
  END IF;

  -- Outstanding balance is derived, never stored: the advance amount
  -- minus everything currently linked to any non-cancelled payroll row
  -- OTHER than this one (so re-editing this same link never double-counts
  -- itself, and cancelling a payroll automatically frees its share back
  -- up for a future one).
  SELECT COALESCE(SUM(pal.amount), 0) INTO v_other_linked
  FROM public.payroll_advance_links pal
  JOIN public.employee_salaries es ON es.id = pal.payroll_id
  WHERE pal.advance_id = _advance_id AND pal.payroll_id <> _payroll_id AND es.status <> 'cancelled';

  v_available := v_advance.amount - v_other_linked;

  IF _amount = 0 THEN
    DELETE FROM public.payroll_advance_links WHERE payroll_id = _payroll_id AND advance_id = _advance_id;
  ELSE
    IF _amount > v_available THEN
      RAISE EXCEPTION 'Amount % exceeds this advance''s outstanding balance (%.2f available)', _amount, v_available;
    END IF;

    INSERT INTO public.payroll_advance_links (payroll_id, advance_id, amount, created_by)
    VALUES (_payroll_id, _advance_id, _amount, auth.uid())
    ON CONFLICT (payroll_id, advance_id) DO UPDATE SET amount = EXCLUDED.amount, updated_at = now();
  END IF;

  PERFORM public.recompute_payroll_totals(_payroll_id);
END;
$$;

REVOKE ALL ON FUNCTION public.link_salary_advance_to_payroll(uuid, uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_salary_advance_to_payroll(uuid, uuid, numeric) TO authenticated;

-- =======================================================================
-- 10. get_cash_in_hand_summary(): one more distinguishable column,
--     salary_advances_paid_total. Return shape changed - DROP first.
-- =======================================================================

DROP FUNCTION IF EXISTS public.get_cash_in_hand_summary();

CREATE FUNCTION public.get_cash_in_hand_summary()
RETURNS TABLE (
  opening_balance numeric,
  client_payment_credits numeric,
  expenses_total numeric,
  inventory_purchases_paid_total numeric,
  paid_salaries_total numeric,
  salary_advances_paid_total numeric,
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
  v_advances numeric;
  v_adjustments numeric;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT cs.opening_balance INTO v_opening FROM public.cash_settings cs LIMIT 1;
  v_opening := COALESCE(v_opening, 0);

  SELECT COALESCE(SUM(amount), 0) INTO v_credits
  FROM public.cash_ledger_entries WHERE entry_type = 'client_payment_credit';

  SELECT COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount ELSE -amount END), 0) INTO v_expenses
  FROM public.cash_ledger_entries WHERE entry_type = 'expense';

  SELECT COALESCE(SUM(amount), 0) INTO v_inventory
  FROM public.cash_ledger_entries WHERE entry_type = 'inventory_purchase';

  SELECT COALESCE(SUM(amount), 0) INTO v_salaries
  FROM public.cash_ledger_entries WHERE entry_type = 'salary_payment';

  SELECT COALESCE(SUM(amount), 0) INTO v_advances
  FROM public.cash_ledger_entries WHERE entry_type = 'salary_advance';

  SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END), 0) INTO v_adjustments
  FROM public.cash_ledger_entries WHERE entry_type = 'adjustment';

  RETURN QUERY SELECT
    v_opening, v_credits, v_expenses, v_inventory, v_salaries, v_advances, v_adjustments,
    v_opening + v_credits - v_expenses - v_inventory - v_salaries - v_advances + v_adjustments;
END;
$$;

REVOKE ALL ON FUNCTION public.get_cash_in_hand_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cash_in_hand_summary() TO authenticated;

-- =======================================================================
-- 11. Harden employee_salaries: all financial mutation must now go
--     through the RPCs above. Previously `authenticated` had blanket
--     INSERT/UPDATE/DELETE (RLS-gated on admin role only, with no status
--     check at all) - meaning an admin session could edit or delete a
--     PAID row directly from the browser. Revoking direct write access
--     closes that gap; SECURITY DEFINER RPCs still work (they execute as
--     the function owner, unaffected by this REVOKE), and service_role
--     (backend/migrations) is unaffected.
-- =======================================================================

REVOKE INSERT, UPDATE, DELETE ON public.employee_salaries FROM authenticated;

DROP POLICY IF EXISTS "Admins can insert salaries" ON public.employee_salaries;
DROP POLICY IF EXISTS "Admins can update salaries" ON public.employee_salaries;
DROP POLICY IF EXISTS "Admins can delete salaries" ON public.employee_salaries;
-- "Admins can view salaries" (SELECT) is left exactly as-is.
