import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { fetchInvoices } from "@/lib/queries";
import { pkr, fmtDate } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, Undo2, AlertTriangle } from "lucide-react";
import { useMemo, useState, useEffect } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/returns")({
  head: () => ({ meta: [{ title: "Returns & Damaged Goods — TFC CRM" }] }),
  component: ReturnsPage,
});

const RETURN_REASONS = ["Wrong Item", "Quality Issue", "Excess Quantity", "Other"];
const RETURN_STATUSES = ["Pending", "Processed", "Refunded"] as const;
const DAMAGE_CATEGORIES = ["Expired", "Damaged", "Spoiled"];

function statusBadgeClass(s: string) {
  switch (s) {
    case "Pending":
      return "border-yellow-500/40 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400";
    case "Processed":
      return "border-blue-500/40 bg-blue-500/10 text-blue-600 dark:text-blue-400";
    case "Refunded":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
    default:
      return "";
  }
}

function categoryBadgeClass(c: string) {
  switch (c) {
    case "Expired":
      return "border-orange-500/40 bg-orange-500/10 text-orange-600 dark:text-orange-400";
    case "Damaged":
      return "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400";
    case "Spoiled":
      return "border-amber-600/40 bg-amber-600/10 text-amber-700 dark:text-amber-400";
    default:
      return "";
  }
}

async function fetchReturns() {
  const { data, error } = await supabase
    .from("returns")
    .select("*, invoices(id, invoice_no)")
    .order("return_date", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

async function fetchDamaged() {
  const { data, error } = await supabase
    .from("damaged_stock")
    .select("*")
    .order("loss_date", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

function inThisMonth(dateStr: string | null | undefined) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

function ReturnsPage() {
  const qc = useQueryClient();
  const returnsQ = useQuery({ queryKey: ["returns"], queryFn: fetchReturns });
  const damagedQ = useQuery({ queryKey: ["damaged_stock"], queryFn: fetchDamaged });
  const invoicesQ = useQuery({ queryKey: ["invoices"], queryFn: fetchInvoices });

  const returns = useMemo(() => (returnsQ.data ?? []) as any[], [returnsQ.data]);
  const damaged = useMemo(() => (damagedQ.data ?? []) as any[], [damagedQ.data]);

  const summary = useMemo(() => {
    const returnValMTD = returns
      .filter((r) => inThisMonth(r.return_date))
      .reduce((s, r) => s + Number(r.total_return_value || 0), 0);
    const damagedValMTD = damaged
      .filter((d) => inThisMonth(d.loss_date))
      .reduce((s, d) => s + Number(d.total_loss_value || 0), 0);
    const numReturnsMTD = returns.filter((r) => inThisMonth(r.return_date)).length;
    const totalOverall =
      returns.reduce((s, r) => s + Number(r.total_return_value || 0), 0) +
      damaged.reduce((s, d) => s + Number(d.total_loss_value || 0), 0);
    return { returnValMTD, damagedValMTD, numReturnsMTD, totalOverall };
  }, [returns, damaged]);

  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  const [editingReturn, setEditingReturn] = useState<any | null>(null);
  const [damagedDialogOpen, setDamagedDialogOpen] = useState(false);
  const [editingDamaged, setEditingDamaged] = useState<any | null>(null);

  async function deleteReturn(id: string) {
    if (!confirm("Delete this return entry?")) return;
    const { error } = await supabase.from("returns").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Return deleted");
    qc.invalidateQueries({ queryKey: ["returns"] });
  }

  async function deleteDamaged(id: string) {
    if (!confirm("Delete this damaged/expired entry?")) return;
    const { error } = await supabase.from("damaged_stock").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Entry deleted");
    qc.invalidateQueries({ queryKey: ["damaged_stock"] });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold">Returns & Damaged Goods</h1>
          <p className="text-sm text-muted-foreground">
            Track customer returns and internal stock losses.
          </p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <SummaryCard
          icon={<Undo2 className="h-4 w-4" />}
          label="Return Value (MTD)"
          value={pkr(summary.returnValMTD)}
          tone="warn"
        />
        <SummaryCard
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Damaged/Expired (MTD)"
          value={pkr(summary.damagedValMTD)}
          tone="danger"
        />
        <SummaryCard
          icon={<Undo2 className="h-4 w-4" />}
          label="# Returns (MTD)"
          value={String(summary.numReturnsMTD)}
        />
        <SummaryCard
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Total Overall Loss"
          value={pkr(summary.totalOverall)}
          tone="danger"
        />
      </div>

      <Tabs defaultValue="returns" className="space-y-4">
        <TabsList>
          <TabsTrigger value="returns">Customer Returns</TabsTrigger>
          <TabsTrigger value="damaged">Damaged & Expired Stock</TabsTrigger>
        </TabsList>

        {/* Customer Returns Tab */}
        <TabsContent value="returns" className="space-y-4">
          <div className="flex justify-end">
            <Dialog
              open={returnDialogOpen}
              onOpenChange={(o) => {
                setReturnDialogOpen(o);
                if (!o) setEditingReturn(null);
              }}
            >
              <DialogTrigger asChild>
                <Button className="gap-2" data-financial-action>
                  <Plus className="h-4 w-4" /> Log Return
                </Button>
              </DialogTrigger>
              <ReturnFormDialog
                editing={editingReturn}
                invoices={(invoicesQ.data ?? []) as any[]}
                onDone={() => {
                  setReturnDialogOpen(false);
                  setEditingReturn(null);
                  qc.invalidateQueries({ queryKey: ["returns"] });
                }}
              />
            </Dialog>
          </div>

          <Card>
            <CardContent className="p-0">
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-left">
                    <tr>
                      <Th>Return ID</Th>
                      <Th>Invoice</Th>
                      <Th>Client</Th>
                      <Th>Item</Th>
                      <Th className="text-right">Qty (kg)</Th>
                      <Th className="text-right">Value</Th>
                      <Th>Date</Th>
                      <Th>Reason</Th>
                      <Th>Status</Th>
                      <Th className="text-right">Actions</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {returns.length === 0 && (
                      <tr>
                        <td colSpan={10} className="p-6 text-center text-muted-foreground">
                          No returns logged yet.
                        </td>
                      </tr>
                    )}
                    {returns.map((r) => (
                      <tr key={r.id} className="border-t hover:bg-muted/30">
                        <Td className="font-mono">{r.return_no}</Td>
                        <Td className="font-mono text-xs">{r.invoices?.invoice_no ?? "—"}</Td>
                        <Td>{r.client_name ?? "—"}</Td>
                        <Td>{r.item_description}</Td>
                        <Td className="text-right tabular-nums">
                          {Number(r.return_qty).toLocaleString()}
                        </Td>
                        <Td className="text-right tabular-nums text-orange-600 dark:text-orange-400 font-medium">
                          {pkr(r.total_return_value)}
                        </Td>
                        <Td>{fmtDate(r.return_date)}</Td>
                        <Td>{r.reason ?? "—"}</Td>
                        <Td>
                          <Badge variant="outline" className={statusBadgeClass(r.status)}>
                            {r.status}
                          </Badge>
                        </Td>
                        <Td className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => {
                                setEditingReturn(r);
                                setReturnDialogOpen(true);
                              }}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              data-financial-action
                              onClick={() => deleteReturn(r.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="md:hidden divide-y">
                {returns.length === 0 && (
                  <div className="p-6 text-center text-muted-foreground text-sm">
                    No returns logged yet.
                  </div>
                )}
                {returns.map((r) => (
                  <div key={r.id} className="p-4 space-y-2">
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="font-mono text-sm font-semibold">{r.return_no}</div>
                        <div className="text-xs text-muted-foreground">
                          {r.client_name ?? "—"} · {fmtDate(r.return_date)}
                        </div>
                      </div>
                      <Badge variant="outline" className={statusBadgeClass(r.status)}>
                        {r.status}
                      </Badge>
                    </div>
                    <div className="text-sm">{r.item_description}</div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">
                        {Number(r.return_qty)} kg · {r.reason ?? "—"}
                      </span>
                      <span className="font-medium text-orange-600 dark:text-orange-400">
                        {pkr(r.total_return_value)}
                      </span>
                    </div>
                    <div className="flex gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        onClick={() => {
                          setEditingReturn(r);
                          setReturnDialogOpen(true);
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        data-financial-action
                        onClick={() => deleteReturn(r.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Damaged Tab */}
        <TabsContent value="damaged" className="space-y-4">
          <div className="flex justify-end">
            <Dialog
              open={damagedDialogOpen}
              onOpenChange={(o) => {
                setDamagedDialogOpen(o);
                if (!o) setEditingDamaged(null);
              }}
            >
              <DialogTrigger asChild>
                <Button className="gap-2" data-financial-action>
                  <Plus className="h-4 w-4" /> Log Damage/Expiry
                </Button>
              </DialogTrigger>
              <DamagedFormDialog
                editing={editingDamaged}
                onDone={() => {
                  setDamagedDialogOpen(false);
                  setEditingDamaged(null);
                  qc.invalidateQueries({ queryKey: ["damaged_stock"] });
                }}
              />
            </Dialog>
          </div>

          <Card>
            <CardContent className="p-0">
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-left">
                    <tr>
                      <Th>Entry ID</Th>
                      <Th>Item</Th>
                      <Th>Category</Th>
                      <Th className="text-right">Qty Lost (kg)</Th>
                      <Th className="text-right">Unit Cost</Th>
                      <Th className="text-right">Total Loss</Th>
                      <Th>Date</Th>
                      <Th>Notes</Th>
                      <Th className="text-right">Actions</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {damaged.length === 0 && (
                      <tr>
                        <td colSpan={9} className="p-6 text-center text-muted-foreground">
                          No entries logged yet.
                        </td>
                      </tr>
                    )}
                    {damaged.map((d) => (
                      <tr key={d.id} className="border-t hover:bg-muted/30">
                        <Td className="font-mono">{d.entry_no}</Td>
                        <Td>{d.item_description}</Td>
                        <Td>
                          <Badge variant="outline" className={categoryBadgeClass(d.category)}>
                            {d.category}
                          </Badge>
                        </Td>
                        <Td className="text-right tabular-nums">
                          {Number(d.qty_lost).toLocaleString()}
                        </Td>
                        <Td className="text-right tabular-nums">{pkr(d.unit_cost)}</Td>
                        <Td className="text-right tabular-nums text-red-600 dark:text-red-400 font-medium">
                          {pkr(d.total_loss_value)}
                        </Td>
                        <Td>{fmtDate(d.loss_date)}</Td>
                        <Td className="max-w-[200px] truncate text-muted-foreground">
                          {d.notes ?? "—"}
                        </Td>
                        <Td className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => {
                                setEditingDamaged(d);
                                setDamagedDialogOpen(true);
                              }}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              data-financial-action
                              onClick={() => deleteDamaged(d.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="md:hidden divide-y">
                {damaged.length === 0 && (
                  <div className="p-6 text-center text-muted-foreground text-sm">
                    No entries logged yet.
                  </div>
                )}
                {damaged.map((d) => (
                  <div key={d.id} className="p-4 space-y-2">
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="font-mono text-sm font-semibold">{d.entry_no}</div>
                        <div className="text-xs text-muted-foreground">
                          {fmtDate(d.loss_date)}
                          {d.batch_no ? ` · Batch ${d.batch_no}` : ""}
                        </div>
                      </div>
                      <Badge variant="outline" className={categoryBadgeClass(d.category)}>
                        {d.category}
                      </Badge>
                    </div>
                    <div className="text-sm">{d.item_description}</div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">
                        {Number(d.qty_lost)} kg × {pkr(d.unit_cost)}
                      </span>
                      <span className="font-medium text-red-600 dark:text-red-400">
                        {pkr(d.total_loss_value)}
                      </span>
                    </div>
                    <div className="flex gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        onClick={() => {
                          setEditingDamaged(d);
                          setDamagedDialogOpen(true);
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        data-financial-action
                        onClick={() => deleteDamaged(d.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={`px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground ${className}`}
    >
      {children}
    </th>
  );
}
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 align-middle ${className}`}>{children}</td>;
}

function SummaryCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: "danger" | "warn";
}) {
  const toneClass =
    tone === "danger"
      ? "text-red-600 dark:text-red-400"
      : tone === "warn"
        ? "text-orange-600 dark:text-orange-400"
        : "";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
          {icon}
          <span>{label}</span>
        </div>
        <div className={`mt-2 text-xl md:text-2xl font-semibold tabular-nums ${toneClass}`}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

/* -------------------- Return Form Dialog -------------------- */
function ReturnFormDialog({
  editing,
  invoices,
  onDone,
}: {
  editing: any | null;
  invoices: any[];
  onDone: () => void;
}) {
  const [invoiceId, setInvoiceId] = useState<string>("");
  const [clientName, setClientName] = useState("");
  const [branch, setBranch] = useState("");
  const [item, setItem] = useState("");
  const [qty, setQty] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [returnDate, setReturnDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState<string>(RETURN_REASONS[0]);
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<string>("Pending");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editing) {
      setInvoiceId(editing.invoice_id ?? "");
      setClientName(editing.client_name ?? "");
      setBranch(editing.branch ?? "");
      setItem(editing.item_description ?? "");
      setQty(String(editing.return_qty ?? ""));
      setUnitPrice(String(editing.unit_price ?? ""));
      setReturnDate(editing.return_date ?? new Date().toISOString().slice(0, 10));
      setReason(editing.reason ?? RETURN_REASONS[0]);
      setNotes(editing.notes ?? "");
      setStatus(editing.status ?? "Pending");
    } else {
      setInvoiceId("");
      setClientName("");
      setBranch("");
      setItem("");
      setQty("");
      setUnitPrice("");
      setReturnDate(new Date().toISOString().slice(0, 10));
      setReason(RETURN_REASONS[0]);
      setNotes("");
      setStatus("Pending");
    }
  }, [editing]);

  function onInvoiceChange(id: string) {
    setInvoiceId(id);
    const inv = invoices.find((i: any) => i.id === id);
    if (inv) {
      setClientName(inv.clients?.legal_name ?? "");
      setBranch(inv.branches?.branch_name ?? "");
      if (inv.unit_price) setUnitPrice(String(inv.unit_price));
      if (inv.item_description) setItem(inv.item_description);
    }
  }

  const total = (Number(qty) || 0) * (Number(unitPrice) || 0);

  async function save() {
    if (!item.trim()) return toast.error("Item description is required");
    setSaving(true);
    const payload = {
      invoice_id: invoiceId || null,
      client_name: clientName || null,
      branch: branch || null,
      item_description: item,
      return_qty: Number(qty) || 0,
      unit_price: Number(unitPrice) || 0,
      total_return_value: total,
      return_date: returnDate,
      reason,
      notes: notes || null,
      status,
    };
    const { error } = editing
      ? await supabase.from("returns").update(payload).eq("id", editing.id)
      : await supabase.from("returns").insert(payload);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(editing ? "Return updated" : "Return logged");
    onDone();
  }

  return (
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>{editing ? "Edit Return" : "Log Customer Return"}</DialogTitle>
      </DialogHeader>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Original Invoice</Label>
          <Select value={invoiceId} onValueChange={onInvoiceChange}>
            <SelectTrigger>
              <SelectValue placeholder="Select invoice" />
            </SelectTrigger>
            <SelectContent>
              {invoices.map((i: any) => (
                <SelectItem key={i.id} value={i.id}>
                  {i.invoice_no} — {i.clients?.legal_name ?? "—"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Return Date</Label>
          <Input type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Client Name</Label>
          <Input value={clientName} onChange={(e) => setClientName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Branch</Label>
          <Input value={branch} onChange={(e) => setBranch(e.target.value)} />
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label>Item Description</Label>
          <Input value={item} onChange={(e) => setItem(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Return Qty (kg)</Label>
          <Input type="number" step="0.01" value={qty} onChange={(e) => setQty(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Unit Price (Rs./kg)</Label>
          <Input
            type="number"
            step="0.01"
            value={unitPrice}
            onChange={(e) => setUnitPrice(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Total Return Value</Label>
          <Input value={pkr(total)} readOnly className="font-mono" />
        </div>
        <div className="space-y-1.5">
          <Label>Reason</Label>
          <Select value={reason} onValueChange={setReason}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RETURN_REASONS.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label>Status</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RETURN_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label>Notes</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </div>
      </div>
      <DialogFooter>
        <Button data-financial-action onClick={save} disabled={saving}>
          {saving ? "Saving..." : editing ? "Update Return" : "Log Return"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

/* -------------------- Damaged Form Dialog -------------------- */
function DamagedFormDialog({ editing, onDone }: { editing: any | null; onDone: () => void }) {
  const [item, setItem] = useState("");
  const [category, setCategory] = useState<string>(DAMAGE_CATEGORIES[0]);
  const [qty, setQty] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [lossDate, setLossDate] = useState(new Date().toISOString().slice(0, 10));
  const [batchNo, setBatchNo] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editing) {
      setItem(editing.item_description ?? "");
      setCategory(editing.category ?? DAMAGE_CATEGORIES[0]);
      setQty(String(editing.qty_lost ?? ""));
      setUnitCost(String(editing.unit_cost ?? ""));
      setLossDate(editing.loss_date ?? new Date().toISOString().slice(0, 10));
      setBatchNo(editing.batch_no ?? "");
      setNotes(editing.notes ?? "");
    } else {
      setItem("");
      setCategory(DAMAGE_CATEGORIES[0]);
      setQty("");
      setUnitCost("");
      setLossDate(new Date().toISOString().slice(0, 10));
      setBatchNo("");
      setNotes("");
    }
  }, [editing]);

  const total = (Number(qty) || 0) * (Number(unitCost) || 0);

  async function save() {
    if (!item.trim()) return toast.error("Item description is required");
    setSaving(true);
    const payload = {
      item_description: item,
      category,
      qty_lost: Number(qty) || 0,
      unit_cost: Number(unitCost) || 0,
      total_loss_value: total,
      loss_date: lossDate,
      batch_no: batchNo || null,
      notes: notes || null,
    };
    const { error } = editing
      ? await supabase.from("damaged_stock").update(payload).eq("id", editing.id)
      : await supabase.from("damaged_stock").insert(payload);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(editing ? "Entry updated" : "Entry logged");
    onDone();
  }

  return (
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>{editing ? "Edit Entry" : "Log Damaged / Expired Stock"}</DialogTitle>
      </DialogHeader>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1.5 md:col-span-2">
          <Label>Item Description</Label>
          <Input value={item} onChange={(e) => setItem(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Category</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DAMAGE_CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Date of Loss</Label>
          <Input type="date" value={lossDate} onChange={(e) => setLossDate(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Quantity Lost (kg)</Label>
          <Input type="number" step="0.01" value={qty} onChange={(e) => setQty(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Unit Cost (Rs./kg)</Label>
          <Input
            type="number"
            step="0.01"
            value={unitCost}
            onChange={(e) => setUnitCost(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Total Loss Value</Label>
          <Input value={pkr(total)} readOnly className="font-mono" />
        </div>
        <div className="space-y-1.5">
          <Label>Batch / Lot No. (optional)</Label>
          <Input value={batchNo} onChange={(e) => setBatchNo(e.target.value)} />
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label>Notes</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </div>
      </div>
      <DialogFooter>
        <Button data-financial-action onClick={save} disabled={saving}>
          {saving ? "Saving..." : editing ? "Update Entry" : "Log Entry"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
