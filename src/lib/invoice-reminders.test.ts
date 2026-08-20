import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_INVOICE_REMINDER_SETTINGS,
  assertUniqueReminderIdempotencyKeys,
  assertReminderSettingsAllowQueueCreation,
  buildReminderQueueGeneration,
  calculateInvoiceDueDate,
  calculateOutstandingAmount,
  canModifyInvoiceReminderSettings,
  createReminderIdempotencyKey,
  normalizePakistanWhatsappPhone,
  selectReminderStage,
} from "./invoice-reminders.ts";

test("due_date is delivery_date plus 15 days", () => {
  assert.equal(calculateInvoiceDueDate("2026-07-29"), "2026-08-13");
  assert.equal(calculateInvoiceDueDate("2026-12-25"), "2027-01-09");
  assert.equal(calculateInvoiceDueDate(null), null);
});

test("Done invoice outstanding amount is always zero", () => {
  assert.equal(
    calculateOutstandingAmount({ amount: 6000, amount_received: 0, payment_status: "Done" }),
    0,
  );
  assert.equal(
    calculateOutstandingAmount({ amount: 6000, amount_received: 2500, payment_status: "Done" }),
    0,
  );
});

test("unpaid invoice outstanding amount uses total minus received", () => {
  assert.equal(
    calculateOutstandingAmount({ amount: 6000, amount_received: 0, payment_status: "Not Done" }),
    6000,
  );
  assert.equal(
    calculateOutstandingAmount({
      amount: "4500",
      amount_received: null,
      payment_status: "Not Done",
    }),
    4500,
  );
});

test("partial invoice outstanding amount is never negative", () => {
  assert.equal(
    calculateOutstandingAmount({ amount: 10000, amount_received: 3500, payment_status: "Partial" }),
    6500,
  );
  assert.equal(
    calculateOutstandingAmount({
      amount: 10000,
      amount_received: 12000,
      payment_status: "Partial",
    }),
    0,
  );
});

test("Pakistan WhatsApp phone normalization", () => {
  assert.equal(normalizePakistanWhatsappPhone("03001234567"), "923001234567");
  assert.equal(normalizePakistanWhatsappPhone("+923001234567"), "923001234567");
  assert.equal(normalizePakistanWhatsappPhone("00923001234567"), "923001234567");
  assert.equal(normalizePakistanWhatsappPhone("923001234567"), "923001234567");
  assert.equal(normalizePakistanWhatsappPhone(""), null);
  assert.equal(normalizePakistanWhatsappPhone("0213456789"), null);
});

test("duplicate reminder idempotency keys are rejected", () => {
  assert.doesNotThrow(() =>
    assertUniqueReminderIdempotencyKeys([
      { idempotency_key: "invoice-a:first:2026-07-29" },
      { idempotency_key: "invoice-b:first:2026-07-29" },
    ]),
  );

  assert.throws(
    () =>
      assertUniqueReminderIdempotencyKeys([
        { idempotency_key: "invoice-a:first:2026-07-29" },
        { idempotency_key: "invoice-a:first:2026-07-29" },
      ]),
    /Duplicate reminder idempotency key/,
  );
});

const baseInvoice = {
  id: "11111111-1111-4111-8111-111111111111",
  invoice_no: "TFC-TEST-001",
  client_id: "22222222-2222-4222-8222-222222222222",
  date: "2026-07-20",
  delivery_date: "2026-07-20",
  due_date: "2026-07-23",
  amount: 10000,
  amount_received: 0,
  payment_status: "Not Done",
  is_deleted: false,
  clients: {
    id: "22222222-2222-4222-8222-222222222222",
    legal_name: "Test Client",
    phone: "03001234567",
    phone_normalized: null,
    whatsapp_opt_out: false,
    reminders_paused: false,
  },
};

function buildSingle(overrides: Record<string, unknown> = {}, existing: any[] = []) {
  return buildReminderQueueGeneration([{ ...baseInvoice, ...overrides } as any], existing, {
    dryRunOnly: true,
    createPendingQueue: false,
    automationLaunchDate: "2026-07-01",
    today: "2026-07-30",
    maxRemindersPerInvoice: 4,
  });
}

test("overdue eligible invoice is included in dry-run", () => {
  const report = buildSingle();

  assert.equal(report.eligible_count, 1);
  assert.equal(report.inserted_count, 0);
  assert.equal(report.pending_rows.length, 1);
  assert.equal(report.pending_rows[0].status, "pending");
  assert.equal(report.pending_rows[0].normalized_recipient_phone, "923001234567");
  assert.equal(report.sample_preview_rows[0].reminder_stage, "overdue_day_7");
});

test("paid invoice is rejected", () => {
  const report = buildSingle({ payment_status: "Done" });

  assert.equal(report.eligible_count, 0);
  assert.equal(report.skipped_paid, 1);
});

test("awaiting receiving invoice is not collectible and never reminder eligible", () => {
  assert.equal(
    calculateOutstandingAmount({
      amount: 6000,
      amount_received: 0,
      payment_status: "Not Done",
      receiving_status: "awaiting_receiving",
    }),
    0,
  );

  const report = buildSingle({ receiving_status: "awaiting_receiving" });
  assert.equal(report.eligible_count, 0);
  assert.equal(report.pending_rows.length, 0);
  assert.equal(report.sample_preview_rows[0].skip_reason, "awaiting_receiving");
});

test("partial invoice with outstanding amount is accepted", () => {
  const report = buildSingle({ payment_status: "Partial", amount: 10000, amount_received: 3500 });

  assert.equal(report.eligible_count, 1);
  assert.equal(report.pending_rows[0].outstanding_amount_snapshot, 6500);
});

test("missing due date is rejected", () => {
  const report = buildSingle({ due_date: null });

  assert.equal(report.eligible_count, 0);
  assert.equal(report.skipped_missing_due_date, 1);
});

test("invalid phone is rejected", () => {
  const report = buildSingle({
    clients: { ...baseInvoice.clients, phone: "0213456789", phone_normalized: null },
  });

  assert.equal(report.eligible_count, 0);
  assert.equal(report.skipped_invalid_phone, 1);
});

test("opt-out is rejected", () => {
  const report = buildSingle({
    clients: { ...baseInvoice.clients, whatsapp_opt_out: true },
  });

  assert.equal(report.eligible_count, 0);
  assert.equal(report.skipped_opt_out, 1);
});

test("paused client is rejected separately from opt-out", () => {
  const report = buildSingle({
    clients: { ...baseInvoice.clients, reminders_paused: true },
  });

  assert.equal(report.eligible_count, 0);
  assert.equal(report.skipped_paused_client, 1);
  assert.equal(report.skipped_opt_out, 0);
});

test("duplicate same stage is rejected", () => {
  const existing = [
    {
      invoice_id: baseInvoice.id,
      reminder_stage: "overdue_day_7",
      idempotency_key: createReminderIdempotencyKey(baseInvoice.id, "overdue_day_7"),
      status: "pending",
    },
  ];
  const report = buildSingle({}, existing);

  assert.equal(report.eligible_count, 0);
  assert.equal(report.skipped_duplicate, 1);
});

test("launch-date cutoff rejects old invoices", () => {
  const report = buildReminderQueueGeneration([{ ...baseInvoice, date: "2026-06-30" } as any], [], {
    dryRunOnly: true,
    createPendingQueue: false,
    automationLaunchDate: "2026-07-01",
    today: "2026-07-30",
  });

  assert.equal(report.eligible_count, 0);
  assert.equal(report.skipped_before_launch_date, 1);
});

test("stage selection", () => {
  assert.equal(selectReminderStage(0), null);
  assert.equal(selectReminderStage(1), "overdue_day_1");
  assert.equal(selectReminderStage(2), "overdue_day_1");
  assert.equal(selectReminderStage(3), "overdue_day_3");
  assert.equal(selectReminderStage(6), "overdue_day_3");
  assert.equal(selectReminderStage(7), "overdue_day_7");
  assert.equal(selectReminderStage(13), "overdue_day_7");
  assert.equal(selectReminderStage(14), "overdue_day_14");
});

test("deterministic idempotency key", () => {
  assert.equal(
    createReminderIdempotencyKey("11111111-1111-4111-8111-111111111111", "overdue_day_14"),
    "invoice:11111111-1111-4111-8111-111111111111:stage:overdue_day_14",
  );
});

test("dry-run creates no DB rows", () => {
  const report = buildSingle();

  assert.equal(report.mode, "dry_run");
  assert.equal(report.inserted_count, 0);
  assert.equal(report.pending_rows.length, 1);
});

test("settings default disabled safety state", () => {
  assert.equal(DEFAULT_INVOICE_REMINDER_SETTINGS.enabled, false);
  assert.equal(DEFAULT_INVOICE_REMINDER_SETTINGS.dry_run, true);
  assert.equal(DEFAULT_INVOICE_REMINDER_SETTINGS.manual_approval_required, true);
  assert.equal(DEFAULT_INVOICE_REMINDER_SETTINGS.pause_all, true);
  assert.equal(DEFAULT_INVOICE_REMINDER_SETTINGS.provider, "whatsapp-web");
});

test("missing launch date rejects pending queue creation", () => {
  assert.throws(
    () =>
      assertReminderSettingsAllowQueueCreation({
        ...DEFAULT_INVOICE_REMINDER_SETTINGS,
        enabled: true,
        dry_run: false,
        pause_all: false,
        automation_launch_date: null,
      }),
    /Automation launch date/,
  );
});

test("pause_all blocks pending queue creation but pure dry-run can still report", () => {
  assert.throws(
    () =>
      assertReminderSettingsAllowQueueCreation({
        ...DEFAULT_INVOICE_REMINDER_SETTINGS,
        enabled: true,
        dry_run: false,
        pause_all: true,
        automation_launch_date: "2026-07-01",
      }),
    /paused/,
  );

  const report = buildSingle();
  assert.equal(report.mode, "dry_run");
  assert.equal(report.inserted_count, 0);
});

test("staff cannot modify reminder settings", () => {
  assert.equal(canModifyInvoiceReminderSettings(["staff"]), false);
  assert.equal(canModifyInvoiceReminderSettings(["staff", "admin"]), true);
});
