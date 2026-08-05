import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { BellRing, Database, PauseCircle, Play, RefreshCw, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { pkr, fmtDate } from "@/lib/format";
import { useIsAdmin } from "@/lib/roles";
import {
  generateInvoiceReminderQueue,
  getInvoiceReminderSettings,
  listPendingInvoiceReminders,
  updateInvoiceReminderSettings,
} from "@/lib/invoice-reminder-queue.functions";

export const Route = createFileRoute("/_authenticated/payment-reminders")({
  head: () => ({ meta: [{ title: "Payment Reminders - TFC CRM" }] }),
  component: PaymentRemindersPage,
});

type ReminderReport = any;
type ReminderSettingsUpdate = {
  enabled?: boolean;
  dry_run?: boolean;
  pause_all?: boolean;
  automation_launch_date?: string | null;
};

function statusTone(value: boolean, safeWhenTrue = true) {
  const safe = safeWhenTrue ? value : !value;
  return safe
    ? "bg-success/15 text-success border-success/30"
    : "bg-warning/15 text-warning border-warning/30";
}

function pendingClientName(row: any) {
  const client = Array.isArray(row.clients) ? row.clients[0] : row.clients;
  return client?.legal_name ?? "-";
}

function pendingInvoiceNo(row: any) {
  const invoice = Array.isArray(row.invoices) ? row.invoices[0] : row.invoices;
  return invoice?.invoice_no ?? "-";
}

function PaymentRemindersPage() {
  const qc = useQueryClient();
  const { isAdmin, isLoading } = useIsAdmin();
  const getSettingsFn = useServerFn(getInvoiceReminderSettings);
  const updateSettingsFn = useServerFn(updateInvoiceReminderSettings);
  const generateFn = useServerFn(generateInvoiceReminderQueue);
  const pendingFn = useServerFn(listPendingInvoiceReminders);
  const [launchDate, setLaunchDate] = useState("");
  const [report, setReport] = useState<ReminderReport | null>(null);

  const settingsQ = useQuery({
    queryKey: ["invoice-reminder-settings"],
    queryFn: () => getSettingsFn({}),
    enabled: isAdmin,
  });

  const pendingQ = useQuery({
    queryKey: ["invoice-reminders-pending"],
    queryFn: () => pendingFn({}),
    enabled: isAdmin,
  });

  useEffect(() => {
    const value = settingsQ.data?.settings.automation_launch_date ?? "";
    setLaunchDate(value);
  }, [settingsQ.data?.settings.automation_launch_date]);

  const settings = settingsQ.data?.settings;
  const migrationRequired = !!settingsQ.data?.migration_required;

  const updateSettings = useMutation({
    mutationFn: (data: ReminderSettingsUpdate) => updateSettingsFn({ data }),
    onSuccess: () => {
      toast.success("Reminder settings saved");
      qc.invalidateQueries({ queryKey: ["invoice-reminder-settings"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to save reminder settings"),
  });

  const dryRun = useMutation({
    mutationFn: () =>
      generateFn({
        data: {
          dry_run_only: true,
          create_pending_queue: false,
          sample_limit: 50,
        },
      }),
    onSuccess: (data) => {
      setReport(data);
      toast.success("Dry-run report generated");
    },
    onError: (e: any) => toast.error(e?.message ?? "Dry-run failed"),
  });

  const createPending = useMutation({
    mutationFn: () =>
      generateFn({
        data: {
          dry_run_only: false,
          create_pending_queue: true,
          sample_limit: 50,
          second_confirmation: true,
        },
      }),
    onSuccess: (data) => {
      setReport(data);
      toast.success(`Created ${data.inserted_count} pending reminder(s)`);
      qc.invalidateQueries({ queryKey: ["invoice-reminders-pending"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Pending queue creation failed"),
  });

  const statRows = useMemo(() => {
    if (!report) return [];
    return [
      ["Scanned invoices", report.scanned_count],
      ["Eligible invoices", report.eligible_count],
      ["Skipped paid", report.skipped_paid],
      ["Skipped zero outstanding", report.skipped_zero_outstanding],
      ["Skipped missing due date", report.skipped_missing_due_date],
      ["Skipped invalid phone", report.skipped_invalid_phone],
      ["Skipped opt-out", report.skipped_opt_out],
      ["Skipped paused client", report.skipped_paused_client],
      ["Skipped duplicate", report.skipped_duplicate],
      ["Skipped before launch date", report.skipped_before_launch_date],
    ];
  }, [report]);

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading access...</div>;
  }

  if (!isAdmin) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Payment Reminders</h1>
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground">
            Admin access is required.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Payment Reminders</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Admin dry-run and pending queue controls. This page does not send WhatsApp messages.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => dryRun.mutate()}
            disabled={dryRun.isPending || migrationRequired}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Generate dry-run
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button disabled={createPending.isPending || migrationRequired}>
                <Database className="mr-2 h-4 w-4" />
                Create pending queue
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Create pending reminders?</AlertDialogTitle>
                <AlertDialogDescription>
                  This creates pending queue rows only. It will not approve, send, schedule, or
                  contact customers.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => createPending.mutate()}>
                  Confirm pending queue
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {migrationRequired && (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="flex gap-3 py-4 text-sm">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <span>
              Reminder settings migration has not been applied yet. Dry-run and queue creation are
              blocked until the settings table exists.
            </span>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Safety Configuration</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label>Automation launch date</Label>
            <div className="flex gap-2">
              <Input
                type="date"
                value={launchDate}
                onChange={(e) => setLaunchDate(e.target.value)}
              />
              <Button
                variant="outline"
                disabled={updateSettings.isPending || migrationRequired}
                onClick={() =>
                  updateSettings.mutate({ automation_launch_date: launchDate || null })
                }
              >
                Save
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border border-border px-4 py-3">
            <div>
              <div className="text-sm font-medium">Pause all</div>
              <div className="text-xs text-muted-foreground">Blocks pending queue creation.</div>
            </div>
            <Switch
              checked={!!settings?.pause_all}
              disabled={updateSettings.isPending || migrationRequired}
              onCheckedChange={(value) => updateSettings.mutate({ pause_all: value })}
            />
          </div>

          <div className="flex items-center justify-between rounded-md border border-border px-4 py-3">
            <div>
              <div className="text-sm font-medium">Dry-run mode</div>
              <div className="text-xs text-muted-foreground">
                When on, no pending rows can be created.
              </div>
            </div>
            <Switch
              checked={settings?.dry_run ?? true}
              disabled={updateSettings.isPending || migrationRequired}
              onCheckedChange={(value) => updateSettings.mutate({ dry_run: value })}
            />
          </div>

          <div className="flex items-center justify-between rounded-md border border-border px-4 py-3">
            <div>
              <div className="text-sm font-medium">Reminder system</div>
              <div className="text-xs text-muted-foreground">
                Controls pending queue creation only.
              </div>
            </div>
            <Switch
              checked={!!settings?.enabled}
              disabled={updateSettings.isPending || migrationRequired}
              onCheckedChange={(value) => updateSettings.mutate({ enabled: value })}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 md:col-span-2">
            <Badge variant="outline" className={statusTone(settings?.enabled ?? false)}>
              {settings?.enabled ? "Enabled" : "Disabled"}
            </Badge>
            <Badge variant="outline" className={statusTone(settings?.dry_run ?? true)}>
              {(settings?.dry_run ?? true) ? "Dry-run on" : "Dry-run off"}
            </Badge>
            <Badge variant="outline" className={statusTone(settings?.pause_all ?? true)}>
              {(settings?.pause_all ?? true) ? "Paused" : "Not paused"}
            </Badge>
            <Badge variant="outline">Provider: {settings?.provider ?? "whatsapp-web"}</Badge>
            <Badge variant="outline">Max reminders: {settings?.maximum_reminders ?? 4}</Badge>
            <Badge variant="outline">Daily cap: {settings?.maximum_daily_messages ?? 20}</Badge>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-5">
        {statRows.length === 0 ? (
          <Card className="md:col-span-5">
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Generate a dry-run report to preview eligibility.
            </CardContent>
          </Card>
        ) : (
          statRows.map(([label, value]) => (
            <Card key={label}>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className="mt-1 tabular text-2xl font-semibold">{value}</div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Preview</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Invoice</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Days</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
                <TableHead>Original phone</TableHead>
                <TableHead>Normalized</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(report?.sample_preview_rows ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                    No preview rows yet.
                  </TableCell>
                </TableRow>
              ) : (
                report!.sample_preview_rows.map((row: any) => (
                  <TableRow key={`${row.invoice_id}-${row.skip_reason ?? row.reminder_stage}`}>
                    <TableCell>{row.client_name ?? "-"}</TableCell>
                    <TableCell className="font-mono text-xs">{row.invoice_no ?? "-"}</TableCell>
                    <TableCell>{row.due_date ? fmtDate(row.due_date) : "-"}</TableCell>
                    <TableCell className="tabular">{row.days_overdue}</TableCell>
                    <TableCell className="tabular text-right">
                      {pkr(row.outstanding_amount)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{row.original_phone ?? "-"}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {row.normalized_phone ?? "-"}
                    </TableCell>
                    <TableCell>{row.reminder_stage ?? "-"}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          row.eligibility === "eligible" ? "border-success/30 text-success" : ""
                        }
                      >
                        {row.eligibility === "eligible" ? "eligible" : row.skip_reason}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Pending Reminders</CardTitle>
          <Button variant="outline" size="sm" onClick={() => pendingQ.refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Invoice</TableHead>
                <TableHead>Due</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(pendingQ.data ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                    No pending reminders.
                  </TableCell>
                </TableRow>
              ) : (
                (pendingQ.data ?? []).map((row: any) => (
                  <TableRow key={row.id}>
                    <TableCell>{pendingClientName(row)}</TableCell>
                    <TableCell className="font-mono text-xs">{pendingInvoiceNo(row)}</TableCell>
                    <TableCell>{fmtDate(row.due_date_snapshot)}</TableCell>
                    <TableCell className="tabular text-right">
                      {pkr(Number(row.outstanding_amount_snapshot ?? 0))}
                    </TableCell>
                    <TableCell>{row.reminder_stage}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{row.status}</Badge>
                    </TableCell>
                    <TableCell>{fmtDate(row.created_at)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="border-warning/30">
        <CardContent className="flex flex-wrap items-center gap-3 py-4 text-sm text-muted-foreground">
          <PauseCircle className="h-4 w-4" />
          <span>
            No row approval, sending, scheduling, WhatsApp connection, webhook, Edge Function,
            email, or cron action exists on this page.
          </span>
          <Play className="h-4 w-4" />
          <span>Create pending queue only writes rows with status pending.</span>
          <BellRing className="h-4 w-4" />
        </CardContent>
      </Card>
    </div>
  );
}
