import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { fetchInvoices, fetchClients, fetchExpenses, fetchInventory } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import { pkr } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, TrendingUp, Wallet, Clock, Users, FileText, Receipt, Package, Building2, Factory, Wheat, Truck, Warehouse, Trophy } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, PieChart, Pie, Cell } from "recharts";
import { EXPENSE_GROUPS, GROUP_NAMES, GROUP_COLORS } from "@/lib/expense-categories";
import { fetchSettings } from "@/lib/queries";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import { AnimatedNumber } from "@/components/animated-number";
import { Sparkline } from "@/components/sparkline";
import { StatCardGridSkeleton } from "@/components/skeletons";
import { useRef } from "react";

function ReorderAlertsWidget({ invoices, clients, thresholdDays }: { invoices: any[]; clients: any[]; thresholdDays: number }) {
  const qc = useQueryClient();
  const resolvedQ = useQuery({
    queryKey: ["reorder-alerts-resolved"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reorder_alerts")
        .select("client_id, resolved, resolved_at")
        .eq("resolved", true)
        .gte("resolved_at", new Date(Date.now() - 7 * 86400000).toISOString());
      if (error) throw error;
      return data ?? [];
    },
  });
  const resolvedIds = new Set((resolvedQ.data ?? []).map((r: any) => r.client_id));

  const today = Date.now();
  const rows = clients
    .filter((c: any) => c.client_type === "Paying Client")
    .map((c: any) => {
      const clientInvoices = invoices
        .filter((i) => i.client_id === c.id && i.delivery_date)
        .map((i) => i.delivery_date as string)
        .sort();
      const latest = clientInvoices[clientInvoices.length - 1];
      if (!latest) return null;
      const days = Math.floor((today - new Date(latest).getTime()) / 86400000);
      // rough average order cycle (gaps between deliveries)
      let avgCycle: number | null = null;
      if (clientInvoices.length >= 2) {
        const gaps: number[] = [];
        for (let i = 1; i < clientInvoices.length; i++) {
          gaps.push(
            (new Date(clientInvoices[i]).getTime() - new Date(clientInvoices[i - 1]).getTime()) /
              86400000,
          );
        }
        avgCycle = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
      }
      return { client: c, days, lastDate: latest, avgCycle };
    })
    .filter((x: any) => x && x.days >= thresholdDays && !resolvedIds.has(x.client.id))
    .sort((a: any, b: any) => b.days - a.days);

  const markContacted = async (clientId: string, days: number, lastDate: string) => {
    const { error } = await supabase.from("reorder_alerts").insert({
      client_id: clientId,
      last_order_date: lastDate,
      days_since_order: days,
      resolved: true,
      resolved_at: new Date().toISOString(),
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Marked as contacted");
    qc.invalidateQueries({ queryKey: ["reorder-alerts-resolved"] });
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="font-display text-lg font-medium text-foreground">Reorder alerts</h2>
          <p className="text-xs text-muted-foreground">Order tickets past their expected reorder cadence</p>
        </div>
        <span
          className={`status-pill ${rows.length > 0 ? "status-pill--overdue" : "status-pill--paid"}`}
        >
          {rows.length > 0 ? `${rows.length} due` : "All on track"}
        </span>
      </div>
      {rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-primary" /> All clients up to date
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {rows.slice(0, 6).map((row: any) => (
            <article key={row.client.id} className="docket-card">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="docket-meta">Reorder ticket</div>
                  <h3 className="mt-1 truncate text-[15px] font-medium">{row.client.legal_name}</h3>
                  <div className="docket-meta mt-0.5 text-[12px]">
                    {row.client.branches?.[0]?.branch_name ?? row.client.city ?? "—"}
                  </div>
                </div>
                <span className={`docket-pill ${row.days >= thresholdDays ? "docket-pill--overdue" : "docket-pill--ontrack"}`}>
                  {row.days}d
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 border-t border-dashed border-paper-ink/20 pt-3">
                <div>
                  <div className="docket-meta">Last order</div>
                  <div className="docket-amount mt-0.5 text-[13px]">{new Date(row.lastDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}</div>
                </div>
                <div>
                  <div className="docket-meta">Avg cycle</div>
                  <div className="docket-amount mt-0.5 text-[13px]">{row.avgCycle != null ? `${row.avgCycle}d` : "—"}</div>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => markContacted(row.client.id, row.days, row.lastDate)}
                  className="docket-link"
                >
                  Mark contacted →
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Fry Guys CRM" },
      { name: "description", content: "Revenue, collections, overdue invoices and data-health insights." },
    ],
  }),
  component: Index,
});

function Index() {
  const inv = useQuery({ queryKey: ["invoices"], queryFn: fetchInvoices });
  const cl = useQuery({ queryKey: ["clients"], queryFn: fetchClients });
  const ex = useQuery({ queryKey: ["expenses"], queryFn: fetchExpenses });
  const invy = useQuery({ queryKey: ["inventory"], queryFn: fetchInventory });
  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });
  const prod = useQuery({
    queryKey: ["daily_production_today"],
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("daily_production").select("*").eq("date", today)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const prodAll = useQuery({
    queryKey: ["daily_production"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_production").select("*").order("date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const anomalies = useQuery({
    queryKey: ["production_anomalies"],
    queryFn: async () => {
      const since = new Date(); since.setDate(since.getDate() - 7);
      const sinceStr = since.toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("daily_production")
        .select("date, packs_produced, actual_packs_produced, variance_reason, ai_flag")
        .eq("ai_flag", "Investigate")
        .gte("date", sinceStr)
        .order("date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const invoices = inv.data ?? [];
  const clients = cl.data ?? [];
  const expenses = ex.data ?? [];
  const today = new Date();
  const thisMonthKey = today.toISOString().slice(0, 7);
  const lastMonthDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const lastMonthKey = lastMonthDate.toISOString().slice(0, 7);
  const toDateKey = (...values: Array<string | null | undefined>) => {
    const raw = values.find((v) => typeof v === "string" && v.length >= 10);
    return raw ? String(raw).slice(0, 10) : "";
  };
  const invoiceDateKey = (i: any) => toDateKey(i.delivery_date, i.date, i.created_at);
  const expenseDateKey = (e: any) => toDateKey(e.date, e.created_at);
  const invoiceMonthKey = (i: any) => invoiceDateKey(i).slice(0, 7);
  const expenseMonthKey = (e: any) => expenseDateKey(e).slice(0, 7);

  // Month filter — default to current month. "all" = All Time.
  const [monthFilter, setMonthFilter] = useState<string>(thisMonthKey);
  const monthOptions = useMemo(() => {
    const set = new Set<string>();
    for (const i of invoices as any[]) {
      const d = invoiceMonthKey(i);
      if (d) set.add(d);
    }
    for (const e of expenses as any[]) {
      const d = expenseMonthKey(e);
      if (d) set.add(d);
    }
    set.add(thisMonthKey);
    const keys = Array.from(set).sort();
    if (keys.length > 0) {
      const [sy, sm] = keys[0].split("-").map(Number);
      const [cy, cm] = thisMonthKey.split("-").map(Number);
      const filled = new Set<string>();
      let y = sy, m = sm;
      while (y < cy || (y === cy && m <= cm)) {
        filled.add(`${y}-${String(m).padStart(2, "0")}`);
        m++; if (m > 12) { m = 1; y++; }
      }
      return Array.from(filled).sort((a, b) => (a < b ? 1 : -1));
    }
    return [thisMonthKey];
  }, [invoices, expenses, thisMonthKey]);
  const monthLabel = (k: string) =>
    new Date(k + "-01").toLocaleDateString("en", { month: "long", year: "numeric" });
  const dashboardFilterOptions = useMemo(
    () => [
      { key: "all", label: "All Time" },
      ...monthOptions.map((k) => ({
        key: k,
        label: k === thisMonthKey ? `This Month — ${monthLabel(k)}` : monthLabel(k),
      })),
    ],
    [monthOptions, thisMonthKey],
  );

  const isAll = monthFilter === "all";
  const invMatchesMonth = (i: any) =>
    isAll || invoiceMonthKey(i) === monthFilter;
  const expMatchesMonth = (e: any) =>
    isAll || expenseMonthKey(e) === monthFilter;

  const filteredInvoices = invoices.filter(invMatchesMonth);
  const filteredExpenses = (expenses as any[]).filter(expMatchesMonth);

  const totalRevenue = filteredInvoices.reduce((s, i) => s + Number(i.amount), 0);
  const collected = filteredInvoices.filter((i) => i.payment_status === "Done").reduce((s, i) => s + Number(i.amount), 0);
  const pending = filteredInvoices.filter((i) => i.payment_status === "Not Done").reduce((s, i) => s + Number(i.amount), 0);
  const unknown = filteredInvoices.filter((i) => i.payment_status === "Unknown").reduce((s, i) => s + Number(i.amount), 0);
  const filteredExpensesTotal = filteredExpenses.reduce((s: number, e: any) => s + Number(e.price), 0);
  const cashInHand = collected - filteredExpensesTotal;
  const overdue = invoices.filter(
    (i) => i.payment_status === "Not Done" && i.due_date && new Date(i.due_date) < today,
  );
  const payingClients = isAll
    ? clients.filter((c: any) => c.client_type === "Paying Client").length
    : (() => {
        const ids = new Set<string>();
        for (const i of filteredInvoices as any[]) if (i.client_id) ids.add(i.client_id);
        return clients.filter(
          (c: any) => c.client_type === "Paying Client" && ids.has(c.id),
        ).length;
      })();

  // Top 3 customers by revenue
  const customerTotals = new Map<string, number>();
  filteredInvoices.forEach((i: any) => {
    const name = i.clients?.legal_name ?? "—";
    customerTotals.set(name, (customerTotals.get(name) ?? 0) + Number(i.amount));
  });
  const topCustomers = Array.from(customerTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  const topMax = topCustomers[0]?.[1] ?? 1;

  // Monthly expenses (respects filter; when "all" shows all-time expenses)
  const monthlyExpenseTotal = filteredExpensesTotal;

  const expByMonth = new Map<string, number>();
  const expByDay = new Map<string, number>();
  (isAll ? expenses : filteredExpenses).forEach((e: any) => {
    const key = isAll ? expenseMonthKey(e) : expenseDateKey(e);
    if (!key) return;
    if (isAll) expByMonth.set(key, (expByMonth.get(key) ?? 0) + Number(e.price));
    else expByDay.set(key, (expByDay.get(key) ?? 0) + Number(e.price));
  });
  const expenseChart = Array.from((isAll ? expByMonth : expByDay).entries())
    .sort()
    .map(([m, v]) => ({ month: isAll ? new Date(m + "-01").toLocaleDateString("en", { month: "short" }) : String(Number(m.slice(8, 10))), total: v }));

  // Selected month by GROUP (Fixed Overhead / Variable Costs / One-Time / Other)
  const expByGroup = new Map<string, number>();
  GROUP_NAMES.forEach((g) => expByGroup.set(g, 0));
  filteredExpenses
    .forEach((e: any) => {
      const g = e.category && GROUP_NAMES.includes(e.category) ? e.category : "One-Time / Other";
      expByGroup.set(g, (expByGroup.get(g) ?? 0) + Number(e.price));
    });
  const expCatData = Array.from(expByGroup.entries())
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({ name, value }));

  // Fixed Overhead breakdown for selected + previous month
  const prevMonthKey = (() => {
    if (isAll) return lastMonthKey;
    const [y, m] = monthFilter.split("-").map(Number);
    const d = new Date(y, m - 2, 1);
    return d.toISOString().slice(0, 7);
  })();
  const overheadSubs = EXPENSE_GROUPS["Fixed Overhead"];
  const overheadBreakdown = overheadSubs.map((sub) => ({
    sub,
    total: expenses
      .filter(
        (e: any) =>
          (isAll || expenseMonthKey(e) === monthFilter) &&
          e.category === "Fixed Overhead" &&
          e.subcategory === sub,
      )
      .reduce((s: number, e: any) => s + Number(e.price), 0),
  }));
  const overheadThisMonth = overheadBreakdown.reduce((s, x) => s + x.total, 0);
  const overheadLastMonth = expenses
    .filter(
      (e: any) =>
        expenseMonthKey(e) === prevMonthKey && e.category === "Fixed Overhead",
    )
    .reduce((s: number, e: any) => s + Number(e.price), 0);
  const overheadDelta = overheadThisMonth - overheadLastMonth;

  // Low stock
  const inventory = invy.data ?? [];
  const lowStock = inventory.filter(
    (i: any) => Number(i.current_stock) <= Number(i.minimum_stock),
  );

  // Monthly chart
  const monthMap = new Map<string, number>();
  const dayMap = new Map<string, number>();
  (isAll ? invoices : filteredInvoices).forEach((i) => {
    const key = isAll ? invoiceMonthKey(i) : invoiceDateKey(i);
    if (!key) return;
    if (isAll) monthMap.set(key, (monthMap.get(key) ?? 0) + Number(i.amount));
    else dayMap.set(key, (dayMap.get(key) ?? 0) + Number(i.amount));
  });
  const chartData = Array.from((isAll ? monthMap : dayMap).entries())
    .sort()
    .map(([m, v]) => ({ month: isAll ? new Date(m + "-01").toLocaleDateString("en", { month: "short" }) : String(Number(m.slice(8, 10))), revenue: v }));

  // Client breakdown
  const clientMap = new Map<string, number>();
  filteredInvoices.forEach((i: any) => {
    const name = i.clients?.legal_name ?? "—";
    clientMap.set(name, (clientMap.get(name) ?? 0) + Number(i.amount));
  });
  const pieData = Array.from(clientMap.entries()).map(([name, value]) => ({ name, value }));
  const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

  const stats = [
    { key: "revenue", label: isAll ? "Total Revenue" : "Revenue", value: totalRevenue, format: pkr, icon: TrendingUp, accent: true, hero: true },
    { key: "collected", label: "Collected", value: collected, format: pkr, icon: Wallet, hero: true },
    {
      key: "cash",
      label: "Cash in Hand",
      value: cashInHand,
      format: pkr,
      icon: Wallet,
      accent: true,
      hero: true,
      valueClass: cashInHand >= 0 ? "text-primary" : "text-foreground",
    },
    { key: "pending", label: "Pending", value: pending, format: pkr, icon: Clock, hero: true, valueClass: "text-foreground" },
    { key: "unknown", label: "Unknown Status", value: unknown, format: pkr, icon: AlertTriangle },
    { key: "expenses", label: isAll ? "Total Expenses" : "Monthly Expenses", value: monthlyExpenseTotal, format: pkr, icon: Receipt },
    { key: "invoices_count", label: isAll ? "Total Invoices" : "Invoices", value: filteredInvoices.length, format: (n: number) => Math.round(n).toLocaleString(), icon: FileText },
    { key: "clients_count", label: "Active Paying Clients", value: payingClients, format: (n: number) => Math.round(n).toLocaleString(), icon: Users },
  ];

  // Previous-month totals for hero-card % delta indicators
  const prevInvoices = invoices.filter(
    (i: any) => invoiceMonthKey(i) === prevMonthKey,
  );
  const prevRevenue = prevInvoices.reduce((s, i) => s + Number(i.amount), 0);
  const prevCollected = prevInvoices
    .filter((i) => i.payment_status === "Done")
    .reduce((s, i) => s + Number(i.amount), 0);
  const prevPending = prevInvoices
    .filter((i) => i.payment_status === "Not Done")
    .reduce((s, i) => s + Number(i.amount), 0);
  const prevExpTotal = (expenses as any[])
    .filter((e) => expenseMonthKey(e) === prevMonthKey)
    .reduce((s: number, e: any) => s + Number(e.price), 0);
  const prevCash = prevCollected - prevExpTotal;
  const pctDelta = (curr: number, prev: number): number => {
    if (!prev) return curr > 0 ? 100 : 0;
    return ((curr - prev) / Math.abs(prev)) * 100;
  };
  const sharePct = (value: number, total: number): number => {
    if (!total) return value > 0 ? 100 : 0;
    return Math.max(0, Math.min(100, (value / Math.abs(total)) * 100));
  };
  const totalPayingClients = clients.filter((c: any) => c.client_type === "Paying Client").length;
  const heroDelta: Record<string, { pct: number; goodUp: boolean }> = {
    revenue: { pct: isAll ? sharePct(collected, totalRevenue) : pctDelta(totalRevenue, prevRevenue), goodUp: true },
    collected: { pct: isAll ? sharePct(collected, totalRevenue) : pctDelta(collected, prevCollected), goodUp: true },
    cash: { pct: isAll ? sharePct(Math.max(cashInHand, 0), Math.max(collected, monthlyExpenseTotal)) : pctDelta(cashInHand, prevCash), goodUp: true },
    pending: { pct: isAll ? sharePct(pending, totalRevenue) : pctDelta(pending, prevPending), goodUp: false },
    expenses: { pct: isAll ? sharePct(monthlyExpenseTotal, Math.max(totalRevenue, monthlyExpenseTotal)) : pctDelta(monthlyExpenseTotal, prevExpTotal), goodUp: false },
    invoices_count: {
      pct: isAll ? 100 : pctDelta(filteredInvoices.length, prevInvoices.length),
      goodUp: true,
    },
    unknown: {
      pct: isAll ? sharePct(unknown, totalRevenue) : pctDelta(
        unknown,
        prevInvoices.filter((i) => i.payment_status !== "Done" && i.payment_status !== "Not Done").reduce((s, i) => s + Number(i.amount), 0),
      ),
      goodUp: false,
    },
    clients_count: { pct: sharePct(payingClients, totalPayingClients), goodUp: true },
  };

  // Trend bars follow the active dashboard filter: monthly buckets for all-time, daily buckets for one month.
  const trendKeys: string[] = isAll
    ? monthOptions.slice().reverse().slice(-8)
    : (() => {
        const [year, month] = monthFilter.split("-").map(Number);
        const daysInMonth = new Date(year, month, 0).getDate();
        return Array.from({ length: daysInMonth }, (_, i) => `${monthFilter}-${String(i + 1).padStart(2, "0")}`);
      })();
  const revenueSpark = trendKeys.map((key) =>
    invoices
      .filter((i: any) => (isAll ? invoiceMonthKey(i) : invoiceDateKey(i)) === key)
      .reduce((s: number, i: any) => s + Number(i.amount), 0),
  );
  const collectedSpark = trendKeys.map((key) =>
    invoices
      .filter((i: any) => (isAll ? invoiceMonthKey(i) : invoiceDateKey(i)) === key && i.payment_status === "Done")
      .reduce((s: number, i: any) => s + Number(i.amount), 0),
  );
  const expensesSpark = trendKeys.map((key) =>
    (expenses as any[])
      .filter((e) => (isAll ? expenseMonthKey(e) : expenseDateKey(e)) === key)
      .reduce((s, e: any) => s + Number(e.price), 0),
  );
  const sparklineFor = (key: string): number[] | null => {
    if (key === "revenue") return revenueSpark;
    if (key === "collected") return collectedSpark;
    if (key === "expenses") return expensesSpark;
    return null;
  };

  const lastUpdatedRef = useRef<number>(Date.now());
  const isLoading = inv.isLoading || cl.isLoading || ex.isLoading;
  if (!isLoading && inv.dataUpdatedAt) {
    lastUpdatedRef.current = Math.max(
      inv.dataUpdatedAt,
      cl.dataUpdatedAt || 0,
      ex.dataUpdatedAt || 0,
    );
  }

  const hasUnknown = unknown > 0;
  const expensesGap = (ex.data ?? []).length < 10;

  // Ticker meta
  const lastUpdatedLabel = (() => {
    const t = lastUpdatedRef.current;
    const diff = Math.max(0, Date.now() - t);
    if (diff < 60_000) return "just now";
    const mins = Math.floor(diff / 60_000);
    if (mins < 60) return `${mins}m ago`;
    return `${Math.floor(mins / 60)}h ago`;
  })();

  return (
    <div className="space-y-6">
      <div className="ticker-strip">
        <span>Last updated <span className="tabular text-foreground">{lastUpdatedLabel}</span></span>
        <span className="text-muted-foreground/60">·</span>
        <span>
          <span className="tabular font-semibold text-primary">{overdue.length}</span> overdue invoice{overdue.length === 1 ? "" : "s"}
        </span>
        <span className="ml-auto flex items-center gap-2">
          <Link
            to="/invoices"
            className="rounded-[9px] bg-primary px-3 py-1.5 text-[12px] font-semibold text-primary-foreground transition-colors hover:brightness-110"
          >
            + New invoice
          </Link>
        </span>
      </div>

      <div className="dashboard-filter-shell" aria-label="Dashboard month filter">
        <span className="dashboard-filter-label">View</span>
        <div className="dashboard-filter-scroll">
          {dashboardFilterOptions.map((option) => (
            <button
              key={option.key}
              type="button"
              data-state={monthFilter === option.key ? "active" : "inactive"}
              className="dashboard-filter-button"
              onClick={() => setMonthFilter(option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <span className="dashboard-filter-summary">
          {isAll ? "Showing all-time totals" : `Showing ${monthLabel(monthFilter)}`}
        </span>
      </div>

      {(hasUnknown || expensesGap) && (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 text-warning" />
            <div className="space-y-1 text-sm">
              <p className="font-medium">Data Health</p>
              {hasUnknown && (
                <p className="text-muted-foreground">
                  {pkr(unknown)} across {invoices.filter((i) => i.payment_status === "Unknown").length} invoices have unknown payment status (May & June + 6 April invoices). Backfill in the Invoices tab.
                </p>
              )}
              {expensesGap && (
                <p className="text-muted-foreground">Expense tracking has gaps after April 1, 2026 — add today's expenses in the Expenses tab.</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {lowStock.length > 0 && (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="flex items-start gap-3 p-4">
            <Package className="mt-0.5 h-5 w-5 text-warning" />
            <div className="flex-1 space-y-1 text-sm">
              <div className="flex items-center justify-between">
                <p className="font-medium">Low Stock Alerts ({lowStock.length})</p>
                <Link to="/inventory" className="text-xs text-primary hover:underline">View inventory →</Link>
              </div>
              <div className="flex flex-wrap gap-2">
                {lowStock.slice(0, 8).map((i: any) => (
                  <Badge key={i.id} variant="outline" className="border-warning/40 text-warning">
                    {i.item_name}: {Number(i.current_stock)} {i.unit}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <ReorderAlertsWidget
        invoices={invoices}
        clients={clients}
        thresholdDays={Number((settingsQ.data as any)?.reorder_threshold_days ?? 14)}
      />

      {isLoading ? (
        <StatCardGridSkeleton count={8} />
      ) : (
        <>
          {/* Hero row — signature Fry Guys treatment */}
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {stats.filter((s) => (s as any).hero).map((s) => {
              const delta = heroDelta[s.key];
              const positive = delta.goodUp ? delta.pct >= 0 : delta.pct <= 0;
              const trendState = positive ? "up" : "down";
              const pctAbs = Math.min(Math.abs(delta.pct), 100);
              const ringColor = "var(--primary)";
              const R = 22;
              const C = 2 * Math.PI * R;
              const dash = pctAbs != null ? (pctAbs / 100) * C : 0;
              return (
                  <Card key={`${monthFilter}-${s.key}`} className={`hero-card hero-card--${s.key} relative rounded-2xl`}>
                   <CardContent className="relative z-10 p-5 sm:p-6">
                     <div className="flex items-start justify-between gap-3">
                       <div className="hero-card__icon-wrap">
                         <s.icon className="h-4 w-4" />
                       </div>
                       <div
                         className={`hero-ring hero-ring--${trendState}`}
                         aria-label={`${pctAbs.toFixed(1)} percent`}
                       >
                         <svg viewBox="0 0 56 56" className="hero-ring__svg">
                           <circle cx="28" cy="28" r={R} className="hero-ring__track" />
                           <circle
                             cx="28"
                             cy="28"
                             r={R}
                             className="hero-ring__value"
                             stroke={ringColor}
                             strokeDasharray={`${dash} ${C}`}
                             transform="rotate(-90 28 28)"
                           />
                         </svg>
                         <span className="hero-ring__label">{pctAbs.toFixed(0)}%</span>
                       </div>
                    </div>
                     <div className="mt-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{s.label}</div>
                     <div className="mt-2">
                       <div className={`hero-card__value ${(s as any).valueClass ?? "text-foreground"}`}>
                         <AnimatedNumber key={`${monthFilter}-${s.key}-${s.value}`} value={s.value} format={s.format} />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
          {/* Secondary metrics */}
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
            {stats.filter((s) => !(s as any).hero).map((s) => {
              const spark = sparklineFor(s.key);
              const delta = heroDelta[s.key];
              const positive = delta.goodUp ? delta.pct >= 0 : delta.pct <= 0;
              const trendState = positive ? "up" : "down";
              const pctAbs = Math.min(Math.abs(delta.pct), 100);
              const ringColor = "var(--primary)";
              const R = 22;
              const C = 2 * Math.PI * R;
              const dash = pctAbs != null ? (pctAbs / 100) * C : 0;
              return (
                <Card key={`${monthFilter}-${s.key}`} className={`dashboard-metric-card polish-card rounded-xl ${s.accent ? "border-primary/40" : ""}`}>
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{s.label}</span>
                      <div
                        className={`hero-ring hero-ring--${trendState}`}
                        aria-label={`${pctAbs.toFixed(1)} percent`}
                      >
                        <svg viewBox="0 0 56 56" className="hero-ring__svg">
                          <circle cx="28" cy="28" r={R} className="hero-ring__track" />
                          <circle
                            cx="28"
                            cy="28"
                            r={R}
                            className="hero-ring__value"
                            stroke={ringColor}
                            strokeDasharray={`${dash} ${C}`}
                            transform="rotate(-90 28 28)"
                          />
                        </svg>
                        <span className="hero-ring__label">{pctAbs.toFixed(0)}%</span>
                      </div>
                    </div>
                    <div className={`font-display tabular mt-3 text-2xl font-semibold ${(s as any).valueClass ?? (s.accent ? "text-primary" : "")}`}>
                      <AnimatedNumber key={`${monthFilter}-${s.key}-${s.value}`} value={s.value} format={s.format} />
                    </div>
                    {spark && <Sparkline data={spark} />}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}

      {/* Insight cards — collection ring · expense mix · top clients */}
      {(() => {
        const collectRate = totalRevenue > 0 ? Math.round((collected / totalRevenue) * 100) : 0;
        const overdueIdx = filteredInvoices.length > 0
          ? Math.round((overdue.filter((i: any) => isAll || invoiceMonthKey(i) === monthFilter).length / filteredInvoices.length) * 100)
          : 0;
        const R2 = 70;
        const C2 = 2 * Math.PI * R2;
        const dash2 = (collectRate / 100) * C2;

        const mixTotal = expCatData.reduce((s, d) => s + d.value, 0);
        const mixColors: Record<string, string> = {
          "Fixed Overhead": "var(--primary)",
          "Variable Costs": "var(--chart-2)",
          "One-Time / Other": "var(--muted-foreground)",
        };
        const mix = expCatData
          .map((d) => ({
            ...d,
            pct: mixTotal > 0 ? Math.round((d.value / mixTotal) * 100) : 0,
            color: mixColors[d.name] ?? "var(--primary)",
          }))
          .sort((a, b) => b.value - a.value)
          .slice(0, 3);

        const topSum = topCustomers.reduce((s, [, v]) => s + v, 0);
        const regions = topCustomers.map(([name, v]) => ({
          name,
          pct: topSum > 0 ? Math.round((v / topSum) * 100) : 0,
        }));
        const leader = regions[0];

        return (
          <div className="grid gap-4 md:grid-cols-3">
            <div className="insight-card">
              <div className="insight-card__eyebrow">Collection Rate</div>
              <div className="insight-ring" aria-label={`Collection rate ${collectRate} percent`}>
                <svg viewBox="0 0 168 168">
                  <circle cx="84" cy="84" r={R2} className="insight-ring__track" />
                  <circle
                    cx="84"
                    cy="84"
                    r={R2}
                    className="insight-ring__value"
                    strokeDasharray={`${dash2} ${C2}`}
                  />
                </svg>
                <div className="insight-ring__center">{collectRate}%</div>
              </div>
              <div className="insight-card__caption">
                Overdue Index <strong>{overdueIdx}%</strong>
              </div>
            </div>

            <div className="insight-card">
              <div className="insight-card__eyebrow">Expense Mix</div>
              <div className="flex flex-col gap-3 mt-1">
                {mix.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No expenses this period.</p>
                ) : mix.map((m) => (
                  <div key={m.name} className="space-y-1.5">
                    <div className="insight-row">
                      <span className="insight-row__label">
                        <span className="insight-row__dot" style={{ background: m.color }} />
                        {m.name}
                      </span>
                      <span className="insight-row__pct">{m.pct}%</span>
                    </div>
                    <div className="insight-bar">
                      <div className="insight-bar__fill" style={{ width: `${m.pct}%`, background: m.color }} />
                    </div>
                  </div>
                ))}
              </div>
              <Link to="/pnl" className="insight-cta">View Details</Link>
            </div>

            <div className="insight-card">
              <div className="insight-card__eyebrow">Top Clients</div>
              <p className="text-xs text-muted-foreground -mt-2">Share of revenue this period</p>
              <div className="flex flex-col gap-2 mt-1">
                {regions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No client revenue yet.</p>
                ) : regions.map((r, idx) => (
                  <div key={r.name} className="insight-row">
                    <span className="insight-row__label truncate max-w-[65%]">
                      {idx === 0 ? <span className="font-semibold text-primary">{r.name}</span> : r.name}
                    </span>
                    <span className="insight-row__pct">{r.pct}%</span>
                  </div>
                ))}
              </div>
              {leader && (
                <div className="insight-map">
                  <div className="insight-map__pin" style={{ top: 44, left: "38%" }}>
                    {leader.name.length > 14 ? leader.name.slice(0, 14) + "…" : leader.name} {leader.pct}%
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {(() => {
        const PS = 2.5;
        const allProd = prodAll.data ?? [];
        const todayStr = new Date().toISOString().slice(0, 10);
        const packsOf = (r: any) => Number(r.actual_packs_produced ?? r.packs_produced ?? 0);
        const todayProd = (allProd as any[]).filter((r) => r.date === todayStr);
        const monthProd = isAll
          ? (allProd as any[])
          : (allProd as any[]).filter((r) => String(r.date).slice(0, 7) === monthFilter);
        const monthInv = isAll
          ? invoices
          : invoices.filter((i: any) => String(i.delivery_date ?? "").slice(0, 7) === monthFilter);
        const monthSubLabel = isAll ? "All time" : monthLabel(monthFilter);
        const todayInv = invoices.filter((i: any) => i.delivery_date === todayStr);
        const todayRaw = todayProd.reduce((s, r) => s + Number(r.raw_input_kg ?? 0), 0);
        const monthRaw = monthProd.reduce((s, r) => s + Number(r.raw_input_kg ?? 0), 0);
        const todayPacks = todayProd.reduce((s, r) => s + packsOf(r), 0);
        const monthPacks = monthProd.reduce((s, r) => s + packsOf(r), 0);
        const todayDel = todayInv.reduce((s: number, i: any) => s + (Number(i.weight_kg ?? 0) / PS), 0);
        const monthDel = monthInv.reduce((s: number, i: any) => s + (Number(i.weight_kg ?? 0) / PS), 0);
        const totalProduced = (allProd as any[]).reduce((s, r) => s + packsOf(r), 0);
        const totalDelivered = invoices.reduce((s: number, i: any) => s + (Number(i.weight_kg ?? 0) / PS), 0);
        const inHand = Math.max(0, totalProduced - totalDelivered);
        const inHandColor = inHand > 20 ? "text-primary border-primary/40"
          : inHand >= 1 ? "text-warning border-warning/40"
          : "text-foreground border-foreground/40";
        const cards = [
          { label: "Raw Material", icon: Wheat, color: "text-primary border-primary/40",
            primary: `${todayRaw.toLocaleString("en", { maximumFractionDigits: 1 })} kg`,
            sub: `${monthSubLabel}: ${monthRaw.toLocaleString("en", { maximumFractionDigits: 0 })} kg`,
            tag: "Today's input" },
          { label: "Final Product", icon: Package, color: "text-primary border-primary/40",
            primary: `${todayPacks.toLocaleString("en", { maximumFractionDigits: 1 })} packs`,
            sub: `${(todayPacks * PS).toLocaleString("en", { maximumFractionDigits: 1 })} kg · ${monthPacks.toLocaleString("en", { maximumFractionDigits: 0 })} packs (${monthSubLabel})`,
            tag: "Today produced" },
          { label: "Delivered", icon: Truck, color: "text-primary border-primary/40",
            primary: `${todayDel.toLocaleString("en", { maximumFractionDigits: 1 })} packs`,
            sub: `${monthSubLabel}: ${monthDel.toLocaleString("en", { maximumFractionDigits: 0 })} packs`,
            tag: "Today shipped" },
          { label: "In Hand", icon: Warehouse, color: inHandColor,
            primary: inHand === 0 ? "Out of Stock" : `${inHand.toLocaleString("en", { maximumFractionDigits: 1 })} packs`,
            sub: inHand === 0 ? "No stock available" : `${(inHand * PS).toLocaleString("en", { maximumFractionDigits: 1 })} kg current stock`,
            tag: "All-time produced − delivered" },
        ];
        return (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-muted-foreground">Production → Inventory chain</h2>
              <Link to="/production" className="text-xs text-primary hover:underline">Log production →</Link>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {cards.map((c) => (
                <Card key={c.label} className={`chain-card border ${c.color}`}>
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs uppercase tracking-wider text-muted-foreground">{c.label}</span>
                      <c.icon className={`h-4 w-4 ${c.color.split(" ")[0]}`} />
                    </div>
                    <div className={`tabular mt-3 text-2xl font-semibold ${c.color.split(" ")[0]}`}>{c.primary}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{c.tag}</div>
                    <div className="mt-2 text-xs text-foreground/80 tabular">{c.sub}</div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        );
      })()}

      {(anomalies.data ?? []).length > 0 && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="space-y-2 p-4">
            <div className="flex items-center gap-2 text-primary">
              <AlertTriangle className="h-5 w-5" />
              <p className="font-medium">🚨 Production Anomaly Detected (last 7 days)</p>
            </div>
            <div className="space-y-1 text-sm text-foreground/90">
              {(anomalies.data ?? []).slice(0, 5).map((a: any) => {
                const exp = Number(a.packs_produced ?? 0);
                const act = Number(a.actual_packs_produced ?? 0);
                return (
                  <div key={a.date}>
                    <span className="font-medium">{a.date}:</span> Expected {exp.toFixed(1)} packs, got {act.toFixed(1)}.
                    {a.variance_reason ? <span className="text-muted-foreground"> Reason: {a.variance_reason}</span> : null}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Monthly Overhead Card */}
      <Card className="border-primary/30">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">
              {isAll ? "Overhead — Fixed Costs (All Time)" : "Monthly Overhead — Fixed Costs"}
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              {isAll ? "All-time totals" : monthLabel(monthFilter)}
            </p>
          </div>
          <Building2 className="h-5 w-5 text-primary" />
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-baseline gap-3">
            <div className="tabular text-2xl md:text-3xl font-semibold text-primary">{pkr(overheadThisMonth)}</div>
            {overheadLastMonth > 0 && (
              <span className={`text-xs ${overheadDelta > 0 ? "text-foreground" : "text-primary"}`}>
                {overheadDelta > 0 ? "↑" : "↓"} {pkr(Math.abs(overheadDelta))} vs last month
              </span>
            )}
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {overheadBreakdown.map((b) => (
              <div key={b.sub} className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{b.sub}</div>
                <div className="tabular mt-1 text-sm font-semibold">{pkr(b.total)}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Top 3 Customers widget */}
      <Card className="border-primary/30">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">Top 3 Customers</CardTitle>
          </div>
          <Link to="/customer-analytics" className="text-xs text-primary hover:underline">
            View all →
          </Link>
        </CardHeader>
        <CardContent>
          {topCustomers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No customer revenue yet.</p>
          ) : (
            <Link to="/customer-analytics" className="block space-y-3">
              {topCustomers.map(([name, total], idx) => (
                <div key={name} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">
                      <span className="mr-2 text-primary">#{idx + 1}</span>
                      {name}
                    </span>
                    <span className="tabular text-primary">{pkr(total)}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded bg-muted">
                    <div
                      className="h-full bg-primary"
                      style={{ width: `${(total / topMax) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </Link>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Expenses by Month</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={expenseChart}>
                <XAxis dataKey="month" stroke="var(--muted-foreground)" fontSize={12} />
                <YAxis stroke="var(--muted-foreground)" fontSize={12} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip
                  contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 6 }}
                  formatter={(v: number) => pkr(v)}
                />
                <Bar dataKey="total" fill="var(--primary)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {isAll ? "By Group (All Time)" : `${monthLabel(monthFilter)} by Group`}
            </CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            {expCatData.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No expenses recorded {isAll ? "yet" : "for this month"}.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={expCatData} dataKey="value" nameKey="name" innerRadius={40} outerRadius={80} paddingAngle={2}>
                    {expCatData.map((d, i) => (
                      <Cell key={i} fill={GROUP_COLORS[d.name as keyof typeof GROUP_COLORS] ?? COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => pkr(v)} contentStyle={{ background: "var(--card)", border: "1px solid var(--border)" }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Monthly Revenue</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <XAxis dataKey="month" stroke="var(--muted-foreground)" fontSize={12} />
                <YAxis stroke="var(--muted-foreground)" fontSize={12} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip
                  contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 6 }}
                  formatter={(v: number) => pkr(v)}
                />
                <Bar dataKey="revenue" fill="var(--primary)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Revenue by Client</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90} paddingAngle={2}>
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => pkr(v)} contentStyle={{ background: "var(--card)", border: "1px solid var(--border)" }} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Top Overdue Invoices</CardTitle>
        </CardHeader>
        <CardContent>
          {overdue.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No overdue invoices. 🎉</p>
          ) : (
            <div className="divide-y divide-border">
              {overdue.slice(0, 8).map((i: any) => {
                const days = Math.floor((today.getTime() - new Date(i.due_date!).getTime()) / 86400000);
                return (
                  <div key={i.id} className="flex items-center justify-between py-3">
                    <div>
                      <div className="font-medium">
                        {i.clients?.legal_name}
                        {i.branches?.branch_name ? ` — ${i.branches.branch_name}` : ""}
                      </div>
                      <div className="text-xs text-muted-foreground">{i.invoice_no}</div>
                    </div>
                    <div className="flex items-center gap-4">
                      <Badge variant="destructive">{days}d overdue</Badge>
                      <span className="tabular font-semibold">{pkr(Number(i.amount))}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {(() => {
        const s: any = settingsQ.data;
        const enabled = s?.day_end_notification_enabled;
        const lastSent = s?.day_end_last_sent_at ? new Date(s.day_end_last_sent_at) : null;
        const sentToday = lastSent && lastSent.toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10);
        const timeStr = (s?.day_end_report_time ?? "20:00").slice(0, 5);
        let cls = "border-warning/40 bg-warning/5 text-warning";
        let icon = "🟠";
        let text = "Day End Report: Not sent yet today";
        if (enabled === false) {
          cls = "border-border bg-muted/30 text-muted-foreground";
          icon = "⚪";
          text = "Day End Report: OFF";
        } else if (sentToday && lastSent) {
          cls = "border-primary/40 bg-primary/5 text-primary";
          icon = "✅";
          const t = lastSent.toLocaleTimeString("en", { hour: "numeric", minute: "2-digit", hour12: true });
          text = `Day End Report: Sent today at ${t}`;
        } else {
          text = `Day End Report: Not sent yet today (scheduled ${timeStr} PKT)`;
        }
        return (
          <div className={`flex items-center justify-between rounded-md border px-4 py-2 text-xs ${cls}`}>
            <span>{icon} {text}</span>
            <Link to="/settings" className="underline opacity-80 hover:opacity-100">Settings</Link>
          </div>
        );
      })()}
    </div>
  );
}
