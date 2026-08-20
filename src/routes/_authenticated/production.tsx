import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CalendarIcon, Trash2, Factory, AlertTriangle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
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
import { syncInventoryStockForDate } from "@/lib/inventory-sync";
import { useIsAdmin } from "@/lib/roles";
import { WastageVerificationDialog } from "@/components/wastage-verification-dialog";

export const Route = createFileRoute("/_authenticated/production")({
  head: () => ({ meta: [{ title: "Daily Production — Fry Guys CRM" }] }),
  component: ProductionPage,
});

async function fetchProduction() {
  const { data, error } = await supabase
    .from("daily_production")
    .select("*, products(id, name)")
    .order("date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

async function fetchProducts() {
  const { data, error } = await supabase
    .from("products")
    .select("id, name")
    .eq("is_active", true)
    .order("name");
  if (error) throw error;
  return data ?? [];
}

const PACK_SIZE = 2.5;
const fmt = (n: number, d = 2) =>
  Number.isFinite(n) ? n.toLocaleString("en", { maximumFractionDigits: d }) : "—";

function flagFor(variancePct: number) {
  if (variancePct < 5)
    return {
      label: "✓ Normal",
      className: "bg-success/15 text-success border-success/30",
      ai: "Normal",
    };
  if (variancePct <= 15)
    return {
      label: "⚠ High Wastage",
      className: "bg-warning/15 text-warning border-warning/30",
      ai: "High Wastage",
    };
  return {
    label: "🚨 Investigate",
    className: "bg-destructive/15 text-destructive border-destructive/30",
    ai: "Investigate",
  };
}

function ProductionPage() {
  const qc = useQueryClient();
  const { isAdmin } = useIsAdmin();
  const { data: rows = [] } = useQuery({
    queryKey: ["daily_production"],
    queryFn: fetchProduction,
  });
  const { data: products = [] } = useQuery({
    queryKey: ["products", "production-entry"],
    queryFn: fetchProducts,
  });

  const [date, setDate] = useState<Date>(new Date());
  const [productId, setProductId] = useState("none");
  const [rawInput, setRawInput] = useState("");
  const [wastage, setWastage] = useState("60");
  const [target, setTarget] = useState("");
  const [notes, setNotes] = useState("");
  const [actualPacks, setActualPacks] = useState("");
  const [varianceReason, setVarianceReason] = useState("");

  const raw = Number(rawInput) || 0;
  const w = Number(wastage) || 0;
  const usable = raw * (1 - w / 100);
  const expectedPacks = usable / PACK_SIZE;
  const tgt = target === "" ? null : Number(target);
  const gap = tgt != null ? tgt - expectedPacks : null;

  const actual = actualPacks === "" ? null : Number(actualPacks);
  const variancePacks = actual != null ? expectedPacks - actual : 0;
  const variancePct =
    actual != null && expectedPacks > 0 ? (variancePacks / expectedPacks) * 100 : 0;
  const hasVariance = actual != null && variancePct > 5;
  const actualWastagePct = actual != null && raw > 0 ? (1 - (actual * PACK_SIZE) / raw) * 100 : w;
  const flag = actual != null ? flagFor(Math.max(0, variancePct)) : null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const save = async () => {
    if (!rawInput || raw <= 0) return toast.error("Raw input is required");
    if (w < 0 || w >= 100) return toast.error("Wastage must be between 0 and 100");
    if (hasVariance && !varianceReason.trim()) {
      return toast.error("Variance reason is required when actual differs from expected by >5%");
    }
    if (!isAdmin) {
      const d = new Date(date);
      d.setHours(0, 0, 0, 0);
      if (d.getTime() < today.getTime()) {
        return toast.error("You can only add production entries for today or future dates");
      }
    }
    const dateStr = format(date, "yyyy-MM-dd");
    const { error } = await supabase.from("daily_production").insert({
      date: dateStr,
      raw_input_kg: raw,
      wastage_percent: w,
      pack_size_kg: PACK_SIZE,
      product_id: productId === "none" ? null : productId,
      target_packs: tgt,
      notes: notes || null,
      actual_packs_produced: actual,
      variance_packs: actual != null ? variancePacks : null,
      variance_reason: hasVariance ? varianceReason.trim() : null,
      ai_flag: flag?.ai ?? null,
    });
    if (error) return toast.error(error.message);
    // Sync the inventory_stock ledger for this date.
    try {
      await syncInventoryStockForDate(dateStr);
    } catch (e: any) {
      console.warn("inventory_stock sync failed:", e?.message ?? e);
    }
    toast.success("Production logged & inventory synced");
    setRawInput("");
    setProductId("none");
    setTarget("");
    setNotes("");
    setWastage("60");
    setDate(new Date());
    setActualPacks("");
    setVarianceReason("");
    qc.invalidateQueries({ queryKey: ["daily_production"] });
    qc.invalidateQueries({ queryKey: ["daily_production_today"] });
    qc.invalidateQueries({ queryKey: ["inventory_stock"] });
    qc.invalidateQueries({ queryKey: ["production_anomalies"] });
  };

  const del = async (id: string) => {
    const { data: row } = await supabase
      .from("daily_production")
      .select("date")
      .eq("id", id)
      .maybeSingle();
    const { error } = await supabase.from("daily_production").delete().eq("id", id);
    if (error) return toast.error(error.message);
    if (row?.date) await syncInventoryStockForDate(row.date).catch(() => {});
    toast.success("Entry deleted");
    qc.invalidateQueries({ queryKey: ["daily_production"] });
    qc.invalidateQueries({ queryKey: ["daily_production_today"] });
    qc.invalidateQueries({ queryKey: ["inventory_stock"] });
    qc.invalidateQueries({ queryKey: ["production_anomalies"] });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Factory className="h-7 w-7 text-[#F59E0B]" />
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Daily Production</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Track raw potato input and estimate finished packs after wastage.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Today's Production Entry</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-4">
            <div>
              <Label>Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !date && "text-muted-foreground",
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {date ? format(date, "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={date}
                    onSelect={(d) => d && setDate(d)}
                    initialFocus
                    disabled={!isAdmin ? { before: today } : undefined}
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <Label>Finished Product (optional)</Label>
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No product link</SelectItem>
                  {products.map((product: any) => (
                    <SelectItem key={product.id} value={product.id}>
                      {product.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Raw Potato Input (kg)</Label>
              <Input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.1"
                value={rawInput}
                onChange={(e) => setRawInput(e.target.value)}
                placeholder="e.g. 100"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Wastage %</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  max="99"
                  step="0.1"
                  value={wastage}
                  onChange={(e) => setWastage(e.target.value)}
                />
              </div>
              <div>
                <Label>Pack Size (kg)</Label>
                <Input value="2.5" readOnly disabled />
              </div>
            </div>
            <div>
              <Label>Target Packs (optional)</Label>
              <Input
                type="number"
                inputMode="decimal"
                min="0"
                step="1"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="e.g. 50"
              />
            </div>
            <div>
              <Label>Notes</Label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional"
              />
            </div>

            <div className="border-t border-border pt-4">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Step 2 · After production
              </Label>
              <div className="mt-2">
                <Label>Actual Packs Produced</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.1"
                  value={actualPacks}
                  onChange={(e) => setActualPacks(e.target.value)}
                  placeholder={
                    expectedPacks > 0
                      ? `Expected ${fmt(expectedPacks, 1)}`
                      : "Leave empty if not finished"
                  }
                />
              </div>
              {hasVariance && (
                <div className="mt-3 space-y-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
                  <div className="flex items-start gap-2 text-warning">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <div>
                      <div className="font-semibold">Variance detected</div>
                      <div className="text-foreground/80">
                        Expected {fmt(expectedPacks, 1)} packs but only {fmt(actual!, 1)} produced.
                        Actual wastage estimate: <strong>{fmt(actualWastagePct, 1)}%</strong> vs
                        entered {fmt(w, 1)}%.
                      </div>
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Reason (required)</Label>
                    <Input
                      value={varianceReason}
                      onChange={(e) => setVarianceReason(e.target.value)}
                      placeholder="e.g. potato quality, machine downtime, oil shortage"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-lg border border-[#F59E0B]/40 bg-[rgba(245,158,11,0.08)] p-5 text-sm">
              <div className="mb-3 font-semibold text-[#F59E0B]">📊 Production Estimate</div>
              <div className="space-y-1.5 tabular text-foreground/90">
                <div className="flex justify-between">
                  <span>Raw Input</span>
                  <span>{fmt(raw)} kg</span>
                </div>
                <div className="flex justify-between">
                  <span>After Wastage ({fmt(w, 1)}%)</span>
                  <span>{fmt(usable)} kg</span>
                </div>
                <div className="flex justify-between">
                  <span>Pack Size</span>
                  <span>2.5 kg</span>
                </div>
                <div className="my-2 border-t border-[#F59E0B]/30" />
                <div className="flex justify-between text-base font-semibold text-[#F59E0B]">
                  <span>Estimated Packs</span>
                  <span>{fmt(expectedPacks, 1)} packs</span>
                </div>
                {actual != null && (
                  <div className="mt-2 flex justify-between border-t border-[#F59E0B]/30 pt-2">
                    <span>Actual Packs</span>
                    <span className="font-semibold">{fmt(actual, 1)}</span>
                  </div>
                )}
                {actual != null && flag && (
                  <div className="mt-1 flex justify-between text-xs">
                    <span>Variance</span>
                    <Badge variant="outline" className={flag.className}>
                      {flag.label} ({fmt(variancePct, 1)}%)
                    </Badge>
                  </div>
                )}
                {tgt != null && (
                  <div className="mt-2 flex justify-between text-xs">
                    <span>Target: {fmt(tgt, 0)} packs</span>
                    <span className={gap! > 0 ? "text-destructive" : "text-success"}>
                      Gap: {fmt(Math.abs(gap!), 1)} packs {gap! > 0 ? "short" : "over"}
                    </span>
                  </div>
                )}
              </div>
            </div>
            <Button
              data-financial-action
              onClick={save}
              className="w-full bg-[#F59E0B] text-[#0A0F1E] hover:bg-[#D97706]"
            >
              Log Production
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Production History</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-left">Product</th>
                  <th className="px-4 py-3 text-right">Raw (kg)</th>
                  <th className="px-4 py-3 text-right">Wastage %</th>
                  <th className="px-4 py-3 text-right">Usable (kg)</th>
                  <th className="px-4 py-3 text-right">Expected</th>
                  <th className="px-4 py-3 text-right">Actual</th>
                  <th className="px-4 py-3 text-left">Flag</th>
                  <th className="px-4 py-3 text-right">Target</th>
                  <th className="px-4 py-3 text-left">vs Target</th>
                  <th className="px-4 py-3 text-left">Notes</th>
                  <th className="px-4 py-3 text-left">Wastage Proof</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={13} className="px-4 py-10 text-center text-muted-foreground">
                      No production entries yet.
                    </td>
                  </tr>
                )}
                {rows.map((r: any) => {
                  const tgtR = r.target_packs != null ? Number(r.target_packs) : null;
                  const expectedR = Number(r.packs_produced);
                  const actualR =
                    r.actual_packs_produced != null ? Number(r.actual_packs_produced) : null;
                  const varPct =
                    actualR != null && expectedR > 0
                      ? Math.max(0, ((expectedR - actualR) / expectedR) * 100)
                      : 0;
                  const fl = actualR != null ? flagFor(varPct) : null;
                  let badge: React.ReactNode = <span className="text-muted-foreground">—</span>;
                  if (tgtR != null) {
                    const refPacks = actualR ?? expectedR;
                    const diff = tgtR - refPacks;
                    badge =
                      diff <= 0 ? (
                        <Badge className="bg-success/15 text-success hover:bg-success/15">
                          ✓ Met
                        </Badge>
                      ) : (
                        <Badge variant="destructive">↓ {fmt(diff, 1)} short</Badge>
                      );
                  }
                  return (
                    <tr key={r.id} className="hover:bg-muted/30">
                      <td className="px-4 py-3">{format(new Date(r.date), "dd MMM yyyy")}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {r.products?.name ?? "Unlinked"}
                      </td>
                      <td className="px-4 py-3 text-right tabular">
                        {fmt(Number(r.raw_input_kg))}
                      </td>
                      <td className="px-4 py-3 text-right tabular">
                        {fmt(Number(r.wastage_percent), 1)}%
                      </td>
                      <td className="px-4 py-3 text-right tabular">{fmt(Number(r.usable_kg))}</td>
                      <td className="px-4 py-3 text-right tabular text-muted-foreground">
                        {fmt(expectedR, 1)}
                      </td>
                      <td className="px-4 py-3 text-right tabular font-medium text-[#F59E0B]">
                        {actualR != null ? fmt(actualR, 1) : "—"}
                      </td>
                      <td className="px-4 py-3">
                        {fl ? (
                          <Badge variant="outline" className={fl.className}>
                            {fl.label}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular">
                        {tgtR != null ? fmt(tgtR, 0) : "—"}
                      </td>
                      <td className="px-4 py-3">{badge}</td>
                      <td
                        className="px-4 py-3 max-w-[200px] truncate text-muted-foreground"
                        title={r.variance_reason || r.notes || ""}
                      >
                        {r.variance_reason ? (
                          <span className="text-warning">⚠ {r.variance_reason}</span>
                        ) : (
                          r.notes || "—"
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <WastageVerificationDialog
                          row={{
                            id: r.id,
                            date: r.date,
                            raw_input_kg: Number(r.raw_input_kg),
                            wastage_percent: Number(r.wastage_percent),
                          }}
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isAdmin && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="text-muted-foreground hover:text-destructive"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete production entry?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This will permanently remove the entry from{" "}
                                  {format(new Date(r.date), "dd MMM yyyy")}.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction data-financial-action onClick={() => del(r.id)}>
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="space-y-3 p-4 md:hidden">
            {rows.length === 0 && (
              <div className="py-10 text-center text-sm text-muted-foreground">
                No production entries yet.
              </div>
            )}
            {rows.map((r: any) => {
              const tgtR = r.target_packs != null ? Number(r.target_packs) : null;
              const expectedR = Number(r.packs_produced);
              const actualR =
                r.actual_packs_produced != null ? Number(r.actual_packs_produced) : null;
              const varPct =
                actualR != null && expectedR > 0
                  ? Math.max(0, ((expectedR - actualR) / expectedR) * 100)
                  : 0;
              const fl = actualR != null ? flagFor(varPct) : null;
              const variancePacks = actualR != null ? expectedR - actualR : 0;
              return (
                <div key={r.id} className="space-y-3 rounded-xl border border-border bg-card p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-foreground">
                        {format(new Date(r.date), "dd MMM yyyy")}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {r.products?.name ?? "Unlinked product"}
                      </div>
                    </div>
                    {fl ? (
                      <Badge variant="outline" className={fl.className}>
                        {fl.label}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg bg-muted/30 p-3">
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Raw Input
                      </div>
                      <div className="text-base font-bold text-foreground tabular">
                        {fmt(Number(r.raw_input_kg))} kg
                      </div>
                    </div>
                    <div className="rounded-lg bg-muted/30 p-3">
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Usable ({fmt(Number(r.wastage_percent), 1)}% wast.)
                      </div>
                      <div className="text-base font-bold text-foreground tabular">
                        {fmt(Number(r.usable_kg))} kg
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <div className="text-[10px] text-muted-foreground">Expected</div>
                      <div className="text-sm font-bold text-foreground tabular">
                        {fmt(expectedR, 1)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground">Actual</div>
                      <div className="text-sm font-bold text-primary tabular">
                        {actualR != null ? fmt(actualR, 1) : "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground">Variance</div>
                      <div
                        className={cn(
                          "text-sm font-bold tabular",
                          variancePacks > 0 ? "text-destructive" : "text-success",
                        )}
                      >
                        {actualR != null
                          ? variancePacks > 0
                            ? `-${fmt(variancePacks, 1)}`
                            : "✓"
                          : "—"}
                      </div>
                    </div>
                  </div>
                  {tgtR != null && (
                    <div className="text-xs text-muted-foreground">
                      Target: {fmt(tgtR, 0)} packs
                    </div>
                  )}
                  {r.variance_reason && (
                    <div className="rounded-lg bg-warning/10 p-2 text-xs text-warning">
                      ⚠️ {r.variance_reason}
                    </div>
                  )}
                  {!r.variance_reason && r.notes && (
                    <div className="text-xs text-muted-foreground">{r.notes}</div>
                  )}
                  <WastageVerificationDialog
                    row={{
                      id: r.id,
                      date: r.date,
                      raw_input_kg: Number(r.raw_input_kg),
                      wastage_percent: Number(r.wastage_percent),
                    }}
                  />
                  {isAdmin && (
                    <div className="flex justify-end">
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="ghost" className="h-8 text-destructive">
                            <Trash2 className="mr-1 h-3 w-3" /> Delete
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete production entry?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will permanently remove the entry from{" "}
                              {format(new Date(r.date), "dd MMM yyyy")}.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction data-financial-action onClick={() => del(r.id)}>
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
