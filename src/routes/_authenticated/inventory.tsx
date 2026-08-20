import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchInventory, fetchStockMovements, fetchInvoices } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import { pkr, fmtDate } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Plus,
  ArrowDownToLine,
  ArrowUpFromLine,
  Trash2,
  Wheat,
  Package as PackageIcon,
  Truck,
  Warehouse,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { useIsAdmin } from "@/lib/roles";

const PACK_SIZE = 2.5;
const fmtN = (n: number, d = 1) =>
  Number.isFinite(n) ? n.toLocaleString("en", { maximumFractionDigits: d }) : "—";

function flagFor(variancePct: number) {
  if (variancePct < 5)
    return { label: "✓ Normal", className: "bg-success/15 text-success border-success/30" };
  if (variancePct <= 15)
    return { label: "⚠ High Wastage", className: "bg-warning/15 text-warning border-warning/30" };
  return {
    label: "🚨 Investigate",
    className: "bg-destructive/15 text-destructive border-destructive/30",
  };
}

async function fetchProduction() {
  const { data, error } = await supabase
    .from("daily_production")
    .select("*")
    .order("date", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export const Route = createFileRoute("/_authenticated/inventory")({
  head: () => ({ meta: [{ title: "Inventory — TFC CRM" }] }),
  component: InventoryPage,
});

function statusFor(item: any) {
  const cur = Number(item.current_stock);
  const min = Number(item.minimum_stock);
  if (cur <= 0)
    return {
      label: "Out of Stock",
      className: "bg-destructive/15 text-destructive border-destructive/30",
    };
  if (cur <= min)
    return { label: "Low Stock", className: "bg-warning/15 text-warning border-warning/30" };
  return { label: "OK", className: "bg-success/15 text-success border-success/30" };
}

function InventoryPage() {
  const qc = useQueryClient();
  const { isAdmin } = useIsAdmin();
  const { data: items = [] } = useQuery({ queryKey: ["inventory"], queryFn: fetchInventory });
  const { data: movements = [] } = useQuery({
    queryKey: ["stock_movements"],
    queryFn: fetchStockMovements,
  });
  const { data: invoices = [] } = useQuery({ queryKey: ["invoices"], queryFn: fetchInvoices });
  const { data: production = [] } = useQuery({
    queryKey: ["daily_production"],
    queryFn: fetchProduction,
  });

  const [addOpen, setAddOpen] = useState(false);
  const [moveItem, setMoveItem] = useState<any | null>(null);
  const [moveType, setMoveType] = useState<"Stock In" | "Stock Out">("Stock In");

  const [filterItem, setFilterItem] = useState<string>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const filteredMovements = useMemo(() => {
    return movements.filter((m: any) => {
      if (filterItem !== "all" && m.inventory_id !== filterItem) return false;
      if (fromDate && m.movement_date < fromDate) return false;
      if (toDate && m.movement_date > toDate) return false;
      return true;
    });
  }, [movements, filterItem, fromDate, toDate]);

  const deleteItem = async (id: string) => {
    const { error } = await supabase
      .from("inventory" as any)
      .delete()
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Item deleted");
    qc.invalidateQueries({ queryKey: ["inventory"] });
    qc.invalidateQueries({ queryKey: ["stock_movements"] });
  };

  // ---- Dashboard aggregates ----------------------------------------------
  const todayStr = new Date().toISOString().slice(0, 10);
  const monthKey = todayStr.slice(0, 7);

  const packsOf = (r: any) => Number(r.actual_packs_produced ?? r.packs_produced ?? 0);

  const todayProd = (production as any[]).filter((r) => r.date === todayStr);
  const monthProd = (production as any[]).filter((r) => String(r.date).slice(0, 7) === monthKey);

  const todayRawKg = todayProd.reduce((s, r) => s + Number(r.raw_input_kg ?? 0), 0);
  const monthRawKg = monthProd.reduce((s, r) => s + Number(r.raw_input_kg ?? 0), 0);

  const todayPacks = todayProd.reduce((s, r) => s + packsOf(r), 0);
  const monthPacks = monthProd.reduce((s, r) => s + packsOf(r), 0);

  const deliveredPacksFromInvoice = (i: any) => Number(i.weight_kg ?? 0) / PACK_SIZE;
  const todayDelivered = (invoices as any[])
    .filter((i) => i.delivery_date === todayStr)
    .reduce((s, i) => s + deliveredPacksFromInvoice(i), 0);
  const monthDelivered = (invoices as any[])
    .filter((i) => String(i.delivery_date ?? "").slice(0, 7) === monthKey)
    .reduce((s, i) => s + deliveredPacksFromInvoice(i), 0);

  const totalProduced = (production as any[]).reduce((s, r) => s + packsOf(r), 0);
  const totalDelivered = (invoices as any[]).reduce((s, i) => s + deliveredPacksFromInvoice(i), 0);
  const inHand = Math.max(0, totalProduced - totalDelivered);

  const inHandColor =
    inHand > 20
      ? "text-success border-success/40"
      : inHand >= 1
        ? "text-warning border-warning/40"
        : "text-destructive border-destructive/40";

  // ---- Daily Pack Log (joined per-date view) -----------------------------
  const dateSet = new Set<string>();
  (production as any[]).forEach((r) => r.date && dateSet.add(r.date));
  (invoices as any[]).forEach((i) => i.delivery_date && dateSet.add(i.delivery_date));
  const dailyLog = Array.from(dateSet)
    .sort()
    .reverse()
    .map((d) => {
      const ps = (production as any[]).filter((r) => r.date === d);
      const raw = ps.reduce((s, r) => s + Number(r.raw_input_kg ?? 0), 0);
      const expected = ps.reduce((s, r) => s + Number(r.packs_produced ?? 0), 0);
      const actualVals = ps.map((r) =>
        r.actual_packs_produced != null ? Number(r.actual_packs_produced) : null,
      );
      const allActual = actualVals.length > 0 && actualVals.every((v) => v != null);
      const actual = allActual ? actualVals.reduce((s, v) => s + (v as number), 0) : null;
      const usedPacks = actual ?? expected;
      const variancePct =
        actual != null && expected > 0 ? Math.max(0, ((expected - actual) / expected) * 100) : 0;
      const fl = actual != null ? flagFor(variancePct) : null;
      const delivered = (invoices as any[])
        .filter((i) => i.delivery_date === d)
        .reduce((s, i) => s + deliveredPacksFromInvoice(i), 0);
      const reasons = ps
        .map((r) => r.variance_reason)
        .filter(Boolean)
        .join(" · ");
      const notes = ps
        .map((r) => r.notes)
        .filter(Boolean)
        .join(" · ");
      return { date: d, raw, expected, actual, usedPacks, delivered, fl, reasons, notes };
    });

  // Running In Hand per row (chronological cumulative)
  let running = 0;
  const dailyLogAsc = [...dailyLog].reverse().map((row) => {
    running = Math.max(0, running + (row.usedPacks ?? 0) - row.delivered);
    return { ...row, inHand: running };
  });
  const dailyLogDesc = dailyLogAsc.slice().reverse();

  const dashboardCards = [
    {
      label: "Raw Material",
      icon: Wheat,
      color: "text-[#F59E0B] border-[#F59E0B]/40",
      primary: `${fmtN(todayRawKg, 1)} kg`,
      sub: `This month: ${fmtN(monthRawKg, 0)} kg`,
      tag: "Today's input",
    },
    {
      label: "Final Product",
      icon: PackageIcon,
      color: "text-success border-success/40",
      primary: `${fmtN(todayPacks, 1)} packs`,
      sub: `${fmtN(todayPacks * PACK_SIZE, 1)} kg · This month ${fmtN(monthPacks, 0)} packs`,
      tag: "Today produced",
    },
    {
      label: "Delivered Packs",
      icon: Truck,
      color: "text-sky-400 border-sky-400/40",
      primary: `${fmtN(todayDelivered, 1)} packs`,
      sub: `This month: ${fmtN(monthDelivered, 0)} packs`,
      tag: "Today shipped",
    },
    {
      label: "In Hand",
      icon: Warehouse,
      color: inHandColor,
      primary: inHand === 0 ? "Out of Stock" : `${fmtN(inHand, 1)} packs`,
      sub: inHand === 0 ? "No stock available" : `${fmtN(inHand * PACK_SIZE, 1)} kg current stock`,
      tag: "All-time produced − delivered",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Inventory</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Stock levels, costs and movement history.
          </p>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button data-financial-action>
              <Plus className="mr-1 h-4 w-4" /> Add item
            </Button>
          </DialogTrigger>
          <AddItemDialog onDone={() => setAddOpen(false)} />
        </Dialog>
      </div>

      {/* Production → Inventory chain dashboard */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {dashboardCards.map((c) => (
          <Card key={c.label} className={`border ${c.color}`}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">
                  {c.label}
                </span>
                <c.icon className={`h-4 w-4 ${c.color.split(" ")[0]}`} />
              </div>
              <div className={`tabular mt-3 text-2xl font-semibold ${c.color.split(" ")[0]}`}>
                {c.primary}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">{c.tag}</div>
              <div className="mt-2 text-xs text-foreground/80 tabular">{c.sub}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="items">
        <TabsList>
          <TabsTrigger value="items">Items</TabsTrigger>
          <TabsTrigger value="movements">Movement history</TabsTrigger>
          <TabsTrigger value="packlog">Daily Pack Log</TabsTrigger>
        </TabsList>

        <TabsContent value="items" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <div className="desktop-table overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase tracking-wider text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="px-4 py-3 text-left">Item</th>
                      <th className="px-4 py-3 text-left">Unit</th>
                      <th className="px-4 py-3 text-right">Current</th>
                      <th className="px-4 py-3 text-right">Min</th>
                      <th className="px-4 py-3 text-right">Cost/unit</th>
                      <th className="px-4 py-3 text-right">Total value</th>
                      <th className="px-4 py-3 text-center">Status</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="tabular">
                    {items.map((it: any) => {
                      const st = statusFor(it);
                      const total = Number(it.current_stock) * Number(it.cost_per_unit);
                      return (
                        <tr key={it.id} className="border-b border-border/40 hover:bg-muted/40">
                          <td className="px-4 py-3 font-medium">{it.item_name}</td>
                          <td className="px-4 py-3 text-muted-foreground">{it.unit}</td>
                          <td className="px-4 py-3 text-right">{Number(it.current_stock)}</td>
                          <td className="px-4 py-3 text-right text-muted-foreground">
                            {Number(it.minimum_stock)}
                          </td>
                          <td className="px-4 py-3 text-right">{pkr(Number(it.cost_per_unit))}</td>
                          <td className="px-4 py-3 text-right font-semibold">{pkr(total)}</td>
                          <td className="px-4 py-3 text-center">
                            <Badge variant="outline" className={st.className}>
                              {st.label}
                            </Badge>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                data-financial-action
                                size="sm"
                                variant="ghost"
                                className="h-8 text-success hover:bg-success/10"
                                onClick={() => {
                                  setMoveItem(it);
                                  setMoveType("Stock In");
                                }}
                              >
                                <ArrowDownToLine className="mr-1 h-3.5 w-3.5" /> In
                              </Button>
                              <Button
                                data-financial-action
                                size="sm"
                                variant="ghost"
                                className="h-8 text-warning hover:bg-warning/10"
                                onClick={() => {
                                  setMoveItem(it);
                                  setMoveType("Stock Out");
                                }}
                              >
                                <ArrowUpFromLine className="mr-1 h-3.5 w-3.5" /> Out
                              </Button>
                              {isAdmin && (
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-8 w-8 text-destructive hover:bg-destructive/10"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Delete {it.item_name}?</AlertDialogTitle>
                                      <AlertDialogDescription>
                                        This deletes the item and all of its stock movements. This
                                        cannot be undone.
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                                      <AlertDialogAction
                                        data-financial-action
                                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                        onClick={() => deleteItem(it.id)}
                                      >
                                        Delete
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {items.length === 0 && (
                      <tr>
                        <td colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                          No inventory items yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="mobile-card-list">
                {items.map((it: any) => {
                  const st = statusFor(it);
                  const total = Number(it.current_stock) * Number(it.cost_per_unit);
                  return (
                    <div key={it.id} className="mobile-data-card space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-semibold">{it.item_name}</div>
                          <div className="text-xs text-muted-foreground">{it.unit}</div>
                        </div>
                        <Badge variant="outline" className={st.className}>
                          {st.label}
                        </Badge>
                      </div>
                      <div className="mobile-data-row">
                        <span>Current</span>
                        <span>{Number(it.current_stock)}</span>
                      </div>
                      <div className="mobile-data-row">
                        <span>Minimum</span>
                        <span>{Number(it.minimum_stock)}</span>
                      </div>
                      <div className="mobile-data-row">
                        <span>Cost / Unit</span>
                        <span>{pkr(Number(it.cost_per_unit))}</span>
                      </div>
                      <div className="mobile-data-row">
                        <span>Total Value</span>
                        <span className="font-semibold">{pkr(total)}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          data-financial-action
                          variant="outline"
                          className="text-success"
                          onClick={() => {
                            setMoveItem(it);
                            setMoveType("Stock In");
                          }}
                        >
                          <ArrowDownToLine className="h-4 w-4" /> In
                        </Button>
                        <Button
                          data-financial-action
                          variant="outline"
                          className="text-warning"
                          onClick={() => {
                            setMoveItem(it);
                            setMoveType("Stock Out");
                          }}
                        >
                          <ArrowUpFromLine className="h-4 w-4" /> Out
                        </Button>
                      </div>
                    </div>
                  );
                })}
                {items.length === 0 && (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    No inventory items yet.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="movements" className="mt-4 space-y-4">
          <Card>
            <CardContent className="grid gap-3 p-4 md:grid-cols-[2fr_1fr_1fr_auto]">
              <div>
                <Label>Item</Label>
                <Select value={filterItem} onValueChange={setFilterItem}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All items</SelectItem>
                    {items.map((it: any) => (
                      <SelectItem key={it.id} value={it.id}>
                        {it.item_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>From</Label>
                <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
              </div>
              <div>
                <Label>To</Label>
                <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
              </div>
              <div className="flex items-end">
                <Button
                  variant="outline"
                  onClick={() => {
                    setFilterItem("all");
                    setFromDate("");
                    setToDate("");
                  }}
                >
                  Reset
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              <div className="desktop-table overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase tracking-wider text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="px-4 py-3 text-left">Date</th>
                      <th className="px-4 py-3 text-left">Item</th>
                      <th className="px-4 py-3 text-left">Type</th>
                      <th className="px-4 py-3 text-right">Qty</th>
                      <th className="px-4 py-3 text-left">Invoice</th>
                      <th className="px-4 py-3 text-left">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="tabular">
                    {filteredMovements.map((m: any) => (
                      <tr key={m.id} className="border-b border-border/40 hover:bg-muted/40">
                        <td className="px-4 py-3 text-muted-foreground">
                          {fmtDate(m.movement_date)}
                        </td>
                        <td className="px-4 py-3 font-medium">{m.inventory?.item_name ?? "—"}</td>
                        <td className="px-4 py-3">
                          <Badge
                            variant="outline"
                            className={
                              m.movement_type === "Stock In"
                                ? "border-success/30 text-success"
                                : "border-warning/30 text-warning"
                            }
                          >
                            {m.movement_type}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {Number(m.quantity)} {m.inventory?.unit ?? ""}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                          {m.invoices?.invoice_no ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{m.notes ?? ""}</td>
                      </tr>
                    ))}
                    {filteredMovements.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                          No movements.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="mobile-card-list">
                {filteredMovements.map((m: any) => (
                  <div key={m.id} className="mobile-data-card">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold">{m.inventory?.item_name ?? "-"}</div>
                        <div className="text-xs text-muted-foreground">
                          {fmtDate(m.movement_date)}
                        </div>
                      </div>
                      <Badge
                        variant="outline"
                        className={
                          m.movement_type === "Stock In"
                            ? "border-success/30 text-success"
                            : "border-warning/30 text-warning"
                        }
                      >
                        {m.movement_type}
                      </Badge>
                    </div>
                    <div className="mobile-data-row">
                      <span>Quantity</span>
                      <span>
                        {Number(m.quantity)} {m.inventory?.unit ?? ""}
                      </span>
                    </div>
                    <div className="mobile-data-row">
                      <span>Invoice</span>
                      <span className="font-mono">{m.invoices?.invoice_no ?? "-"}</span>
                    </div>
                    {m.notes && <div className="mt-2 text-xs text-muted-foreground">{m.notes}</div>}
                  </div>
                ))}
                {filteredMovements.length === 0 && (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    No movements.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="packlog" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <div className="desktop-table overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 text-left">Date</th>
                      <th className="px-4 py-3 text-right">Raw Input (kg)</th>
                      <th className="px-4 py-3 text-right">Expected</th>
                      <th className="px-4 py-3 text-right">Actual</th>
                      <th className="px-4 py-3 text-right">Variance</th>
                      <th className="px-4 py-3 text-right">Delivered</th>
                      <th className="px-4 py-3 text-right">In Hand</th>
                      <th className="px-4 py-3 text-left">Flag</th>
                      <th className="px-4 py-3 text-left">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="tabular divide-y divide-border">
                    {dailyLogDesc.length === 0 && (
                      <tr>
                        <td colSpan={9} className="px-4 py-10 text-center text-muted-foreground">
                          No production or delivery activity yet.
                        </td>
                      </tr>
                    )}
                    {dailyLogDesc.map((r) => (
                      <tr key={r.date} className="hover:bg-muted/30">
                        <td className="px-4 py-3">{format(new Date(r.date), "dd MMM yyyy")}</td>
                        <td className="px-4 py-3 text-right">{fmtN(r.raw, 1)}</td>
                        <td className="px-4 py-3 text-right text-muted-foreground">
                          {fmtN(r.expected, 1)}
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-[#F59E0B]">
                          {r.actual != null ? fmtN(r.actual, 1) : "—"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {r.actual != null ? (
                            <span
                              className={
                                r.expected - r.actual > 0 ? "text-destructive" : "text-success"
                              }
                            >
                              {r.expected - r.actual > 0 ? "↓" : "↑"}{" "}
                              {fmtN(Math.abs(r.expected - r.actual), 1)}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">{fmtN(r.delivered, 1)}</td>
                        <td className="px-4 py-3 text-right font-semibold">{fmtN(r.inHand, 1)}</td>
                        <td className="px-4 py-3">
                          {r.fl ? (
                            <Badge variant="outline" className={r.fl.className}>
                              {r.fl.label}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td
                          className="px-4 py-3 max-w-[260px] truncate text-muted-foreground"
                          title={r.reasons || r.notes}
                        >
                          {r.reasons ? (
                            <span className="text-warning">⚠ {r.reasons}</span>
                          ) : (
                            r.notes || "—"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mobile-card-list">
                {dailyLogDesc.length === 0 && (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    No production or delivery activity yet.
                  </div>
                )}
                {dailyLogDesc.map((r) => (
                  <div key={r.date} className="mobile-data-card">
                    <div className="flex items-start justify-between gap-3">
                      <div className="font-semibold">{format(new Date(r.date), "dd MMM yyyy")}</div>
                      {r.fl ? (
                        <Badge variant="outline" className={r.fl.className}>
                          {r.fl.label}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="mobile-data-row">
                      <span>Raw Input</span>
                      <span>{fmtN(r.raw, 1)} kg</span>
                    </div>
                    <div className="mobile-data-row">
                      <span>Expected / Actual</span>
                      <span>
                        {fmtN(r.expected, 1)} / {r.actual != null ? fmtN(r.actual, 1) : "-"}
                      </span>
                    </div>
                    <div className="mobile-data-row">
                      <span>Delivered</span>
                      <span>{fmtN(r.delivered, 1)}</span>
                    </div>
                    <div className="mobile-data-row">
                      <span>In Hand</span>
                      <span className="font-semibold">{fmtN(r.inHand, 1)}</span>
                    </div>
                    {(r.reasons || r.notes) && (
                      <div className="mt-2 text-xs text-muted-foreground">
                        {r.reasons || r.notes}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!moveItem} onOpenChange={(o) => !o && setMoveItem(null)}>
        {moveItem && (
          <MovementDialog
            item={moveItem}
            type={moveType}
            invoices={invoices}
            onDone={() => setMoveItem(null)}
          />
        )}
      </Dialog>
    </div>
  );
}

function AddItemDialog({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("kg");
  const [minimum, setMinimum] = useState("0");
  const [cost, setCost] = useState("0");
  const [opening, setOpening] = useState("0");

  const submit = async () => {
    if (!name) return toast.error("Item name required");
    const { error } = await supabase.from("inventory" as any).insert({
      item_name: name,
      unit,
      minimum_stock: Number(minimum),
      cost_per_unit: Number(cost),
      current_stock: Number(opening),
    } as any);
    if (error) return toast.error(error.message);
    toast.success("Item added");
    qc.invalidateQueries({ queryKey: ["inventory"] });
    onDone();
  };

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Add inventory item</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <div>
          <Label>Item name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Maida" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Unit</Label>
            <Input
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="kg / carton / pack"
            />
          </div>
          <div>
            <Label>Opening stock</Label>
            <Input type="number" value={opening} onChange={(e) => setOpening(e.target.value)} />
          </div>
          <div>
            <Label>Minimum stock (alert)</Label>
            <Input type="number" value={minimum} onChange={(e) => setMinimum(e.target.value)} />
          </div>
          <div>
            <Label>Cost per unit (Rs.)</Label>
            <Input type="number" value={cost} onChange={(e) => setCost(e.target.value)} />
          </div>
        </div>
        <Button data-financial-action onClick={submit} className="w-full">
          Add item
        </Button>
      </div>
    </DialogContent>
  );
}

function MovementDialog({
  item,
  type,
  invoices,
  onDone,
}: {
  item: any;
  type: "Stock In" | "Stock Out";
  invoices: any[];
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [qty, setQty] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [invoiceId, setInvoiceId] = useState<string>("");
  const [notes, setNotes] = useState("");

  const submit = async () => {
    const q = Number(qty);
    if (!q || q <= 0) return toast.error("Enter a positive quantity");
    const delta = type === "Stock In" ? q : -q;
    const newStock = Number(item.current_stock) + delta;
    const { error: e1 } = await supabase.from("stock_movements" as any).insert({
      inventory_id: item.id,
      movement_type: type,
      quantity: q,
      movement_date: date,
      invoice_id: invoiceId || null,
      notes: notes || null,
    } as any);
    if (e1) return toast.error(e1.message);
    const { error: e2 } = await supabase
      .from("inventory" as any)
      .update({ current_stock: newStock } as any)
      .eq("id", item.id);
    if (e2) return toast.error(e2.message);
    toast.success(`${type} recorded`);
    qc.invalidateQueries({ queryKey: ["inventory"] });
    qc.invalidateQueries({ queryKey: ["stock_movements"] });
    onDone();
  };

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>
          {type} — {item.item_name}
        </DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Current stock:{" "}
          <strong>
            {Number(item.current_stock)} {item.unit}
          </strong>
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Quantity ({item.unit})</Label>
            <Input type="number" value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
          <div>
            <Label>Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        {type === "Stock Out" && (
          <div>
            <Label>Link to invoice (optional)</Label>
            <Select value={invoiceId} onValueChange={setInvoiceId}>
              <SelectTrigger>
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                {invoices.slice(0, 100).map((i: any) => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.invoice_no} — {i.clients?.legal_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div>
          <Label>Notes</Label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
        </div>
        <Button data-financial-action onClick={submit} className="w-full">
          Record {type}
        </Button>
      </div>
    </DialogContent>
  );
}
