import type { AppRole } from "@/lib/roles";

export const NOTIFICATION_CATEGORIES = [
  "critical_alerts",
  "operational_alerts",
  "financial_alerts",
  "invoice_alerts",
  "inventory_alerts",
  "payroll_alerts",
  "investor_alerts",
  "system_alerts",
  "ai_watchdog",
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const PUSH_PREFERENCE_CATEGORIES = [
  "critical_alerts",
  "operational_alerts",
  "financial_alerts",
  "invoice_alerts",
  "inventory_alerts",
  "payroll_alerts",
  "ai_watchdog_alerts",
  "investor_alerts",
  "system_alerts",
] as const;

export type PushPreferenceCategory = (typeof PUSH_PREFERENCE_CATEGORIES)[number];

export const NOTIFICATION_SEVERITIES = ["Critical", "High", "Medium", "Low"] as const;
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];

export type NotificationPreferences = Record<PushPreferenceCategory, boolean> & {
  push_enabled: boolean;
  min_push_severity: NotificationSeverity;
  permission_state: NotificationPermission | "unsupported";
};

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
  created_at: string;
  read_at: string | null;
  push_attempted_at?: string | null;
  push_delivered?: boolean | null;
  push_result?: Record<string, unknown> | null;
};

export type PushSubscriptionRecord = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  active: boolean;
  revoked_at: string | null;
};

export type PushPayload = {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  notification_id?: string;
  category?: NotificationCategory;
  severity?: NotificationSeverity;
  target_url?: string;
  source_type?: string | null;
  source_id?: string | null;
};

export type NotificationCreateInput = {
  recipientUserIds?: string[];
  roles?: AppRole[];
  category: NotificationCategory;
  severity: NotificationSeverity;
  title: string;
  body: string;
  targetUrl: string;
  sourceType?: string | null;
  sourceId?: string | null;
  dedupeKey?: string | null;
};

export type OperationalNotificationInput = {
  id: string;
  alertType: string;
  severity: "critical" | "warning" | "info" | string;
  message?: string | null;
};

const severityRank: Record<NotificationSeverity, number> = {
  Critical: 4,
  High: 3,
  Medium: 2,
  Low: 1,
};

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  push_enabled: false,
  critical_alerts: true,
  operational_alerts: true,
  financial_alerts: true,
  invoice_alerts: true,
  inventory_alerts: true,
  payroll_alerts: true,
  ai_watchdog_alerts: true,
  investor_alerts: false,
  system_alerts: true,
  min_push_severity: "High",
  permission_state: "default",
};

export const NOTIFICATION_CATEGORY_LABELS: Record<
  NotificationCategory | PushPreferenceCategory,
  string
> = {
  critical_alerts: "Critical alerts",
  operational_alerts: "Operational alerts",
  financial_alerts: "Financial alerts",
  invoice_alerts: "Invoice alerts",
  inventory_alerts: "Inventory alerts",
  payroll_alerts: "Payroll alerts",
  ai_watchdog_alerts: "AI Watchdog",
  investor_alerts: "Investor alerts",
  system_alerts: "System alerts",
  ai_watchdog: "AI Watchdog",
};

export function normalizeNotificationPreferences(
  row: Partial<NotificationPreferences> | null | undefined,
): NotificationPreferences {
  return { ...DEFAULT_NOTIFICATION_PREFERENCES, ...(row ?? {}) };
}

export function canAttemptBrowserPush(
  permission: NotificationPermission | "unsupported",
): permission is "granted" {
  return permission === "granted";
}

export function shouldAttemptPush(
  notification: Pick<NotificationRow, "category" | "severity">,
  preferences: NotificationPreferences,
): boolean {
  if (!preferences.push_enabled) return false;
  if (preferences.permission_state !== "granted") return false;
  if (notification.category === "ai_watchdog") {
    if (!preferences.ai_watchdog_alerts) return false;
    if (!preferences.critical_alerts && notification.severity === "Critical") return false;
  } else if (!preferences[notification.category]) {
    return false;
  }
  return severityRank[notification.severity] >= severityRank[preferences.min_push_severity];
}

export function rolesForNotification(input: {
  category: NotificationCategory;
  severity: NotificationSeverity;
  sourceType?: string | null;
}): AppRole[] {
  if (input.category === "operational_alerts" || input.category === "inventory_alerts") {
    return input.severity === "Critical" ? ["admin", "moderator"] : ["admin", "moderator"];
  }
  if (
    input.category === "financial_alerts" ||
    input.category === "invoice_alerts" ||
    input.category === "payroll_alerts" ||
    input.category === "critical_alerts"
  ) {
    return ["admin"];
  }
  if (input.category === "system_alerts") return ["admin"];
  if (input.category === "investor_alerts") return ["admin"];
  return ["admin"];
}

export function canRoleReceiveNotification(role: AppRole, category: NotificationCategory): boolean {
  if (role === "admin") return true;
  if (role === "moderator") {
    return category === "operational_alerts" || category === "inventory_alerts";
  }
  if (role === "staff") return category === "operational_alerts" || category === "inventory_alerts";
  return category === "investor_alerts";
}

export function uniqueRecipientIds(userIds: string[]): string[] {
  return [...new Set(userIds.filter(Boolean))];
}

export function notificationDedupeKey(parts: Array<string | number | null | undefined>): string {
  return parts
    .filter((part) => part !== null && part !== undefined && String(part).trim() !== "")
    .map((part) => String(part).trim())
    .join(":");
}

export function sanitizeNotificationTargetUrl(targetUrl: string | null | undefined): string {
  const value = (targetUrl ?? "/").trim() || "/";
  if (!isValidInternalNotificationTarget(value)) return "/";
  return value;
}

export function isValidInternalNotificationTarget(targetUrl: string): boolean {
  if (!targetUrl.startsWith("/")) return false;
  if (targetUrl.startsWith("//")) return false;
  if (targetUrl.startsWith("/\\")) return false;
  try {
    const parsed = new URL(targetUrl, "https://fryguys.local");
    return parsed.origin === "https://fryguys.local" && parsed.pathname.startsWith("/");
  } catch {
    return false;
  }
}

export function payloadForNotification(notification: NotificationRow): PushPayload {
  return {
    title: notification.title,
    body: notification.body,
    icon: "/pwa-192.png",
    badge: "/pwa-192.png",
    tag: notification.dedupe_key ?? notification.id,
    notification_id: notification.id,
    category: notification.category,
    severity: notification.severity,
    target_url: sanitizeNotificationTargetUrl(notification.target_url),
    source_type: notification.source_type,
    source_id: notification.source_id,
  };
}

export function severityFromOperationalAlert(severity: string): NotificationSeverity {
  if (severity === "critical") return "Critical";
  if (severity === "warning") return "High";
  if (severity === "info") return "Low";
  return "Medium";
}

export function paymentVerificationReceivedNotification(
  requestId: string,
): NotificationCreateInput {
  return {
    roles: ["admin"],
    category: "financial_alerts",
    severity: "High",
    title: "Payment Verification Received",
    body: "New payment verification requires review.",
    targetUrl: `/payment-verifications?request_id=${requestId}`,
    sourceType: "payment_verification_request",
    sourceId: requestId,
    dedupeKey: notificationDedupeKey(["payment-verification", requestId]),
  };
}

export function operationalAlertNotification(
  alert: OperationalNotificationInput,
): NotificationCreateInput {
  const category: NotificationCategory =
    alert.alertType === "stock_variance" ? "inventory_alerts" : "operational_alerts";
  return {
    roles: rolesForNotification({
      category,
      severity: severityFromOperationalAlert(alert.severity),
      sourceType: "operational_alert",
    }),
    category,
    severity: severityFromOperationalAlert(alert.severity),
    title: alert.alertType === "stock_variance" ? "Stock Variance Alert" : "Operational Alert",
    body:
      alert.message?.trim() ||
      (alert.alertType === "stock_variance"
        ? "Stock variance requires review."
        : "Operational alert requires review."),
    targetUrl: `/operational-alerts?alert_id=${alert.id}`,
    sourceType: "operational_alert",
    sourceId: alert.id,
    dedupeKey: notificationDedupeKey(["operational-alert", alert.id]),
  };
}

export function creditPurchaseDueNotification(purchaseId: string): NotificationCreateInput {
  return {
    roles: ["admin"],
    category: "financial_alerts",
    severity: "High",
    title: "Credit Purchase Due",
    body: "Credit inventory purchase is due soon.",
    targetUrl: `/credit-inventory-purchases?purchase_id=${purchaseId}`,
    sourceType: "credit_inventory_purchase",
    sourceId: purchaseId,
    dedupeKey: notificationDedupeKey(["credit-purchase-due", purchaseId]),
  };
}

export function permissionDeniedBlocksSubscription(permission: NotificationPermission): boolean {
  return permission === "denied";
}

export function isPermanentPushFailure(statusCode: number | undefined): boolean {
  return statusCode === 404 || statusCode === 410;
}
