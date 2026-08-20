import type { SupabaseClient } from "@supabase/supabase-js";
import webPush from "web-push";
import type { WorkerConfig } from "../config.js";

export type NotificationSeverity = "Critical" | "High" | "Medium" | "Low";
export type NotificationCategory =
  | "critical_alerts"
  | "operational_alerts"
  | "financial_alerts"
  | "invoice_alerts"
  | "inventory_alerts"
  | "payroll_alerts"
  | "investor_alerts"
  | "system_alerts"
  | "ai_watchdog";

export type NotificationRow = {
  id: string;
  recipient_user_id: string;
  category: NotificationCategory;
  severity: NotificationSeverity;
  title: string;
  body: string;
  target_url: string;
  source_type: string | null;
  source_id: string | null;
  dedupe_key: string | null;
};

export type NotificationPreferenceRow = {
  push_enabled: boolean;
  critical_alerts: boolean;
  operational_alerts: boolean;
  financial_alerts: boolean;
  invoice_alerts: boolean;
  inventory_alerts: boolean;
  payroll_alerts: boolean;
  investor_alerts: boolean;
  system_alerts: boolean;
  min_push_severity: NotificationSeverity;
  permission_state: "default" | "granted" | "denied" | "unsupported";
};

export type PushSubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type PushDispatchReport = {
  reason: "disabled" | "completed" | "no_pending_notifications";
  mode: "dry" | "live";
  scanCount: number;
  attemptedCount: number;
  sentCount: number;
  failedCount: number;
  revokedCount: number;
};

const DEFAULT_PREFERENCES: NotificationPreferenceRow = {
  push_enabled: false,
  critical_alerts: true,
  operational_alerts: true,
  financial_alerts: true,
  invoice_alerts: true,
  inventory_alerts: true,
  payroll_alerts: true,
  investor_alerts: false,
  system_alerts: true,
  min_push_severity: "High",
  permission_state: "default",
};

const severityRank: Record<NotificationSeverity, number> = {
  Critical: 4,
  High: 3,
  Medium: 2,
  Low: 1,
};

function safeTargetUrl(targetUrl: string | null | undefined): string {
  const value = (targetUrl ?? "/").trim() || "/";
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  try {
    const parsed = new URL(value, "https://fryguys.local");
    return parsed.origin === "https://fryguys.local"
      ? `${parsed.pathname}${parsed.search}${parsed.hash}`
      : "/";
  } catch {
    return "/";
  }
}

export function shouldDispatchPush(
  notification: Pick<NotificationRow, "category" | "severity">,
  preferences: NotificationPreferenceRow,
): boolean {
  if (!preferences.push_enabled) return false;
  if (preferences.permission_state !== "granted") return false;
  if (notification.category === "ai_watchdog") {
    if (!preferences.critical_alerts && notification.severity === "Critical") return false;
  } else if (!preferences[notification.category]) {
    return false;
  }
  return severityRank[notification.severity] >= severityRank[preferences.min_push_severity];
}

function buildPushPayload(notification: NotificationRow) {
  return {
    title: notification.title,
    body: notification.body,
    icon: "/pwa-192.png",
    badge: "/pwa-192.png",
    tag: notification.dedupe_key ?? notification.id,
    notification_id: notification.id,
    category: notification.category,
    severity: notification.severity,
    target_url: safeTargetUrl(notification.target_url),
    source_type: notification.source_type,
    source_id: notification.source_id,
  };
}

function isPermanentPushFailure(statusCode: number | undefined): boolean {
  return statusCode === 404 || statusCode === 410;
}

async function recordPushResult(
  supabase: SupabaseClient,
  notificationId: string,
  delivered: boolean,
  result: Record<string, unknown>,
) {
  const { error } = await supabase.rpc("record_notification_push_result", {
    _notification_id: notificationId,
    _attempted_at: new Date().toISOString(),
    _delivered: delivered,
    _result: result,
  });
  if (error) throw new Error(`Push result recording failed: ${error.message}`);
}

async function revokeSubscription(supabase: SupabaseClient, subscriptionId: string) {
  await supabase
    .from("push_subscriptions")
    .update({ active: false, revoked_at: new Date().toISOString() })
    .eq("id", subscriptionId);
}

export async function dispatchPendingPushNotifications(
  supabase: SupabaseClient,
  config: WorkerConfig,
): Promise<PushDispatchReport> {
  const mode = config.webPushDryRun ? "dry" : "live";
  if (!config.webPushEnabled) {
    return {
      reason: "disabled",
      mode,
      scanCount: 0,
      attemptedCount: 0,
      sentCount: 0,
      failedCount: 0,
      revokedCount: 0,
    };
  }

  const { data: notifications, error } = await supabase
    .from("notifications")
    .select(
      "id, recipient_user_id, category, severity, title, body, target_url, source_type, source_id, dedupe_key",
    )
    .is("push_attempted_at", null)
    .order("created_at", { ascending: true })
    .limit(25);
  if (error) throw new Error(`Pending push notification load failed: ${error.message}`);

  if (!notifications?.length) {
    return {
      reason: "no_pending_notifications",
      mode,
      scanCount: 0,
      attemptedCount: 0,
      sentCount: 0,
      failedCount: 0,
      revokedCount: 0,
    };
  }

  const vapidConfigured = Boolean(
    config.webPushVapidPublicKey && config.webPushVapidPrivateKey && config.webPushSubject,
  );
  if (
    vapidConfigured &&
    config.webPushSubject &&
    config.webPushVapidPublicKey &&
    config.webPushVapidPrivateKey
  ) {
    webPush.setVapidDetails(
      config.webPushSubject,
      config.webPushVapidPublicKey,
      config.webPushVapidPrivateKey,
    );
  }

  let attemptedCount = 0;
  let sentCount = 0;
  let failedCount = 0;
  let revokedCount = 0;

  for (const notification of notifications as NotificationRow[]) {
    const { data: preference } = await supabase
      .from("notification_preferences")
      .select("*")
      .eq("user_id", notification.recipient_user_id)
      .maybeSingle();
    const preferences = { ...DEFAULT_PREFERENCES, ...(preference ?? {}) };

    if (!shouldDispatchPush(notification, preferences)) {
      await recordPushResult(supabase, notification.id, false, {
        status: "skipped",
        reason: "preferences_or_permission",
      });
      continue;
    }

    if (!vapidConfigured) {
      await recordPushResult(supabase, notification.id, false, {
        status: "skipped",
        reason: "vapid_not_configured",
      });
      continue;
    }

    const { data: subscriptions, error: subscriptionError } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", notification.recipient_user_id)
      .eq("active", true)
      .is("revoked_at", null);
    if (subscriptionError)
      throw new Error(`Push subscription load failed: ${subscriptionError.message}`);

    if (!subscriptions?.length) {
      await recordPushResult(supabase, notification.id, false, {
        status: "skipped",
        reason: "no_active_subscriptions",
      });
      continue;
    }

    let notificationSent = 0;
    let notificationFailed = 0;
    let notificationRevoked = 0;
    const payload = JSON.stringify(buildPushPayload(notification));

    for (const subscription of subscriptions as PushSubscriptionRow[]) {
      attemptedCount += 1;
      if (config.webPushDryRun) {
        notificationSent += 1;
        continue;
      }
      try {
        await webPush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          payload,
        );
        notificationSent += 1;
      } catch (error: any) {
        notificationFailed += 1;
        if (isPermanentPushFailure(error?.statusCode)) {
          notificationRevoked += 1;
          await revokeSubscription(supabase, subscription.id);
        }
      }
    }

    sentCount += notificationSent;
    failedCount += notificationFailed;
    revokedCount += notificationRevoked;
    await recordPushResult(supabase, notification.id, notificationSent > 0, {
      status: "completed",
      mode,
      attempted: subscriptions.length,
      sent: notificationSent,
      failed: notificationFailed,
      revoked: notificationRevoked,
    });
  }

  return {
    reason: "completed",
    mode,
    scanCount: notifications.length,
    attemptedCount,
    sentCount,
    failedCount,
    revokedCount,
  };
}

export function logPushDispatchReport(report: PushDispatchReport) {
  console.info("PWA push dispatch workflow", report);
}
