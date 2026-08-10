import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEarlyPaymentReply,
  buildInvalidPaidCommandReply,
  buildMultipleOpenInvoicesReply,
  buildNoOutstandingInvoiceReply,
  buildOverdueInvoiceMessage,
} from "./services/message-builder.js";

test("overdue reminder template contains client name, invoice ID, outstanding amount and the exact PAID command", () => {
  const body = buildOverdueInvoiceMessage({
    clientName: "Testing Dev",
    invoiceNumber: "INV-1023",
    dueDate: "2026-07-20",
    outstandingAmount: 25000,
  });

  assert.match(body, /Testing Dev/);
  assert.match(body, /INV-1023/);
  assert.match(body, /Rs\. 25,000/);
  assert.match(body, /PAID 25000 INV-1023/);
});

test("early-payment reply contains client name, invoice ID, outstanding amount and the exact PAID command", () => {
  const body = buildEarlyPaymentReply({
    clientName: "Testing Dev",
    invoiceNumber: "INV-1023",
    outstandingAmount: 25000,
  });

  assert.match(body, /Testing Dev/);
  assert.match(body, /INV-1023/);
  assert.match(body, /Rs\. 25,000/);
  assert.match(body, /PAID 25000 INV-1023/);
});

test("no-outstanding-invoice reply never fabricates an invoice", () => {
  const body = buildNoOutstandingInvoiceReply("Testing Dev");
  assert.match(body, /Testing Dev/);
  assert.doesNotMatch(body, /INV-/);
});

test("multiple-open-invoices reply lists invoice IDs, amounts and exact commands", () => {
  const body = buildMultipleOpenInvoicesReply("Testing Dev", [
    { invoiceNumber: "INV-1023", outstandingAmount: 25000 },
    { invoiceNumber: "INV-1024", outstandingAmount: 12500 },
  ]);

  assert.match(body, /Testing Dev/);
  assert.match(body, /Invoice ID: INV-1023/);
  assert.match(body, /Amount: Rs\. 25,000/);
  assert.match(body, /Reply: PAID 25000 INV-1023/);
  assert.match(body, /Invoice ID: INV-1024/);
  assert.match(body, /Amount: Rs\. 12,500/);
  assert.match(body, /Reply: PAID 12500 INV-1024/);
});

test("invalid-command guidance shows the exact required format", () => {
  const body = buildInvalidPaidCommandReply();
  assert.match(body, /PAID <Amount> <Invoice-ID>/);
});
