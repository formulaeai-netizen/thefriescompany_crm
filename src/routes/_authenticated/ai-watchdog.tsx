import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BrainCircuit, ExternalLink, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { WATCHDOG_MODULES, type WatchdogModule } from "@/lib/ai-watchdog";
import { listAiWatchdogAlerts, reviewAiWatchdogAlert } from "@/lib/ai-watchdog.functions";
import { pkr } from "@/lib/format";
import { useMyRoles } from "@/lib/roles";

export const Route = createFileRoute("/_authenticated/ai-watchdog")({
  head: () => ({ meta: [{ title: "AI Business Watchdog - Fry Guys CRM" }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    alert_id: typeof search.alert_id === "string" ? search.alert_id : undefined,
  }),
  component: AiWatchdogPage,
});

const moduleLabels: Record<WatchdogModule, string> = {
  expenses: "Expenses",
  cash_bank: "Cash / Bank",
  inventory: "Inventory",
  credit_supplier: "Credit / Supplier",
  invoice_receivables: "Invoice / Receivables",
  payroll: "Payroll",
};

function severityTone(severity: string) {
  if (severity === "critical") return "border-destructive/40 text-destructive";
  if (severity === "high") return "border-warning/40 text-warning";
  if (severity === "medium") return "border-primary/40 text-primary";
  return "border-muted-foreground/40 text-muted-foreground";
}

function statusTone(status: string) {
  if (status === "new") return "border-warning/40 text-warning";
  if (status === "resolved") return "border-success/40 text-success";
  if (status === "dismissed") return "border-muted-foreground/40 text-muted-foreground";
  return "border-primary/40 text-primary";
}

function relatedUrl(row: any): string {
  if (row.source_type === "expense") return "/expenses";
  if (row.source_type === "cash_ledger_entry") return "/pnl";
  if (row.source_type === "inventory") return "/inventory";
  if (row.source_type === "stock_audit_item") return "/stock-audits";
  if (row.source_type === "credit_inventory_purchase") return "/credit-inventory-purchases";
  if (row.source_type === "invoice") return "/invoices";
  if (row.source_type === "employee_salary") return "/salaries";
  return "/";
}

function formatValue(value: unknown, module: string) {
  if (value == null) return "-";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  if (module === "inventory" || module === "invoice_receivables") {
    return numeric.toLocaleString("en-PK", { maximumFractionDigits: 2 });
  }
  return pkr(numeric);
}

function ActionButtons({ row, isAdmin }: { row: any; isAdmin: boolean }) {
  const qc = useQueryClient();
  const reviewFn = useServerFn(reviewAiWatchdogAlert);
  const mut = useMutation({
    mutationFn: (status: "reviewed" | "dismissed" | "resolved") =>
      reviewFn({ data: { alert_id: row.id, status } }),
    onSuccess: () => {
      toast.success("Watchdog alert updated");
      qc.invalidateQueries({ queryKey: ["ai-watchdog-alerts"] });
      qc.invalidateQueries({ queryKey: ["ai-watchdog-dashboard-summary"] });
    },
    onError: (error: any) => toast.error(error?.message ?? "Could not update alert"),
  });

  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Button asChild size="sm" variant="outline">
        <Link to={relatedUrl(row) as any}>
          <ExternalLink className="mr-2 h-4 w-4" />
          Open
        </Link>
      </Button>
      {isAdmin && row.status !== "reviewed" && (
        <Button
          size="sm"
          variant="outline"
          disabled={mut.isPending}
          onClick={() => mut.mutate("reviewed")}
        >
          Mark Reviewed
        </Button>
      )}
      {isAdmin && row.status !== "dismissed" && (
        <Button
          size="sm"
          variant="outline"
          disabled={mut.isPending}
          onClick={() => mut.mutate("dismissed")}
        >
          Dismiss
        </Button>
      )}
      {isAdmin && row.status !== "resolved" && (
        <Button size="sm" disabled={mut.isPending} onClick={() => mut.mutate("resolved")}>
          Resolve
        </Button>
      )}
    </div>
  );
}

function AiWatchdogPage() {
  const search = Route.useSearch();
  const { data: roles = [], isLoading } = useMyRoles();
  const isAdmin = roles.includes("admin");
  const canRead = roles.includes("admin") || roles.includes("moderator") || roles.includes("staff");
  const listFn = useServerFn(listAiWatchdogAlerts);
  const [module, setModule] = useState<WatchdogModule | "all">("all");
  const [severity, setSeverity] = useState<"all" | "low" | "medium" | "high" | "critical">("all");
  const [status, setStatus] = useState<"all" | "new" | "reviewed" | "dismissed" | "resolved">(
    "all",
  );

  const alertsQ = useQuery({
    queryKey: ["ai-watchdog-alerts", module, severity, status],
    queryFn: () => listFn({ data: { module, severity, status } }),
    enabled: canRead,
  });

  const rows = useMemo(() => alertsQ.data?.rows ?? [], [alertsQ.data?.rows]);
  const highlightedRows = useMemo(() => {
    if (!search.alert_id) return rows;
    return [...rows].sort((a: any, b: any) =>
      a.id === search.alert_id ? -1 : b.id === search.alert_id ? 1 : 0,
    );
  }, [rows, search.alert_id]);
  const summary = alertsQ.data?.summary ?? {};

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading access...</div>;
  if (!canRead) {
    return (
      <Card>
        <CardContent className="py-8 text-sm text-muted-foreground">
          AI Watchdog is not available for this role.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight md:text-3xl">
            <BrainCircuit className="h-7 w-7 text-primary" />
            AI Business Watchdog
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Deterministic and statistical anomaly alerts. AI explanations are advisory only.
          </p>
        </div>
        <Button variant="outline" onClick={() => alertsQ.refetch()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      {alertsQ.data?.migration_required && (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="py-4 text-sm text-muted-foreground">
            AI Watchdog migration has not been applied yet.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-4">
        <Metric label="Critical" value={Number((summary as any).critical ?? 0)} tone="critical" />
        <Metric label="High" value={Number((summary as any).high ?? 0)} tone="high" />
        <Metric label="Medium" value={Number((summary as any).medium ?? 0)} tone="medium" />
        <Metric label="New" value={Number((summary as any).new ?? 0)} tone="new" />
      </div>

      <Card>
        <CardHeader className="gap-4">
          <CardTitle className="text-base">Alerts</CardTitle>
          <div className="grid gap-3 md:grid-cols-3">
            <Select value={module} onValueChange={(value) => setModule(value as any)}>
              <SelectTrigger>
                <SelectValue placeholder="Module" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All modules</SelectItem>
                {WATCHDOG_MODULES.map((key) => (
                  <SelectItem key={key} value={key}>
                    {moduleLabels[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={severity} onValueChange={(value) => setSeverity(value as any)}>
              <SelectTrigger>
                <SelectValue placeholder="Severity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All severities</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={(value) => setStatus(value as any)}>
              <SelectTrigger>
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="new">New</SelectItem>
                <SelectItem value="reviewed">Reviewed</SelectItem>
                <SelectItem value="dismissed">Dismissed</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {alertsQ.isError ? (
            <div className="m-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              Could not load AI Watchdog alerts: {(alertsQ.error as Error)?.message}
            </div>
          ) : (
            <>
              <div className="desktop-table overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Detected</TableHead>
                      <TableHead>Module</TableHead>
                      <TableHead>Severity</TableHead>
                      <TableHead>Actual / Expected</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>AI / Recommendation</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {highlightedRows.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={8}
                          className="py-8 text-center text-sm text-muted-foreground"
                        >
                          No AI Watchdog alerts.
                        </TableCell>
                      </TableRow>
                    ) : (
                      highlightedRows.map((row: any) => (
                        <TableRow
                          key={row.id}
                          className={row.id === search.alert_id ? "bg-primary/5" : undefined}
                        >
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                            {new Date(row.detected_at).toLocaleString()}
                          </TableCell>
                          <TableCell>
                            <div className="font-medium">
                              {moduleLabels[row.module as WatchdogModule] ?? row.module}
                            </div>
                            <div className="text-xs text-muted-foreground">{row.anomaly_type}</div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={severityTone(row.severity)}>
                              {row.severity}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs tabular">
                            <div>Actual: {formatValue(row.actual_value, row.module)}</div>
                            <div>Expected: {formatValue(row.expected_value, row.module)}</div>
                            <div>
                              Variance: {formatValue(row.absolute_variance, row.module)}
                              {row.percentage_variance != null
                                ? ` (${Number(row.percentage_variance).toFixed(1)}%)`
                                : ""}
                            </div>
                          </TableCell>
                          <TableCell className="max-w-xs text-xs text-muted-foreground">
                            {row.deterministic_reason}
                          </TableCell>
                          <TableCell className="max-w-sm text-xs text-muted-foreground">
                            {row.ai_explanation && <p>{row.ai_explanation}</p>}
                            <p className={row.ai_explanation ? "mt-2" : undefined}>
                              {row.recommendation ?? "-"}
                            </p>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={statusTone(row.status)}>
                              {row.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <ActionButtons row={row} isAdmin={isAdmin} />
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
              <div className="mobile-card-list">
                {highlightedRows.length === 0 ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    No AI Watchdog alerts.
                  </div>
                ) : (
                  highlightedRows.map((row: any) => (
                    <div
                      key={row.id}
                      className={`mobile-data-card space-y-3 ${row.id === search.alert_id ? "border-primary/50" : ""}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-semibold">
                            {moduleLabels[row.module as WatchdogModule] ?? row.module}
                          </div>
                          <div className="text-xs text-muted-foreground">{row.anomaly_type}</div>
                        </div>
                        <Badge variant="outline" className={severityTone(row.severity)}>
                          {row.severity}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{row.deterministic_reason}</p>
                      <div className="rounded-md border border-border bg-muted/20 p-3 text-xs tabular">
                        <div>Actual: {formatValue(row.actual_value, row.module)}</div>
                        <div>Expected: {formatValue(row.expected_value, row.module)}</div>
                        <div>
                          Variance: {formatValue(row.absolute_variance, row.module)}
                          {row.percentage_variance != null
                            ? ` (${Number(row.percentage_variance).toFixed(1)}%)`
                            : ""}
                        </div>
                      </div>
                      <div className="mobile-data-row">
                        <span>Status</span>
                        <span>{row.status}</span>
                      </div>
                      {(row.ai_explanation || row.recommendation) && (
                        <div className="text-xs text-muted-foreground">
                          {row.ai_explanation && <p>{row.ai_explanation}</p>}
                          {row.recommendation && <p className="mt-2">{row.recommendation}</p>}
                        </div>
                      )}
                      <ActionButtons row={row} isAdmin={isAdmin} />
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "critical" | "high" | "medium" | "new";
}) {
  const toneClass =
    tone === "critical"
      ? "border-destructive/30 text-destructive"
      : tone === "high"
        ? "border-warning/30 text-warning"
        : tone === "medium"
          ? "border-primary/30 text-primary"
          : "border-border text-foreground";
  return (
    <Card className={toneClass}>
      <CardContent className="p-4">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="tabular mt-1 text-2xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}
