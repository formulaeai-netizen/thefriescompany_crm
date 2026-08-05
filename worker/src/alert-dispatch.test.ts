import assert from "node:assert/strict";
import test from "node:test";
import type { WhatsAppProvider, WhatsAppProviderStatus } from "./providers/whatsapp-provider.js";
import {
  maskPhoneForLog,
  runAlertDispatchWorkflow,
  selectAlertsPendingNotification,
  type AlertDispatchRepository,
  type AlertDispatchSettings,
  type OperationalAlertRow,
} from "./services/alert-dispatch.js";
import {
  buildOperationalAlertMessage,
  buildStockAuditAlertMessage,
} from "./services/message-builder.js";
import type { WhatsAppRoutingFlowKey } from "./services/whatsapp-routing.js";

const baseSettings: AlertDispatchSettings = {
  enabled: true,
  dry_run: false,
};

const wastageAlert: OperationalAlertRow = {
  id: "alert-1",
  alert_type: "wastage_over_threshold",
  source_type: "wastage_verification",
  source_id: "verification-1",
  severity: "warning",
  message: "Actual wastage 70% exceeds the expected 60% + 5 point tolerance (threshold 65%)",
  expected_value: 65,
  actual_value: 70,
  variance_value: 5,
  unit: "%",
  status: "open",
  created_at: "2026-07-31T12:00:00.000Z",
  whatsapp_notified_at: null,
};

const stockVarianceAlert: OperationalAlertRow = {
  id: "alert-2",
  alert_type: "stock_variance",
  source_type: "stock_audit_item",
  source_id: "item-1",
  severity: "warning",
  message: "Physical stock variance detected for Flour 25kg during monthly audit",
  expected_value: 100,
  actual_value: 95,
  variance_value: -5,
  unit: "kg",
  status: "open",
  created_at: "2026-07-31T12:00:00.000Z",
  whatsapp_notified_at: null,
};

class MemoryRepository implements AlertDispatchRepository {
  public notified: string[] = [];
  public routingNumbers: Partial<Record<WhatsAppRoutingFlowKey, string | null>> = {
    wastage_alerts: "923212558027",
    stock_audit_alerts: "923211112222",
    credit_purchase_reminders: "923213334444",
  };

  constructor(
    public settings: AlertDispatchSettings = baseSettings,
    public alerts: OperationalAlertRow[] = [wastageAlert],
  ) {}

  async loadSettings() {
    return this.settings;
  }

  async listUndeliveredOpenAlerts() {
    return this.alerts;
  }

  async resolveRecipientForFlowKey(flowKey: WhatsAppRoutingFlowKey) {
    return this.routingNumbers[flowKey] ?? null;
  }

  async markNotified(id: string) {
    this.notified.push(id);
    this.alerts = this.alerts.map((a) =>
      a.id === id ? { ...a, whatsapp_notified_at: new Date().toISOString() } : a,
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
      lastConnectedAt: this.connected ? "2026-07-31T00:00:00.000Z" : null,
      lastError: this.connected ? null : "disconnected",
    };
  }

  async sendMessage(message: { to: string; body: string }) {
    this.sendCalls++;
    this.lastTo = message.to;
    if (this.shouldFail) throw new Error("simulated send failure");
    return { providerMessageId: `provider-${this.sendCalls}`, dryRun: false };
  }
}

const config = { maxSendRetries: 2 };

test("selectAlertsPendingNotification filters to open + not-yet-notified", () => {
  const rows: OperationalAlertRow[] = [
    wastageAlert,
    { ...wastageAlert, id: "alert-3", status: "resolved" },
    { ...wastageAlert, id: "alert-4", whatsapp_notified_at: "2026-07-31T00:00:00.000Z" },
  ];
  const eligible = selectAlertsPendingNotification(rows);
  assert.deepEqual(
    eligible.map((r) => r.id),
    ["alert-1"],
  );
});

test("dispatch never sends when settings are disabled", async () => {
  const repo = new MemoryRepository({ ...baseSettings, enabled: false });
  const provider = new FakeProvider();
  const report = await runAlertDispatchWorkflow({
    repository: repo,
    provider,
    config,
    mode: "live",
  });
  assert.equal(report.reason, "settings_disabled");
  assert.equal(provider.sendCalls, 0);
});

test("dry mode never sends, even when settings.enabled and settings.dry_run=false", async () => {
  const repo = new MemoryRepository();
  const provider = new FakeProvider();
  const report = await runAlertDispatchWorkflow({
    repository: repo,
    provider,
    config,
    mode: "dry",
  });
  assert.equal(report.reason, "dry_run_only");
  assert.equal(provider.sendCalls, 0);
  assert.equal(repo.notified.length, 0);
});

test("settings.dry_run=true blocks sending even in live mode", async () => {
  const repo = new MemoryRepository({ ...baseSettings, dry_run: true });
  const provider = new FakeProvider();
  const report = await runAlertDispatchWorkflow({
    repository: repo,
    provider,
    config,
    mode: "live",
  });
  assert.equal(report.reason, "dry_run_only");
  assert.equal(provider.sendCalls, 0);
});

test("no pending alerts reports no_pending_alerts and never calls the provider", async () => {
  const repo = new MemoryRepository(baseSettings, []);
  const provider = new FakeProvider();
  const report = await runAlertDispatchWorkflow({
    repository: repo,
    provider,
    config,
    mode: "live",
  });
  assert.equal(report.reason, "no_pending_alerts");
  assert.equal(provider.sendCalls, 0);
});

test("disconnected provider blocks a live send", async () => {
  const repo = new MemoryRepository();
  const provider = new FakeProvider(false);
  const report = await runAlertDispatchWorkflow({
    repository: repo,
    provider,
    config,
    mode: "live",
  });
  assert.equal(report.reason, "whatsapp_disconnected");
  assert.equal(provider.sendCalls, 0);
});

test("wastage alert routes to the wastage_alerts recipient", async () => {
  const repo = new MemoryRepository(baseSettings, [wastageAlert]);
  const provider = new FakeProvider(true);
  const report = await runAlertDispatchWorkflow({
    repository: repo,
    provider,
    config,
    mode: "live",
  });
  assert.equal(report.sentCount, 1);
  assert.equal(provider.lastTo, "923212558027");
  assert.deepEqual(repo.notified, ["alert-1"]);
});

test("stock variance alert routes to the stock_audit_alerts recipient, separate from wastage_alerts", async () => {
  const repo = new MemoryRepository(baseSettings, [stockVarianceAlert]);
  const provider = new FakeProvider(true);
  const report = await runAlertDispatchWorkflow({
    repository: repo,
    provider,
    config,
    mode: "live",
  });
  assert.equal(report.sentCount, 1);
  assert.equal(provider.lastTo, "923211112222");
  assert.notEqual(provider.lastTo, repo.routingNumbers.wastage_alerts);
});

test("an alert with no configured routing number for its flow fails safely: no send, no crash, no notified stamp", async () => {
  const repo = new MemoryRepository(baseSettings, [stockVarianceAlert]);
  repo.routingNumbers.stock_audit_alerts = null;
  const provider = new FakeProvider(true);
  const report = await runAlertDispatchWorkflow({
    repository: repo,
    provider,
    config,
    mode: "live",
  });

  assert.equal(report.routingFailedCount, 1);
  assert.equal(report.sentCount, 0);
  assert.equal(provider.sendCalls, 0);
  assert.equal(repo.notified.length, 0);
});

test("a routing failure for one alert does not block other eligible alerts in the same run", async () => {
  const repo = new MemoryRepository(baseSettings, [wastageAlert, stockVarianceAlert]);
  repo.routingNumbers.stock_audit_alerts = null;
  const provider = new FakeProvider(true);
  const report = await runAlertDispatchWorkflow({
    repository: repo,
    provider,
    config,
    mode: "live",
  });

  assert.equal(report.sentCount, 1);
  assert.equal(report.routingFailedCount, 1);
  assert.deepEqual(repo.notified, ["alert-1"]);
});

test("an already-notified alert is never sent again (duplicate guard)", async () => {
  const alreadyNotified: OperationalAlertRow = {
    ...wastageAlert,
    whatsapp_notified_at: "2026-07-31T00:00:00.000Z",
  };
  const repo = new MemoryRepository(baseSettings, [alreadyNotified]);
  const provider = new FakeProvider();
  const report = await runAlertDispatchWorkflow({
    repository: repo,
    provider,
    config,
    mode: "live",
  });
  assert.equal(report.scanCount, 0);
  assert.equal(provider.sendCalls, 0);
});

test("a send failure does not mark the alert notified, so it stays eligible for retry", async () => {
  const repo = new MemoryRepository();
  const provider = new FakeProvider(true, true);
  const report = await runAlertDispatchWorkflow({
    repository: repo,
    provider,
    config,
    mode: "live",
  });
  assert.equal(report.failedCount, 1);
  assert.equal(report.sentCount, 0);
  assert.equal(repo.notified.length, 0);
});

test("maskPhoneForLog never exposes the full number", () => {
  const masked = maskPhoneForLog("923212558027");
  assert.doesNotMatch(masked, /212558/);
  assert.equal(maskPhoneForLog(null), "(none)");
});

test("buildOperationalAlertMessage includes expected/actual/variance and a batch reference", () => {
  const body = buildOperationalAlertMessage({
    alertType: "wastage_over_threshold",
    severity: "warning",
    message: "Actual wastage 70% exceeds the expected 60% + 5 point tolerance (threshold 65%)",
    sourceType: "wastage_verification",
    sourceId: "verification-1",
    expectedValue: 65,
    actualValue: 70,
    varianceValue: 5,
    unit: "%",
    createdAt: "2026-07-31T12:00:00.000Z",
  });
  assert.match(body, /wastage_over_threshold/);
  assert.match(body, /65%/);
  assert.match(body, /70%/);
  assert.match(body, /verification-1/);
});

test("buildStockAuditAlertMessage includes audit-specific fields", () => {
  const body = buildStockAuditAlertMessage({
    alertType: "stock_variance",
    severity: "warning",
    message: "Physical stock variance detected for Flour 25kg during monthly audit",
    sourceType: "stock_audit_item",
    sourceId: "item-1",
    expectedValue: 100,
    actualValue: 95,
    varianceValue: -5,
    unit: "kg",
    createdAt: "2026-07-31T12:00:00.000Z",
  });
  assert.match(body, /Stock Audit Alert/);
  assert.match(body, /Flour 25kg/);
  assert.match(body, /System quantity: 100kg/);
  assert.match(body, /Physical\/Reconciled quantity: 95kg/);
  assert.match(body, /Difference: -5kg/);
  assert.match(body, /stock_audit_item item-1/);
});
