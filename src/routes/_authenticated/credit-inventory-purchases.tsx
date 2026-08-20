import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FinancialAccountSelect } from "@/components/financial-account-select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import {
  isCreditPurchaseOverdue,
  validateCreditPurchaseFormInput,
  type CreditPurchasePaymentMode,
} from "@/lib/credit-inventory-purchases";
import { useIsAdmin, useIsStaffOnly } from "@/lib/roles";
import { pkr } from "@/lib/format";
import { fetchInventory } from "@/lib/queries";
import { listFinancialAccounts } from "@/lib/financial-accounts.functions";
import {
  cancelCreditPurchase,
  createCreditPurchase,
  listCreditPurchases,
  markCreditPurchasePaid,
  updateCreditPurchase,
} from "@/lib/credit-purchases.functions";

export const Route = createFileRoute("/_authenticated/credit-inventory-purchases")({
  head: () => ({ meta: [{ title: "Credit Inventory Purchases - Fry Guys CRM" }] }),
  component: CreditInventoryPurchasesPage,
});

type FormState = {
  supplier_name: string;
  item_name_snapshot: string;
  amount_due: string;
  quantity: string;
  unit: string;
  due_at: string;
  reminder_lead_hours: string;
  notes: string;
  payment_mode: CreditPurchasePaymentMode;
  paid_from_account_id: string;
  inventory_item_id: string;
};

const EMPTY_FORM: FormState = {
  supplier_name: "",
  item_name_snapshot: "",
  amount_due: "",
  quantity: "",
  unit: "",
  due_at: "",
  reminder_lead_hours: "24",
  notes: "",
  payment_mode: "credit",
  paid_from_account_id: "",
  inventory_item_id: "",
};

function statusTone(status: string) {
  if (status === "paid") return "border-success/30 text-success";
  if (status === "cancelled") return "border-muted-foreground/30 text-muted-foreground";
  return "border-warning/30 text-warning";
}

function paymentModeTone(mode: string) {
  return mode === "cash" ? "border-primary/30 text-primary" : "border-white/20 text-white/70";
}

function reminderStateLabel(row: any) {
  if (row.reminder_sent_at) return "Sent";
  if (row.reminder_queued_at) return "Queued";
  return "Not queued";
}

function CreditInventoryPurchasesPage() {
  const qc = useQueryClient();
  const { isAdmin } = useIsAdmin();
  const { isStaffOnly } = useIsStaffOnly();
  const canCreateOrEdit = isAdmin || isStaffOnly;

  const listFn = useServerFn(listCreditPurchases);
  const createFn = useServerFn(createCreditPurchase);
  const updateFn = useServerFn(updateCreditPurchase);
  const markPaidFn = useServerFn(markCreditPurchasePaid);
  const cancelFn = useServerFn(cancelCreditPurchase);
  const accountsFn = useServerFn(listFinancialAccounts);

  const listQ = useQuery({ queryKey: ["credit-inventory-purchases"], queryFn: () => listFn({}) });
  const inventoryQ = useQuery({ queryKey: ["inventory"], queryFn: fetchInventory });
  const accountsQ = useQuery({
    queryKey: ["financial-accounts"],
    queryFn: () => accountsFn({}),
    enabled: isAdmin || isStaffOnly,
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [cancelReason, setCancelReason] = useState<Record<string, string>>({});
  const [markPaidAccount, setMarkPaidAccount] = useState<Record<string, string>>({});

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["credit-inventory-purchases"] });
    qc.invalidateQueries({ queryKey: ["financial-account-balances"] });
  };

  const createMut = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          supplier_name: form.supplier_name.trim(),
          item_name_snapshot: form.item_name_snapshot.trim(),
          amount_due: Number(form.amount_due),
          due_at: new Date(form.due_at).toISOString(),
          inventory_item_id: form.inventory_item_id || null,
          quantity: form.quantity.trim() ? Number(form.quantity) : null,
          unit: form.unit.trim() || null,
          notes: form.notes.trim() || null,
          reminder_lead_hours: Number(form.reminder_lead_hours) || 24,
          payment_mode: form.payment_mode,
          paid_from_account_id: form.payment_mode === "cash" ? form.paid_from_account_id : null,
        },
      }),
    onSuccess: () => {
      toast.success(
        form.payment_mode === "cash"
          ? "Cash purchase recorded and paid"
          : "Credit purchase created",
      );
      setDialogOpen(false);
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not create credit purchase"),
  });

  const updateMut = useMutation({
    mutationFn: () =>
      updateFn({
        data: {
          purchase_id: editingId as string,
          supplier_name: form.supplier_name.trim(),
          item_name_snapshot: form.item_name_snapshot.trim(),
          amount_due: Number(form.amount_due),
          due_at: new Date(form.due_at).toISOString(),
          inventory_item_id: form.inventory_item_id || null,
          quantity: form.quantity.trim() ? Number(form.quantity) : null,
          unit: form.unit.trim() || null,
          notes: form.notes.trim() || null,
          reminder_lead_hours: Number(form.reminder_lead_hours) || 24,
        },
      }),
    onSuccess: () => {
      toast.success("Credit purchase updated");
      setDialogOpen(false);
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not update credit purchase"),
  });

  const markPaidMut = useMutation({
    mutationFn: (input: { id: string; accountId: string }) =>
      markPaidFn({ data: { purchase_id: input.id, paid_from_account_id: input.accountId } }),
    onSuccess: () => {
      toast.success("Marked as paid");
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not mark as paid"),
  });

  const cancelMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      cancelFn({ data: { purchase_id: id, reason } }),
    onSuccess: () => {
      toast.success("Credit purchase cancelled");
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not cancel"),
  });

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEdit(row: any) {
    setEditingId(row.id);
    setForm({
      supplier_name: row.supplier_name,
      item_name_snapshot: row.item_name_snapshot,
      amount_due: String(row.amount_due),
      quantity: row.quantity != null ? String(row.quantity) : "",
      unit: row.unit ?? "",
      due_at: row.due_at ? row.due_at.slice(0, 16) : "",
      reminder_lead_hours: String(row.reminder_lead_hours ?? 24),
      notes: row.notes ?? "",
      payment_mode: (row.payment_mode as CreditPurchasePaymentMode) ?? "credit",
      paid_from_account_id: row.paid_from_account_id ?? "",
      inventory_item_id: row.inventory_item_id ?? "",
    });
    setDialogOpen(true);
  }

  const formErrors = validateCreditPurchaseFormInput({
    supplier_name: form.supplier_name,
    item_name_snapshot: form.item_name_snapshot,
    amount_due: form.amount_due,
    due_at: form.due_at ? new Date(form.due_at).toISOString() : "",
    reminder_lead_hours: form.reminder_lead_hours,
  });
  const hasErrors = Object.keys(formErrors).length > 0;
  const accountMissing = form.payment_mode === "cash" && !form.paid_from_account_id;

  const rows = listQ.data?.rows ?? [];
  const createdByNames = listQ.data?.createdByNames ?? {};

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">
            Credit Inventory Purchases
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Material/inventory purchases - cash (paid immediately) or credit (payable later, with
            configurable WhatsApp due-reminders).
          </p>
        </div>
        {canCreateOrEdit && (
          <Button data-financial-action onClick={openCreate}>
            New Credit Purchase
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Purchases</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="desktop-table overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Payment Mode</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Reminder Lead</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reminder</TableHead>
                  <TableHead>Created By</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={10}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      No credit purchases yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row: any) => {
                    const overdue = isCreditPurchaseOverdue({
                      status: row.status,
                      due_at: row.due_at,
                    });
                    const canEditRow = canCreateOrEdit && row.status === "unpaid";
                    return (
                      <TableRow key={row.id} className={overdue ? "bg-destructive/5" : ""}>
                        <TableCell className="text-xs">
                          {row.item_name_snapshot}
                          {row.quantity != null && (
                            <span className="ml-1 text-muted-foreground">
                              ({row.quantity} {row.unit ?? ""})
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">{row.supplier_name}</TableCell>
                        <TableCell className="text-xs tabular">{pkr(row.amount_due)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={paymentModeTone(row.payment_mode)}>
                            {row.payment_mode === "cash" ? "Cash" : "Credit"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          {new Date(row.due_at).toLocaleString()}
                          {overdue && (
                            <Badge
                              variant="outline"
                              className="ml-2 border-destructive/40 text-destructive"
                            >
                              Overdue
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">{row.reminder_lead_hours}h</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={statusTone(row.status)}>
                            {row.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {reminderStateLabel(row)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {row.created_by ? (createdByNames[row.created_by] ?? "-") : "-"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            {canEditRow && (
                              <Button size="sm" variant="outline" onClick={() => openEdit(row)}>
                                Edit
                              </Button>
                            )}
                            {isAdmin && row.status === "unpaid" && (
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    data-financial-action
                                    disabled={markPaidMut.isPending}
                                  >
                                    Mark Paid
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Mark this purchase paid?</AlertDialogTitle>
                                    <AlertDialogDescription asChild>
                                      <div>
                                        {row.item_name_snapshot} from {row.supplier_name}. This will
                                        deduct <strong>{pkr(row.amount_due)}</strong> from the
                                        selected account.
                                        <div className="mt-3">
                                          <FinancialAccountSelect
                                            accounts={accountsQ.data?.rows ?? []}
                                            value={markPaidAccount[row.id] ?? ""}
                                            onValueChange={(value) =>
                                              setMarkPaidAccount((current) => ({
                                                ...current,
                                                [row.id]: value,
                                              }))
                                            }
                                            placeholder="Paid from"
                                          />
                                        </div>
                                      </div>
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction
                                      data-financial-action
                                      disabled={!markPaidAccount[row.id]}
                                      onClick={() =>
                                        markPaidMut.mutate({
                                          id: row.id,
                                          accountId: markPaidAccount[row.id],
                                        })
                                      }
                                    >
                                      Mark Paid
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            )}
                            {isAdmin && row.status === "unpaid" && (
                              <Dialog>
                                <DialogTrigger asChild>
                                  <Button size="sm" variant="ghost" className="text-destructive">
                                    Cancel
                                  </Button>
                                </DialogTrigger>
                                <DialogContent>
                                  <DialogHeader>
                                    <DialogTitle>Cancel credit purchase</DialogTitle>
                                  </DialogHeader>
                                  <Input
                                    placeholder="Cancellation reason (required)"
                                    value={cancelReason[row.id] ?? ""}
                                    onChange={(e) =>
                                      setCancelReason((c) => ({ ...c, [row.id]: e.target.value }))
                                    }
                                  />
                                  <DialogFooter>
                                    <Button
                                      variant="destructive"
                                      disabled={
                                        !cancelReason[row.id]?.trim() || cancelMut.isPending
                                      }
                                      onClick={() =>
                                        cancelMut.mutate({
                                          id: row.id,
                                          reason: (cancelReason[row.id] ?? "").trim(),
                                        })
                                      }
                                    >
                                      Confirm Cancel
                                    </Button>
                                  </DialogFooter>
                                </DialogContent>
                              </Dialog>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
          <div className="mobile-card-list">
            {rows.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No credit purchases yet.
              </div>
            ) : (
              rows.map((row: any) => {
                const overdue = isCreditPurchaseOverdue({
                  status: row.status,
                  due_at: row.due_at,
                });
                const canEditRow = canCreateOrEdit && row.status === "unpaid";
                return (
                  <div
                    key={row.id}
                    className={`mobile-data-card space-y-3 ${overdue ? "border-destructive/40 bg-destructive/5" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-semibold">{row.item_name_snapshot}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {row.supplier_name}
                        </div>
                      </div>
                      <Badge variant="outline" className={statusTone(row.status)}>
                        {row.status}
                      </Badge>
                    </div>
                    <div className="mobile-data-row">
                      <span>Amount</span>
                      <span className="font-semibold">{pkr(row.amount_due)}</span>
                    </div>
                    <div className="mobile-data-row">
                      <span>Payment Mode</span>
                      <span>{row.payment_mode === "cash" ? "Cash" : "Credit"}</span>
                    </div>
                    <div className="mobile-data-row">
                      <span>Due</span>
                      <span>{new Date(row.due_at).toLocaleString()}</span>
                    </div>
                    <div className="mobile-data-row">
                      <span>Reminder</span>
                      <span>{reminderStateLabel(row)}</span>
                    </div>
                    <div className="mobile-data-row">
                      <span>Created By</span>
                      <span>{row.created_by ? (createdByNames[row.created_by] ?? "-") : "-"}</span>
                    </div>
                    {row.quantity != null && (
                      <div className="mobile-data-row">
                        <span>Quantity</span>
                        <span>
                          {row.quantity} {row.unit ?? ""}
                        </span>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      {canEditRow && (
                        <Button variant="outline" onClick={() => openEdit(row)}>
                          Edit
                        </Button>
                      )}
                      {isAdmin && row.status === "unpaid" && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              data-financial-action
                              variant="outline"
                              disabled={markPaidMut.isPending}
                            >
                              Mark Paid
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Mark this purchase paid?</AlertDialogTitle>
                              <AlertDialogDescription asChild>
                                <div>
                                  {row.item_name_snapshot} from {row.supplier_name}. This will
                                  deduct <strong>{pkr(row.amount_due)}</strong> from the selected
                                  account.
                                  <div className="mt-3">
                                    <FinancialAccountSelect
                                      accounts={accountsQ.data?.rows ?? []}
                                      value={markPaidAccount[row.id] ?? ""}
                                      onValueChange={(value) =>
                                        setMarkPaidAccount((current) => ({
                                          ...current,
                                          [row.id]: value,
                                        }))
                                      }
                                      placeholder="Paid from"
                                    />
                                  </div>
                                </div>
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                data-financial-action
                                disabled={!markPaidAccount[row.id]}
                                onClick={() =>
                                  markPaidMut.mutate({
                                    id: row.id,
                                    accountId: markPaidAccount[row.id],
                                  })
                                }
                              >
                                Mark Paid
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                      {isAdmin && row.status === "unpaid" && (
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button variant="ghost" className="text-destructive">
                              Cancel
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>Cancel credit purchase</DialogTitle>
                            </DialogHeader>
                            <Input
                              placeholder="Cancellation reason (required)"
                              value={cancelReason[row.id] ?? ""}
                              onChange={(e) =>
                                setCancelReason((c) => ({ ...c, [row.id]: e.target.value }))
                              }
                            />
                            <DialogFooter>
                              <Button
                                variant="destructive"
                                disabled={!cancelReason[row.id]?.trim() || cancelMut.isPending}
                                onClick={() =>
                                  cancelMut.mutate({
                                    id: row.id,
                                    reason: (cancelReason[row.id] ?? "").trim(),
                                  })
                                }
                              >
                                Confirm Cancel
                              </Button>
                            </DialogFooter>
                          </DialogContent>
                        </Dialog>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit" : "New"} Credit Purchase</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs">Payment Mode</Label>
              <Select
                value={form.payment_mode}
                onValueChange={(v) =>
                  setForm({ ...form, payment_mode: v as CreditPurchasePaymentMode })
                }
                disabled={!!editingId}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="credit">
                    Credit (payable later, due-reminders apply)
                  </SelectItem>
                  <SelectItem value="cash">
                    Cash (paid now, debits selected account immediately)
                  </SelectItem>
                </SelectContent>
              </Select>
              {editingId && (
                <p className="text-[11px] text-muted-foreground">
                  Payment mode cannot be changed after creation.
                </p>
              )}
            </div>
            {form.payment_mode === "cash" && (
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-xs">Paid From</Label>
                <FinancialAccountSelect
                  accounts={accountsQ.data?.rows ?? []}
                  value={form.paid_from_account_id}
                  onValueChange={(value) => setForm({ ...form, paid_from_account_id: value })}
                  placeholder="Cash or Bank"
                  disabled={!!editingId}
                />
              </div>
            )}
            <FormField label="Supplier Name" error={formErrors.supplier_name}>
              <Input
                value={form.supplier_name}
                onChange={(e) => setForm({ ...form, supplier_name: e.target.value })}
              />
            </FormField>
            <FormField label="Product / Item Name" error={formErrors.item_name_snapshot}>
              <Input
                value={form.item_name_snapshot}
                onChange={(e) => setForm({ ...form, item_name_snapshot: e.target.value })}
              />
            </FormField>
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs">Inventory Item (optional - updates stock on save)</Label>
              <Select
                value={form.inventory_item_id || "none"}
                onValueChange={(v) =>
                  setForm({ ...form, inventory_item_id: v === "none" ? "" : v })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Not linked to an inventory item" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not linked</SelectItem>
                  {(inventoryQ.data ?? []).map((item: any) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.item_name} ({Number(item.current_stock)} {item.unit ?? ""})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <FormField label="Quantity (optional)">
              <Input
                type="number"
                value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: e.target.value })}
              />
            </FormField>
            <FormField label="Unit (optional)">
              <Input
                value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value })}
              />
            </FormField>
            <FormField label="Amount Due" error={formErrors.amount_due}>
              <Input
                type="number"
                step="0.01"
                value={form.amount_due}
                onChange={(e) => setForm({ ...form, amount_due: e.target.value })}
              />
            </FormField>
            <FormField label="Due Date/Time" error={formErrors.due_at}>
              <Input
                type="datetime-local"
                value={form.due_at}
                onChange={(e) => setForm({ ...form, due_at: e.target.value })}
              />
            </FormField>
            <FormField label="Reminder Lead Hours" error={formErrors.reminder_lead_hours}>
              <Input
                type="number"
                value={form.reminder_lead_hours}
                onChange={(e) => setForm({ ...form, reminder_lead_hours: e.target.value })}
              />
            </FormField>
            <div className="sm:col-span-2">
              <Label className="text-xs">Notes (optional)</Label>
              <Textarea
                rows={2}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              data-financial-action
              disabled={hasErrors || accountMissing || createMut.isPending || updateMut.isPending}
              onClick={() => (editingId ? updateMut.mutate() : createMut.mutate())}
            >
              {editingId ? "Save changes" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FormField({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
