import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  adjustPacketsToAvailable,
  assertInvoiceStockOverride,
  calculateInvoiceStockShortages,
  invoiceStockOverrideMutatesInventory,
} from "./invoice-stock-gate";

const stock = [{ product_id: "p1", product_name: "Curly Fries", available_packets: 20 }];

test("invoice quantity below available stock succeeds", () => {
  assert.deepEqual(
    calculateInvoiceStockShortages(
      [{ product_id: "p1", product: "Curly Fries", requested_qty: 10 }],
      stock,
    ),
    [],
  );
});

test("invoice quantity above available stock returns a structured shortage", () => {
  assert.deepEqual(
    calculateInvoiceStockShortages(
      [{ product_id: "p1", product: "Curly Fries", requested_qty: 30 }],
      stock,
    ),
    [
      {
        product_id: "p1",
        product: "Curly Fries",
        requested_qty: 30,
        available_qty: 20,
        shortfall_qty: 10,
      },
    ],
  );
});

test("invoice quantity exactly equal to available succeeds", () => {
  assert.equal(
    calculateInvoiceStockShortages(
      [{ product_id: "p1", product: "Curly Fries", requested_qty: 20 }],
      stock,
    ).length,
    0,
  );
});

test("one shortage blocks a multi-product invoice atomically", () => {
  const result = calculateInvoiceStockShortages(
    [
      { product_id: "p1", product: "Curly Fries", requested_qty: 10 },
      { product_id: "p2", product: "Waffle Fries", requested_qty: 12 },
    ],
    [...stock, { product_id: "p2", product_name: "Waffle Fries", available_packets: 8 }],
  );
  assert.deepEqual(
    result.map((row) => row.product_id),
    ["p2"],
  );
});

test("Admin force override succeeds only with a reason", () => {
  const shortages = calculateInvoiceStockShortages(
    [{ product_id: "p1", product: "Curly Fries", requested_qty: 30 }],
    stock,
  );
  assert.equal(
    assertInvoiceStockOverride({ role: "admin", reason: "Emergency order", shortages }),
    true,
  );
  assert.throws(
    () => assertInvoiceStockOverride({ role: "admin", reason: " ", shortages }),
    /reason is required/,
  );
});

test("non-Admin cannot force an invoice stock override", () => {
  const shortages = calculateInvoiceStockShortages(
    [{ product_id: "p1", product: "Curly Fries", requested_qty: 30 }],
    stock,
  );
  assert.throws(
    () => assertInvoiceStockOverride({ role: "staff", reason: "Requested", shortages }),
    /Only an Admin/,
  );
  for (const role of ["moderator", "customer", "investor"] as const) {
    assert.throws(
      () => assertInvoiceStockOverride({ role, reason: "Requested", shortages }),
      /Only an Admin/,
    );
  }
});

test("adjust action uses the canonical available quantity", () => {
  assert.equal(
    adjustPacketsToAvailable({
      product_id: "p1",
      product: "Curly Fries",
      requested_qty: 30,
      available_qty: 20,
      shortfall_qty: 10,
    }),
    20,
  );
});

test("stock override never fabricates or changes inventory", () => {
  assert.equal(invoiceStockOverrideMutatesInventory(), false);
});

test("database contract serializes stock validation and closes direct insert bypass", () => {
  const sql = readFileSync(
    new URL(
      "../../supabase/migrations/20260821140000_finished_stock_invoice_gate.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /ORDER BY \(line->>'product_id'\)::uuid/);
  assert.match(sql, /finished_stock_availability\(ARRAY\[line_record\.product_id\]\)/);
  assert.match(sql, /REVOKE INSERT ON public\.invoices FROM authenticated/);
  assert.doesNotMatch(sql, /UPDATE public\.inventory/);
  assert.doesNotMatch(sql, /cash_ledger_entries|bank_ledger_entries|cash_accounts/);
});
