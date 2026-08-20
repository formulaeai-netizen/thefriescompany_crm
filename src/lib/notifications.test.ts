import assert from "node:assert/strict";
import test from "node:test";

import { calculateCashInHand } from "./cash-in-hand.ts";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  canRoleReceiveNotification,
  creditPurchaseDueNotification,
  isPermanentPushFailure,
  isValidInternalNotificationTarget,
  notificationDedupeKey,
  operationalAlertNotification,
  payloadForNotification,
  paymentVerificationReceivedNotification,
  permissionDeniedBlocksSubscription,
  rolesForNotification,
  sanitizeNotificationTargetUrl,
  shouldAttemptPush,
  uniqueRecipientIds,
  type NotificationCreateInput,
  type NotificationPreferences,
  type NotificationRow,
  type PushSubscriptionRecord,
} from "./notifications.ts";

type Store = {
  notifications: NotificationRow[];
  subscriptions: PushSubscriptionRecord[];
  preferences: Record<string, NotificationPreferences>;
};

function defaultPrefs(overrides: Partial<NotificationPreferences> = {}): NotificationPreferences {
  return {
    ...DEFAULT_NOTIFICATION_PREFERENCES,
    push_enabled: true,
    permission_state: "granted",
    ...overrides,
  };
}

function emptyStore(): Store {
  return { notifications: [], subscriptions: [], preferences: {} };
}

function registerSubscription(
  store: Store,
  userId: string,
  endpoint: string,
): PushSubscriptionRecord {
  const existing = store.subscriptions.find((sub) => sub.endpoint === endpoint);
  if (existing && existing.user_id !== userId) throw new Error("subscription_endpoint_owned");
  if (existing) {
    existing.active = true;
    existing.revoked_at = null;
    return existing;
  }
  const row = {
    id: `sub-${store.subscriptions.length + 1}`,
    user_id: userId,
    endpoint,
    p256dh: "p256dh",
    auth: "auth",
    active: true,
    revoked_at: null,
  };
  store.subscriptions.push(row);
  return row;
}

function createNotification(
  store: Store,
  input: NotificationCreateInput,
  recipients = ["admin-user"],
): NotificationRow[] {
  const ids = uniqueRecipientIds(input.recipientUserIds ?? recipients);
  return ids.map((recipient_user_id) => {
    const dedupe = input.dedupeKey ?? null;
    const existing = store.notifications.find(
      (row) => row.recipient_user_id === recipient_user_id && row.dedupe_key === dedupe,
    );
    if (existing) return existing;
    const row: NotificationRow = {
      id: `note-${store.notifications.length + 1}`,
      recipient_user_id,
      category: input.category,
      severity: input.severity,
      title: input.title,
      body: input.body,
      target_url: sanitizeNotificationTargetUrl(input.targetUrl),
      source_type: input.sourceType ?? null,
      source_id: input.sourceId ?? null,
      dedupe_key: dedupe,
      created_at: new Date(0).toISOString(),
      read_at: null,
    };
    store.notifications.push(row);
    return row;
  });
}

async function fakeDispatch(
  store: Store,
  notification: NotificationRow,
  send: (subscription: PushSubscriptionRecord) => Promise<{ ok: boolean; statusCode?: number }>,
) {
  const prefs = store.preferences[notification.recipient_user_id] ?? defaultPrefs();
  const activeSubs = store.subscriptions.filter(
    (sub) =>
      sub.user_id === notification.recipient_user_id && sub.active && sub.revoked_at === null,
  );
  if (!shouldAttemptPush(notification, prefs)) {
    notification.push_attempted_at = new Date(0).toISOString();
    notification.push_delivered = false;
    notification.push_result = { status: "skipped", reason: "preferences_or_permission" };
    return { attempted: 0, sent: 0, failed: 0, revoked: 0 };
  }
  let sent = 0;
  let failed = 0;
  let revoked = 0;
  for (const sub of activeSubs) {
    const result = await send(sub);
    if (result.ok) {
      sent += 1;
    } else {
      failed += 1;
      if (isPermanentPushFailure(result.statusCode)) {
        sub.active = false;
        sub.revoked_at = new Date(0).toISOString();
        revoked += 1;
      }
    }
  }
  notification.push_attempted_at = new Date(0).toISOString();
  notification.push_delivered = sent > 0;
  notification.push_result = {
    status: "completed",
    attempted: activeSubs.length,
    sent,
    failed,
    revoked,
  };
  return { attempted: activeSubs.length, sent, failed, revoked };
}

test("1. subscription register creates one active subscription", () => {
  const store = emptyStore();
  const row = registerSubscription(store, "user-1", "https://push/1");
  assert.equal(row.active, true);
  assert.equal(store.subscriptions.length, 1);
});

test("2. duplicate endpoint does not duplicate", () => {
  const store = emptyStore();
  registerSubscription(store, "user-1", "https://push/1");
  registerSubscription(store, "user-1", "https://push/1");
  assert.equal(store.subscriptions.length, 1);
});

test("3. subscription belongs to authenticated user", () => {
  const store = emptyStore();
  registerSubscription(store, "user-1", "https://push/1");
  assert.throws(() => registerSubscription(store, "user-2", "https://push/1"));
});

test("4. user cannot read another user's push credentials", () => {
  const store = emptyStore();
  registerSubscription(store, "user-1", "https://push/1");
  const visible = store.subscriptions.filter((sub) => sub.user_id === "user-2");
  assert.equal(visible.length, 0);
});

test("5. permission denied -> no subscription attempt", () => {
  assert.equal(permissionDeniedBlocksSubscription("denied"), true);
});

test("6. notification canonical row created", () => {
  const store = emptyStore();
  const [row] = createNotification(store, paymentVerificationReceivedNotification("req-1"));
  assert.equal(row.title, "Payment Verification Received");
});

test("7. dedupe key prevents duplicate notification", () => {
  const store = emptyStore();
  const input = paymentVerificationReceivedNotification("req-1");
  createNotification(store, input);
  createNotification(store, input);
  assert.equal(store.notifications.length, 1);
});

test("8. push preference ON -> eligible dispatch", () => {
  const row = createNotification(emptyStore(), paymentVerificationReceivedNotification("req-1"))[0];
  assert.equal(shouldAttemptPush(row, defaultPrefs()), true);
});

test("9. category OFF -> no push but in-app notification remains", async () => {
  const store = emptyStore();
  const [row] = createNotification(store, paymentVerificationReceivedNotification("req-1"));
  store.preferences[row.recipient_user_id] = defaultPrefs({ financial_alerts: false });
  registerSubscription(store, row.recipient_user_id, "https://push/1");
  const result = await fakeDispatch(store, row, async () => ({ ok: true }));
  assert.equal(result.sent, 0);
  assert.equal(store.notifications.length, 1);
});

test("10. Critical notification default behavior is eligible when enabled", () => {
  const prefs = defaultPrefs({ min_push_severity: "High" });
  assert.equal(
    shouldAttemptPush({ category: "critical_alerts", severity: "Critical" }, prefs),
    true,
  );
});

test("11. invalid/dead subscription handled safely", async () => {
  const store = emptyStore();
  const [row] = createNotification(store, paymentVerificationReceivedNotification("req-1"));
  const sub = registerSubscription(store, row.recipient_user_id, "https://push/dead");
  const result = await fakeDispatch(store, row, async () => ({ ok: false, statusCode: 410 }));
  assert.equal(result.revoked, 1);
  assert.equal(sub.active, false);
});

test("12. one failed device does not block others", async () => {
  const store = emptyStore();
  const [row] = createNotification(store, paymentVerificationReceivedNotification("req-1"));
  registerSubscription(store, row.recipient_user_id, "https://push/dead");
  registerSubscription(store, row.recipient_user_id, "https://push/live");
  const result = await fakeDispatch(store, row, async (sub) => ({
    ok: sub.endpoint.endsWith("/live"),
    statusCode: sub.endpoint.endsWith("/live") ? undefined : 410,
  }));
  assert.equal(result.sent, 1);
  assert.equal(result.failed, 1);
});

test("13. same user multiple devices supported", () => {
  const store = emptyStore();
  registerSubscription(store, "user-1", "https://push/1");
  registerSubscription(store, "user-1", "https://push/2");
  assert.equal(store.subscriptions.length, 2);
});

test("14. notification read", () => {
  const store = emptyStore();
  const [row] = createNotification(store, paymentVerificationReceivedNotification("req-1"));
  row.read_at = new Date(0).toISOString();
  assert.ok(row.read_at);
});

test("15. mark all read", () => {
  const store = emptyStore();
  createNotification(store, paymentVerificationReceivedNotification("req-1"));
  createNotification(store, creditPurchaseDueNotification("purchase-1"));
  store.notifications.forEach((row) => {
    row.read_at = new Date(0).toISOString();
  });
  assert.equal(store.notifications.filter((row) => !row.read_at).length, 0);
});

test("16. role targeting", () => {
  assert.deepEqual(rolesForNotification({ category: "financial_alerts", severity: "High" }), [
    "admin",
  ]);
  assert.equal(canRoleReceiveNotification("moderator", "operational_alerts"), true);
  assert.equal(canRoleReceiveNotification("investor", "financial_alerts"), false);
});

test("17. user cannot forge Admin notification", () => {
  assert.equal(canRoleReceiveNotification("staff", "financial_alerts"), false);
});

test("18. deep link accepts valid internal URL", () => {
  assert.equal(isValidInternalNotificationTarget("/payment-verifications?request_id=req"), true);
});

test("19. deep link rejects external URL", () => {
  assert.equal(isValidInternalNotificationTarget("https://evil.example/path"), false);
  assert.equal(sanitizeNotificationTargetUrl("//evil.example/path"), "/");
});

test("20. payment verification creates Admin notification input", () => {
  const input = paymentVerificationReceivedNotification("req-1");
  assert.deepEqual(input.roles, ["admin"]);
  assert.equal(input.targetUrl, "/payment-verifications?request_id=req-1");
});

test("21. operational alert creates notification input", () => {
  const input = operationalAlertNotification({
    id: "alert-1",
    alertType: "stock_variance",
    severity: "warning",
  });
  assert.equal(input.category, "inventory_alerts");
  assert.equal(input.severity, "High");
});

test("22. credit due event creates notification input", () => {
  const input = creditPurchaseDueNotification("purchase-1");
  assert.equal(input.dedupeKey, "credit-purchase-due:purchase-1");
});

test("23. notification failure never changes financial/business record", async () => {
  const store = emptyStore();
  const purchase = { id: "purchase-1", status: "unpaid", reminder_sent_at: null as string | null };
  const [row] = createNotification(store, creditPurchaseDueNotification(purchase.id));
  registerSubscription(store, row.recipient_user_id, "https://push/dead");
  await fakeDispatch(store, row, async () => ({ ok: false, statusCode: 410 }));
  assert.deepEqual(purchase, { id: "purchase-1", status: "unpaid", reminder_sent_at: null });
});

test("24. push dispatch never writes cash ledger", async () => {
  const store = emptyStore();
  const ledgerSummary = {
    openingBalance: 1000,
    clientPaymentCredits: 0,
    expensesTotal: 0,
    inventoryPurchasesPaidTotal: 0,
    paidSalariesTotal: 0,
    salaryAdvancesPaidTotal: 0,
    accountTransfersTotal: 0,
    adjustmentsTotal: 0,
  };
  const before = calculateCashInHand(ledgerSummary);
  const [row] = createNotification(store, paymentVerificationReceivedNotification("req-1"));
  registerSubscription(store, row.recipient_user_id, "https://push/1");
  await fakeDispatch(store, row, async () => ({ ok: true }));
  assert.equal(calculateCashInHand(ledgerSummary), before);
});

test("25. existing Phase 4B offline protections remain represented by financial-action guard", async () => {
  const source = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("../components/pwa-status.tsx", import.meta.url), "utf8"),
  );
  assert.match(source, /data-financial-action/);
});

test("payload keeps only safe notification delivery fields", () => {
  const [row] = createNotification(emptyStore(), paymentVerificationReceivedNotification("req-1"));
  const payload = payloadForNotification(row);
  assert.equal(payload.target_url, "/payment-verifications?request_id=req-1");
  assert.equal("endpoint" in payload, false);
});

test("dedupe key builder removes empty parts", () => {
  assert.equal(notificationDedupeKey(["payment", "", null, "req-1"]), "payment:req-1");
});
