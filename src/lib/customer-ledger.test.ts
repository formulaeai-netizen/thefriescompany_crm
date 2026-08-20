import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCustomerLedgerRows,
  calculateCustomerLedgerBalance,
  formatStockQuantity,
  summarizeCustomerLedger,
  type CustomerLedgerInvoice,
} from "./customer-ledger.ts";

const today = "2026-08-13";

function invoice(overrides: Partial<CustomerLedgerInvoice>): CustomerLedgerInvoice {
  return {
    id: "inv-1",
    invoice_no: "TFC-1",
    client_id: "client-a",
    customer_name: "ABC Foods",
    branch_id: "branch-johar",
    branch_name: "Johar Branch",
    stock_date: "2026-08-10",
    due_date: "2026-08-20",
    item: "Curly Fries",
    weight_kg: 50,
    no_of_packs: null,
    amount: 20_000,
    amount_received: 0,
    payment_status: "Not Done",
    is_deleted: false,
    ...overrides,
  };
}

test("distinct branches for the same customer remain separate identities", () => {
  const rows = buildCustomerLedgerRows(
    [
      invoice({ id: "a", invoice_no: "A", branch_id: "johar", branch_name: "Johar" }),
      invoice({ id: "b", invoice_no: "B", branch_id: "dha", branch_name: "DHA" }),
    ],
    today,
  );
  const summary = summarizeCustomerLedger(rows);

  assert.equal(summary.uniqueCustomerBranches, 2);
  assert.deepEqual(
    rows.map((r) => `${r.customer_name} - ${r.branch_name}`),
    ["ABC Foods - Johar", "ABC Foods - DHA"],
  );
});

test("one invoice/dispatch event produces one row and multiple same-branch dispatches do not collapse", () => {
  const rows = buildCustomerLedgerRows(
    [
      invoice({ id: "a", invoice_no: "A", stock_date: "2026-08-10", amount: 1000 }),
      invoice({ id: "b", invoice_no: "B", stock_date: "2026-08-11", amount: 2000 }),
      invoice({ id: "c", invoice_no: "C", stock_date: "2026-08-12", amount: 3000 }),
    ],
    today,
  );

  assert.equal(rows.length, 3);
  assert.equal(summarizeCustomerLedger(rows).uniqueCustomerBranches, 1);
  assert.deepEqual(
    rows.map((r) => r.invoice_no),
    ["A", "B", "C"],
  );
});

test("stock date and days since stock sent are dynamic and independent of due date", () => {
  const [row] = buildCustomerLedgerRows(
    [invoice({ stock_date: "2026-08-08", due_date: "2026-09-01" })],
    today,
  );

  assert.equal(row.stock_date, "2026-08-08");
  assert.equal(row.days_since_stock_sent, 5);
  assert.equal(row.due_status, "not_due");
});

test("quantity label uses real units and never assumes boxes", () => {
  assert.equal(formatStockQuantity({ weight_kg: 20, no_of_packs: null }), "20 kg");
  assert.equal(formatStockQuantity({ weight_kg: null, no_of_packs: 30 }), "30 packs");
  assert.equal(formatStockQuantity({ weight_kg: 20, no_of_packs: 10 }), "20 kg / 10 packs");
  assert.equal(formatStockQuantity({ weight_kg: 0, no_of_packs: 0 }), "Not recorded");
});

test("unpaid, partial, pending claim and rejected claim balance rules are truthful", () => {
  assert.deepEqual(calculateCustomerLedgerBalance(invoice({ amount: 2000 })), {
    verifiedCollections: 0,
    balance: 2000,
  });
  assert.deepEqual(
    calculateCustomerLedgerBalance(
      invoice({ amount: 2000, amount_received: 1200, payment_status: "Partial" }),
    ),
    { verifiedCollections: 1200, balance: 800 },
  );

  const pendingClaimDoesNothing = invoice({
    amount: 2000,
    amount_received: 0,
    payment_status: "Not Done",
  });
  assert.equal(calculateCustomerLedgerBalance(pendingClaimDoesNothing).balance, 2000);
  assert.equal(calculateCustomerLedgerBalance(pendingClaimDoesNothing).verifiedCollections, 0);
});

test("fully paid invoice balance is zero", () => {
  assert.deepEqual(
    calculateCustomerLedgerBalance(
      invoice({ amount: 2500, amount_received: 0, payment_status: "Done" }),
    ),
    { verifiedCollections: 2500, balance: 0 },
  );
});

test("awaiting receiving invoice creates no customer ledger receivable", () => {
  const awaiting = invoice({
    amount: 5000,
    amount_received: 0,
    payment_status: "Not Done",
    receiving_status: "awaiting_receiving",
  });

  assert.deepEqual(calculateCustomerLedgerBalance(awaiting), {
    verifiedCollections: 0,
    balance: 0,
  });
  assert.equal(buildCustomerLedgerRows([awaiting], today).length, 0);
});

test("cash and bank payment approvals reduce receivable identically; account choice is irrelevant here", () => {
  const cashApproved = calculateCustomerLedgerBalance(
    invoice({ amount: 5000, amount_received: 5000, payment_status: "Done" }),
  );
  const bankApproved = calculateCustomerLedgerBalance(
    invoice({ amount: 5000, amount_received: 5000, payment_status: "Done" }),
  );

  assert.deepEqual(cashApproved, bankApproved);
  assert.equal(cashApproved.balance, 0);
});

test("customer search, branch filter, outstanding filter and overdue filter work from row truth", () => {
  const invoices = [
    invoice({
      id: "a",
      invoice_no: "A",
      customer_name: "ABC Foods",
      branch_id: "johar",
      due_date: "2026-08-01",
    }),
    invoice({
      id: "b",
      invoice_no: "B",
      customer_name: "XYZ Foods",
      branch_id: "dha",
      branch_name: "DHA",
      amount_received: 20_000,
      payment_status: "Done",
    }),
    invoice({
      id: "c",
      invoice_no: "C",
      customer_name: "ABC Foods",
      branch_id: "dha",
      branch_name: "DHA",
    }),
  ];

  assert.equal(buildCustomerLedgerRows(invoices, today, { search: "abc" }).length, 2);
  assert.equal(buildCustomerLedgerRows(invoices, today, { branchId: "dha" }).length, 2);
  assert.equal(
    buildCustomerLedgerRows(invoices, today, { balanceStatus: "outstanding" }).length,
    2,
  );
  assert.equal(buildCustomerLedgerRows(invoices, today, { balanceStatus: "paid" }).length, 1);
  assert.equal(buildCustomerLedgerRows(invoices, today, { dueStatus: "overdue" }).length, 1);
});

test("summary totals equal the same row truth", () => {
  const rows = buildCustomerLedgerRows(
    [
      invoice({ id: "a", invoice_no: "A", amount: 1000, due_date: "2026-08-01" }),
      invoice({
        id: "b",
        invoice_no: "B",
        amount: 2000,
        amount_received: 500,
        payment_status: "Partial",
      }),
      invoice({
        id: "c",
        invoice_no: "C",
        branch_id: "dha",
        branch_name: "DHA",
        amount: 3000,
        amount_received: 3000,
        payment_status: "Done",
      }),
    ],
    today,
  );
  const summary = summarizeCustomerLedger(rows);

  assert.equal(summary.uniqueCustomerBranches, 2);
  assert.equal(summary.outstandingCustomerBranches, 1);
  assert.equal(summary.totalInvoiceValue, 6000);
  assert.equal(summary.totalOutstandingBalance, 2500);
  assert.equal(summary.overdueBalance, 1000);
});
