import assert from "node:assert/strict";
import test from "node:test";
import type { WhatsAppProvider, WhatsAppProviderStatus } from "./providers/whatsapp-provider.js";
import {
  isCreditPurchaseReminderDue,
  runCreditPurchaseDispatchWorkflow,
  type CreditPurchaseDispatchRepository,
  type CreditPurchaseRow,
} from "./services/credit-purchase-dispatch.js";
import { buildCreditPurchaseReminderMessage } from "./services/message-builder.js";

const now = new Date("2026-08-04T12:00:00.000Z");

const duePurchase: CreditPurchaseRow = {
  id: "purchase-1",
  supplier_name: "ABC Traders",
  item_name_snapshot: "Cooking Oil 10L",
  amount_due: 5000,
  due_at: "2026-08-04T13:00:00.000Z",
  status: "unpaid",
  reminder_lead_hours: 24,
  reminder_queued_at: null,
  reminder_sent_at: null,
};

class MemoryRepository implements CreditPurchaseDispatchRepository {
  public sent: string[] = [];
  public unclaimed: string[] = [];
  public claimCalls = 0;

  constructor(
    public recipient: string | null = "923213334444",
    public purchases: CreditPurchaseRow[] = [duePurchase],
  ) {}

  async loadRoutingRecipient() {
    return this.recipient;
  }

  async previewDuePurchases(at: Date = now) {
    return this.purchases.filter((p) => isCreditPurchaseReminderDue(p, at));
  }

  async claimDuePurchases() {
    this.claimCalls++;
    const due = this.purchases.filter((p) => isCreditPurchaseReminderDue(p, now));
    this.purchases = this.purchases.map((p) =>
      due.includes(p) ? { ...p, reminder_queued_at: now.toISOString() } : p,
    );
    return due;
  }

  async markReminderSent(id: string) {
    this.sent.push(id);
    this.purchases = this.purchases.map((p) =>
      p.id === id ? { ...p, reminder_sent_at: now.toISOString() } : p,
    );
  }

  async unclaimReminder(id: string) {
    this.unclaimed.push(id);
    this.purchases = this.purchases.map((p) =>
      p.id === id ? { ...p, reminder_queued_at: null } : p,
    );
  }
}

class FakeProvider implements WhatsAppProvider {
  public sendCalls = 0;
  public lastTo: string | null = null;

  constructor(
    private connected = true,
    private shouldFail = false,
  ) {}

  async initialize() {}
  async disconnect() {}

  getStatus(): WhatsAppProviderStatus {
    return {
      provider: "fake",
      connected: this.connected,
      qrRequired: false,
      lastHeartbeat: null,
      lastConnectedAt: null,
      lastError: null,
    };
  }

  async sendMessage(message: { to: string; body: string }) {
    this.sendCalls++;
    this.lastTo = message.to;
    if (this.shouldFail) throw new Error("simulated send failure");
    return { providerMessageId: `provider-${this.sendCalls}`, dryRun: false };
  }
}

const config = { maxSendRetries: 1 };

test("eligible unpaid purchase due within lead-hours is claimed and sent", async () => {
  const repo = new MemoryRepository();
  const provider = new FakeProvider(true);
  const report = await runCreditPurchaseDispatchWorkflow({
    repository: repo,
    provider,
    config,
    mode: "live",
    now,
  });

  assert.equal(report.sentCount, 1);
  assert.equal(provider.lastTo, "923213334444");
  assert.deepEqual(repo.sent, ["purchase-1"]);
});

test("paid purchase is skipped (never eligible regardless of due date)", () => {
  assert.equal(isCreditPurchaseReminderDue({ ...duePurchase, status: "paid" }, now), false);
});

test("cancelled purchase is skipped", () => {
  assert.equal(isCreditPurchaseReminderDue({ ...duePurchase, status: "cancelled" }, now), false);
});

test("dry mode never claims or sends - it only previews", async () => {
  const repo = new MemoryRepository();
  const provider = new FakeProvider(true);
  const report = await runCreditPurchaseDispatchWorkflow({
    repository: repo,
    provider,
    config,
    mode: "dry",
    now,
  });

  assert.equal(report.reason, "dry_run_only");
  assert.equal(report.scanCount, 1);
  assert.equal(repo.claimCalls, 0);
  assert.equal(provider.sendCalls, 0);
});

test("configured credit_purchase_reminders coordinator recipient is used, not a hardcoded number", async () => {
  const repo = new MemoryRepository("923219998888");
  const provider = new FakeProvider(true);
  await runCreditPurchaseDispatchWorkflow({
    repository: repo,
    provider,
    config,
    mode: "live",
    now,
  });
  assert.equal(provider.lastTo, "923219998888");
});

test("missing recipient fails safely - no claim, no send", async () => {
  const repo = new MemoryRepository(null);
  const provider = new FakeProvider(true);
  const report = await runCreditPurchaseDispatchWorkflow({
    repository: repo,
    provider,
    config,
    mode: "live",
    now,
  });

  assert.equal(report.reason, "recipient_not_configured");
  assert.equal(repo.claimCalls, 0);
  assert.equal(provider.sendCalls, 0);
});

test("duplicate reminder is prevented - an already-queued purchase is never claimed again", async () => {
  const alreadyQueued = { ...duePurchase, reminder_queued_at: now.toISOString() };
  const repo = new MemoryRepository("923213334444", [alreadyQueued]);
  const provider = new FakeProvider(true);
  const report = await runCreditPurchaseDispatchWorkflow({
    repository: repo,
    provider,
    config,
    mode: "live",
    now,
  });

  assert.equal(report.reason, "no_pending_reminders");
  assert.equal(provider.sendCalls, 0);
});

test("failed send remains retryable - reminder_queued_at is reset instead of being stuck forever", async () => {
  const repo = new MemoryRepository();
  const provider = new FakeProvider(true, true);
  const report = await runCreditPurchaseDispatchWorkflow({
    repository: repo,
    provider,
    config,
    mode: "live",
    now,
  });

  assert.equal(report.failedCount, 1);
  assert.equal(report.sentCount, 0);
  assert.deepEqual(repo.unclaimed, ["purchase-1"]);
  assert.equal(repo.purchases[0].reminder_queued_at, null);
});

test("disconnected provider blocks a live send without claiming", async () => {
  const repo = new MemoryRepository();
  const provider = new FakeProvider(false);
  const report = await runCreditPurchaseDispatchWorkflow({
    repository: repo,
    provider,
    config,
    mode: "live",
    now,
  });

  assert.equal(report.reason, "whatsapp_disconnected");
  assert.equal(repo.claimCalls, 0);
});

test("buildCreditPurchaseReminderMessage contains product, supplier, amount, due date and reference", () => {
  const body = buildCreditPurchaseReminderMessage({
    itemName: "Cooking Oil 10L",
    supplierName: "ABC Traders",
    amountDue: 5000,
    dueAt: "2026-08-04T13:00:00.000Z",
    reference: "purchase-1",
  });
  assert.match(body, /Credit Payment Due/);
  assert.match(body, /Cooking Oil 10L/);
  assert.match(body, /ABC Traders/);
  assert.match(body, /Rs\. 5,000/);
  assert.match(body, /purchase-1/);
});
