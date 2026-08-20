import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { format } from "date-fns";
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
import { classifyAuditDate } from "@/lib/stock-audits";
import { useIsAdmin, useIsAdminOrModerator, useIsStaffOnly } from "@/lib/roles";
import {
  ensureDueStockAudit,
  getStockAuditDetail,
  listStockAudits,
  reconcileAndLockStockAudit,
  submitStockAuditManagementCount,
  submitStockAuditStaffCount,
} from "@/lib/stock-audits.functions";

export const Route = createFileRoute("/_authenticated/stock-audits")({
  head: () => ({ meta: [{ title: "Stock Audits - Fry Guys CRM" }] }),
  component: StockAuditsPage,
});

function todayIso() {
  return format(new Date(), "yyyy-MM-dd");
}

function statusTone(status: string) {
  if (status === "locked") return "border-success/30 text-success";
  if (status === "ready_for_reconciliation") return "border-warning/30 text-warning";
  return "border-muted-foreground/30 text-muted-foreground";
}

function AuditDetail({ auditId }: { auditId: string }) {
  const qc = useQueryClient();
  const detailFn = useServerFn(getStockAuditDetail);
  const staffFn = useServerFn(submitStockAuditStaffCount);
  const mgmtFn = useServerFn(submitStockAuditManagementCount);
  const reconcileFn = useServerFn(reconcileAndLockStockAudit);
  const { isAdmin } = useIsAdmin();
  const { isAdminOrModerator } = useIsAdminOrModerator();
  const { isStaffOnly } = useIsStaffOnly();

  const [staffCounts, setStaffCounts] = useState<Record<string, string>>({});
  const [mgmtCounts, setMgmtCounts] = useState<Record<string, string>>({});
  const [reconciledCounts, setReconciledCounts] = useState<Record<string, string>>({});
  const [reconciledReasons, setReconciledReasons] = useState<Record<string, string>>({});

  const detailQ = useQuery({
    queryKey: ["stock-audit-detail", auditId],
    queryFn: () => detailFn({ data: { audit_id: auditId } }),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["stock-audit-detail", auditId] });
    qc.invalidateQueries({ queryKey: ["stock-audits"] });
  };

  const staffMut = useMutation({
    mutationFn: () =>
      staffFn({
        data: {
          audit_id: auditId,
          items: items.map((i: any) => ({
            audit_item_id: i.id,
            physical_quantity: Number(staffCounts[i.id] ?? ""),
          })),
          notes: null,
        },
      }),
    onSuccess: () => {
      toast.success("Staff count submitted");
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Submission failed"),
  });

  const mgmtMut = useMutation({
    mutationFn: () =>
      mgmtFn({
        data: {
          audit_id: auditId,
          items: items.map((i: any) => ({
            audit_item_id: i.id,
            physical_quantity: Number(mgmtCounts[i.id] ?? ""),
          })),
          notes: null,
        },
      }),
    onSuccess: () => {
      toast.success("Management count submitted");
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Submission failed"),
  });

  const reconcileMut = useMutation({
    mutationFn: () =>
      reconcileFn({
        data: {
          audit_id: auditId,
          reconciled_items: items.map((i: any) => ({
            audit_item_id: i.id,
            reconciled_quantity: Number(reconciledCounts[i.id] ?? i.system_quantity_snapshot),
            reconciliation_reason: reconciledReasons[i.id] ?? null,
          })),
          approval_notes: null,
        },
      }),
    onSuccess: () => {
      toast.success("Audit reconciled and locked");
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Reconciliation failed"),
  });

  if (detailQ.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const audit = detailQ.data?.audit;
  const items = detailQ.data?.items ?? [];
  const submissions = detailQ.data?.submissions ?? [];
  if (!audit) return <p className="text-sm text-muted-foreground">Audit not found.</p>;

  const staffSubmitted = submissions.some((s: any) => s.participant_type === "staff");
  const mgmtSubmitted = submissions.some((s: any) => s.participant_type === "management");
  const locked = audit.status === "locked";
  const readyToReconcile = audit.status === "ready_for_reconciliation";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium">
            {audit.facility_name} · {audit.audit_type}
          </div>
          <div className="text-xs text-muted-foreground">{audit.audit_date}</div>
        </div>
        <Badge variant="outline" className={statusTone(audit.status)}>
          {audit.status}
        </Badge>
      </div>

      {locked && (
        <div className="rounded-md border border-success/30 bg-success/5 p-3 text-xs text-success">
          This audit is locked and read-only.
        </div>
      )}

      <div className="desktop-table overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead>System Stock</TableHead>
              {isStaffOnly && !staffSubmitted && <TableHead>Your Count</TableHead>}
              {isAdminOrModerator && !mgmtSubmitted && <TableHead>Management Count</TableHead>}
              {isAdmin && readyToReconcile && <TableHead>Reconciled</TableHead>}
              {isAdmin && readyToReconcile && <TableHead>Reason</TableHead>}
              {(locked || (!isStaffOnly && !isAdminOrModerator)) && (
                <TableHead>Reconciled</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item: any) => (
              <TableRow key={item.id}>
                <TableCell className="text-xs">
                  {item.item_name_snapshot} {item.unit_snapshot ? `(${item.unit_snapshot})` : ""}
                </TableCell>
                <TableCell className="text-xs tabular">{item.system_quantity_snapshot}</TableCell>
                {isStaffOnly && !staffSubmitted && (
                  <TableCell>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      className="h-8 w-24"
                      value={staffCounts[item.id] ?? ""}
                      onChange={(e) => setStaffCounts((c) => ({ ...c, [item.id]: e.target.value }))}
                    />
                  </TableCell>
                )}
                {isAdminOrModerator && !mgmtSubmitted && (
                  <TableCell>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      className="h-8 w-24"
                      value={mgmtCounts[item.id] ?? ""}
                      onChange={(e) => setMgmtCounts((c) => ({ ...c, [item.id]: e.target.value }))}
                    />
                  </TableCell>
                )}
                {isAdmin && readyToReconcile && (
                  <>
                    <TableCell>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        className="h-8 w-24"
                        value={reconciledCounts[item.id] ?? ""}
                        onChange={(e) =>
                          setReconciledCounts((c) => ({ ...c, [item.id]: e.target.value }))
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        className="h-8 w-40"
                        placeholder="Reason if different"
                        value={reconciledReasons[item.id] ?? ""}
                        onChange={(e) =>
                          setReconciledReasons((c) => ({ ...c, [item.id]: e.target.value }))
                        }
                      />
                    </TableCell>
                  </>
                )}
                {(locked || (!isStaffOnly && !isAdminOrModerator)) && (
                  <TableCell className="text-xs tabular text-muted-foreground">
                    {item.reconciled_quantity ?? "—"}
                    {item.variance_quantity != null && Number(item.variance_quantity) !== 0 && (
                      <span className="ml-1 text-warning">
                        ({item.variance_quantity > 0 ? "+" : ""}
                        {item.variance_quantity})
                      </span>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="mobile-card-list px-0">
        {items.map((item: any) => (
          <div key={item.id} className="mobile-data-card space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="font-semibold">
                {item.item_name_snapshot} {item.unit_snapshot ? `(${item.unit_snapshot})` : ""}
              </div>
              <span className="tabular text-sm text-muted-foreground">
                System {item.system_quantity_snapshot}
              </span>
            </div>
            {isStaffOnly && !staffSubmitted && (
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="Your count"
                value={staffCounts[item.id] ?? ""}
                onChange={(e) => setStaffCounts((c) => ({ ...c, [item.id]: e.target.value }))}
              />
            )}
            {isAdminOrModerator && !mgmtSubmitted && (
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="Management count"
                value={mgmtCounts[item.id] ?? ""}
                onChange={(e) => setMgmtCounts((c) => ({ ...c, [item.id]: e.target.value }))}
              />
            )}
            {isAdmin && readyToReconcile && (
              <div className="grid gap-2">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Reconciled quantity"
                  value={reconciledCounts[item.id] ?? ""}
                  onChange={(e) =>
                    setReconciledCounts((c) => ({ ...c, [item.id]: e.target.value }))
                  }
                />
                <Input
                  placeholder="Reason if different"
                  value={reconciledReasons[item.id] ?? ""}
                  onChange={(e) =>
                    setReconciledReasons((c) => ({ ...c, [item.id]: e.target.value }))
                  }
                />
              </div>
            )}
            {(locked || (!isStaffOnly && !isAdminOrModerator)) && (
              <div className="mobile-data-row">
                <span>Reconciled</span>
                <span>
                  {item.reconciled_quantity ?? "-"}
                  {item.variance_quantity != null && Number(item.variance_quantity) !== 0
                    ? ` (${item.variance_quantity > 0 ? "+" : ""}${item.variance_quantity})`
                    : ""}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {isStaffOnly && !staffSubmitted && !locked && (
          <Button
            size="sm"
            disabled={staffMut.isPending || items.some((i: any) => !staffCounts[i.id])}
            onClick={() => staffMut.mutate()}
          >
            Submit Staff Count (all items required)
          </Button>
        )}
        {isAdminOrModerator && !mgmtSubmitted && !locked && (
          <Button
            size="sm"
            disabled={mgmtMut.isPending || items.some((i: any) => !mgmtCounts[i.id])}
            onClick={() => mgmtMut.mutate()}
          >
            Submit Management Count (all items required)
          </Button>
        )}
        {isAdmin && readyToReconcile && (
          <Button
            size="sm"
            disabled={reconcileMut.isPending || items.some((i: any) => !reconciledCounts[i.id])}
            onClick={() => reconcileMut.mutate()}
          >
            Reconcile & Lock
          </Button>
        )}
      </div>
    </div>
  );
}

function StockAuditsPage() {
  const { isAdmin } = useIsAdmin();
  const { isAdminOrModerator } = useIsAdminOrModerator();
  const listFn = useServerFn(listStockAudits);
  const ensureFn = useServerFn(ensureDueStockAudit);
  const qc = useQueryClient();

  const listQ = useQuery({ queryKey: ["stock-audits"], queryFn: () => listFn({}) });
  const dateClass = classifyAuditDate(todayIso());

  const ensureMut = useMutation({
    mutationFn: () => ensureFn({ data: { audit_date: todayIso() } }),
    onSuccess: () => {
      toast.success("Audit session ready");
      qc.invalidateQueries({ queryKey: ["stock-audits"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not create audit"),
  });

  const rows = listQ.data?.rows ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Stock Audits</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Physical raw-material audits on the 15th and final calendar day of each month. Single
          production facility.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Today</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            {todayIso()} —{" "}
            {dateClass ? (
              <Badge variant="outline" className="border-warning/30 text-warning">
                {dateClass === "mid_month" ? "Mid-month audit day" : "Month-end audit day"}
              </Badge>
            ) : (
              <span className="text-muted-foreground">Not a scheduled audit date</span>
            )}
          </div>
          {isAdminOrModerator && dateClass && (
            <Button size="sm" onClick={() => ensureMut.mutate()} disabled={ensureMut.isPending}>
              Create/Open Today's Audit
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Audit Sessions</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="desktop-table overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Facility</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      No audit sessions yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row: any) => (
                    <TableRow key={row.id}>
                      <TableCell className="text-xs">{row.audit_date}</TableCell>
                      <TableCell className="text-xs">{row.audit_type}</TableCell>
                      <TableCell className="text-xs">{row.facility_name}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={statusTone(row.status)}>
                          {row.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button size="sm" variant="outline">
                              Open
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-2xl">
                            <DialogHeader>
                              <DialogTitle>Audit Detail</DialogTitle>
                            </DialogHeader>
                            <AuditDetail auditId={row.id} />
                            <DialogFooter />
                          </DialogContent>
                        </Dialog>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          <div className="mobile-card-list">
            {rows.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No audit sessions yet.
              </div>
            ) : (
              rows.map((row: any) => (
                <div key={row.id} className="mobile-data-card space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold">{row.audit_date}</div>
                      <div className="text-xs text-muted-foreground">{row.facility_name}</div>
                    </div>
                    <Badge variant="outline" className={statusTone(row.status)}>
                      {row.status}
                    </Badge>
                  </div>
                  <div className="mobile-data-row">
                    <span>Type</span>
                    <span>{row.audit_type}</span>
                  </div>
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button variant="outline">Open Audit</Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl">
                      <DialogHeader>
                        <DialogTitle>Audit Detail</DialogTitle>
                      </DialogHeader>
                      <AuditDetail auditId={row.id} />
                      <DialogFooter />
                    </DialogContent>
                  </Dialog>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
