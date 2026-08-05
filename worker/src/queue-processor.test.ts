import assert from "node:assert/strict";
import test from "node:test";
import type { WhatsAppProvider, WhatsAppProviderStatus } from "./providers/whatsapp-provider.js";
import {
  runReminderWorkflow,
  type InvoiceReminderSettings,
  type ReminderInsert,
  type ReminderInvoice,
  type ReminderRepository,
  type SendableReminder,
} from "./services/queue-processor.js";

const baseSettings: InvoiceReminderSettings = {
  enabled: true,
  dry_run: false,
  manual_approval_required: false,
  pause_all: false,
  provider: "whatsapp-web",
  automation_launch_date: "2026-07-30",
  timezone: "Asia/Karachi",
  first_reminder_after_days: 1,
  repeat_interval_days: 3,
  maximum_reminders: 4,
  maximum_daily_messages: 20,
};

const baseInvoice: ReminderInvoice = {
  id: "invoice-1",
  invoice_no: "TFC-TEST-001",
  client_id: "client-1",
  date: "2026-07-30",
  delivery_date: "2026-07-30",
  due_date: "2026-07-29",
  amount: 1000,
  amount_received: 0,
  payment_status: "Not Done",
  is_deleted: false,
  clients: {
    id: "client-1",
    legal_name: "testing_dev",
    phone: "03212558027",
    phone_normalized: "923212558027",
    whatsapp_opt_out: false,
    reminders_paused: false,
  },
};

class MemoryRepository implements ReminderRepository {
  public reminders: SendableReminder[] = [];
  public failed: string[] = [];
  public skipped: string[] = [];
  public sent: string[] = [];
  public duplicateKeys = new Set<string>();

  constructor(
    public settings: InvoiceReminderSettings = baseSettings,
    public invoices: ReminderInvoice[] = [baseInvoice],
  ) {}

  async loadSettings() {
    return this.settings;
  }

  async listInvoices() {
    return this.invoices;
  }

  async listExistingReminders() {
    return this.reminders.map((row) => ({
      id: row.id,
      invoice_id: row.invoice_id,
      reminder_stage: row.reminder_stage,
      idempotency_key: row.idempotency_key,
      status: row.status,
    }));
  }

  async insertReminder(row: ReminderInsert) {
    if (this.duplicateKeys.has(row.idempotency_key)) return "duplicate" as const;
    this.duplicateKeys.add(row.idempotency_key);
    const invoice = this.invoices.find((item) => item.id === row.invoice_id) ?? null;
    this.reminders.push({
      ...row,
      id: `reminder-${this.reminders.length + 1}`,
      status: row.status,
      invoices: invoice,
      clients: invoice?.clients ?? null,
    } as SendableReminder);
    return "inserted" as const;
  }

  async listSendableReminders(limit: number, includePending: boolean) {
    const statuses = includePending ? ["pending", "approved"] : ["approved"];
    return this.reminders.filter((row) => statuses.includes(row.status)).slice(0, limit);
  }

  async markApproved(id: string) {
    this.find(id).status = "approved";
  }

  async markProcessing(id: string) {
    this.find(id).status = "processing";
  }

  async markSent(id: string, providerMessageId: string) {
    const row = this.find(id);
    row.status = "sent";
    (row as any).provider_message_id = providerMessageId;
    this.sent.push(id);
  }

  async markFailed(id: string, code: string) {
    this.find(id).status = "failed";
    this.failed.push(code);
  }

  async markSkipped(id: string, code: string) {
    this.find(id).status = "skipped";
    this.skipped.push(code);
  }

  private find(id: string) {
    const row = this.reminders.find((reminder) => reminder.id === id);
    if (!row) throw new Error(`Missing reminder ${id}`);
    return row;
  }
}

class FakeProvider implements WhatsAppProvider {
  public sendCalls = 0;

  constructor(
    private connected = true,
    private failuresBeforeSuccess = 0,
  ) {}

  async initialize() {}
  async disconnect() {}

  getStatus(): WhatsAppProviderStatus {
    return {
      provider: "fake",
      connected: this.connected,
      qrRequired: false,
      lastHeartbeat: null,
      lastConnectedAt: this.connected ? "2026-07-30T00:00:00.000Z" : null,
      lastError: this.connected ? null : "disconnected",
    };
  }

  async sendMessage() {
    this.sendCalls++;
    if (this.sendCalls <= this.failuresBeforeSuccess) throw new Error("temporary send failure");
    return { providerMessageId: `provider-${this.sendCalls}`, dryRun: false };
  }
}

const config = { messageDelayMs: 0, maxSendRetries: 2 };

test("workflow stops when settings are disabled", async () => {
  const repo = new MemoryRepository({ ...baseSettings, enabled: false });
  const provider = new FakeProvider();
  const report = await runReminderWorkflow({ repository: repo, provider, config, mode: "live" });

  assert.equal(report.reason, "settings_disabled");
  assert.equal(report.scanCount, 0);
  assert.equal(provider.sendCalls, 0);
});

test("workflow stops when pause_all is enabled", async () => {
  const repo = new MemoryRepository({ ...baseSettings, pause_all: true });
  const provider = new FakeProvider();
  const report = await runReminderWorkflow({ repository: repo, provider, config, mode: "live" });

  assert.equal(report.reason, "pause_all_enabled");
  assert.equal(provider.sendCalls, 0);
});

test("paid-after-queue reminders are skipped before send", async () => {
  const invoice = { ...baseInvoice, payment_status: "Done" };
  const repo = new MemoryRepository(baseSettings, [invoice]);
  await repo.insertReminder({
    invoice_id: invoice.id,
    client_id: "client-1",
    due_date_snapshot: "2026-07-29",
    outstanding_amount_snapshot: 1000,
    recipient_phone: "03212558027",
    normalized_recipient_phone: "923212558027",
    provider: "whatsapp-web",
    channel: "whatsapp",
    reminder_stage: "overdue_day_1",
    status: "approved",
    idempotency_key: "invoice:invoice-1:stage:overdue_day_1",
    scheduled_for: "2026-07-30T00:00:00.000Z",
  });
  const provider = new FakeProvider();

  const report = await runReminderWorkflow({ repository: repo, provider, config, mode: "live" });

  assert.equal(provider.sendCalls, 0);
  assert.equal(report.skippedCount, 2);
  assert.deepEqual(repo.skipped, ["invoice_paid_after_queue"]);
});

test("duplicate prevention blocks duplicate queue rows after restart", async () => {
  const repo = new MemoryRepository();
  const provider = new FakeProvider();

  await runReminderWorkflow({ repository: repo, provider, config, mode: "live" });
  await runReminderWorkflow({ repository: repo, provider, config, mode: "live" });

  assert.equal(repo.reminders.length, 1);
  assert.equal(repo.sent.length, 1);
});

test("maximum daily cap limits sends", async () => {
  const invoices = Array.from({ length: 3 }, (_, index) => ({
    ...baseInvoice,
    id: `invoice-${index + 1}`,
    invoice_no: `TFC-TEST-${index + 1}`,
  }));
  const repo = new MemoryRepository({ ...baseSettings, maximum_daily_messages: 2 }, invoices);
  const provider = new FakeProvider();

  const report = await runReminderWorkflow({ repository: repo, provider, config, mode: "live" });

  assert.equal(report.queuedCount, 3);
  assert.equal(report.sentCount, 2);
  assert.equal(provider.sendCalls, 2);
});

test("disconnected worker queues but does not send", async () => {
  const repo = new MemoryRepository();
  const provider = new FakeProvider(false);
  const report = await runReminderWorkflow({ repository: repo, provider, config, mode: "live" });

  assert.equal(report.reason, "whatsapp_disconnected");
  assert.equal(report.queuedCount, 1);
  assert.equal(report.sentCount, 0);
  assert.equal(provider.sendCalls, 0);
});

test("successful provider-confirmed send marks sent", async () => {
  const repo = new MemoryRepository();
  const provider = new FakeProvider();
  const report = await runReminderWorkflow({ repository: repo, provider, config, mode: "live" });

  assert.equal(report.sentCount, 1);
  assert.equal(repo.reminders[0].status, "sent");
  assert.equal((repo.reminders[0] as any).provider_message_id, "provider-1");
});

test("retry limit marks send failure after configured attempts", async () => {
  const repo = new MemoryRepository();
  const provider = new FakeProvider(true, 2);
  const report = await runReminderWorkflow({ repository: repo, provider, config, mode: "live" });

  assert.equal(provider.sendCalls, 2);
  assert.equal(report.failedCount, 1);
  assert.equal(repo.reminders[0].status, "failed");
  assert.deepEqual(repo.failed, ["whatsapp_send_failed"]);
});
