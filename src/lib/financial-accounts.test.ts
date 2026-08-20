import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateAccountBalances,
  calculatePayables,
  calculateReceivables,
  calculateTruthfulPnl,
  createTransferLedgerEntries,
  insertAccountLedgerEntry,
  totalLiquidFunds,
  type AccountLedgerEntry,
  type FinancialAccount,
} from "./financial-accounts.ts";

const accounts: FinancialAccount[] = [
  {
    id: "cash",
    account_key: "cash_in_hand",
    name: "Cash in Hand",
    account_type: "cash",
    opening_balance: 1000,
  },
  {
    id: "bank",
    account_key: "cash_in_bank",
    name: "Cash in Bank",
    account_type: "bank",
    opening_balance: 0,
  },
];

let id = 0;
function entry(input: Omit<AccountLedgerEntry, "id">): AccountLedgerEntry {
  id += 1;
  return { id: `l-${id}`, ...input };
}

function balances(ledger: AccountLedgerEntry[]) {
  const rows = calculateAccountBalances(accounts, ledger);
  return {
    cash: rows.find((row) => row.account_key === "cash_in_hand")!.balance,
    bank: rows.find((row) => row.account_key === "cash_in_bank")!.balance,
    liquid: totalLiquidFunds(rows),
  };
}

test("approved client payment to Cash credits Cash only", () => {
  const ledger = [
    entry({
      account_id: "cash",
      entry_type: "client_payment_credit",
      direction: "credit",
      amount: 1200,
      source_key: "payment_verification_request:req-cash",
    }),
  ];
  assert.deepEqual(balances(ledger), { cash: 2200, bank: 0, liquid: 2200 });
});

test("approved client payment to Bank credits Bank only", () => {
  const ledger = [
    entry({
      account_id: "bank",
      entry_type: "client_payment_credit",
      direction: "credit",
      amount: 1200,
      source_key: "payment_verification_request:req-bank",
    }),
  ];
  assert.deepEqual(balances(ledger), { cash: 1000, bank: 1200, liquid: 2200 });
});

test("duplicate payment approval does not duplicate ledger entry", () => {
  let ledger: AccountLedgerEntry[] = [];
  ledger = insertAccountLedgerEntry(
    ledger,
    entry({
      account_id: "bank",
      entry_type: "client_payment_credit",
      direction: "credit",
      amount: 500,
      source_key: "payment_verification_request:req-dup",
    }),
  ).ledger;
  const retry = insertAccountLedgerEntry(
    ledger,
    entry({
      account_id: "bank",
      entry_type: "client_payment_credit",
      direction: "credit",
      amount: 500,
      source_key: "payment_verification_request:req-dup",
    }),
  );
  assert.equal(retry.inserted, false);
  assert.deepEqual(balances(retry.ledger), { cash: 1000, bank: 500, liquid: 1500 });
});

test("expense from Cash and Bank debits exactly selected account", () => {
  const cashExpense = entry({
    account_id: "cash",
    entry_type: "expense",
    direction: "debit",
    amount: 250,
    source_key: "expense:cash:v1",
  });
  const bankExpense = entry({
    account_id: "bank",
    entry_type: "expense",
    direction: "debit",
    amount: 400,
    source_key: "expense:bank:v1",
  });
  assert.deepEqual(balances([cashExpense, bankExpense]), { cash: 750, bank: -400, liquid: 350 });
});

test("WhatsApp expense defaults to Cash exactly once", () => {
  let ledger: AccountLedgerEntry[] = [];
  ledger = insertAccountLedgerEntry(
    ledger,
    entry({
      account_id: "cash",
      entry_type: "expense",
      direction: "debit",
      amount: 300,
      source_key: "expense:whatsapp:v1",
    }),
  ).ledger;
  ledger = insertAccountLedgerEntry(
    ledger,
    entry({
      account_id: "cash",
      entry_type: "expense",
      direction: "debit",
      amount: 300,
      source_key: "expense:whatsapp:v1",
    }),
  ).ledger;
  assert.deepEqual(balances(ledger), { cash: 700, bank: 0, liquid: 700 });
});

test("expense correction stays on original account", () => {
  const ledger = [
    entry({
      account_id: "bank",
      entry_type: "expense",
      direction: "debit",
      amount: 500,
      source_key: "expense:correct:v1",
    }),
    entry({
      account_id: "bank",
      entry_type: "expense",
      direction: "credit",
      amount: 200,
      source_key: "expense:correct:v2",
    }),
  ];
  assert.deepEqual(balances(ledger), { cash: 1000, bank: -300, liquid: 700 });
});

test("cash inventory purchase from Cash and Bank debit exactly once", () => {
  const ledger = [
    entry({
      account_id: "cash",
      entry_type: "inventory_purchase",
      direction: "debit",
      amount: 600,
      source_key: "credit_inventory_purchase:cash",
    }),
    entry({
      account_id: "bank",
      entry_type: "inventory_purchase",
      direction: "debit",
      amount: 900,
      source_key: "credit_inventory_purchase:bank",
    }),
  ];
  assert.deepEqual(balances(ledger), { cash: 400, bank: -900, liquid: -500 });
});

test("credit purchase creation has no movement; mark paid debits selected account once", () => {
  let ledger: AccountLedgerEntry[] = [];
  assert.deepEqual(balances(ledger), { cash: 1000, bank: 0, liquid: 1000 });
  ledger = insertAccountLedgerEntry(
    ledger,
    entry({
      account_id: "bank",
      entry_type: "inventory_purchase",
      direction: "debit",
      amount: 1800,
      source_key: "credit_inventory_purchase:later",
    }),
  ).ledger;
  assert.deepEqual(balances(ledger), { cash: 1000, bank: -1800, liquid: -800 });
});

test("payroll and salary advances debit selected accounts; advance deduction makes no second debit", () => {
  const ledger = [
    entry({
      account_id: "cash",
      entry_type: "salary_payment",
      direction: "debit",
      amount: 4000,
      source_key: "employee_salary:cash",
    }),
    entry({
      account_id: "bank",
      entry_type: "salary_payment",
      direction: "debit",
      amount: 5000,
      source_key: "employee_salary:bank",
    }),
    entry({
      account_id: "cash",
      entry_type: "salary_advance",
      direction: "debit",
      amount: 1000,
      source_key: "salary_advance:cash",
    }),
    entry({
      account_id: "bank",
      entry_type: "salary_advance",
      direction: "debit",
      amount: 1500,
      source_key: "salary_advance:bank",
    }),
  ];
  assert.deepEqual(balances(ledger), { cash: -4000, bank: -6500, liquid: -10500 });
});

test("Cash to Bank and Bank to Cash transfers are paired, idempotent and liquid-neutral", () => {
  let ledger: AccountLedgerEntry[] = [];
  for (const row of createTransferLedgerEntries({
    transferId: "t1",
    fromAccountId: "cash",
    toAccountId: "bank",
    amount: 700,
  })) {
    ledger = insertAccountLedgerEntry(ledger, row).ledger;
  }
  for (const row of createTransferLedgerEntries({
    transferId: "t1",
    fromAccountId: "cash",
    toAccountId: "bank",
    amount: 700,
  })) {
    ledger = insertAccountLedgerEntry(ledger, row).ledger;
  }
  assert.deepEqual(balances(ledger), { cash: 300, bank: 700, liquid: 1000 });

  for (const row of createTransferLedgerEntries({
    transferId: "t2",
    fromAccountId: "bank",
    toAccountId: "cash",
    amount: 200,
  })) {
    ledger = insertAccountLedgerEntry(ledger, row).ledger;
  }
  assert.deepEqual(balances(ledger), { cash: 500, bank: 500, liquid: 1000 });
});

test("pending claims do not increase accounts; unpaid credit purchases are payable only", () => {
  assert.deepEqual(balances([]), { cash: 1000, bank: 0, liquid: 1000 });
  const payables = calculatePayables(
    [{ amount_due: 900, status: "unpaid", due_at: "2026-08-01T00:00:00Z" }],
    [{ net_salary: 2500, status: "finalized" }],
    new Date("2026-08-13T00:00:00Z"),
  );
  assert.equal(payables.supplier.outstanding, 900);
  assert.equal(payables.supplier.overdue, 900);
  assert.equal(payables.payrollPayable, 2500);
});

test("receivables use invoice outstanding only, never pending WhatsApp claims", () => {
  const r = calculateReceivables(
    [
      { amount: 1000, amount_received: 0, payment_status: "Not Done", due_date: "2026-08-01" },
      { amount: 500, amount_received: 500, payment_status: "Done", due_date: "2026-08-01" },
    ],
    new Date("2026-08-13T00:00:00Z"),
  );
  assert.deepEqual(r, { outstanding: 1000, overdue: 1000, overdueCount: 1 });
});

test("P&L excludes internal transfers and period filters operational data", () => {
  const pnl = calculateTruthfulPnl({
    start: "2026-08-01",
    end: "2026-08-31",
    invoices: [
      { amount: 10000, date: "2026-08-10" },
      { amount: 7000, date: "2026-09-01" },
    ],
    expenses: [
      { price: 1200, date: "2026-08-11" },
      { price: 300, date: "2026-07-31" },
    ],
    payroll: [
      { net_salary: 2500, status: "finalized", period: "2026-08" },
      { net_salary: 2500, status: "draft", period: "2026-08" },
    ],
  });
  assert.equal(pnl.revenue, 10000);
  assert.equal(pnl.operatingExpenses, 1200);
  assert.equal(pnl.payrollExpense, 2500);
  assert.equal(pnl.netProfit, 6300);
  assert.equal(pnl.cogs, null);
});

test("ledger rows require account and remain append-only by API shape", () => {
  assert.throws(() =>
    insertAccountLedgerEntry([], {
      id: "bad",
      account_id: "",
      entry_type: "expense",
      direction: "debit",
      amount: 1,
      source_key: "expense:bad:v1",
    }),
  );
});
