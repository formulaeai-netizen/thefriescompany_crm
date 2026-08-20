import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_WATCHDOG_SETTINGS,
  canRoleSeeWatchdogModule,
  dedupeCandidates,
  evaluateAbnormalOutflow,
  evaluateExpenseAmountAnomaly,
  evaluateExpenseFrequencyAnomaly,
  evaluateLargeCashDebit,
  evaluateLargeCreditPurchase,
  evaluateLowStock,
  evaluatePayrollOutlier,
  evaluateSlowCustomerCollection,
  evaluateStockVariance,
  evaluateSupplierPriceIncrease,
  notificationSeverityForWatchdog,
  shouldCreateCanonicalNotification,
  type CreditPurchaseLike,
  type ExpenseLike,
  type InvoiceLike,
  type LedgerLike,
  type PayrollLike,
} from "./ai-watchdog.ts";
import { isValidInternalNotificationTarget } from "./notifications.ts";

const settings = {
  ...DEFAULT_WATCHDOG_SETTINGS,
  minimumHistoryCount: 3,
  minimumAbsolutePkrVariance: 500,
  percentageThreshold: 30,
  highSeverityPercentage: 40,
  criticalSeverityPercentage: 90,
};

function expense(id: string, item: string, price: number, date = "2026-08-13"): ExpenseLike {
  return { id, item, price, date, category: "Variable Costs", subcategory: "Supplies" };
}

test("normal expense stays quiet", () => {
  const result = evaluateExpenseAmountAnomaly(
    expense("e4", "Water Tanker", 1500),
    [
      expense("e1", "Water Tanker", 1400),
      expense("e2", "Water Tanker", 1440),
      expense("e3", "Water Tanker", 1480),
    ],
    settings,
  );
  assert.equal(result.alert, null);
});

test("material expense increase creates alert", () => {
  const result = evaluateExpenseAmountAnomaly(
    expense("e4", "Water Tanker", 2400),
    [
      expense("e1", "Water Tanker", 1400),
      expense("e2", "Water Tanker", 1440),
      expense("e3", "Water Tanker", 1480),
    ],
    settings,
  );
  assert.equal(result.alert?.module, "expenses");
  assert.equal(result.alert?.anomalyType, "expense_amount_spike");
  assert.equal(result.alert?.severity, "high");
});

test("tiny 100 percent increase below absolute threshold is not noisy", () => {
  const result = evaluateExpenseAmountAnomaly(
    expense("e4", "Tape", 20),
    [expense("e1", "Tape", 10), expense("e2", "Tape", 10), expense("e3", "Tape", 10)],
    settings,
  );
  assert.equal(result.alert, null);
  assert.equal(result.skippedReason, "below-absolute-threshold");
});

test("insufficient history is safe and non-alerting", () => {
  const result = evaluateExpenseAmountAnomaly(
    expense("e3", "Water Tanker", 3000),
    [expense("e1", "Water Tanker", 1400), expense("e2", "Water Tanker", 1440)],
    settings,
  );
  assert.equal(result.alert, null);
  assert.equal(result.skippedReason, "insufficient-baseline");
});

test("repeated scan candidates dedupe by dedupe key", () => {
  const result = evaluateExpenseAmountAnomaly(
    expense("e4", "Water Tanker", 2400),
    [
      expense("e1", "Water Tanker", 1400),
      expense("e2", "Water Tanker", 1440),
      expense("e3", "Water Tanker", 1480),
    ],
    settings,
  );
  assert.ok(result.alert);
  assert.equal(dedupeCandidates([result.alert, result.alert]).length, 1);
});

test("unusual frequency creates alert", () => {
  const result = evaluateExpenseFrequencyAnomaly(
    expense("e9", "Drinking Water", 80, "2026-08-13"),
    [
      expense("e1", "Drinking Water", 80, "2026-08-10"),
      expense("e2", "Drinking Water", 80, "2026-08-11"),
      expense("e3", "Drinking Water", 80, "2026-08-12"),
      expense("e4", "Drinking Water", 80, "2026-08-13"),
      expense("e5", "Drinking Water", 80, "2026-08-13"),
      expense("e6", "Drinking Water", 80, "2026-08-13"),
      expense("e7", "Drinking Water", 80, "2026-08-13"),
    ],
    settings,
  );
  assert.equal(result.alert?.anomalyType, "expense_frequency_spike");
});

function ledger(id: string, amount: number, entry_type = "expense", day = "2026-08-13"): LedgerLike {
  return { id, amount, entry_type, direction: "debit", created_at: `${day}T10:00:00Z` };
}

test("large cash or bank debit creates alert", () => {
  const result = evaluateLargeCashDebit(
    ledger("l4", 5000),
    [ledger("l1", 1000), ledger("l2", 1200), ledger("l3", 1100)],
    settings,
  );
  assert.equal(result.alert?.module, "cash_bank");
});

test("Cash to Bank transfer is excluded from P&L-style anomaly", () => {
  const result = evaluateLargeCashDebit(
    ledger("l4", 50000, "account_transfer"),
    [ledger("l1", 1000), ledger("l2", 1200), ledger("l3", 1100)],
    settings,
  );
  assert.equal(result.alert, null);
  assert.equal(result.skippedReason, "account-transfer-excluded");
});

test("abnormal daily outflow ignores transfer rows", () => {
  const result = evaluateAbnormalOutflow("2026-08-13", [
    ledger("l1", 1000, "expense", "2026-08-10"),
    ledger("l2", 1000, "expense", "2026-08-11"),
    ledger("l3", 1000, "expense", "2026-08-12"),
    ledger("l4", 5000, "expense", "2026-08-13"),
    ledger("l5", 100000, "account_transfer", "2026-08-13"),
  ], settings);
  assert.equal(result.alert?.actualValue, 5000);
});

test("low stock creates deterministic alert", () => {
  const result = evaluateLowStock(
    { id: "i1", item_name: "Cooking Oil", current_stock: 8, minimum_stock: 10, unit: "packs" },
    settings,
  );
  assert.equal(result.alert?.anomalyType, "low_stock");
});

test("stock variance creates deterministic alert", () => {
  const result = evaluateStockVariance(
    {
      id: "s1",
      item_name_snapshot: "Cooking Oil",
      system_quantity_snapshot: 10,
      reconciled_quantity: 7,
      variance_quantity: -3,
      unit_snapshot: "packs",
    },
    settings,
  );
  assert.equal(result.alert?.anomalyType, "stock_variance_spike");
});

function credit(id: string, amount: number, qty = 10): CreditPurchaseLike {
  return {
    id,
    supplier_name: "DEMO Supplier",
    item_name_snapshot: "Cooking Oil",
    amount_due: amount,
    quantity: qty,
    purchased_at: "2026-08-13T10:00:00Z",
    due_at: "2026-08-14T10:00:00Z",
    status: "unpaid",
  };
}

test("supplier price rise creates alert", () => {
  const result = evaluateSupplierPriceIncrease(
    credit("c4", 20000, 10),
    [credit("c1", 10000, 10), credit("c2", 11000, 10), credit("c3", 10500, 10)],
    settings,
  );
  assert.equal(result.alert?.anomalyType, "supplier_price_increase");
});

test("unusually large credit purchase creates alert", () => {
  const result = evaluateLargeCreditPurchase(
    credit("c4", 50000, 10),
    [credit("c1", 10000, 10), credit("c2", 11000, 10), credit("c3", 10500, 10)],
    settings,
  );
  assert.equal(result.alert?.anomalyType, "large_credit_purchase");
});

function invoice(id: string, status: string, paidAt?: string): InvoiceLike {
  return {
    id,
    client_id: "client-1",
    invoice_no: id,
    amount: 1000,
    amount_received: status === "Done" ? 1000 : 0,
    payment_status: status,
    delivery_date: "2026-08-01",
    due_date: "2026-08-02",
    paid_at: paidAt,
  };
}

test("slower customer collection uses verified paid history only", () => {
  const result = evaluateSlowCustomerCollection(
    invoice("inv-current", "Not Done"),
    [
      invoice("inv1", "Done", "2026-08-03"),
      invoice("inv2", "Done", "2026-08-04"),
      invoice("inv3", "Done", "2026-08-03"),
      invoice("pending-proof", "Not Done"),
    ],
    new Date("2026-08-20T00:00:00Z"),
    settings,
  );
  assert.equal(result.alert?.anomalyType, "slower_customer_collection");
  assert.equal(result.alert?.metadata?.invoice_no, "inv-current");
});

function payroll(id: string, overtime: number, bonus = 0): PayrollLike {
  return {
    id,
    employee_ref_id: "emp-1",
    employee_name: "Ali",
    month: "2026-08",
    overtime_hours: overtime,
    overtime_amount: overtime * 100,
    bonus,
    allowances: 0,
    other_deduction: 0,
    total_deductions: 0,
    status: "finalized",
  };
}

test("high overtime creates alert but first-time value waits for history", () => {
  const result = evaluatePayrollOutlier(
    payroll("p4", 12),
    [payroll("p1", 2), payroll("p2", 2), payroll("p3", 3)],
    "overtime_hours",
    { ...settings, minimumAbsolutePkrVariance: 1 },
  );
  assert.equal(result.alert?.anomalyType, "payroll_overtime_hours_spike");

  const firstTime = evaluatePayrollOutlier(payroll("p1", 12), [], "overtime_hours", settings);
  assert.equal(firstTime.alert, null);
  assert.equal(firstTime.skippedReason, "insufficient-baseline");
});

test("deterministic alert can survive AI failure because AI fields are optional", () => {
  const result = evaluateLowStock(
    { id: "i1", item_name: "Cooking Oil", current_stock: 0, minimum_stock: 10 },
    settings,
  );
  assert.equal(result.alert?.severity, "critical");
  assert.equal(result.alert?.metadata?.item_name, "Cooking Oil");
});

test("AI detector helpers never model financial mutations", () => {
  const result = evaluateExpenseAmountAnomaly(
    expense("e4", "Water Tanker", 2400),
    [
      expense("e1", "Water Tanker", 1400),
      expense("e2", "Water Tanker", 1440),
      expense("e3", "Water Tanker", 1480),
    ],
    settings,
  );
  assert.ok(result.alert);
  assert.deepEqual(Object.keys(result.alert).filter((key) => key.includes("paid")), []);
});

test("High and Critical create canonical notification once; Medium and Low do not force push policy", () => {
  assert.equal(shouldCreateCanonicalNotification("critical"), true);
  assert.equal(shouldCreateCanonicalNotification("high"), true);
  assert.equal(shouldCreateCanonicalNotification("medium"), false);
  assert.equal(shouldCreateCanonicalNotification("low"), false);
  assert.equal(notificationSeverityForWatchdog("critical"), "Critical");
});

test("external deep links are impossible", () => {
  assert.equal(isValidInternalNotificationTarget("/ai-watchdog?alert_id=abc"), true);
  assert.equal(isValidInternalNotificationTarget("https://example.com/ai-watchdog"), false);
  assert.equal(isValidInternalNotificationTarget("//example.com/ai-watchdog"), false);
});

test("role restrictions keep investors away from watchdog details", () => {
  assert.equal(canRoleSeeWatchdogModule("admin", "expenses"), true);
  assert.equal(canRoleSeeWatchdogModule("moderator", "inventory"), true);
  assert.equal(canRoleSeeWatchdogModule("staff", "inventory"), true);
  assert.equal(canRoleSeeWatchdogModule("moderator", "expenses"), false);
  assert.equal(canRoleSeeWatchdogModule("investor", "inventory"), false);
});
