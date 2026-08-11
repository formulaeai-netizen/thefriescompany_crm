import assert from "node:assert/strict";
import test from "node:test";
import {
  calculatePayroll,
  isPayableNetSalary,
  validateManualAdjustmentReason,
  validatePayrollDayTotals,
  validatePayrollNonNegativeInputs,
  type PayrollInputValidationFields,
} from "./payroll.ts";

const BASE_INPUT = {
  baseSalary: 30000,
  payrollWorkingDays: 30,
  unpaidLeaveDays: 0,
  absentDays: 0,
  overtimeHours: 0,
  overtimeRate: 0,
  bonus: 0,
  allowances: 0,
  commission: 0,
  otherEarnings: 0,
  advanceDeduction: 0,
  otherDeduction: 0,
  manualAdjustment: 0,
};

test("1. base salary only payroll: gross and net equal base salary, no deductions", () => {
  const r = calculatePayroll(BASE_INPUT);
  assert.equal(r.baseEarned, 30000);
  assert.equal(r.grossSalary, 30000);
  assert.equal(r.totalDeductions, 0);
  assert.equal(r.netSalary, 30000);
  assert.equal(r.unpaidLeaveDeduction, 0);
});

test("2. paid leave does not deduct anything - only unpaid leave and absence do", () => {
  // paidLeaveDays is not even a parameter to calculatePayroll - it never
  // enters the formula at all, which is the policy itself: paid leave is
  // already covered by the full base salary.
  const r = calculatePayroll(BASE_INPUT);
  assert.equal(r.netSalary, 30000);
});

test("3. unpaid leave deducts correctly via the daily rate", () => {
  const r = calculatePayroll({ ...BASE_INPUT, unpaidLeaveDays: 3 });
  // dailyRate = 30000 / 30 = 1000; 3 unpaid days = 3000 deduction
  assert.equal(r.dailyRate, 1000);
  assert.equal(r.unpaidLeaveDeduction, 3000);
  assert.equal(r.netSalary, 27000);
});

test("4. absence is folded into the unpaid-leave deduction, never double-deducted", () => {
  const unpaidOnly = calculatePayroll({ ...BASE_INPUT, unpaidLeaveDays: 2, absentDays: 0 });
  const absentOnly = calculatePayroll({ ...BASE_INPUT, unpaidLeaveDays: 0, absentDays: 2 });
  const combined = calculatePayroll({ ...BASE_INPUT, unpaidLeaveDays: 1, absentDays: 1 });

  // 2 unpaid-leave days and 2 absent days must produce the IDENTICAL
  // deduction (same daily rate, same day count) - proving they are one
  // unified "unpaid days" concept, not two independently-summed penalties.
  assert.equal(unpaidOnly.unpaidLeaveDeduction, absentOnly.unpaidLeaveDeduction);
  assert.equal(unpaidOnly.unpaidLeaveDeduction, 2000);
  // A 1+1 split produces the same total as either 2+0 or 0+2 - never double.
  assert.equal(combined.unpaidLeaveDeduction, 2000);
  assert.equal(combined.netSalary, unpaidOnly.netSalary);
});

test("5. overtime adds correctly as hours * rate", () => {
  const r = calculatePayroll({ ...BASE_INPUT, overtimeHours: 10, overtimeRate: 150 });
  assert.equal(r.overtimeAmount, 1500);
  assert.equal(r.grossSalary, 31500);
  assert.equal(r.netSalary, 31500);
});

test("6. bonus adds correctly to gross and net", () => {
  const r = calculatePayroll({ ...BASE_INPUT, bonus: 5000 });
  assert.equal(r.grossSalary, 35000);
  assert.equal(r.netSalary, 35000);
});

test("7. allowance adds correctly to gross and net", () => {
  const r = calculatePayroll({ ...BASE_INPUT, allowances: 2000 });
  assert.equal(r.grossSalary, 32000);
  assert.equal(r.netSalary, 32000);
});

test("8. commission adds correctly to gross and net", () => {
  const r = calculatePayroll({ ...BASE_INPUT, commission: 3000 });
  assert.equal(r.grossSalary, 33000);
  assert.equal(r.netSalary, 33000);
});

test("9. advance deduction reduces payable net salary without touching gross", () => {
  const r = calculatePayroll({ ...BASE_INPUT, advanceDeduction: 10000 });
  assert.equal(
    r.grossSalary,
    30000,
    "gross salary is canonical earnings only, unaffected by deductions",
  );
  assert.equal(r.totalDeductions, 10000);
  assert.equal(r.netSalary, 20000);
});

test("10. other deduction subtracts from net salary", () => {
  const r = calculatePayroll({ ...BASE_INPUT, otherDeduction: 1500 });
  assert.equal(r.totalDeductions, 1500);
  assert.equal(r.netSalary, 28500);
});

test("11. gross salary is the exact sum of every earnings line, nothing else", () => {
  const r = calculatePayroll({
    ...BASE_INPUT,
    overtimeHours: 4,
    overtimeRate: 100,
    bonus: 1000,
    allowances: 500,
    commission: 250,
    otherEarnings: 750,
  });
  // base 30000 + overtime 400 + bonus 1000 + allowances 500 + commission 250 + other 750
  assert.equal(r.grossSalary, 32900);
});

test("12. net salary is gross minus every deduction plus the manual adjustment", () => {
  const r = calculatePayroll({
    ...BASE_INPUT,
    unpaidLeaveDays: 1, // 1000 deduction
    advanceDeduction: 2000,
    otherDeduction: 500,
    manualAdjustment: 300,
  });
  // gross 30000, total deductions 1000+2000+500=3500, net = 30000-3500+300 = 26800
  assert.equal(r.totalDeductions, 3500);
  assert.equal(r.netSalary, 26800);
});

test("a full combined scenario matches hand-computed totals exactly", () => {
  const r = calculatePayroll({
    baseSalary: 50000,
    payrollWorkingDays: 25,
    unpaidLeaveDays: 2,
    absentDays: 1,
    overtimeHours: 8,
    overtimeRate: 200,
    bonus: 3000,
    allowances: 1000,
    commission: 500,
    otherEarnings: 0,
    advanceDeduction: 10000,
    otherDeduction: 0,
    manualAdjustment: -300,
  });
  // dailyRate = 50000/25 = 2000; unpaid days = 3 -> 6000 deduction
  assert.equal(r.dailyRate, 2000);
  assert.equal(r.unpaidLeaveDeduction, 6000);
  // overtime = 8*200 = 1600
  assert.equal(r.overtimeAmount, 1600);
  // gross = 50000 + 1600 + 3000 + 1000 + 500 = 56100
  assert.equal(r.grossSalary, 56100);
  // deductions = 6000 + 10000 = 16000
  assert.equal(r.totalDeductions, 16000);
  // net = 56100 - 16000 - 300 = 39800
  assert.equal(r.netSalary, 39800);
});

test("zero payroll working days never divides by zero - daily rate falls back to 0", () => {
  const r = calculatePayroll({ ...BASE_INPUT, payrollWorkingDays: 0, unpaidLeaveDays: 5 });
  assert.equal(r.dailyRate, 0);
  assert.equal(r.unpaidLeaveDeduction, 0);
});

test("validatePayrollDayTotals: the paid+unpaid+absent partial total is checked even when presentDays is not yet tracked (Phase 3.1)", () => {
  const result = validatePayrollDayTotals({
    totalWorkingDays: 26,
    presentDays: null,
    paidLeaveDays: 0,
    unpaidLeaveDays: 0,
    absentDays: 100, // now rejected even without presentDays - was silently skipped pre-3.1
  });
  assert.equal(result.valid, false);
});

test("validatePayrollDayTotals: presentDays truly null (not yet tracked) with a valid partial total is accepted", () => {
  const result = validatePayrollDayTotals({
    totalWorkingDays: 26,
    presentDays: null,
    paidLeaveDays: 2,
    unpaidLeaveDays: 1,
    absentDays: 1,
  });
  assert.equal(result.valid, true);
});

test("attendance total > working days is rejected once presentDays is entered", () => {
  const result = validatePayrollDayTotals({
    totalWorkingDays: 26,
    presentDays: 20,
    paidLeaveDays: 3,
    unpaidLeaveDays: 2,
    absentDays: 3, // 20+3+2+3 = 28 > 26
  });
  assert.equal(result.valid, false);
});

test("exact total = working days is accepted (boundary, not rejected)", () => {
  const result = validatePayrollDayTotals({
    totalWorkingDays: 26,
    presentDays: 20,
    paidLeaveDays: 2,
    unpaidLeaveDays: 2,
    absentDays: 2, // 20+2+2+2 = 26 exactly
  });
  assert.equal(result.valid, true);
});

test("unpaid leave and absence are counted as distinct categories that both contribute to the same day-total cap", () => {
  // 10 unpaid + 10 absent = 20, still within 26 working days -> accepted,
  // proving neither category is silently dropped or merged incorrectly.
  const bothCounted = validatePayrollDayTotals({
    totalWorkingDays: 26,
    presentDays: null,
    paidLeaveDays: 0,
    unpaidLeaveDays: 10,
    absentDays: 10,
  });
  assert.equal(bothCounted.valid, true);

  // 14 unpaid + 14 absent = 28 > 26 -> rejected, proving both categories
  // are genuinely summed (not just the larger of the two checked).
  const overLimit = validatePayrollDayTotals({
    totalWorkingDays: 26,
    presentDays: null,
    paidLeaveDays: 0,
    unpaidLeaveDays: 14,
    absentDays: 14,
  });
  assert.equal(overLimit.valid, false);

  // And the same total split differently (27 unpaid + 1 absent vs 1
  // unpaid + 27 absent) is rejected identically either way - confirming
  // the two fields are symmetric, mutually-exclusive contributors to one
  // shared cap, never double counted or treated preferentially.
  const skewedA = validatePayrollDayTotals({
    totalWorkingDays: 26,
    presentDays: null,
    paidLeaveDays: 0,
    unpaidLeaveDays: 27,
    absentDays: 1,
  });
  const skewedB = validatePayrollDayTotals({
    totalWorkingDays: 26,
    presentDays: null,
    paidLeaveDays: 0,
    unpaidLeaveDays: 1,
    absentDays: 27,
  });
  assert.equal(skewedA.valid, false);
  assert.equal(skewedB.valid, false);
});

test("isPayableNetSalary blocks negative payable salary, allows zero and positive", () => {
  assert.equal(isPayableNetSalary(-1), false);
  assert.equal(isPayableNetSalary(0), true);
  assert.equal(isPayableNetSalary(15000), true);
});

const VALID_NONNEG_FIELDS: PayrollInputValidationFields = {
  totalWorkingDays: 26,
  presentDays: 20,
  paidLeaveDays: 2,
  unpaidLeaveDays: 2,
  absentDays: 2,
  overtimeHours: 5,
  overtimeRate: 100,
  bonus: 1000,
  allowances: 500,
  commission: 0,
  otherEarnings: 0,
  otherDeduction: 0,
};

test("validatePayrollNonNegativeInputs accepts a fully valid set of inputs", () => {
  assert.deepEqual(validatePayrollNonNegativeInputs(VALID_NONNEG_FIELDS), { valid: true });
});

test("negative attendance values are rejected (present/paid leave/unpaid leave/absent days)", () => {
  assert.equal(
    validatePayrollNonNegativeInputs({ ...VALID_NONNEG_FIELDS, presentDays: -1 }).valid,
    false,
  );
  assert.equal(
    validatePayrollNonNegativeInputs({ ...VALID_NONNEG_FIELDS, paidLeaveDays: -1 }).valid,
    false,
  );
  assert.equal(
    validatePayrollNonNegativeInputs({ ...VALID_NONNEG_FIELDS, unpaidLeaveDays: -1 }).valid,
    false,
  );
  assert.equal(
    validatePayrollNonNegativeInputs({ ...VALID_NONNEG_FIELDS, absentDays: -1 }).valid,
    false,
  );
});

test("zero or negative total working days is rejected", () => {
  assert.equal(
    validatePayrollNonNegativeInputs({ ...VALID_NONNEG_FIELDS, totalWorkingDays: 0 }).valid,
    false,
  );
  assert.equal(
    validatePayrollNonNegativeInputs({ ...VALID_NONNEG_FIELDS, totalWorkingDays: -5 }).valid,
    false,
  );
});

test("negative overtime hours or rate is rejected", () => {
  assert.equal(
    validatePayrollNonNegativeInputs({ ...VALID_NONNEG_FIELDS, overtimeHours: -1 }).valid,
    false,
  );
  assert.equal(
    validatePayrollNonNegativeInputs({ ...VALID_NONNEG_FIELDS, overtimeRate: -1 }).valid,
    false,
  );
});

test("negative earnings or deductions are rejected", () => {
  assert.equal(
    validatePayrollNonNegativeInputs({ ...VALID_NONNEG_FIELDS, bonus: -1 }).valid,
    false,
  );
  assert.equal(
    validatePayrollNonNegativeInputs({ ...VALID_NONNEG_FIELDS, allowances: -1 }).valid,
    false,
  );
  assert.equal(
    validatePayrollNonNegativeInputs({ ...VALID_NONNEG_FIELDS, commission: -1 }).valid,
    false,
  );
  assert.equal(
    validatePayrollNonNegativeInputs({ ...VALID_NONNEG_FIELDS, otherEarnings: -1 }).valid,
    false,
  );
  assert.equal(
    validatePayrollNonNegativeInputs({ ...VALID_NONNEG_FIELDS, otherDeduction: -1 }).valid,
    false,
  );
});

test("signed manual adjustment requires a reason only when non-zero", () => {
  assert.equal(validateManualAdjustmentReason(0, null), true);
  assert.equal(validateManualAdjustmentReason(0, ""), true);
  assert.equal(validateManualAdjustmentReason(500, null), false);
  assert.equal(validateManualAdjustmentReason(500, ""), false);
  assert.equal(validateManualAdjustmentReason(500, "   "), false);
  assert.equal(validateManualAdjustmentReason(500, "Approved top-up"), true);
  assert.equal(validateManualAdjustmentReason(-500, "Recovering an overpayment"), true);
});
