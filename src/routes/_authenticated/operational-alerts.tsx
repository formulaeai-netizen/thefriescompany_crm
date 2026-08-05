import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useIsAdminOrModerator } from "@/lib/roles";
import { listOperationalAlerts, resolveOperationalAlert } from "@/lib/operational-alerts.functions";
import {
  operationalAlertRoutingFlowKey,
  WHATSAPP_ROUTING_FLOW_LABELS,
} from "@/lib/whatsapp-routing";

export const Route = createFileRoute("/_authenticated/operational-alerts")({
  head: () => ({ meta: [{ title: "Operational Alerts - Fry Guys CRM" }] }),
  component: OperationalAlertsPage,
});

function severityTone(severity: string) {
  if (severity === "critical") return "border-destructive/30 text-destructive";
  if (severity === "warning") return "border-warning/30 text-warning";
  return "border-muted-foreground/30 text-muted-foreground";
}

function ResolveDialog({ alertId, disabled }: { alertId: string; disabled: boolean }) {
  const qc = useQueryClient();
  const resolveFn = useServerFn(resolveOperationalAlert);
  const [notes, setNotes] = useState("");
  const [open, setOpen] = useState(false);

  const mut = useMutation({
    mutationFn: () => resolveFn({ data: { alert_id: alertId, resolution_notes: notes.trim() } }),
    onSuccess: () => {
      toast.success("Alert resolved");
      qc.invalidateQueries({ queryKey: ["operational-alerts"] });
      setOpen(false);
      setNotes("");
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not resolve alert"),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={disabled}>
          Resolve
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Resolve Alert</DialogTitle>
        </DialogHeader>
        <Input
          placeholder="Resolution notes (required)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <DialogFooter>
          <Button disabled={!notes.trim() || mut.isPending} onClick={() => mut.mutate()}>
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OperationalAlertsPage() {
  const { isAdminOrModerator, isLoading } = useIsAdminOrModerator();
  const listFn = useServerFn(listOperationalAlerts);
  const listQ = useQuery({
    queryKey: ["operational-alerts"],
    queryFn: () => listFn({}),
    enabled: isAdminOrModerator,
  });

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading access…</div>;
  if (!isAdminOrModerator) {
    return (
      <Card>
        <CardContent className="py-8 text-sm text-muted-foreground">
          Admin or Moderator access is required.
        </CardContent>
      </Card>
    );
  }

  const rows = listQ.data?.rows ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Operational Alerts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Wastage variance, AI mismatch/unreadable results, rejections and stock-audit variances.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Alerts</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Routing Flow</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Message</TableHead>
                <TableHead>System / Physical / Difference</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>WhatsApp</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                    No alerts.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row: any) => {
                  const flowKey = operationalAlertRoutingFlowKey(row.alert_type);
                  const isStockVariance = row.alert_type === "stock_variance";
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="text-xs">{row.alert_type}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {WHATSAPP_ROUTING_FLOW_LABELS[flowKey]}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={severityTone(row.severity)}>
                          {row.severity}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-xs text-xs text-muted-foreground">
                        {row.message}
                      </TableCell>
                      <TableCell className="text-xs tabular text-muted-foreground">
                        {row.expected_value != null ? (
                          <div>
                            <div>
                              {isStockVariance ? "System" : "Expected"}: {row.expected_value}
                              {row.unit ?? ""}
                            </div>
                            <div>
                              {isStockVariance ? "Physical/Reconciled" : "Actual"}:{" "}
                              {row.actual_value}
                              {row.unit ?? ""}
                            </div>
                            <div>
                              Difference: {row.variance_value}
                              {row.unit ?? ""}
                            </div>
                          </div>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            row.status === "open"
                              ? "border-warning/30 text-warning"
                              : "border-success/30 text-success"
                          }
                        >
                          {row.status}
                        </Badge>
                        {row.status === "resolved" && row.resolution_notes && (
                          <div className="mt-1 text-[10px] text-muted-foreground">
                            {row.resolution_notes}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        {row.whatsapp_notified_at ? (
                          <Badge variant="outline" className="border-success/30 text-success">
                            Notified
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="border-muted-foreground/30 text-muted-foreground"
                          >
                            Not notified
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(row.created_at).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <ResolveDialog alertId={row.id} disabled={row.status !== "open"} />
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
