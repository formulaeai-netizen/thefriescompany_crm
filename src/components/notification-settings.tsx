import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BellRing, BellOff } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  getNotificationSettingsBootstrap,
  registerPushSubscription,
  revokePushSubscription,
  updateNotificationPreferences,
} from "@/lib/notifications.functions";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NOTIFICATION_CATEGORY_LABELS,
  NOTIFICATION_SEVERITIES,
  PUSH_PREFERENCE_CATEGORIES,
  canAttemptBrowserPush,
  permissionDeniedBlocksSubscription,
  type NotificationPreferences,
  type NotificationSeverity,
  type PushPreferenceCategory,
} from "@/lib/notifications";

function getBrowserPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined") return "unsupported";
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission;
}

function supportsPush() {
  if (typeof window === "undefined") return false;
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function subscriptionPayload(subscription: PushSubscription) {
  const json = subscription.toJSON();
  return {
    endpoint: json.endpoint ?? subscription.endpoint,
    p256dh: json.keys?.p256dh ?? "",
    auth: json.keys?.auth ?? "",
    user_agent: navigator.userAgent,
    platform: navigator.platform,
  };
}

export function NotificationSettings() {
  const qc = useQueryClient();
  const getBootstrapFn = useServerFn(getNotificationSettingsBootstrap);
  const updatePrefsFn = useServerFn(updateNotificationPreferences);
  const registerFn = useServerFn(registerPushSubscription);
  const revokeFn = useServerFn(revokePushSubscription);
  const [form, setForm] = useState<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFERENCES);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(
    getBrowserPermission(),
  );

  const pushSupported = useMemo(() => supportsPush(), []);

  const bootstrapQ = useQuery({
    queryKey: ["notification-settings"],
    queryFn: () => getBootstrapFn({}),
  });

  useEffect(() => {
    if (!bootstrapQ.data?.preferences) return;
    const browserPermission = getBrowserPermission();
    setPermission(browserPermission);
    setForm({
      ...bootstrapQ.data.preferences,
      permission_state: browserPermission,
      push_enabled:
        browserPermission === "granted" ? bootstrapQ.data.preferences.push_enabled : false,
    });
  }, [bootstrapQ.data?.preferences]);

  const saveMutation = useMutation({
    mutationFn: (next: NotificationPreferences) => updatePrefsFn({ data: next }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notification-settings"] });
      toast.success("Notification preferences saved");
    },
    onError: (error: any) => toast.error(error?.message ?? "Could not save notifications"),
  });

  const enableMutation = useMutation({
    mutationFn: async () => {
      if (!pushSupported) throw new Error("Browser push is not supported on this device.");
      if (!bootstrapQ.data?.vapidPublicKey) {
        throw new Error("Server push public key is not configured yet.");
      }
      let nextPermission = getBrowserPermission();
      if (nextPermission === "default") {
        nextPermission = await Notification.requestPermission();
      }
      setPermission(nextPermission);
      if (!canAttemptBrowserPush(nextPermission)) {
        const next = { ...form, push_enabled: false, permission_state: nextPermission };
        await updatePrefsFn({ data: next });
        return { enabled: false };
      }
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(bootstrapQ.data.vapidPublicKey),
        }));
      await registerFn({ data: subscriptionPayload(subscription) });
      const next = { ...form, push_enabled: true, permission_state: "granted" as const };
      await updatePrefsFn({ data: next });
      return { enabled: true };
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["notification-settings"] });
      setForm((current) => ({
        ...current,
        push_enabled: result.enabled,
        permission_state: result.enabled ? "granted" : getBrowserPermission(),
      }));
      toast.success(result.enabled ? "Push notifications enabled" : "Notifications not enabled");
    },
    onError: (error: any) => toast.error(error?.message ?? "Could not enable notifications"),
  });

  const disableMutation = useMutation({
    mutationFn: async () => {
      if (pushSupported) {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          await revokeFn({ data: { endpoint: subscription.endpoint } });
          await subscription.unsubscribe();
        }
      }
      const next = { ...form, push_enabled: false, permission_state: getBrowserPermission() };
      await updatePrefsFn({ data: next });
      return next;
    },
    onSuccess: (next) => {
      setForm(next);
      qc.invalidateQueries({ queryKey: ["notification-settings"] });
      toast.success("Push notifications disabled");
    },
    onError: (error: any) => toast.error(error?.message ?? "Could not disable notifications"),
  });

  const setPreference = (
    key: keyof NotificationPreferences,
    value: boolean | NotificationSeverity,
  ) => {
    const next = { ...form, [key]: value };
    setForm(next);
    saveMutation.mutate(next);
  };

  const disabledReason = (() => {
    if (!pushSupported) return "Push is not supported by this browser/device.";
    if (!bootstrapQ.data?.vapidPublicKey) return "VAPID public key is not configured.";
    if (permission !== "unsupported" && permissionDeniedBlocksSubscription(permission)) {
      return "Browser permission is denied. Enable notifications from browser/site settings first.";
    }
    return null;
  })();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {form.push_enabled ? (
            <BellRing className="h-4 w-4 text-primary" />
          ) : (
            <BellOff className="h-4 w-4 text-muted-foreground" />
          )}
          Notifications
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {bootstrapQ.data?.migration_required ? (
          <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
            Notification migration is not applied yet.
          </div>
        ) : null}

        <div className="flex flex-col gap-3 rounded-md border border-border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="font-medium">Push Notifications</div>
            <div className="text-xs text-muted-foreground">
              Permission: {permission}. Active devices:{" "}
              {bootstrapQ.data?.activeSubscriptionCount ?? 0}
            </div>
            {disabledReason && <div className="mt-1 text-xs text-warning">{disabledReason}</div>}
          </div>
          {form.push_enabled ? (
            <Button
              variant="outline"
              disabled={disableMutation.isPending}
              onClick={() => disableMutation.mutate()}
            >
              Disable
            </Button>
          ) : (
            <Button
              disabled={Boolean(disabledReason) || enableMutation.isPending}
              onClick={() => enableMutation.mutate()}
            >
              Enable Notifications
            </Button>
          )}
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {PUSH_PREFERENCE_CATEGORIES.map((category: PushPreferenceCategory) => (
            <div
              key={category}
              className="flex items-center justify-between rounded-md border border-border p-3"
            >
              <Label className="text-sm">{NOTIFICATION_CATEGORY_LABELS[category]}</Label>
              <Switch
                checked={form[category]}
                onCheckedChange={(checked) => setPreference(category, checked)}
              />
            </div>
          ))}
        </div>

        <div className="rounded-md border border-border p-4">
          <Label>Minimum push severity</Label>
          <select
            className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm sm:w-56"
            value={form.min_push_severity}
            onChange={(event) =>
              setPreference("min_push_severity", event.target.value as NotificationSeverity)
            }
          >
            {NOTIFICATION_SEVERITIES.map((severity) => (
              <option key={severity} value={severity}>
                {severity}
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs text-muted-foreground">
            In-app notifications are always kept; this only filters browser push delivery.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
