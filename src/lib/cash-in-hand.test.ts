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

test("cash in hand formula includes opening balance, credits, expenses, inventory purchases, salaries, salary advances and adjustments", () => {
  const result = calculateCashInHand({
    openingBalance: 10000,
    clientPaymentCredits: 25000,
    expensesTotal: 8000,
    inventoryPurchasesPaidTotal: 3000,
    paidSalariesTotal: 12000,
    salaryAdvancesPaidTotal: 2000,
    adjustmentsTotal: 500,
  });
  assert.equal(result, 10000 + 25000 - 8000 - 3000 - 12000 - 2000 + 500);
});

test("expenses subtract without any approval concept - no filtering applied here", () => {
  // expensesTotal is expected to already be the ledger-truth sum of all
  // real expense-linked entries - this function does not (and must not)
  // filter it further.
  const result = calculateCashInHand({
    openingBalance: 0,
    clientPaymentCredits: 0,
    expensesTotal: 500,
    inventoryPurchasesPaidTotal: 0,
    paidSalariesTotal: 0,
    salaryAdvancesPaidTotal: 0,
    adjustmentsTotal: 0,
  });
  assert.equal(result, -500);
});

test("a salary advance paid out reduces cash in hand exactly once, distinguishable from a salary payment", () => {
  const withAdvance = calculateCashInHand({
    openingBalance: 100000,
    clientPaymentCredits: 0,
    expensesTotal: 0,
    inventoryPurchasesPaidTotal: 0,
    paidSalariesTotal: 0,
    salaryAdvancesPaidTotal: 10000,
    adjustmentsTotal: 0,
  });
  assert.equal(withAdvance, 90000);
});

test("buildCashInHandDisplayRows produces the same fixed row order for dashboard and P&L", () => {
  const summary = {
    opening_balance: 10000,
    client_payment_credits: 25000,
    expenses_total: 8000,
    inventory_purchases_paid_total: 3000,
    paid_salaries_total: 12000,
    salary_advances_paid_total: 2000,
    adjustments_total: 500,
    cash_in_hand: 10500,
  };
  const rows = buildCashInHandDisplayRows(summary);

  assert.deepEqual(
    rows.map((r) => r.key),
    [
      "opening_balance",
      "client_payment_credits",
      "expenses_total",
      "inventory_purchases_paid_total",
      "paid_salaries_total",
      "salary_advances_paid_total",
      "adjustments_total",
      "cash_in_hand",
    ],
  );
  assert.equal(rows.find((r) => r.key === "opening_balance")?.value, 10000);
  assert.equal(rows.find((r) => r.key === "client_payment_credits")?.value, 25000);
  assert.equal(rows.find((r) => r.key === "expenses_total")?.value, -8000);
  assert.equal(rows.find((r) => r.key === "inventory_purchases_paid_total")?.value, -3000);
  assert.equal(rows.find((r) => r.key === "paid_salaries_total")?.value, -12000);
  assert.equal(rows.find((r) => r.key === "salary_advances_paid_total")?.value, -2000);
  assert.equal(rows.find((r) => r.key === "adjustments_total")?.value, 500);
  assert.equal(rows.find((r) => r.key === "cash_in_hand")?.value, 10500);
  assert.equal(rows.find((r) => r.key === "cash_in_hand")?.emphasize, true);
});
