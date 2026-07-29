import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchInvoices, fetchClients, fetchSettings } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import { pkr, fmtDate } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
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
import { Label } from "@/components/ui/label";
import { useMemo, useState } from "react";
import { Plus, FileDown, Trash2, CalendarIcon, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { toast } from "sonner";
import { downloadInvoicePdf } from "@/lib/invoice-pdf";
import { useIsAdmin } from "@/lib/roles";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/invoices/")({
  head: () => ({ meta: [{ title: "Invoices — TFC CRM" }] }),
  component: InvoicesPage,
});

function statusBadge(s: string) {
  const map: Record<string, string> = {
    Done: "bg-success/15 text-success border-success/30",
    "Not Done": "bg-destructive/15 text-destructive border-destructive/30",
    Partial: "bg-warning/15 text-warning border-warning/30",
    Unknown: "bg-muted text-muted-foreground border-border",
  };
  return map[s] ?? "";
}

function InvoicesPage() {
  const qc = useQueryClient();
  const { isAdmin } = useIsAdmin();
  const { data: invoices = [] } = useQuery({ queryKey: ["invoices"], queryFn: fetchInvoices });
  const { data: clients = [] } = useQuery({ queryKey: ["clients"], queryFn: fetchClients });
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const currentMonthKey = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }, []);
  const [monthFilter, setMonthFilter] = useState<string>(currentMonthKey);
  const [dateFilter, setDateFilter] = useState<Date | null>(null);

  const monthOptions = useMemo(() => {
    const set = new Set<string>();
    for (const i of invoices as any[]) {
      const d = new Date(i.date);
      set.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    set.add(currentMonthKey);
    const keys = Array.from(set).sort();
    if (keys.length > 0) {
      const [sy, sm] = keys[0].split("-").map(Number);
      const now = new Date();
      const cy = now.getFullYear();
      const cm = now.getMonth() + 1;
      const filled = new Set<string>();
      let y = sy, m = sm;
      while (y < cy || (y === cy && m <= cm)) {
        filled.add(`${y}-${String(m).padStart(2, "0")}`);
        m++;
        if (m > 12) { m = 1; y++; }
      }
      return Array.from(filled).sort((a, b) => (a < b ? 1 : -1));
    }
    return [currentMonthKey];
  }, [invoices, currentMonthKey]);

  const monthLabel = (key: string) => {
    const [y, m] = key.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  };

  const filtered = useMemo(() => {
    return invoices.filter((i: any) => {
      if (filter !== "all" && i.payment_status !== filter) return false;
      if (search && !(`${i.invoice_no} ${i.clients?.legal_name}`.toLowerCase().includes(search.toLowerCase())))
        return false;
      const d = new Date(i.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (key !== monthFilter) return false;
      if (dateFilter) {
        const dayKey = format(dateFilter, "yyyy-MM-dd");
        if (String(i.date).slice(0, 10) !== dayKey) return false;
      }
      return true;
    });
  }, [invoices, filter, search, monthFilter, dateFilter]);

  const total = filtered.reduce((s: number, i: any) => s + Number(i.amount), 0);

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("invoices").update({ payment_status: status as any }).eq("id", id);
      if (error) throw error;
      if (status === "Done") {
        // Fire-and-forget — don't block UI on Twilio.
        supabase.functions
          .invoke("payment-status-webhook", { body: { invoice_id: id } })
          .catch((e) => console.error("payment-status-webhook failed", e));
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      toast.success("Payment status updated");
    },
  });

  const deleteInvoice = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("invoices")
        .update({ is_deleted: true, deleted_at: new Date().toISOString() } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["invoices-deleted"] });
      toast.success("Invoice archived");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const updateDueDate = useMutation({
    mutationFn: async ({ id, due_date }: { id: string; due_date: string }) => {
      const { error } = await supabase.from("invoices").update({ due_date } as any).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      toast.success("Due date updated");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const handleDownload = async (i: any) => {
    try {
      const client = clients.find((c: any) => c.id === i.client_id);
      const branch = client?.branches?.find((b: any) => b.id === i.branch_id);
      await downloadInvoicePdf({
        invoice_no: i.invoice_no,
        date: i.date,
        due_date: i.due_date,
        amount: Number(i.amount),
        amount_received: Number(i.amount_received ?? 0),
        item: i.item,
        payment_status: i.payment_status,
        client_name: i.clients?.legal_name ?? "Client",
        branch_name: i.branches?.branch_name,
        city: branch?.city ?? null,
        bank_details: settings?.bank_details,
        sales_rep_name: settings?.sales_rep_name,
        sales_rep_phone: settings?.sales_rep_phone,
        unit_price: i.unit_price,
        weight_kg: i.weight_kg,
      });
    } catch (e: any) {
      toast.error("Failed to generate PDF: " + e.message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Invoices</h1>
          <p className="mt-1 text-sm text-muted-foreground">All deliveries. Auto-calculates due date = delivery + 15 days.</p>
        </div>
        <div className="flex w-full flex-col gap-2 md:w-auto md:flex-row md:items-end md:gap-3">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className="w-full md:w-48" />
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-full md:w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="Done">Done</SelectItem>
              <SelectItem value="Not Done">Not Done</SelectItem>
              <SelectItem value="Partial">Partial</SelectItem>
              <SelectItem value="Unknown">Unknown</SelectItem>
            </SelectContent>
          </Select>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="w-full md:w-auto"><Plus className="mr-1 h-4 w-4" /> New invoice</Button>
            </DialogTrigger>
            <NewInvoiceDialog clients={clients} onDone={() => setOpen(false)} isAdmin={isAdmin} />
          </Dialog>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <Label htmlFor="month-filter" className="text-sm font-medium text-muted-foreground">Month</Label>
          <Select value={monthFilter} onValueChange={setMonthFilter}>
            <SelectTrigger id="month-filter" className="h-9 w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {monthOptions.map((k) => (
                <SelectItem key={k} value={k}>{monthLabel(k)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={cn("h-9 gap-2", dateFilter && "border-amber-500/50 text-amber-300")}
              >
                <CalendarIcon className="h-4 w-4" />
                {dateFilter ? format(dateFilter, "PPP") : "Filter by date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={dateFilter ?? undefined}
                onSelect={(d) => d && setDateFilter(d)}
                initialFocus
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>
          {dateFilter && (
            <Button variant="ghost" size="sm" className="h-9" onClick={() => setDateFilter(null)}>
              <X className="mr-1 h-3.5 w-3.5" /> Show all
            </Button>
          )}
        </div>
        <span className="tabular text-sm">
          Total ({dateFilter ? fmtDate(dateFilter) : monthLabel(monthFilter)}):{" "}
          <strong className="text-amber-400">{pkr(total)}</strong>{" "}
          <span className="text-muted-foreground">({filtered.length})</span>
        </span>
      </div>

      <Card className="hidden md:block">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card text-xs uppercase tracking-wider text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-4 py-3 text-left">Invoice</th>
                  <th className="px-4 py-3 text-left">Client / Branch</th>
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-left">Due</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-right">Weight</th>
                  <th className="px-4 py-3 text-right">Rate</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3"></th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((i: any) => (
                  <tr key={i.id} className="border-b border-border/40 transition hover:bg-muted/40">
                    <td className="px-4 py-3 font-mono text-xs">{i.invoice_no}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{i.clients?.legal_name}</div>
                      {i.branches?.branch_name && (
                        <div className="text-xs text-muted-foreground">{i.branches.branch_name}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{fmtDate(i.date)}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {isAdmin ? (
                        <Popover>
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-left hover:bg-muted hover:text-foreground transition-colors"
                              title="Click to edit due date"
                            >
                              <CalendarIcon className="h-3.5 w-3.5 opacity-60" />
                              {fmtDate(i.due_date)}
                            </button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <Calendar
                              mode="single"
                              selected={i.due_date ? new Date(i.due_date) : undefined}
                              onSelect={(d) => {
                                if (!d) return;
                                const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
                                if (iso === i.due_date) return;
                                updateDueDate.mutate({ id: i.id, due_date: iso });
                              }}
                              initialFocus
                              className="p-3 pointer-events-auto"
                            />
                          </PopoverContent>
                        </Popover>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2 py-1">
                          <CalendarIcon className="h-3.5 w-3.5 opacity-60" />
                          {fmtDate(i.due_date)}
                        </span>
                      )}
                    </td>
                    <td className="tabular px-4 py-3 text-right font-semibold">{pkr(Number(i.amount))}</td>
                    <td className="tabular px-4 py-3 text-right text-muted-foreground">{i.weight_kg != null ? `${i.weight_kg} kg` : "—"}</td>
                    <td className="tabular px-4 py-3 text-right text-muted-foreground">{i.unit_price != null ? `Rs. ${Number(i.unit_price).toLocaleString()}/kg` : "—"}</td>
                    <td className="px-4 py-3 text-center">
                      <Badge variant="outline" className={statusBadge(i.payment_status)}>{i.payment_status}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      {isAdmin && (
                        <Select
                          value={i.payment_status}
                          onValueChange={(v) => updateStatus.mutate({ id: i.id, status: v })}
                        >
                          <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Done">Done</SelectItem>
                            <SelectItem value="Not Done">Not Done</SelectItem>
                            <SelectItem value="Partial">Partial</SelectItem>
                            <SelectItem value="Unknown">Unknown</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-primary hover:bg-primary/10"
                          onClick={() => handleDownload(i)}
                          title="Download PDF"
                        >
                          <FileDown className="h-4 w-4" />
                        </Button>
                        {isAdmin && <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-destructive hover:bg-destructive/10"
                              title="Delete invoice"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Archive invoice {i.invoice_no}?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Archive invoice {i.invoice_no} for {pkr(Number(i.amount))}? It will be moved to Deleted Invoices and can be restored later.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => deleteInvoice.mutate(i.id)}
                              >
                                Archive
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3 md:hidden">
        {filtered.length === 0 && (
          <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">No invoices.</CardContent></Card>
        )}
        {filtered.map((i: any) => (
          <div key={i.id} className="space-y-3 rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-bold text-primary break-all">{i.invoice_no}</span>
              <Badge variant="outline" className={statusBadge(i.payment_status)}>{i.payment_status}</Badge>
            </div>
            <div className="min-w-0 text-sm font-semibold text-foreground">
              <div className="truncate">{i.clients?.legal_name}</div>
              {i.branches?.branch_name && (
                <div className="truncate text-xs font-normal text-muted-foreground">{i.branches.branch_name}</div>
              )}
            </div>
            <div className="tabular text-xl font-bold text-primary">{pkr(Number(i.amount))}</div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>📅 {fmtDate(i.date)}</span>
              <span>⏰ Due: {fmtDate(i.due_date)}</span>
            </div>
            {(i.weight_kg != null || i.unit_price != null) && (
              <div className="text-xs text-muted-foreground">
                {i.weight_kg != null ? `${i.weight_kg} kg` : ""}
                {i.unit_price != null ? ` × Rs. ${Number(i.unit_price).toLocaleString()}/kg` : ""}
              </div>
            )}
            <div className="flex items-center gap-2 pt-1">
              {isAdmin ? (
                <Select value={i.payment_status} onValueChange={(v) => updateStatus.mutate({ id: i.id, status: v })}>
                  <SelectTrigger className="h-9 flex-1 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Done">Done</SelectItem>
                    <SelectItem value="Not Done">Not Done</SelectItem>
                    <SelectItem value="Partial">Partial</SelectItem>
                    <SelectItem value="Unknown">Unknown</SelectItem>
                  </SelectContent>
                </Select>
              ) : <div className="flex-1" />}
              <Button size="icon" variant="ghost" className="h-9 w-9 text-primary hover:bg-primary/10" onClick={() => handleDownload(i)}>
                <FileDown className="h-4 w-4" />
              </Button>
              {isAdmin && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="icon" variant="ghost" className="h-9 w-9 text-destructive hover:bg-destructive/10">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Archive invoice {i.invoice_no}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Archive invoice {i.invoice_no} for {pkr(Number(i.amount))}? It will be moved to Deleted Invoices and can be restored later.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => deleteInvoice.mutate(i.id)}>Archive</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function NewInvoiceDialog({ clients, onDone, isAdmin }: { clients: any[]; onDone: () => void; isAdmin: boolean }) {
  const qc = useQueryClient();
  const [clientId, setClientId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [amountOverride, setAmountOverride] = useState("");
  const [overriding, setOverriding] = useState(false);
  const [unitPrice, setUnitPrice] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [item, setItem] = useState("");
  const [addingNewFlavor, setAddingNewFlavor] = useState(false);
  const [newFlavorName, setNewFlavorName] = useState("");
  const [deliveryDate, setDeliveryDate] = useState(new Date().toISOString().slice(0, 10));

  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products" as any)
        .select("id,name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; name: string }>;
    },
  });

  const addProduct = useMutation({
    mutationFn: async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Enter a flavor name");
      const { data, error } = await supabase
        .from("products" as any)
        .insert({ name: trimmed } as any)
        .select("id,name")
        .single();
      if (error) throw error;
      return data as { id: string; name: string };
    },
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ["products"] });
      setItem(row.name);
      setAddingNewFlavor(false);
      setNewFlavorName("");
      toast.success(`Added ${row.name}`);
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to add flavor"),
  });

  const client = clients.find((c) => c.id === clientId);
  const branches = client?.branches ?? [];

  const wtNum = Number(weightKg);
  const upNum = Number(unitPrice);
  const computedTotal = wtNum > 0 && upNum > 0 ? wtNum * upNum : null;
  const finalAmount = overriding ? Number(amountOverride) : (computedTotal ?? 0);
  const weightInvalid = weightKg !== "" && (!Number.isFinite(wtNum) || wtNum <= 0);
  const canSubmit = !!clientId && !!item && wtNum > 0 && !weightInvalid && finalAmount > 0;

  const submit = async () => {
    if (!clientId) return toast.error("Pick a client");
    if (!item) return toast.error("Pick an item");
    if (wtNum <= 0) return toast.error("Enter weight in kg");
    if (!finalAmount || finalAmount <= 0) return toast.error("Enter weight + unit price, or a total amount");
    const insertPayload: any = {
      client_id: clientId,
      branch_id: branchId || null,
      amount: finalAmount,
      unit_price: upNum > 0 ? upNum : null,
      weight_kg: wtNum > 0 ? wtNum : null,
      item,
      date: deliveryDate,
      delivery_date: deliveryDate,
      payment_status: "Not Done",
    };
    const { data, error } = await supabase.from("invoices").insert(insertPayload).select("invoice_no").single();
    if (error) return toast.error(error.message);
    toast.success(`Created ${data?.invoice_no ?? "invoice"}`);
    qc.invalidateQueries({ queryKey: ["invoices"] });
    onDone();
  };

  return (
    <DialogContent>
      <DialogHeader><DialogTitle>New invoice</DialogTitle></DialogHeader>
      <div className="space-y-4">
        <div>
          <Label>Invoice No.</Label>
                  <Input value="Auto-generated (TFC-MMYY-001)" readOnly disabled className="font-mono text-muted-foreground" />
        </div>
        <div>
          <Label>Client</Label>
          <Select value={clientId} onValueChange={(v) => { setClientId(v); setBranchId(""); }}>
            <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
            <SelectContent>
              {clients.filter((c) => c.client_type === "Paying Client").map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.legal_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {branches.length > 0 && (
          <div>
            <Label>Branch</Label>
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
              <SelectContent>
                {branches.map((b: any) => (
                  <SelectItem key={b.id} value={b.id}>{b.branch_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div>
          <Label>Item</Label>
          {addingNewFlavor ? (
            <div className="flex gap-2">
              <Input
                autoFocus
                value={newFlavorName}
                onChange={(e) => setNewFlavorName(e.target.value)}
                placeholder="e.g. Fryguys Spicy Curly Fries"
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); addProduct.mutate(newFlavorName); }
                  if (e.key === "Escape") { setAddingNewFlavor(false); setNewFlavorName(""); }
                }}
              />
              <Button
                type="button"
                onClick={() => addProduct.mutate(newFlavorName)}
                disabled={!newFlavorName.trim() || addProduct.isPending}
              >
                Save
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => { setAddingNewFlavor(false); setNewFlavorName(""); }}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Select
              value={item}
              onValueChange={(v) => {
                if (v === "__add_new__") { setAddingNewFlavor(true); return; }
                setItem(v);
              }}
            >
              <SelectTrigger><SelectValue placeholder="Select item / flavor" /></SelectTrigger>
              <SelectContent>
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.name}>{p.name}</SelectItem>
                ))}
                <SelectItem value="__add_new__" className="text-primary font-medium">
                  + Add New Flavor
                </SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Pack Size</Label>
            <Input value="2.5 kg" readOnly disabled className="bg-muted text-muted-foreground" />
          </div>
          <div>
            <Label>Weight (kg)</Label>
            <Input
              type="number"
              step="0.1"
              min="0"
              value={weightKg}
              onChange={(e) => setWeightKg(e.target.value)}
              placeholder="e.g. 11"
              className={weightInvalid ? "border-destructive focus-visible:ring-destructive" : ""}
            />
          </div>
        </div>
        <div>
          <Label>Unit Price (Rs./kg)</Label>
          <Input type="number" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} placeholder="e.g. 1250" />
        </div>
        <div>
          <Label>Total Amount (Rs.)</Label>
          <Input
            type="number"
            value={overriding ? amountOverride : (computedTotal != null ? String(computedTotal) : "")}
            onChange={(e) => { setOverriding(true); setAmountOverride(e.target.value); }}
            placeholder="Auto-calculated"
            className={!overriding ? "text-muted-foreground" : ""}
          />
          {computedTotal != null && !overriding ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {wtNum} kg × Rs. {upNum.toLocaleString()} = Rs. {computedTotal.toLocaleString()}
            </p>
          ) : overriding ? (
            <button type="button" className="mt-1 text-xs text-primary underline" onClick={() => { setOverriding(false); setAmountOverride(""); }}>
              Reset to auto-calculation
            </button>
          ) : null}
        </div>
        <div>
          <Label>Delivery Date</Label>
          <Input
            type="date"
            value={deliveryDate}
            onChange={(e) => setDeliveryDate(e.target.value)}
          />
        </div>
        <p className="text-xs text-muted-foreground">Due date auto-set to delivery date + 15 days.</p>
        <Button
          onClick={submit}
          disabled={!canSubmit}
          className="w-full bg-amber-500 text-black hover:bg-amber-600 disabled:opacity-50"
        >
          Create Invoice
        </Button>
      </div>
    </DialogContent>
  );
}