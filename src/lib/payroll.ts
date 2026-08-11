/**
 * Pure, in-memory mirror of public.calculate_payroll() (Phase 3). The SQL
 * function remains the authoritative implementation - this file exists so
 * the Salaries page can show an instant, correct live preview while a
 * draft is being edited, without a round trip, and so the exact policy can
 * be unit-tested without a live database connection:
 *   supabase/migrations/20260812090000_payroll_phase3.sql
 *
 * Canonical policy (must stay in sync with the SQL function's own doc
 * comment):
 *   daily_rate = base_salary / payroll_working_days (0 if working days = 0)
 *   Paid leave is NEVER deducted - it is already covered by the full base
 *   salary.
 *   Absence is folded INTO the unpaid-leave deduction, never a separate
 *   absence_deduction line - this is what makes double-deducting the same
 *   day structurally impossible:
 *     unpaid_leave_deduction = daily_rate * (unpaid_leave_days + absent_days)
 *   base_earned = base_salary (the full snapshot amount; only ever reduced
 *   via the deductions section, never pre-reduced here).
 *   overtime_amount = overtime_hours * overtime_rate (flat hourly rate - no
 *   multiplier model exists anywhere else in this project to reuse).
 *   gross_salary = base_earned + overtime_amount + bonus + allowances
 *                  + commission + other_earnings
 *   total_deductions = unpaid_leave_deduction + advance_deduction + other_deduction
 *   net_salary = gross_salary - total_deductions + manual_adjustment
 *   (manual_adjustment is the one deliberately signed line: positive is an
 *   extra top-up, negative is an extra deduction.)
 */

export type PayrollCalculationInput = {
  baseSalary: number;
  payrollWorkingDays: number;
  unpaidLeaveDays: number;
  absentDays: number;
  overtimeHours: number;
  overtimeRate: number;
  bonus: number;
  allowances: number;
  commission: number;
  otherEarnings: number;
  advanceDeduction: number;
  otherDeduction: number;
  manualAdjustment: number;
};

export type PayrollCalculationResult = {
  dailyRate: number;
  unpaidLeaveDeduction: number;
  overtimeAmount: number;
  baseEarned: number;
  grossSalary: number;
  totalDeductions: number;
  netSalary: number;
};

function n(v: number | null | undefined): number {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
}

/** Rounds to 2 decimal places the same way SQL's round(numeric, 2) does. */
function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

export function calculatePayroll(input: PayrollCalculationInput): PayrollCalculationResult {
  const baseSalary = n(input.baseSalary);
  const workingDays = n(input.payrollWorkingDays);
  const dailyRate = workingDays > 0 ? baseSalary / workingDays : 0;

  const unpaidDaysTotal = n(input.unpaidLeaveDays) + n(input.absentDays);
  const unpaidLeaveDeduction = round2(dailyRate * unpaidDaysTotal);

  const overtimeAmount = round2(n(input.overtimeHours) * n(input.overtimeRate));

  const baseEarned = baseSalary;

  const grossSalary =
    baseEarned +
    overtimeAmount +
    n(input.bonus) +
    n(input.allowances) +
    n(input.commission) +
    n(input.otherEarnings);

  const totalDeductions =
    unpaidLeaveDeduction + n(input.advanceDeduction) + n(input.otherDeduction);

  const netSalary = grossSalary - totalDeductions + n(input.manualAdjustment);

  return {
    dailyRate,
    unpaidLeaveDeduction,
    overtimeAmount,
    baseEarned,
    grossSalary,
    totalDeductions,
    netSalary,
  };
}

/**
 * Mirrors employee_salaries_day_totals_check / save_payroll_draft() /
 * finalize_payroll() exactly (Phase 3.1 hardening):
 *
 *   paid_leave_days + unpaid_leave_days + absent_days <= total_working_days
 *   (always checked, regardless of whether present_days is tracked yet)
 *
 *   present_days + paid_leave_days + unpaid_leave_days + absent_days <= total_working_days
 *   (checked only once present_days has actually been entered - null means
 *   "not yet tracked", true for every pre-Phase-3 legacy row and any
 *   record before a future Attendance module populates it)
 *
 * unpaid_leave_days (approved/recorded unpaid leave) and absent_days
 * (unexcused/non-leave absence) are mutually exclusive categories; this
 * day-total cap is the strongest deterministic check possible on
 * aggregate monthly counts, short of real per-day attendance records.
 */
export function validatePayrollDayTotals(input: {
  totalWorkingDays: number;
  presentDays: number | null;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  absentDays: number;
}): { valid: true } | { valid: false; reason: string } {
  const totalWorkingDays = n(input.totalWorkingDays);
  const partial = n(input.paidLeaveDays) + n(input.unpaidLeaveDays) + n(input.absentDays);

  if (partial > totalWorkingDays) {
    return {
      valid: false,
      reason: `Paid leave + unpaid leave + absent days (${partial}) exceeds total working days (${totalWorkingDays})`,
    };
  }

  if (input.presentDays != null) {
    const full = n(input.presentDays) + partial;
    if (full > totalWorkingDays) {
      return {
        valid: false,
        reason: `Present + paid leave + unpaid leave + absent days (${full}) exceeds total working days (${totalWorkingDays})`,
      };
    }
  }

  return { valid: true };
}

/** Mirrors finalize_payroll()'s negative-net-salary guard - net salary is never payable below zero. */
export function isPayableNetSalary(netSalary: number): boolean {
  return n(netSalary) >= 0;
}

export type PayrollInputValidationFields = {
  totalWorkingDays: number;
  presentDays: number | null;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  absentDays: number;
  overtimeHours: number;
  overtimeRate: number;
  bonus: number;
  allowances: number;
  commission: number;
  otherEarnings: number;
  otherDeduction: number;
};

/**
 * Mirrors employee_salaries_nonneg_check plus save_payroll_draft()'s own
 * "Total working days must be positive" / "cannot be negative" checks
 * (Phase 3.1 hardening, requirements 1/4/5). advance_deduction is
 * deliberately excluded - it is never a raw client input (always
 * recomputed server-side from payroll_advance_links), so there is nothing
 * for a caller to submit a negative value for.
 */
export function validatePayrollNonNegativeInputs(
  input: PayrollInputValidationFields,
): { valid: true } | { valid: false; reason: string } {
  if (n(input.totalWorkingDays) <= 0) {
    return { valid: false, reason: "Total working days must be positive" };
  }
  if (
    (input.presentDays != null && n(input.presentDays) < 0) ||
    n(input.paidLeaveDays) < 0 ||
    n(input.unpaidLeaveDays) < 0 ||
    n(input.absentDays) < 0 ||
    n(input.overtimeHours) < 0 ||
    n(input.overtimeRate) < 0
  ) {
    return { valid: false, reason: "Days, hours and rates cannot be negative" };
  }
  if (
    n(input.bonus) < 0 ||
    n(input.allowances) < 0 ||
    n(input.commission) < 0 ||
    n(input.otherEarnings) < 0 ||
    n(input.otherDeduction) < 0
  ) {
    return { valid: false, reason: "Earnings and deductions cannot be negative" };
  }
  return { valid: true };
}

/**
 * Mirrors employee_salaries_manual_adjustment_reason_check: manual
 * adjustment may remain signed (a positive top-up or a negative
 * deduction), but a non-zero value always requires a non-empty reason.
 */
export function validateManualAdjustmentReason(
  manualAdjustment: number,
  reason: string | null | undefined,
): boolean {
  return n(manualAdjustment) === 0 || !!reason?.trim();
}
