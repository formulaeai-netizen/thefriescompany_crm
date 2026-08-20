import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Bell, CheckCheck, CircleAlert, CircleDollarSign, PackageSearch } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/notifications.functions";
import {
  NOTIFICATION_CATEGORY_LABELS,
  sanitizeNotificationTargetUrl,
  type NotificationCategory,
} from "@/lib/notifications";

function iconForCategory(category: NotificationCategory) {
  if (category === "financial_alerts" || category === "invoice_alerts") {
    return <CircleDollarSign className="h-4 w-4 text-primary" />;
  }
  if (category === "inventory_alerts" || category === "operational_alerts") {
    return <PackageSearch className="h-4 w-4 text-warning" />;
  }
  return <CircleAlert className="h-4 w-4 text-destructive" />;
}

function timeLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function NotificationCenter() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const listFn = useServerFn(listNotifications);
  const markReadFn = useServerFn(markNotificationRead);
  const markAllFn = useServerFn(markAllNotificationsRead);

  const listQ = useQuery({
    queryKey: ["notifications"],
    queryFn: () => listFn({}),
    refetchInterval: 60_000,
  });

  const rows = useMemo(() => listQ.data?.rows ?? [], [listQ.data?.rows]);
  const unreadCount = listQ.data?.unreadCount ?? 0;

  const markRead = useMutation({
    mutationFn: (notificationId: string) =>
      markReadFn({ data: { notification_id: notificationId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
    onError: (error: any) => toast.error(error?.message ?? "Could not mark notification read"),
  });

  const markAll = useMutation({
    mutationFn: () => markAllFn({}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
    onError: (error: any) => toast.error(error?.message ?? "Could not mark notifications read"),
  });

  const openNotification = async (notification: any) => {
    if (!notification.read_at) {
      await markRead.mutateAsync(notification.id).catch(() => null);
    }
    const target = sanitizeNotificationTargetUrl(notification.target_url);
    navigate({ to: target as any });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Notifications" className="relative">
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,420px)] p-0">
        <div className="flex items-center justify-between border-b border-border p-3">
          <div>
            <div className="text-sm font-semibold">Notifications</div>
            <div className="text-xs text-muted-foreground">
              {unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={markAll.isPending || unreadCount === 0}
            onClick={() => markAll.mutate()}
          >
            <CheckCheck className="mr-1 h-3.5 w-3.5" />
            Mark all
          </Button>
        </div>
        {listQ.isLoading ? (
          <div className="p-4 text-sm text-muted-foreground">Loading notifications...</div>
        ) : listQ.isError ? (
          <div className="p-4 text-sm text-destructive">Could not load notifications.</div>
        ) : listQ.data?.migration_required ? (
          <div className="p-4 text-sm text-warning">Notification migration is not applied yet.</div>
        ) : rows.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">No notifications yet.</div>
        ) : (
          <ScrollArea className="max-h-[70vh]">
            <div className="divide-y divide-border">
              {rows.map((notification: any) => (
                <button
                  key={notification.id}
                  type="button"
                  onClick={() => openNotification(notification)}
                  className="flex w-full gap-3 p-3 text-left transition-colors hover:bg-muted/60"
                >
                  <div className="mt-0.5 shrink-0">{iconForCategory(notification.category)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{notification.title}</span>
                      {!notification.read_at && (
                        <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />
                      )}
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {notification.body}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{notification.severity}</Badge>
                      <span className="text-[11px] text-muted-foreground">
                        {
                          NOTIFICATION_CATEGORY_LABELS[
                            notification.category as NotificationCategory
                          ]
                        }
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {timeLabel(notification.created_at)}
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  );
}
