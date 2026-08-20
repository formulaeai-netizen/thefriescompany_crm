import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { loadWorkerConfig } from "./config.js";
import { MetaCloudProvider } from "./providers/meta-cloud.provider.js";
import { assertRealSendAllowed, type WhatsAppProvider } from "./providers/whatsapp-provider.js";
import { WhatsAppWebProvider } from "./providers/whatsapp-web.provider.js";
import {
  buildEligibleReminderRows,
  calculateOutstandingAmount,
  startQueueProcessor,
} from "./services/queue-processor.js";

function withEnv<T>(env: NodeJS.ProcessEnv, fn: () => T): T {
  const previous = { ...process.env };
  process.env = { ...previous, ...env };
  try {
    return fn();
  } finally {
    process.env = previous;
  }
}

test("sending is blocked by default", () => {
  assert.throws(() => assertRealSendAllowed(false), /Real WhatsApp sending is blocked/);
});

test("invalid config is rejected", () => {
  withEnv(
    {
      SUPABASE_URL: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
      WHATSAPP_PROVIDER: "whatsapp-web",
    },
    () => {
      assert.throws(() => loadWorkerConfig(), /SUPABASE_URL is required/);
    },
  );
});

test("Meta provider remains disabled", async () => {
  const provider = new MetaCloudProvider(false);
  assert.equal(provider.getStatus().provider, "meta-cloud");
  await assert.rejects(() => provider.initialize(), /not configured/);
  await assert.rejects(
    () => provider.sendMessage({ to: "923001234567", body: "test" }),
    /Real WhatsApp sending is blocked/,
  );
});

test("provider selection config accepts whatsapp-web", () => {
  const config = withEnv(
    {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "placeholder-service-role-key",
      WHATSAPP_PROVIDER: "whatsapp-web",
      WHATSAPP_AUTOMATION_ENABLED: "false",
      WHATSAPP_DRY_RUN: "true",
      WHATSAPP_ALLOW_REAL_SEND: "false",
    },
    () => loadWorkerConfig(),
  );

  assert.equal(config.provider, "whatsapp-web");
  assert.equal(config.automationEnabled, false);
  assert.equal(config.dryRun, true);
  assert.equal(config.allowRealSend, false);
});

test("provider selection config accepts meta-cloud", () => {
  const config = withEnv(
    {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "placeholder-service-role-key",
      WHATSAPP_PROVIDER: "meta-cloud",
    },
    () => loadWorkerConfig(),
  );

  assert.equal(config.provider, "meta-cloud");
});

test("queue processing does not start automatically", async () => {
  const provider: WhatsAppProvider = {
    async initialize() {},
    async disconnect() {},
    getStatus() {
      return {
        provider: "test",
        connected: false,
        qrRequired: false,
        lastHeartbeat: null,
        lastConnectedAt: null,
        lastError: null,
      };
    },
    async sendMessage() {
      throw new Error("should not send");
    },
  };
  const report = await startQueueProcessor({} as never, provider, {
    supabaseUrl: "https://example.supabase.co",
    supabaseServiceRoleKey: "placeholder",
    provider: "whatsapp-web",
    automationEnabled: false,
    dryRun: true,
    allowRealSend: false,
    webPushEnabled: false,
    webPushDryRun: true,
    webPushVapidPublicKey: null,
    webPushVapidPrivateKey: null,
    webPushSubject: null,
    messageDelayMs: 0,
    maxSendRetries: 2,
    sessionPath: ".worker-data/whatsapp-session",
  });

  assert.equal(report.reason, "env_automation_disabled");
  assert.equal(report.scanCount, 0);
  assert.equal(report.sentCount, 0);
});

test("awaiting-receiving invoices are excluded from worker reminder scans", () => {
  assert.equal(
    calculateOutstandingAmount({
      amount: 1000,
      amount_received: 0,
      payment_status: "Not Done",
      receiving_status: "awaiting_receiving",
    }),
    0,
  );

  const result = buildEligibleReminderRows(
    [
      {
        id: "invoice-1",
        invoice_no: "TFC-1",
        client_id: "client-1",
        date: "2026-08-01",
        delivery_date: "2026-08-01",
        due_date: "2026-08-05",
        amount: 1000,
        amount_received: 0,
        payment_status: "Not Done",
        receiving_status: "awaiting_receiving",
        is_deleted: false,
        clients: {
          id: "client-1",
          legal_name: "Test Client",
          phone: "03001234567",
          phone_normalized: null,
          whatsapp_opt_out: false,
          reminders_paused: false,
        },
      },
    ],
    [],
    {
      enabled: true,
      dry_run: false,
      manual_approval_required: true,
      pause_all: false,
      provider: "whatsapp-web",
      automation_launch_date: "2026-08-01",
      timezone: "Asia/Karachi",
      first_reminder_after_days: 1,
      repeat_interval_days: 3,
      maximum_reminders: 4,
      maximum_daily_messages: 20,
    },
    new Date("2026-08-10T00:00:00.000Z"),
  );

  assert.equal(result.rows.length, 0);
  assert.equal(result.skippedCount, 1);
});

class FakeWhatsAppClient extends EventEmitter {
  public sendCalls = 0;
  public sendResult: any = { id: { _serialized: "direct-provider-id" } };
  public sendHook: (() => void) | null = null;

  async getNumberId(_recipient: string) {
    return { _serialized: "923212558027@c.us" };
  }

  async sendMessage(_chatId: string, _body: string) {
    this.sendCalls++;
    this.sendHook?.();
    return this.sendResult;
  }
}

function createReadyWebProvider(client: FakeWhatsAppClient, timeoutMs = 500) {
  const provider = new WhatsAppWebProvider({
    sessionPath: ".worker-data/test-session",
    allowRealSend: true,
    eventConfirmationTimeoutMs: timeoutMs,
  });

  (provider as any).client = client;
  (provider as any).connected = true;
  return provider;
}

test("WhatsAppWebProvider returns direct provider id when sendMessage returns one", async () => {
  const client = new FakeWhatsAppClient();
  client.sendResult = { id: { _serialized: "direct-provider-id" } };
  const provider = createReadyWebProvider(client);

  const result = await provider.sendMessage({ to: "923212558027", body: "hello" });

  assert.equal(result.providerMessageId, "direct-provider-id");
  assert.equal(client.sendCalls, 1);
  assert.equal(client.listenerCount("message_create"), 0);
  assert.equal(client.listenerCount("message_ack"), 0);
});

test("WhatsAppWebProvider succeeds from matching event when direct return is empty", async () => {
  const client = new FakeWhatsAppClient();
  client.sendResult = undefined;
  client.sendHook = () => {
    setImmediate(() => {
      client.emit("message_create", {
        fromMe: true,
        to: "923212558027@c.us",
        body: "hello",
        id: { id: "event-provider-id" },
      });
    });
  };
  const provider = createReadyWebProvider(client);

  const result = await provider.sendMessage({ to: "923212558027", body: "hello" });

  assert.equal(result.providerMessageId, "event-provider-id");
  assert.equal(client.sendCalls, 1);
  assert.equal(client.listenerCount("message_create"), 0);
  assert.equal(client.listenerCount("message_ack"), 0);
});

test("WhatsAppWebProvider fails on event confirmation timeout", async () => {
  const client = new FakeWhatsAppClient();
  client.sendResult = undefined;
  const provider = createReadyWebProvider(client, 5);

  await assert.rejects(
    () => provider.sendMessage({ to: "923212558027", body: "hello" }),
    /timed out/,
  );

  assert.equal(client.sendCalls, 1);
  assert.equal(client.listenerCount("message_create"), 0);
  assert.equal(client.listenerCount("message_ack"), 0);
});

test("WhatsAppWebProvider removes per-send listeners across duplicate sends", async () => {
  const client = new FakeWhatsAppClient();
  client.sendResult = { _data: { id: { _serialized: "data-provider-id" } } };
  const provider = createReadyWebProvider(client);

  await provider.sendMessage({ to: "923212558027", body: "first" });
  await provider.sendMessage({ to: "923212558027", body: "second" });

  assert.equal(client.sendCalls, 2);
  assert.equal(client.listenerCount("message_create"), 0);
  assert.equal(client.listenerCount("message_ack"), 0);
});
