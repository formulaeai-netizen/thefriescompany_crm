import webPush from "web-push";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  payloadForNotification,
  sanitizeNotificationTargetUrl,
  shouldAttemptPush,
  normalizeNotificationPreferences,
  isPermanentPushFailure,
  uniqueRecipientIds,
  type NotificationCreateInput,
  type NotificationRow,
  type NotificationPreferences,
  type PushSubscriptionRecord,
} from "@/lib/notifications";

type DispatchResult = {
  status: "skipped" | "completed";
  reason?: string;
  attempted: number;
  sent: number;
  failed: number;
  revoked: number;
};

type WebPushSubscription = {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
};

function getWebPushConfig() {
  const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.WEB_PUSH_SUBJECT?.trim();
  return {
    configured: Boolean(publicKey && privateKey && subject),
    publicKey,
    privateKey,
    subject,
  };
}

function toWebPushSubscription(row: PushSubscriptionRecord): WebPushSubscription {
  return {
    endpoint: row.endpoint,
    keys: {
      p256dh: row.p256dh,
      auth: row.auth,
    },
  };
}

async function recordResult(notificationId: string, delivered: boolean, result: DispatchResult) {
  const { error } = await (supabaseAdmin as any).rpc("record_notification_push_result", {
    _notification_id: notificationId,
    _attempted_at: new Date().toISOString(),
    _delivered: delivered,
    _result: result,
  });
  if (error) throw new Error(`Push result recording failed: ${error.message}`);
}

export async function dispatchPushForNotification(notificationId: string): Promise<DispatchResult> {
  const { data: notification, error: notificationError } = await (supabaseAdmin as any)
    .from("notifications")
    .select(
      "id, recipient_user_id, category, severity, title, body, target_url, source_type, source_id, dedupe_key, created_at, read_at",
    )
    .eq("id", notificationId)
    .maybeSingle();
  if (notificationError) throw new Error(`Notification load failed: ${notificationError.message}`);
  if (!notification) {
    return {
      status: "skipped",
      reason: "notification_not_found",
      attempted: 0,
      sent: 0,
      failed: 0,
      revoked: 0,
    };
  }

  const { data: preferenceRow, error: preferenceError } = await (supabaseAdmin as any)
    .from("notification_preferences")
    .select("*")
    .eq("user_id", notification.recipient_user_id)
    .maybeSingle();
  if (preferenceError)
    throw new Error(`Notification preferences load failed: ${preferenceError.message}`);

  const preferences = normalizeNotificationPreferences(
    preferenceRow as Partial<NotificationPreferences> | null,
  );
  if (!shouldAttemptPush(notification as NotificationRow, preferences)) {
    const result: DispatchResult = {
      status: "skipped",
      reason: "preferences_or_permission",
      attempted: 0,
      sent: 0,
      failed: 0,
      revoked: 0,
    };
    await recordResult(notification.id, false, result);
    return result;
  }

  const config = getWebPushConfig();
  if (!config.configured || !config.publicKey || !config.privateKey || !config.subject) {
    const result: DispatchResult = {
      status: "skipped",
      reason: "vapid_not_configured",
      attempted: 0,
      sent: 0,
      failed: 0,
      revoked: 0,
    };
    await recordResult(notification.id, false, result);
    return result;
  }

  const { data: subscriptions, error: subscriptionError } = await (supabaseAdmin as any)
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth, active, revoked_at")
    .eq("user_id", notification.recipient_user_id)
    .eq("active", true)
    .is("revoked_at", null);
  if (subscriptionError) {
    throw new Error(`Push subscriptions load failed: ${subscriptionError.message}`);
  }
  if (!subscriptions?.length) {
    const result: DispatchResult = {
      status: "skipped",
      reason: "no_active_subscriptions",
      attempted: 0,
      sent: 0,
      failed: 0,
      revoked: 0,
    };
    await recordResult(notification.id, false, result);
    return result;
  }

  webPush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  const payload = JSON.stringify(payloadForNotification(notification as NotificationRow));
  let sent = 0;
  let failed = 0;
  let revoked = 0;

  for (const subscription of subscriptions as PushSubscriptionRecord[]) {
    try {
      await webPush.sendNotification(toWebPushSubscription(subscription), payload);
      sent += 1;
    } catch (error: any) {
      failed += 1;
      if (isPermanentPushFailure(error?.statusCode)) {
        revoked += 1;
        await (supabaseAdmin as any)
          .from("push_subscriptions")
          .update({ active: false, revoked_at: new Date().toISOString() })
          .eq("id", subscription.id);
      }
    }
  }

  const result: DispatchResult = {
    status: "completed",
    attempted: subscriptions.length,
    sent,
    failed,
    revoked,
  };
  await recordResult(notification.id, sent > 0, result);
  return result;
}

export async function createAndDispatchNotification(input: NotificationCreateInput) {
  const safeTarget = sanitizeNotificationTargetUrl(input.targetUrl);
  let rows: NotificationRow[] = [];

  if (input.roles?.length) {
    const { data, error } = await (supabaseAdmin as any).rpc("create_notification_for_roles", {
      _roles: input.roles,
      _category: input.category,
      _severity: input.severity,
      _title: input.title,
      _body: input.body,
      _target_url: safeTarget,
      _source_type: input.sourceType ?? null,
      _source_id: input.sourceId ?? null,
      _dedupe_key: input.dedupeKey ?? null,
    });
    if (error) throw new Error(`Notification creation failed: ${error.message}`);
    rows = data ?? [];
  } else if (input.recipientUserIds?.length) {
    for (const recipient_user_id of uniqueRecipientIds(input.recipientUserIds)) {
      let existing = null;
      if (input.dedupeKey) {
        const { data, error } = await (supabaseAdmin as any)
          .from("notifications")
          .select("*")
          .eq("recipient_user_id", recipient_user_id)
          .eq("dedupe_key", input.dedupeKey)
          .maybeSingle();
        if (error) throw new Error(`Notification lookup failed: ${error.message}`);
        existing = data;
      }

      if (existing) {
        const { data, error } = await (supabaseAdmin as any)
          .from("notifications")
          .update({ title: input.title, body: input.body, target_url: safeTarget })
          .eq("id", existing.id)
          .select("*")
          .single();
        if (error) throw new Error(`Notification update failed: ${error.message}`);
        rows.push(data);
      } else {
        const { data, error } = await (supabaseAdmin as any)
          .from("notifications")
          .insert({
            recipient_user_id,
            category: input.category,
            severity: input.severity,
            title: input.title,
            body: input.body,
            target_url: safeTarget,
            source_type: input.sourceType ?? null,
            source_id: input.sourceId ?? null,
            dedupe_key: input.dedupeKey ?? null,
          })
          .select("*")
          .single();
        if (error) throw new Error(`Notification creation failed: ${error.message}`);
        rows.push(data);
      }
    }
  }

  const dispatch = [];
  for (const row of rows) {
    dispatch.push(await dispatchPushForNotification(row.id));
  }
  return { rows, dispatch };
}
