import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NOTIFICATION_SEVERITIES,
  PUSH_PREFERENCE_CATEGORIES,
  normalizeNotificationPreferences,
  sanitizeNotificationTargetUrl,
  type NotificationPreferences,
} from "@/lib/notifications";

const severitySchema = z.enum(NOTIFICATION_SEVERITIES);
const permissionSchema = z.enum(["default", "granted", "denied", "unsupported"]);

const preferenceSchema = z.object({
  push_enabled: z.boolean(),
  critical_alerts: z.boolean(),
  operational_alerts: z.boolean(),
  financial_alerts: z.boolean(),
  invoice_alerts: z.boolean(),
  inventory_alerts: z.boolean(),
  payroll_alerts: z.boolean(),
  ai_watchdog_alerts: z.boolean(),
  investor_alerts: z.boolean(),
  system_alerts: z.boolean(),
  min_push_severity: severitySchema,
  permission_state: permissionSchema,
});

const subscriptionSchema = z.object({
  endpoint: z.string().trim().min(1),
  p256dh: z.string().trim().min(1),
  auth: z.string().trim().min(1),
  user_agent: z.string().trim().max(500).nullable().optional(),
  platform: z.string().trim().max(100).nullable().optional(),
});

const endpointSchema = z.object({
  endpoint: z.string().trim().min(1),
});

const notificationIdSchema = z.object({
  notification_id: z.string().uuid(),
});

function preferencesForDb(data: NotificationPreferences, userId: string) {
  return {
    user_id: userId,
    push_enabled: data.permission_state === "granted" ? data.push_enabled : false,
    critical_alerts: data.critical_alerts,
    operational_alerts: data.operational_alerts,
    financial_alerts: data.financial_alerts,
    invoice_alerts: data.invoice_alerts,
    inventory_alerts: data.inventory_alerts,
    payroll_alerts: data.payroll_alerts,
    ai_watchdog_alerts: data.ai_watchdog_alerts,
    investor_alerts: data.investor_alerts,
    system_alerts: data.system_alerts,
    min_push_severity: data.min_push_severity,
    permission_state: data.permission_state,
  };
}

export const getNotificationSettingsBootstrap = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: preferencesRow, error: preferencesError } = await (context.supabase as any)
      .from("notification_preferences")
      .select("*")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (preferencesError) {
      if (preferencesError.code === "42P01") {
        return {
          migration_required: true,
          preferences: DEFAULT_NOTIFICATION_PREFERENCES,
          activeSubscriptionCount: 0,
          vapidPublicKey: null,
        };
      }
      throw new Error(`Notification preferences load failed: ${preferencesError.message}`);
    }

    const { count, error: countError } = await (context.supabase as any)
      .from("push_subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("active", true)
      .is("revoked_at", null);
    if (countError) throw new Error(`Push subscription count failed: ${countError.message}`);

    return {
      migration_required: false,
      preferences: normalizeNotificationPreferences(preferencesRow),
      activeSubscriptionCount: count ?? 0,
      vapidPublicKey: process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim() || null,
    };
  });

export const updateNotificationPreferences = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => preferenceSchema.parse(data))
  .handler(async ({ data, context }) => {
    const normalized = normalizeNotificationPreferences(data);
    const { error } = await (context.supabase as any)
      .from("notification_preferences")
      .upsert(preferencesForDb(normalized, context.userId), { onConflict: "user_id" });
    if (error) throw new Error(`Notification preferences save failed: ${error.message}`);
    return { ok: true };
  });

export const registerPushSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => subscriptionSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { data: id, error } = await (context.supabase as any).rpc("register_push_subscription", {
      _endpoint: data.endpoint,
      _p256dh: data.p256dh,
      _auth: data.auth,
      _user_agent: data.user_agent ?? null,
      _platform: data.platform ?? null,
    });
    if (error) throw new Error(`Push subscription register failed: ${error.message}`);
    return { ok: true, id };
  });

export const revokePushSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => endpointSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any).rpc("revoke_push_subscription", {
      _endpoint: data.endpoint,
    });
    if (error) throw new Error(`Push subscription revoke failed: ${error.message}`);
    return { ok: true };
  });

export const listNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await (context.supabase as any)
      .from("notifications")
      .select(
        "id, recipient_user_id, category, severity, title, body, target_url, source_type, source_id, dedupe_key, created_at, read_at, push_attempted_at, push_delivered, push_result",
      )
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      if (error.code === "42P01") return { migration_required: true, rows: [], unreadCount: 0 };
      throw new Error(`Notifications load failed: ${error.message}`);
    }

    const rows = (data ?? []).map((row: any) => ({
      ...row,
      target_url: sanitizeNotificationTargetUrl(row.target_url),
    }));
    return {
      migration_required: false,
      rows,
      unreadCount: rows.filter((row: any) => !row.read_at).length,
    };
  });

export const markNotificationRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => notificationIdSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any).rpc("mark_notification_read", {
      _notification_id: data.notification_id,
    });
    if (error) throw new Error(`Notification mark-read failed: ${error.message}`);
    return { ok: true };
  });

export const markAllNotificationsRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await (context.supabase as any).rpc("mark_all_notifications_read");
    if (error) throw new Error(`Notifications mark-all-read failed: ${error.message}`);
    return { ok: true };
  });

export const notificationPreferenceFields = PUSH_PREFERENCE_CATEGORIES;
