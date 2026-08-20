import assert from "node:assert/strict";
import test from "node:test";
import {
  dispatchPendingPushNotifications,
  shouldDispatchPush,
} from "./services/push-notification-dispatch.js";
import type { WorkerConfig } from "./config.js";

function baseConfig(overrides: Partial<WorkerConfig> = {}): WorkerConfig {
  return {
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
    operationsBriefEnabled: false,
    operationsBriefMorningCron: "0 9 * * *",
    operationsBriefEveningCron: "0 20 * * *",
    aiWatchdogSchedulerEnabled: false,
    sessionPath: ".worker-data/test-session",
    messageDelayMs: 0,
    maxSendRetries: 2,
    ...overrides,
  };
}

test("PWA push worker is disabled by default and does not query Supabase", async () => {
  const report = await dispatchPendingPushNotifications({} as never, baseConfig());
  assert.equal(report.reason, "disabled");
  assert.equal(report.scanCount, 0);
});

test("PWA push preference gating requires enabled, granted permission and severity threshold", () => {
  const notification = { category: "financial_alerts" as const, severity: "Medium" as const };
  assert.equal(
    shouldDispatchPush(notification, {
      push_enabled: true,
      permission_state: "granted",
      critical_alerts: true,
      operational_alerts: true,
      financial_alerts: true,
      invoice_alerts: true,
      inventory_alerts: true,
      payroll_alerts: true,
      investor_alerts: false,
      system_alerts: true,
      min_push_severity: "High",
    }),
    false,
  );
});
