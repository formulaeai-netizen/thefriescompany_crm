import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCashInHandDisplayRows,
  calculateCashInHand,
  calculateSalaryNetAmount,
  sumPaidSalariesNet,
} from "./cash-in-hand.ts";

test("calculateSalaryNetAmount mirrors salaries.tsx calcNet/calcDeductions", () => {
  // deductions = round(50000/26*2) = round(3846.15) = 3846
  // net = 50000 - 1000 - 3846 - 5000 = 40154
  const net = calculateSalaryNetAmount({
    gross_salary: 50000,
    income_tax: 1000,
    total_working_days: 26,
    absent_days: 2,
    advance_taken: 5000,
  });
  assert.equal(net, 40154);
});

test("calculateSalaryNetAmount handles zero working days without dividing by zero", () => {
  const net = calculateSalaryNetAmount({
    gross_salary: 50000,
    income_tax: 0,
    total_working_days: 0,
    absent_days: 0,
    advance_taken: 0,
  });
  assert.equal(net, 50000);
});

test("only paid salaries are summed - creation alone subtracts nothing", () => {
  const salaries = [
    {
      gross_salary: 50000,
      income_tax: 0,
      total_working_days: 26,
      absent_days: 0,
      advance_taken: 0,
      paid: false,
    },
    {
      gross_salary: 30000,
      income_tax: 0,
      total_working_days: 26,
      absent_days: 0,
      advance_taken: 0,
      paid: true,
    },
  ];
  assert.equal(sumPaidSalariesNet(salaries), 30000);
});

test("cash in hand formula includes opening balance, credits, expenses and paid salaries", () => {
  const result = calculateCashInHand({
    openingBalance: 10000,
    clientPaymentCredits: 25000,
    expensesTotal: 8000,
    paidSalariesTotal: 12000,
  });
  assert.equal(result, 10000 + 25000 - 8000 - 12000);
});

test("expenses subtract without any approval concept - no filtering applied here", () => {
  // expensesTotal is expected to already be the raw sum of all expense
  // rows (public.expenses has no approval/status field) - this function
  // does not (and must not) filter it further.
  const result = calculateCashInHand({
    openingBalance: 0,
    clientPaymentCredits: 0,
    expensesTotal: 500,
    paidSalariesTotal: 0,
  });
  assert.equal(result, -500);
});

test("buildCashInHandDisplayRows produces the same fixed row order for dashboard and P&L", () => {
  const summary = {
    opening_balance: 10000,
    client_payment_credits: 25000,
    expenses_total: 8000,
    paid_salaries_total: 12000,
    cash_in_hand: 15000,
  };
  const rows = buildCashInHandDisplayRows(summary);

  assert.deepEqual(
    rows.map((r) => r.key),
    [
      "opening_balance",
      "client_payment_credits",
      "expenses_total",
      "paid_salaries_total",
      "cash_in_hand",
    ],
  );
  assert.equal(rows.find((r) => r.key === "opening_balance")?.value, 10000);
  assert.equal(rows.find((r) => r.key === "client_payment_credits")?.value, 25000);
  assert.equal(rows.find((r) => r.key === "expenses_total")?.value, -8000);
  assert.equal(rows.find((r) => r.key === "paid_salaries_total")?.value, -12000);
  assert.equal(rows.find((r) => r.key === "cash_in_hand")?.value, 15000);
  assert.equal(rows.find((r) => r.key === "cash_in_hand")?.emphasize, true);
});
