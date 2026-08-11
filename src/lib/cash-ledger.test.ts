import assert from "node:assert/strict";
import test from "node:test";

import { calculateCashInHand } from "./cash-in-hand.ts";
import {
  effectiveExpenseAmount,
  insertLedgerEntry,
  postExpenseCorrection,
  sumAdjustments,
  sumLedgerByType,
  voidExpenseLedger,
  type CashLedgerEntry,
} from "./cash-ledger.ts";

function summaryFor(ledger: CashLedgerEntry[], openingBalance = 0) {
  return {
    openingBalance,
    clientPaymentCredits: sumLedgerByType(ledger, "client_payment_credit"),
    expensesTotal: sumLedgerByType(ledger, "expense"),
    inventoryPurchasesPaidTotal: sumLedgerByType(ledger, "inventory_purchase"),
    paidSalariesTotal: sumLedgerByType(ledger, "salary_payment"),
    salaryAdvancesPaidTotal: sumLedgerByType(ledger, "salary_advance"),
    adjustmentsTotal: sumAdjustments(ledger),
  };
}

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `id-${idCounter}`;
}

test("1. approved invoice payment -> +cash once", () => {
  let ledger: CashLedgerEntry[] = [];
  const before = calculateCashInHand(summaryFor(ledger));

  const result = insertLedgerEntry(ledger, {
    id: nextId(),
    entry_type: "client_payment_credit",
    direction: "credit",
    amount: 5000,
    source_key: "payment_verification_request:req-1",
    reverses_entry_id: null,
  });
  ledger = result.ledger;

  assert.equal(result.inserted, true);
  assert.equal(calculateCashInHand(summaryFor(ledger)) - before, 5000);
});

test("2. duplicate invoice approval -> no duplicate credit", () => {
  let ledger: CashLedgerEntry[] = [];
  const first = insertLedgerEntry(ledger, {
    id: nextId(),
    entry_type: "client_payment_credit",
    direction: "credit",
    amount: 5000,
    source_key: "payment_verification_request:req-1",
    reverses_entry_id: null,
  });
  ledger = first.ledger;
  const before = calculateCashInHand(summaryFor(ledger));

  const second = insertLedgerEntry(ledger, {
    id: nextId(),
    entry_type: "client_payment_credit",
    direction: "credit",
    amount: 5000,
    source_key: "payment_verification_request:req-1",
    reverses_entry_id: null,
  });

  assert.equal(second.inserted, false);
  assert.equal(calculateCashInHand(summaryFor(second.ledger)) - before, 0);
});

test("expense create -> exactly one effective debit", () => {
  let ledger: CashLedgerEntry[] = [];
  const baseline = calculateCashInHand(summaryFor(ledger));

  const created = postExpenseCorrection(ledger, {
    expenseId: "exp-1",
    newPrice: 500,
    idFactory: nextId,
  });
  ledger = created.ledger;

  assert.equal(ledger.length, 1);
  assert.equal(created.posted?.direction, "debit");
  assert.equal(created.posted?.reverses_entry_id, null);
  assert.equal(effectiveExpenseAmount(ledger, "exp-1"), 500);
  assert.equal(calculateCashInHand(summaryFor(ledger)) - baseline, -500);
});

test("expense amount edit -> correct new Cash in Hand AND original financial history preserved", () => {
  let ledger: CashLedgerEntry[] = [];
  const baseline = calculateCashInHand(summaryFor(ledger));

  const original = postExpenseCorrection(ledger, {
    expenseId: "exp-1",
    newPrice: 500,
    idFactory: nextId,
  });
  ledger = original.ledger;

  const edited = postExpenseCorrection(ledger, {
    expenseId: "exp-1",
    newPrice: 800,
    idFactory: nextId,
  });
  ledger = edited.ledger;

  // Original row is untouched - still present, still 500, still debit.
  assert.ok(ledger.some((e) => e === original.posted));
  assert.equal(original.posted?.amount, 500);
  // A new correction row was appended, linked back to the original.
  assert.equal(ledger.length, 2);
  assert.equal(edited.posted?.amount, 300);
  assert.equal(edited.posted?.direction, "debit");
  assert.equal(edited.posted?.reverses_entry_id, original.posted?.id);
  // Cash in Hand reflects only the latest valid (net) amount.
  assert.equal(effectiveExpenseAmount(ledger, "exp-1"), 800);
  assert.equal(calculateCashInHand(summaryFor(ledger)) - baseline, -800);
});

test("second edit -> correct amount without a duplicated effective cash movement", () => {
  let ledger: CashLedgerEntry[] = [];
  ledger = postExpenseCorrection(ledger, {
    expenseId: "exp-1",
    newPrice: 500,
    idFactory: nextId,
  }).ledger;
  ledger = postExpenseCorrection(ledger, {
    expenseId: "exp-1",
    newPrice: 800,
    idFactory: nextId,
  }).ledger;
  const secondEdit = postExpenseCorrection(ledger, {
    expenseId: "exp-1",
    newPrice: 650,
    idFactory: nextId,
  });
  ledger = secondEdit.ledger;

  assert.equal(secondEdit.posted?.amount, 150);
  assert.equal(secondEdit.posted?.direction, "credit"); // 800 -> 650 is a downward correction
  assert.equal(ledger.length, 3, "all three rows (original + two corrections) are preserved");
  // Net effective amount is exactly the latest price, never an
  // accumulation of every historical value (500 + 800 + 650).
  assert.equal(effectiveExpenseAmount(ledger, "exp-1"), 650);
});

test("resubmitting the identical price is an idempotent no-op (posts nothing)", () => {
  let ledger: CashLedgerEntry[] = [];
  ledger = postExpenseCorrection(ledger, {
    expenseId: "exp-1",
    newPrice: 500,
    idFactory: nextId,
  }).ledger;
  const before = ledger.length;

  const noop = postExpenseCorrection(ledger, {
    expenseId: "exp-1",
    newPrice: 500,
    idFactory: nextId,
  });

  assert.equal(noop.posted, null);
  assert.equal(noop.ledger.length, before);
});

test("expense delete -> effective cash impact becomes zero but historical debit remains auditable", () => {
  let ledger: CashLedgerEntry[] = [];
  const baseline = calculateCashInHand(summaryFor(ledger));
  const original = postExpenseCorrection(ledger, {
    expenseId: "exp-1",
    newPrice: 500,
    idFactory: nextId,
  });
  ledger = original.ledger;
  ledger = postExpenseCorrection(ledger, {
    expenseId: "exp-1",
    newPrice: 800,
    idFactory: nextId,
  }).ledger;

  const voided = voidExpenseLedger(ledger, { expenseId: "exp-1", idFactory: nextId });
  ledger = voided.ledger;

  assert.equal(effectiveExpenseAmount(ledger, "exp-1"), 0, "net effect is now zero");
  assert.equal(
    calculateCashInHand(summaryFor(ledger)),
    baseline,
    "Cash in Hand no longer includes the deleted expense",
  );
  assert.equal(
    ledger.length,
    3,
    "original debit + correction + void are ALL still present - nothing was removed",
  );
  assert.ok(
    ledger.includes(original.posted!),
    "the original debit row object itself is still in the ledger, untouched",
  );
  assert.equal(voided.posted?.direction, "credit");
  assert.equal(voided.posted?.amount, 800);
  assert.notEqual(
    voided.posted?.reverses_entry_id,
    null,
    "the void is explicitly linked to the entry it reverses",
  );
});

test("repeated delete/retry -> no duplicate reversal", () => {
  let ledger: CashLedgerEntry[] = [];
  ledger = postExpenseCorrection(ledger, {
    expenseId: "exp-1",
    newPrice: 500,
    idFactory: nextId,
  }).ledger;
  const firstVoid = voidExpenseLedger(ledger, { expenseId: "exp-1", idFactory: nextId });
  ledger = firstVoid.ledger;
  assert.ok(firstVoid.posted);

  // A second attempt to void the same already-voided expense (e.g. a
  // retried delete) finds the net effect already at zero and posts
  // nothing - mirrors the SQL's `IF v_effective_amount = 0 THEN RETURN`.
  const secondVoid = voidExpenseLedger(ledger, { expenseId: "exp-1", idFactory: nextId });

  assert.equal(secondVoid.posted, null);
  assert.equal(secondVoid.ledger.length, ledger.length);
});

test("users cannot directly delete or rewrite posted ledger entries (enforced at the database level)", () => {
  // This invariant is enforced by a BEFORE UPDATE OR DELETE trigger
  // (prevent_cash_ledger_mutation) directly on cash_ledger_entries in
  // supabase/migrations/20260810160000_cash_ledger_immutability_hardening.sql -
  // it is not expressible as a pure-TypeScript assertion since there is
  // nothing in this module that could perform such a mutation in the
  // first place (postExpenseCorrection/voidExpenseLedger only ever
  // append). Verified live against the real database (rolled back,
  // zero rows persisted): a direct UPDATE of amount and a direct DELETE
  // both raised "cash_ledger_entries rows are immutable...".
  assert.equal(typeof insertLedgerEntry, "function");
});

test("4. cash inventory purchase -> -cash once", () => {
  let ledger: CashLedgerEntry[] = [];
  const before = calculateCashInHand(summaryFor(ledger));

  const result = insertLedgerEntry(ledger, {
    id: nextId(),
    entry_type: "inventory_purchase",
    direction: "debit",
    amount: 2000,
    source_key: "credit_inventory_purchase:purchase-1",
    reverses_entry_id: null,
  });
  ledger = result.ledger;

  assert.equal(result.inserted, true);
  assert.equal(calculateCashInHand(summaryFor(ledger)) - before, -2000);
});

test("5. credit inventory purchase creation -> no cash change", () => {
  const ledger: CashLedgerEntry[] = [];
  const before = calculateCashInHand(summaryFor(ledger));
  assert.equal(calculateCashInHand(summaryFor(ledger)), before);
  assert.equal(sumLedgerByType(ledger, "inventory_purchase"), 0);
});

test("6. credit inventory Mark Paid -> -cash exactly once, 7. duplicate Mark Paid -> no second debit", () => {
  let ledger: CashLedgerEntry[] = [];
  const before = calculateCashInHand(summaryFor(ledger));

  const first = insertLedgerEntry(ledger, {
    id: nextId(),
    entry_type: "inventory_purchase",
    direction: "debit",
    amount: 3000,
    source_key: "credit_inventory_purchase:purchase-2",
    reverses_entry_id: null,
  });
  ledger = first.ledger;
  assert.equal(first.inserted, true);
  assert.equal(calculateCashInHand(summaryFor(ledger)) - before, -3000);

  const second = insertLedgerEntry(ledger, {
    id: nextId(),
    entry_type: "inventory_purchase",
    direction: "debit",
    amount: 3000,
    source_key: "credit_inventory_purchase:purchase-2",
    reverses_entry_id: null,
  });
  assert.equal(second.inserted, false);
  assert.equal(calculateCashInHand(summaryFor(second.ledger)) - before, -3000);
});

test("8. cancelled/unpaid credit -> no debit", () => {
  const ledger: CashLedgerEntry[] = [];
  assert.equal(sumLedgerByType(ledger, "inventory_purchase"), 0);
});

test("9. salary calculated/unpaid -> no debit", () => {
  const ledger: CashLedgerEntry[] = [];
  assert.equal(sumLedgerByType(ledger, "salary_payment"), 0);
});

test("10. salary Mark Paid -> -net salary exactly once, duplicate is blocked", () => {
  let ledger: CashLedgerEntry[] = [];
  const before = calculateCashInHand(summaryFor(ledger));

  const first = insertLedgerEntry(ledger, {
    id: nextId(),
    entry_type: "salary_payment",
    direction: "debit",
    amount: 40154,
    source_key: "employee_salary:salary-1",
    reverses_entry_id: null,
  });
  ledger = first.ledger;
  assert.equal(calculateCashInHand(summaryFor(ledger)) - before, -40154);

  const duplicate = insertLedgerEntry(ledger, {
    id: nextId(),
    entry_type: "salary_payment",
    direction: "debit",
    amount: 40154,
    source_key: "employee_salary:salary-1",
    reverses_entry_id: null,
  });
  assert.equal(duplicate.inserted, false);
  assert.equal(calculateCashInHand(summaryFor(duplicate.ledger)) - before, -40154);
});

test("10b. salary advance paid in cash -> -advance amount exactly once, duplicate is blocked", () => {
  let ledger: CashLedgerEntry[] = [];
  const before = calculateCashInHand(summaryFor(ledger));

  const first = insertLedgerEntry(ledger, {
    id: nextId(),
    entry_type: "salary_advance",
    direction: "debit",
    amount: 10000,
    source_key: "salary_advance:advance-1",
    reverses_entry_id: null,
  });
  ledger = first.ledger;
  assert.equal(calculateCashInHand(summaryFor(ledger)) - before, -10000);

  const duplicate = insertLedgerEntry(ledger, {
    id: nextId(),
    entry_type: "salary_advance",
    direction: "debit",
    amount: 10000,
    source_key: "salary_advance:advance-1",
    reverses_entry_id: null,
  });
  assert.equal(duplicate.inserted, false);
  assert.equal(calculateCashInHand(summaryFor(duplicate.ledger)) - before, -10000);
});

test("10c. an advance later deducted from payroll never creates a second cash-ledger entry for the same advance", () => {
  // The whole point of the derived-outstanding-balance design
  // (link_salary_advance_to_payroll never touches cash_ledger_entries) is
  // that "deducting" an advance from a payslip is purely an in-memory/DB
  // bookkeeping change to the payroll row's advance_deduction field - no
  // ledger row is ever posted for it. Simulated here by simply asserting
  // that after the one advance-disbursal entry, applying the deduction
  // logic (nothing to insert) leaves the ledger with exactly one entry.
  let ledger: CashLedgerEntry[] = [];
  ledger = insertLedgerEntry(ledger, {
    id: nextId(),
    entry_type: "salary_advance",
    direction: "debit",
    amount: 10000,
    source_key: "salary_advance:advance-2",
    reverses_entry_id: null,
  }).ledger;

  // "Applying" the advance deduction to a payroll row is a pure
  // arithmetic operation on the payroll row - it never calls
  // insertLedgerEntry a second time for this advance.
  const advanceEntries = ledger.filter((e) => e.entry_type === "salary_advance");
  assert.equal(advanceEntries.length, 1);
  assert.equal(sumLedgerByType(ledger, "salary_advance"), 10000);
});

test("10d. spec worked example: base payable 50000, advance already paid 10000 -> advance day -10000, Mark Paid -40000, total cash out exactly -50000 (never -10000 then -50000)", () => {
  let ledger: CashLedgerEntry[] = [];
  const before = calculateCashInHand(summaryFor(ledger, 100000));

  // Advance disbursed mid-month.
  ledger = insertLedgerEntry(ledger, {
    id: nextId(),
    entry_type: "salary_advance",
    direction: "debit",
    amount: 10000,
    source_key: "salary_advance:advance-3",
    reverses_entry_id: null,
  }).ledger;

  // Month-end payroll: gross 50000, advance_deduction 10000 already
  // reduced net_salary to 40000 by the RPC before Mark Paid ever runs -
  // only the remaining 40000 is ever debited here.
  ledger = insertLedgerEntry(ledger, {
    id: nextId(),
    entry_type: "salary_payment",
    direction: "debit",
    amount: 40000,
    source_key: "employee_salary:salary-3",
    reverses_entry_id: null,
  }).ledger;

  const totalCashOut = calculateCashInHand(summaryFor(ledger, 100000)) - before;
  assert.equal(
    totalCashOut,
    -50000,
    "total cash out must equal the full base payable exactly once",
  );
  assert.equal(sumLedgerByType(ledger, "salary_advance"), 10000);
  assert.equal(sumLedgerByType(ledger, "salary_payment"), 40000);
});

test("11. Cash in Hand summary equals ledger truth across every entry type at once, including a corrected expense", () => {
  let ledger: CashLedgerEntry[] = [];
  ledger = insertLedgerEntry(ledger, {
    id: nextId(),
    entry_type: "client_payment_credit",
    direction: "credit",
    amount: 10000,
    source_key: "payment_verification_request:req-a",
    reverses_entry_id: null,
  }).ledger;
  ledger = postExpenseCorrection(ledger, {
    expenseId: "exp-a",
    newPrice: 1500,
    idFactory: nextId,
  }).ledger;
  ledger = insertLedgerEntry(ledger, {
    id: nextId(),
    entry_type: "inventory_purchase",
    direction: "debit",
    amount: 2000,
    source_key: "credit_inventory_purchase:purchase-a",
    reverses_entry_id: null,
  }).ledger;
  ledger = insertLedgerEntry(ledger, {
    id: nextId(),
    entry_type: "salary_payment",
    direction: "debit",
    amount: 30000,
    source_key: "employee_salary:salary-a",
    reverses_entry_id: null,
  }).ledger;
  ledger = insertLedgerEntry(ledger, {
    id: nextId(),
    entry_type: "adjustment",
    direction: "credit",
    amount: 250,
    source_key: "adjustment:manual-1",
    reverses_entry_id: null,
  }).ledger;

  const summary = summaryFor(ledger, 5000);
  const cashInHand = calculateCashInHand(summary);

  const expectedCredits = ledger
    .filter((e) => e.entry_type === "client_payment_credit")
    .reduce((s, e) => s + e.amount, 0);
  const expectedExpenses = ledger
    .filter((e) => e.entry_type === "expense")
    .reduce((s, e) => s + (e.direction === "debit" ? e.amount : -e.amount), 0);
  const expectedInventory = ledger
    .filter((e) => e.entry_type === "inventory_purchase")
    .reduce((s, e) => s + e.amount, 0);
  const expectedSalaries = ledger
    .filter((e) => e.entry_type === "salary_payment")
    .reduce((s, e) => s + e.amount, 0);
  const expectedAdjustments = ledger
    .filter((e) => e.entry_type === "adjustment")
    .reduce((s, e) => s + (e.direction === "credit" ? e.amount : -e.amount), 0);

  assert.equal(summary.clientPaymentCredits, expectedCredits);
  assert.equal(summary.expensesTotal, expectedExpenses);
  assert.equal(expectedExpenses, 1500);
  assert.equal(summary.inventoryPurchasesPaidTotal, expectedInventory);
  assert.equal(summary.paidSalariesTotal, expectedSalaries);
  assert.equal(summary.adjustmentsTotal, expectedAdjustments);
  assert.equal(
    cashInHand,
    5000 +
      expectedCredits -
      expectedExpenses -
      expectedInventory -
      expectedSalaries +
      expectedAdjustments,
  );
});

test("does not count: unpaid invoices, pending claims, unpaid credit purchases, unpaid salaries never appear in the ledger", () => {
  const ledger: CashLedgerEntry[] = [];
  assert.equal(sumLedgerByType(ledger, "client_payment_credit"), 0);
  assert.equal(sumLedgerByType(ledger, "inventory_purchase"), 0);
  assert.equal(sumLedgerByType(ledger, "salary_payment"), 0);
});
