-- Phase 3.1: payroll attendance-field validation hardening.
--
-- Goal: make the current manually-entered attendance aggregates
-- (total_working_days, present_days, paid_leave_days, unpaid_leave_days,
-- absent_days, overtime_hours) logically impossible to corrupt, before a
-- future Attendance module starts populating them automatically. No
-- redesign - purely additional validation.
--
-- Live schema/functions were inspected directly before writing this
-- (NEW project uclo...mbud only) via read-only introspection
-- (pg_get_constraintdef / pg_get_functiondef). Findings that shaped this
-- migration:
--   - employee_salaries_nonneg_check ALREADY enforces >= 0 for
--     present_days (nullable), paid_leave_days, unpaid_leave_days,
--     absent_days, overtime_hours, overtime_rate, overtime_amount, and
--     every money field this task lists (bonus, allowances, commission,
--     other_earnings, advance_deduction, other_deduction). Requirements 1,
--     4 (>=0 parts) and 5 are therefore ALREADY satisfied at the table
--     level for every one of those columns - nothing to add there.
--   - total_working_days has NO table-level constraint at all (only a
--     procedural check inside save_payroll_draft). Requirement 1 lists it
--     explicitly, so it is closed here.
--   - The day-total-vs-working-days rule (requirement 2) exists ONLY
--     inside finalize_payroll(), as a plain IF/RAISE, and only when
--     present_days IS NOT NULL - never as a table constraint, and never
--     checked at save time at all. This is the main gap this migration
--     closes: a table CHECK constraint (authoritative, cannot be
--     bypassed by any future write path) plus a friendly pre-check added
--     to save_payroll_draft() (rejects before a draft is even stored, not
--     just before finalize).
--   - overtime_amount, advance_deduction and every other "*_deduction"/
--     "*_earned"/"gross_salary"/"net_salary" field are already
--     exclusively written by recompute_payroll_totals() from
--     calculate_payroll() - none of them are accepted as raw RPC
--     parameters from save_payroll_draft's signature. Requirement 4's
--     "overtime_amount remains computed, not trusted from arbitrary
--     client input" is therefore already true; verified, not changed.
--   - manual_adjustment's signed-with-mandatory-reason rule
--     (employee_salaries_manual_adjustment_reason_check) and
--     finalize_payroll's `net_salary < 0` rejection already exist
--     unchanged from Phase 3. Requirements 5 (manual adjustment) and 6
--     are already satisfied; verified, not changed.
--   - All 6 existing rows have present_days = NULL and
--     paid_leave_days/unpaid_leave_days/absent_days well under
--     total_working_days (checked individually below) - the new
--     constraint passes for every one of them with zero data changes.
--
-- Mutual-exclusivity policy (requirement 3), documented here and via
-- COMMENT ON COLUMN below:
--   unpaid_leave_days = approved/recorded unpaid leave (a planned,
--     sanctioned absence - e.g. an approved leave-without-pay request).
--   absent_days       = unexcused/non-leave absence (the employee simply
--     did not show up, with no approved leave record).
--   These are mutually exclusive categories - a single calendar day must
--   never be counted in both. Phase 3 stores aggregate monthly counts,
--   not per-day attendance records, so true non-overlap cannot be proven
--   at the database level yet (there is no per-day row to compare). The
--   strongest deterministic aggregate check available now is the day-total
--   cap added below: present_days + paid_leave_days + unpaid_leave_days +
--   absent_days can never exceed total_working_days, for any combination.
--   This does not prove non-overlap per se, but it is the exact bound the
--   task asked for and the correct one to enforce until the Attendance
--   module supplies real per-day records (at which point true exclusivity
--   becomes provable and should be enforced then, not guessed at now).
--   The payroll formula itself already treats them identically on purpose
--   (daily_rate * (unpaid_leave_days + absent_days)) - unchanged here.

-- ---------------------------------------------------------------------
-- 1. total_working_days must be positive (matches the RPC's own existing
--    "must be positive" rule - stronger than a bare >= 0, since 0 working
--    days makes an entire payroll period meaningless and calculate_payroll
--    already treats it as a hard zero-divide guard, not a valid period).
-- ---------------------------------------------------------------------

ALTER TABLE public.employee_salaries DROP CONSTRAINT IF EXISTS employee_salaries_working_days_positive_check;
ALTER TABLE public.employee_salaries ADD CONSTRAINT employee_salaries_working_days_positive_check
  CHECK (total_working_days > 0);

-- ---------------------------------------------------------------------
-- 2 + 3. Attendance-day totals must never exceed payroll working days -
--    now a hard table constraint, not just a finalize-time IF check, so
--    it is impossible to bypass via any future write path. Two clauses:
--    the full sum (only meaningful once present_days is tracked) and a
--    partial sum (paid + unpaid + absent alone) that already applies
--    today, before the Attendance module ever populates present_days.
-- ---------------------------------------------------------------------

ALTER TABLE public.employee_salaries DROP CONSTRAINT IF EXISTS employee_salaries_day_totals_check;
ALTER TABLE public.employee_salaries ADD CONSTRAINT employee_salaries_day_totals_check
  CHECK (
    paid_leave_days + unpaid_leave_days + absent_days <= total_working_days
    AND (
      present_days IS NULL
      OR present_days + paid_leave_days + unpaid_leave_days + absent_days <= total_working_days
    )
  );

COMMENT ON COLUMN public.employee_salaries.unpaid_leave_days IS
  'Approved/recorded unpaid leave days. Mutually exclusive with absent_days - see employee_salaries_day_totals_check. Deducted from pay together with absent_days: daily_rate * (unpaid_leave_days + absent_days).';
COMMENT ON COLUMN public.employee_salaries.absent_days IS
  'Unexcused/non-leave absence days (no approved leave record). Mutually exclusive with unpaid_leave_days - see employee_salaries_day_totals_check. Deducted from pay together with unpaid_leave_days: daily_rate * (unpaid_leave_days + absent_days).';
COMMENT ON COLUMN public.employee_salaries.present_days IS
  'Days actually present, entered/adjusted by Admin until a future Attendance module populates it automatically. NULL means not yet tracked for this payroll record (legacy/pre-Phase-3 rows and any record an Admin has not filled in) - the day-total check is skipped, not violated, when NULL.';
COMMENT ON COLUMN public.employee_salaries.total_working_days IS
  'Total working days in this payroll period (the divisor for daily_rate). Must be positive. present_days + paid_leave_days + unpaid_leave_days + absent_days can never exceed this value - see employee_salaries_day_totals_check.';

-- ---------------------------------------------------------------------
-- 4. save_payroll_draft(): add the same friendly pre-check the table
--    constraint now enforces authoritatively, so an invalid attendance
--    total is rejected with a clear message before any row is written,
--    not just at finalize time and not only as a generic constraint
--    violation. Signature is unchanged (CREATE OR REPLACE, same params).
-- ---------------------------------------------------------------------

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
  v_paid_leave integer;
  v_unpaid_leave integer;
  v_absent integer;
  v_day_total integer;
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

  -- Attendance-day totals must never exceed payroll working days -
  -- unpaid_leave_days and absent_days are mutually exclusive categories
  -- (approved/recorded unpaid leave vs. unexcused/non-leave absence); this
  -- is the strongest deterministic check available on aggregate counts.
  -- Mirrors employee_salaries_day_totals_check exactly, checked here too
  -- so a caller gets a specific, friendly error before anything is
  -- written, not a generic constraint-violation message.
  v_paid_leave := COALESCE(_paid_leave_days, 0);
  v_unpaid_leave := COALESCE(_unpaid_leave_days, 0);
  v_absent := COALESCE(_absent_days, 0);

  IF v_paid_leave + v_unpaid_leave + v_absent > _total_working_days THEN
    RAISE EXCEPTION 'Paid leave + unpaid leave + absent days (%) exceeds total working days (%)',
      v_paid_leave + v_unpaid_leave + v_absent, _total_working_days;
  END IF;

  IF _present_days IS NOT NULL THEN
    v_day_total := _present_days + v_paid_leave + v_unpaid_leave + v_absent;
    IF v_day_total > _total_working_days THEN
      RAISE EXCEPTION 'Present + paid leave + unpaid leave + absent days (%) exceeds total working days (%)',
        v_day_total, _total_working_days;
    END IF;
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
      _employee_ref_id, 'draft', _total_working_days, _present_days, v_paid_leave,
      v_unpaid_leave, v_absent, COALESCE(_overtime_hours, 0), COALESCE(_overtime_rate, v_employee.overtime_rate),
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
        paid_leave_days = v_paid_leave,
        unpaid_leave_days = v_unpaid_leave,
        absent_days = v_absent,
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

-- ---------------------------------------------------------------------
-- 5. finalize_payroll(): re-run the same day-total validation (now
--    including the partial paid+unpaid+absent-only clause, matching the
--    table constraint exactly) so finalize never trusts that a row
--    reached this state only through save_payroll_draft's own checks -
--    "do not rely on UI validation" applies to the previous RPC call's
--    validation too, not just the browser's. net_salary < 0 rejection is
--    unchanged from Phase 3 (already satisfies requirement 6).
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.finalize_payroll(_payroll_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.employee_salaries%ROWTYPE;
  v_partial_total integer;
  v_full_total integer;
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

  IF v_row.total_working_days <= 0 THEN
    RAISE EXCEPTION 'Total working days must be positive';
  END IF;

  v_partial_total := v_row.paid_leave_days + v_row.unpaid_leave_days + v_row.absent_days;
  IF v_partial_total > v_row.total_working_days THEN
    RAISE EXCEPTION 'Paid leave + unpaid leave + absent days (%) exceeds total working days (%)',
      v_partial_total, v_row.total_working_days;
  END IF;

  IF v_row.present_days IS NOT NULL THEN
    v_full_total := v_row.present_days + v_partial_total;
    IF v_full_total > v_row.total_working_days THEN
      RAISE EXCEPTION 'Present + paid leave + unpaid leave + absent days (%) exceeds total working days (%)',
        v_full_total, v_row.total_working_days;
    END IF;
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
