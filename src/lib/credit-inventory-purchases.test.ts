import assert from "node:assert/strict";
import test from "node:test";

import {
  isCreditPurchaseOverdue,
  isCreditPurchaseReminderDue,
  selectDueCreditPurchaseReminders,
  validateCreditPurchaseFormInput,
} from "./credit-inventory-purchases.ts";

const now = new Date("2026-08-04T12:00:00.000Z");

test("unpaid purchase due within its lead-hours window is eligible", () => {
  const purchase = {
    status: "unpaid" as const,
    due_at: "2026-08-04T13:00:00.000Z", // 1 hour from now
    reminder_lead_hours: 24,
    reminder_queued_at: null,
  };
  assert.equal(isCreditPurchaseReminderDue(purchase, now), true);
});

test("unpaid purchase due far outside its lead-hours window is not eligible", () => {
  const purchase = {
    status: "unpaid" as const,
    due_at: "2026-09-04T13:00:00.000Z", // a month away
    reminder_lead_hours: 24,
    reminder_queued_at: null,
  };
  assert.equal(isCreditPurchaseReminderDue(purchase, now), false);
});

test("already-queued purchase is never selected again (duplicate prevention)", () => {
  const purchase = {
    status: "unpaid" as const,
    due_at: "2026-08-04T13:00:00.000Z",
    reminder_lead_hours: 24,
    reminder_queued_at: "2026-08-04T11:00:00.000Z",
  };
  assert.equal(isCreditPurchaseReminderDue(purchase, now), false);
});

test("paid or cancelled purchases are never eligible regardless of due date", () => {
  const base = {
    due_at: "2026-08-04T13:00:00.000Z",
    reminder_lead_hours: 24,
    reminder_queued_at: null,
  };
  assert.equal(isCreditPurchaseReminderDue({ ...base, status: "paid" }, now), false);
  assert.equal(isCreditPurchaseReminderDue({ ...base, status: "cancelled" }, now), false);
});

test("selectDueCreditPurchaseReminders filters a mixed list correctly", () => {
  const due = {
    status: "unpaid" as const,
    due_at: "2026-08-04T13:00:00.000Z",
    reminder_lead_hours: 24,
    reminder_queued_at: null,
  };
  const notDue = {
    status: "unpaid" as const,
    due_at: "2026-12-01T00:00:00.000Z",
    reminder_lead_hours: 24,
    reminder_queued_at: null,
  };
  const alreadyQueued = { ...due, reminder_queued_at: "2026-08-04T10:00:00.000Z" };
  const paid = { ...due, status: "paid" as const };

  const result = selectDueCreditPurchaseReminders([due, notDue, alreadyQueued, paid], now);
  assert.equal(result.length, 1);
  assert.equal(result[0], due);
});

test("an unpaid purchase past its due date/time is overdue", () => {
  assert.equal(
    isCreditPurchaseOverdue({ status: "unpaid", due_at: "2026-08-01T00:00:00.000Z" }, now),
    true,
  );
});

test("an unpaid purchase not yet due is not overdue", () => {
  assert.equal(
    isCreditPurchaseOverdue({ status: "unpaid", due_at: "2026-09-01T00:00:00.000Z" }, now),
    false,
  );
});

test("paid/cancelled purchases are never overdue regardless of due date", () => {
  assert.equal(
    isCreditPurchaseOverdue({ status: "paid", due_at: "2026-08-01T00:00:00.000Z" }, now),
    false,
  );
  assert.equal(
    isCreditPurchaseOverdue({ status: "cancelled", due_at: "2026-08-01T00:00:00.000Z" }, now),
    false,
  );
});

test("validateCreditPurchaseFormInput accepts a complete valid form", () => {
  const errors = validateCreditPurchaseFormInput({
    supplier_name: "ABC Traders",
    item_name_snapshot: "Cooking Oil 10L",
    amount_due: 5000,
    due_at: "2026-08-10T00:00:00.000Z",
    reminder_lead_hours: 24,
  });
  assert.deepEqual(errors, {});
});

test("validateCreditPurchaseFormInput rejects missing supplier/item name", () => {
  const errors = validateCreditPurchaseFormInput({
    supplier_name: "  ",
    item_name_snapshot: "",
    amount_due: 5000,
    due_at: "2026-08-10T00:00:00.000Z",
  });
  assert.ok(errors.supplier_name);
  assert.ok(errors.item_name_snapshot);
});

test("validateCreditPurchaseFormInput rejects non-positive amount", () => {
  const errors = validateCreditPurchaseFormInput({
    supplier_name: "ABC",
    item_name_snapshot: "Oil",
    amount_due: 0,
    due_at: "2026-08-10T00:00:00.000Z",
  });
  assert.ok(errors.amount_due);
});

test("validateCreditPurchaseFormInput rejects an invalid due date", () => {
  const errors = validateCreditPurchaseFormInput({
    supplier_name: "ABC",
    item_name_snapshot: "Oil",
    amount_due: 100,
    due_at: "not-a-date",
  });
  assert.ok(errors.due_at);
});

test("validateCreditPurchaseFormInput rejects out-of-range reminder lead hours", () => {
  const errors = validateCreditPurchaseFormInput({
    supplier_name: "ABC",
    item_name_snapshot: "Oil",
    amount_due: 100,
    due_at: "2026-08-10T00:00:00.000Z",
    reminder_lead_hours: 1000,
  });
  assert.ok(errors.reminder_lead_hours);
});
