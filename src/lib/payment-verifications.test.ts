import assert from "node:assert/strict";
import test from "node:test";

import {
  applyPaymentVerificationApprovalForTest,
  applyPaymentVerificationRejectionForTest,
  canApprovePaymentVerification,
  claimedAmountMatchesOutstanding,
  evaluatePaymentVerificationApproval,
  filterSelectableClientInvoices,
  maskPhoneForDisplay,
  parsePaidWhatsAppCommand,
  truncateMessageId,
} from "./payment-verifications.ts";

const clientId = "22222222-2222-4222-8222-222222222222";
const otherClientId = "33333333-3333-4333-8333-333333333333";

const unresolvedRequest = {
  id: "11111111-1111-4111-8111-111111111111",
  client_id: clientId,
  invoice_id: null,
  status: "unresolved" as const,
  // invoiceB has amount 2000, amount_received 500 -> outstanding is 1500.
  claimed_amount: 1500,
};

const invoiceA = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  client_id: clientId,
  invoice_no: "TFC-001",
  due_date: "2026-07-01",
  amount: 1000,
  amount_received: 0,
  payment_status: "Not Done",
  is_deleted: false,
};

const invoiceB = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  client_id: clientId,
  invoice_no: "TFC-002",
  due_date: "2026-07-02",
  amount: 2000,
  amount_received: 500,
  payment_status: "Partial",
  is_deleted: false,
};

test("unresolved request requires invoice selection", () => {
  assert.equal(canApprovePaymentVerification(unresolvedRequest, null), false);
  assert.equal(canApprovePaymentVerification(unresolvedRequest, invoiceA.id), true);
});

test("only client unpaid invoices are listed", () => {
  const selectable = filterSelectableClientInvoices(clientId, [
    invoiceA,
    invoiceB,
    { ...invoiceA, id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", payment_status: "Done" },
    { ...invoiceA, id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", is_deleted: true },
    { ...invoiceA, id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", client_id: otherClientId },
  ]);

  assert.deepEqual(
    selectable.map((invoice) => invoice.id),
    [invoiceA.id, invoiceB.id],
  );
});

test("approval marks selected invoice paid", () => {
  const result = applyPaymentVerificationApprovalForTest(
    unresolvedRequest,
    [invoiceA, invoiceB],
    [],
    invoiceB.id,
  );

  const selected = result.invoices.find((invoice) => invoice.id === invoiceB.id);
  assert.equal(result.request.invoice_id, invoiceB.id);
  assert.equal(result.request.status, "approved");
  assert.equal(selected?.payment_status, "Done");
  assert.equal(selected?.amount_received, 2000);
});

test("approval leaves other invoices unchanged", () => {
  const result = applyPaymentVerificationApprovalForTest(
    unresolvedRequest,
    [invoiceA, invoiceB],
    [],
    invoiceB.id,
  );

  const other = result.invoices.find((invoice) => invoice.id === invoiceA.id);
  assert.equal(other?.payment_status, "Not Done");
  assert.equal(other?.amount_received, 0);
});

test("approval cancels reminders for selected invoice only", () => {
  const result = applyPaymentVerificationApprovalForTest(
    unresolvedRequest,
    [invoiceA, invoiceB],
    [
      { invoice_id: invoiceB.id, status: "pending" },
      { invoice_id: invoiceB.id, status: "approved" },
      { invoice_id: invoiceB.id, status: "processing" },
      { invoice_id: invoiceB.id, status: "sent" },
      { invoice_id: invoiceA.id, status: "pending" },
    ],
    invoiceB.id,
  );

  assert.deepEqual(
    result.reminders.map((reminder) => reminder.status),
    ["cancelled", "cancelled", "cancelled", "sent", "pending"],
  );
});

test("rejection changes no invoice", () => {
  const result = applyPaymentVerificationRejectionForTest(
    unresolvedRequest,
    [invoiceA, invoiceB],
    "Screenshot unclear",
  );

  assert.equal(result.request.status, "rejected");
  assert.equal(result.request.rejection_reason, "Screenshot unclear");
  assert.deepEqual(result.invoices, [invoiceA, invoiceB]);
});

test("rejection requires a non-empty reason", () => {
  assert.throws(() =>
    applyPaymentVerificationRejectionForTest(unresolvedRequest, [invoiceA, invoiceB], ""),
  );
  assert.throws(() =>
    applyPaymentVerificationRejectionForTest(unresolvedRequest, [invoiceA, invoiceB], "   "),
  );
});

test("exact-amount approval succeeds", () => {
  assert.equal(claimedAmountMatchesOutstanding(1500, invoiceB), true);
});

test("claimed amount mismatch (under) is blocked", () => {
  assert.equal(claimedAmountMatchesOutstanding(1000, invoiceB), false);
});

test("claimed amount overpayment is blocked", () => {
  assert.equal(claimedAmountMatchesOutstanding(2000, invoiceB), false);
});

test("missing or non-positive claimed amount is blocked", () => {
  assert.equal(claimedAmountMatchesOutstanding(null, invoiceB), false);
  assert.equal(claimedAmountMatchesOutstanding(undefined, invoiceB), false);
  assert.equal(claimedAmountMatchesOutstanding(0, invoiceB), false);
  assert.equal(claimedAmountMatchesOutstanding(-500, invoiceB), false);
});

test("approval helper throws when claimed amount does not match outstanding", () => {
  assert.throws(
    () =>
      applyPaymentVerificationApprovalForTest(
        { ...unresolvedRequest, claimed_amount: 1000 },
        [invoiceA, invoiceB],
        [],
        invoiceB.id,
      ),
    /does not match/,
  );
});

test("parsePaidWhatsAppCommand parses the exact 'PAID <amount> <invoice>' format", () => {
  assert.deepEqual(parsePaidWhatsAppCommand("PAID 25000 INV-1023"), {
    amount: 25000,
    invoiceReference: "INV-1023",
  });
  assert.deepEqual(parsePaidWhatsAppCommand("paid 500 tfc-002"), {
    amount: 500,
    invoiceReference: "TFC-002",
  });
  assert.deepEqual(parsePaidWhatsAppCommand("  PAID   1200   INV-9  "), {
    amount: 1200,
    invoiceReference: "INV-9",
  });
});

test("parsePaidWhatsAppCommand accepts commas and an optional RS/PKR prefix", () => {
  assert.deepEqual(parsePaidWhatsAppCommand("paid 25,000 inv-1023"), {
    amount: 25000,
    invoiceReference: "INV-1023",
  });
  assert.deepEqual(parsePaidWhatsAppCommand("PAID RS 25000 INV-1023"), {
    amount: 25000,
    invoiceReference: "INV-1023",
  });
  assert.deepEqual(parsePaidWhatsAppCommand("PAID PKR 25000 INV-1023"), {
    amount: 25000,
    invoiceReference: "INV-1023",
  });
  assert.deepEqual(parsePaidWhatsAppCommand("paid rs. 1,200.50 inv-9"), {
    amount: 1200.5,
    invoiceReference: "INV-9",
  });
});

test("parsePaidWhatsAppCommand rejects anything that does not match exactly", () => {
  assert.equal(parsePaidWhatsAppCommand("PAID"), null);
  assert.equal(parsePaidWhatsAppCommand("PAID 25000"), null);
  assert.equal(parsePaidWhatsAppCommand("PAID INV-1023 25000"), null);
  assert.equal(parsePaidWhatsAppCommand("PAID -500 INV-1"), null);
  assert.equal(parsePaidWhatsAppCommand("PAYMENT DONE"), null);
  assert.equal(parsePaidWhatsAppCommand(""), null);
  assert.equal(parsePaidWhatsAppCommand(null), null);
});

test("evaluatePaymentVerificationApproval: claimed amount shown as matching enables approval", () => {
  const request = { ...unresolvedRequest, claimed_amount: 1500 };
  const result = evaluatePaymentVerificationApproval(request, invoiceB.id, [invoiceA, invoiceB]);
  assert.equal(result.canApprove, true);
  assert.equal(result.reason, "ok");
});

test("evaluatePaymentVerificationApproval: mismatch warning blocks approval", () => {
  const request = { ...unresolvedRequest, claimed_amount: 999 };
  const result = evaluatePaymentVerificationApproval(request, invoiceB.id, [invoiceA, invoiceB]);
  assert.equal(result.canApprove, false);
  assert.equal(result.reason, "amount_mismatch");
});

test("evaluatePaymentVerificationApproval: unknown/unmatched sender (no client_id) cannot be approved", () => {
  const request = { ...unresolvedRequest, client_id: null, claimed_amount: 1500 };
  const result = evaluatePaymentVerificationApproval(request, invoiceB.id, [invoiceA, invoiceB]);
  assert.equal(result.canApprove, false);
  assert.equal(result.reason, "unknown_sender");
});

test("evaluatePaymentVerificationApproval: already-reviewed request cannot be approved again", () => {
  const request = { ...unresolvedRequest, status: "approved" as const, claimed_amount: 1500 };
  const result = evaluatePaymentVerificationApproval(request, invoiceB.id, [invoiceA, invoiceB]);
  assert.equal(result.canApprove, false);
  assert.equal(result.reason, "already_reviewed");
});

test("maskPhoneForDisplay never shows the full number", () => {
  const masked = maskPhoneForDisplay("923212558027");
  assert.doesNotMatch(masked, /212558/);
  assert.equal(maskPhoneForDisplay(null), "-");
});

test("truncateMessageId shortens long opaque ids and leaves short ones alone", () => {
  assert.equal(truncateMessageId("abcdefghijklmnopqrstuvwxyz"), "abcdefgh…wxyz");
  assert.equal(truncateMessageId("short-id"), "short-id");
  assert.equal(truncateMessageId(null), "-");
});
