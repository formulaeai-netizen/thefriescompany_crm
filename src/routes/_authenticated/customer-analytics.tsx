import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { fetchClients, fetchInvoices } from "@/lib/queries";
import { pkr, fmtDate } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
  Legend,
} from "recharts";
import {
  Users,
  Trophy,
  Receipt,
  Repeat,
  ArrowUpDown,
  Search,
  MapPin,
  Phone,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/customer-analytics")({
  head: () => ({ meta: [{ title: "Customer Analytics — Fry Guys CRM" }] }),
  component: CustomerAnalyticsPage,
});

type Row = {
  id: string;
  name: string;
  city: string;
  contact: string | null;
  phone: string | null;
  clientType: string | null;
  invoiceCount: number;
  totalBilled: number;
  totalCollected: number;
  outstanding: number;
  avgOrder: number;
  largestOrder: number;
  lastOrderDate: string | null;
  paymentRate: number;
  invoices: any[];
};

type SortKey =
  | "name"
  | "city"
  | "invoiceCount"
  | "totalBilled"
  | "totalCollected"
  | "outstanding"
  | "avgOrder"
  | "largestOrder"
  | "lastOrderDate"
  | "paymentRate";

function CustomerAnalyticsPage() {
  const { data: clients = [] } = useQuery({ queryKey: ["clients"], queryFn: fetchClients });
  const { data: invoices = [] } = useQuery({ queryKey: ["invoices"], queryFn: fetchInvoices });

  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("totalBilled");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [openClientId, setOpenClientId] = useState<string | null>(null);

  const rows: Row[] = useMemo(() => {
    return (clients as any[]).map((c) => {
      const cInvoices = (invoices as any[]).filter((i) => i.clients?.id === c.id || i.client_id === c.id);
      const totalBilled = cInvoices.reduce((s, i) => s + Number(i.amount), 0);
      const totalCollected = cInvoices
        .filter((i) => i.payment_status === "Done")
        .reduce((s, i) => s + Number(i.amount), 0);
      const largestOrder = cInvoices.reduce((m, i) => Math.max(m, Number(i.amount)), 0);
      const lastOrderDate = cInvoices
        .map((i) => i.delivery_date ?? i.date)
        .filter(Boolean)
        .sort()
        .slice(-1)[0] ?? null;
      const paymentRate = totalBilled > 0 ? (totalCollected / totalBilled) * 100 : 0;
      return {
        id: c.id,
        name: c.legal_name ?? "—",
        city: c.city ?? "—",
        contact: c.primary_contact ?? null,
        phone: c.phone ?? null,
        clientType: c.client_type ?? null,
        invoiceCount: cInvoices.length,
        totalBilled,
        totalCollected,
        outstanding: totalBilled - totalCollected,
        avgOrder: cInvoices.length ? totalBilled / cInvoices.length : 0,
        largestOrder,
        lastOrderDate,
        paymentRate,
        invoices: cInvoices,
      };
    });
  }, [clients, invoices]);

  const activeRows = rows.filter((r) => r.invoiceCount > 0);

  // Summary
  const totalActive = activeRows.filter((r) => r.clientType === "Paying Client").length;
  const bestCustomer = [...activeRows].sort((a, b) => b.totalBilled - a.totalBilled)[0];
  const totalRevenue = activeRows.reduce((s, r) => s + r.totalBilled, 0);
  const totalInvoiceCount = activeRows.reduce((s, r) => s + r.invoiceCount, 0);
  const avgOrderAll = totalInvoiceCount > 0 ? totalRevenue / totalInvoiceCount : 0;
  const mostFrequent = [...activeRows].sort((a, b) => b.invoiceCount - a.invoiceCount)[0];

  // Filter + sort
  const filtered = activeRows.filter((r) =>
    r.name.toLowerCase().includes(search.toLowerCase()),
  );
  const sorted = [...filtered].sort((a, b) => {
    const av: any = (a as any)[sortKey];
    const bv: any = (b as any)[sortKey];
    let cmp = 0;
    if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
    else cmp = String(av ?? "").localeCompare(String(bv ?? ""));
    return sortDir === "asc" ? cmp : -cmp;
  });

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortKey(k);
      setSortDir(k === "name" || k === "city" ? "asc" : "desc");
    }
  };

  const openClient = rows.find((r) => r.id === openClientId) ?? null;

  // Chart data
  const revenueChart = [...activeRows]
    .sort((a, b) => b.totalBilled - a.totalBilled)
    .map((r) => ({ name: r.name, value: r.totalBilled }));
  const avgOrderChart = [...activeRows]
    .sort((a, b) => b.avgOrder - a.avgOrder)
    .map((r) => ({ name: r.name, value: r.avgOrder }));
  const payRateChart = [...activeRows]
    .sort((a, b) => b.paymentRate - a.paymentRate)
    .map((r) => ({ name: r.name, value: Number(r.paymentRate.toFixed(1)) }));

  const summary = [
    {
      label: "Total Active Customers",
      value: totalActive.toString(),
      sub: `${activeRows.length} with invoices`,
      icon: Users,
    },
    {
      label: "Best Customer",
      value: bestCustomer?.name ?? "—",
      sub: bestCustomer ? pkr(bestCustomer.totalBilled) : "—",
      icon: Trophy,
    },
    {
      label: "Avg Order Size (All)",
      value: pkr(avgOrderAll),
      sub: `${totalInvoiceCount} invoices total`,
      icon: Receipt,
    },
    {
      label: "Most Frequent",
      value: mostFrequent?.name ?? "—",
      sub: mostFrequent ? `${mostFrequent.invoiceCount} invoices` : "—",
      icon: Repeat,
    },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Customer Analytics</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Per-customer revenue, payment behaviour and ordering patterns.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {summary.map((s) => (
          <Card key={s.label} className="border-primary/30">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">{s.label}</span>
                <s.icon className="h-4 w-4 text-primary" />
              </div>
              <div className="tabular mt-3 truncate text-xl font-semibold text-primary">{s.value}</div>
              <div className="mt-1 truncate text-xs text-muted-foreground">{s.sub}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-col items-stretch justify-between gap-4 space-y-0 sm:flex-row sm:items-center">
          <CardTitle className="text-base">Customer-wise Business</CardTitle>
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by client name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="hidden overflow-x-auto md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortHead label="Client" k="name" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortHead label="City" k="city" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortHead label="Invoices" k="invoiceCount" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                  <SortHead label="Billed" k="totalBilled" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                  <SortHead label="Collected" k="totalCollected" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                  <SortHead label="Outstanding" k="outstanding" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                  <SortHead label="Avg Order" k="avgOrder" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                  <SortHead label="Largest" k="largestOrder" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                  <SortHead label="Last Order" k="lastOrderDate" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortHead label="Payment Rate" k="paymentRate" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((r) => {
                  const rateColor = r.paymentRate >= 50 ? "bg-primary" : "bg-foreground";
                  return (
                    <TableRow
                      key={r.id}
                      className="cursor-pointer"
                      onClick={() => setOpenClientId(r.id)}
                    >
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="text-muted-foreground">{r.city}</TableCell>
                      <TableCell className="text-right tabular">{r.invoiceCount}</TableCell>
                      <TableCell className="text-right tabular">{pkr(r.totalBilled)}</TableCell>
                      <TableCell className="text-right tabular text-primary">{pkr(r.totalCollected)}</TableCell>
                      <TableCell className={`text-right tabular ${r.outstanding > 0 ? "text-foreground" : ""}`}>
                        {pkr(r.outstanding)}
                      </TableCell>
                      <TableCell className="text-right tabular">{pkr(r.avgOrder)}</TableCell>
                      <TableCell className="text-right tabular">{pkr(r.largestOrder)}</TableCell>
                      <TableCell className="text-muted-foreground">{fmtDate(r.lastOrderDate)}</TableCell>
                      <TableCell className="min-w-[140px]">
                        <div className="flex items-center gap-2">
                          <div className="h-2 flex-1 overflow-hidden rounded bg-muted">
                            <div
                              className={`h-full ${rateColor}`}
                              style={{ width: `${Math.min(100, r.paymentRate)}%` }}
                            />
                          </div>
                          <span className="tabular w-10 text-right text-xs">{r.paymentRate.toFixed(0)}%</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {sorted.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} className="py-10 text-center text-muted-foreground">
                      No customers match.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <div className="space-y-3 p-4 md:hidden">
            {sorted.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setOpenClientId(r.id)}
                className="w-full rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold">{r.name}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">{r.city} · {r.invoiceCount} invoices</p>
                  </div>
                  <Badge variant="outline" className="border-primary/40 text-primary">{r.paymentRate.toFixed(0)}%</Badge>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">Billed</div>
                    <div className="tabular font-semibold">{pkr(r.totalBilled)}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">Collected</div>
                    <div className="tabular font-semibold text-primary">{pkr(r.totalCollected)}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">Outstanding</div>
                    <div className="tabular font-semibold">{pkr(r.outstanding)}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">Last Order</div>
                    <div className="font-semibold">{fmtDate(r.lastOrderDate)}</div>
                  </div>
                </div>
              </button>
            ))}
            {sorted.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">No customers match.</p>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Revenue by Customer</CardTitle></CardHeader>
          <CardContent className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={revenueChart} layout="vertical" margin={{ left: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis type="number" stroke="var(--muted-foreground)" fontSize={11} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="name" stroke="var(--muted-foreground)" fontSize={11} width={100} />
                <Tooltip
                  contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 6 }}
                  formatter={(v: number) => pkr(v)}
                />
                <Bar dataKey="value" fill="var(--primary)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Average Order Size</CardTitle></CardHeader>
          <CardContent className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={avgOrderChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="name" stroke="var(--muted-foreground)" fontSize={10} angle={-25} textAnchor="end" height={70} />
                <YAxis stroke="var(--muted-foreground)" fontSize={11} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip
                  contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 6 }}
                  formatter={(v: number) => pkr(v)}
                />
                <Bar dataKey="value" fill="var(--primary)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Payment Rate by Customer</CardTitle></CardHeader>
          <CardContent className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={payRateChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="name" stroke="var(--muted-foreground)" fontSize={10} angle={-25} textAnchor="end" height={70} />
                <YAxis stroke="var(--muted-foreground)" fontSize={11} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                <Tooltip
                  contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 6 }}
                  formatter={(v: number) => `${v}%`}
                />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {payRateChart.map((d, i) => (
                    <Cell
                      key={i}
                      fill={d.value >= 50 ? "var(--primary)" : "var(--foreground)"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!openClient} onOpenChange={(o) => !o && setOpenClientId(null)}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          {openClient && <CustomerDetail row={openClient} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SortHead({
  label,
  k,
  sortKey,
  sortDir,
  onSort,
  align = "left",
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  onSort: (k: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = sortKey === k;
  return (
    <TableHead
      onClick={() => onSort(k)}
      className={`cursor-pointer select-none ${align === "right" ? "text-right" : ""}`}
    >
      <span className={`inline-flex items-center gap-1 ${active ? "text-foreground" : ""}`}>
        {label}
        <ArrowUpDown className="h-3 w-3 opacity-50" />
        {active && <span className="text-[10px]">{sortDir === "asc" ? "▲" : "▼"}</span>}
      </span>
    </TableHead>
  );
}

function CustomerDetail({ row }: { row: Row }) {
  const isActive = row.invoiceCount > 0;

  // Monthly trend
  const byMonth = new Map<string, { billed: number; collected: number }>();
  row.invoices.forEach((i: any) => {
    const m = ((i.delivery_date ?? i.date) ?? "").slice(0, 7);
    if (!m) return;
    const e = byMonth.get(m) ?? { billed: 0, collected: 0 };
    e.billed += Number(i.amount);
    if (i.payment_status === "Done") e.collected += Number(i.amount);
    byMonth.set(m, e);
  });
  const trend = Array.from(byMonth.entries())
    .sort()
    .map(([m, v]) => ({
      month: new Date(m + "-01").toLocaleDateString("en", { month: "short", year: "2-digit" }),
      Billed: v.billed,
      Collected: v.collected,
    }));

  // Branch breakdown
  const byBranch = new Map<string, { count: number; total: number }>();
  row.invoices.forEach((i: any) => {
    const b = i.branches?.branch_name ?? "—";
    const e = byBranch.get(b) ?? { count: 0, total: 0 };
    e.count += 1;
    e.total += Number(i.amount);
    byBranch.set(b, e);
  });
  const branchRows = Array.from(byBranch.entries()).map(([name, v]) => ({
    name,
    count: v.count,
    total: v.total,
    avg: v.total / v.count,
  }));

  const stats = [
    { label: "Total Billed", value: pkr(row.totalBilled) },
    { label: "Collected", value: pkr(row.totalCollected), color: "text-primary" },
    { label: "Outstanding", value: pkr(row.outstanding), color: row.outstanding > 0 ? "text-foreground" : "" },
    { label: "Avg Order", value: pkr(row.avgOrder) },
  ];

  return (
    <div className="space-y-6">
      <DialogHeader>
        <DialogTitle className="text-xl">{row.name}</DialogTitle>
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {row.city}</span>
          {row.contact && <span>{row.contact}</span>}
          {row.phone && <span className="inline-flex items-center gap-1"><Phone className="h-3.5 w-3.5" /> {row.phone}</span>}
          <Badge variant={isActive ? "default" : "outline"} className={isActive ? "border-primary/40 bg-primary/20 text-primary" : ""}>
            {isActive ? "Active" : "Inactive"}
          </Badge>
        </div>
      </DialogHeader>

      <div className="grid gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">{s.label}</div>
              <div className={`tabular mt-2 text-lg font-semibold ${s.color ?? ""}`}>{s.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm">Monthly Trend — Billed vs Collected</CardTitle></CardHeader>
        <CardContent className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="month" stroke="var(--muted-foreground)" fontSize={11} />
              <YAxis stroke="var(--muted-foreground)" fontSize={11} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip
                contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 6 }}
                formatter={(v: number) => pkr(v)}
              />
              <Legend />
              <Bar dataKey="Billed" fill="var(--chart-3)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Collected" fill="var(--primary)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {branchRows.length > 1 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Branch Breakdown</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Branch</TableHead>
                  <TableHead className="text-right">Invoices</TableHead>
                  <TableHead className="text-right">Total Billed</TableHead>
                  <TableHead className="text-right">Avg Order</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {branchRows.map((b) => (
                  <TableRow key={b.name}>
                    <TableCell>{b.name}</TableCell>
                    <TableCell className="text-right tabular">{b.count}</TableCell>
                    <TableCell className="text-right tabular">{pkr(b.total)}</TableCell>
                    <TableCell className="text-right tabular">{pkr(b.avg)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
            <div className="space-y-3 p-4 md:hidden">
              {branchRows.map((b) => (
                <article key={b.name} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">{b.name}</h3>
                      <p className="mt-1 text-xs text-muted-foreground">{b.count} invoices</p>
                    </div>
                    <div className="text-right">
                      <div className="tabular font-semibold text-primary">{pkr(b.total)}</div>
                      <div className="text-xs text-muted-foreground">Avg {pkr(b.avg)}</div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-sm">All Invoices</CardTitle></CardHeader>
          <CardContent className="p-0">
          <div className="hidden md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice No</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...row.invoices]
                .sort((a, b) => String(b.delivery_date ?? b.date).localeCompare(String(a.delivery_date ?? a.date)))
                .map((i: any) => (
                  <TableRow key={i.id}>
                    <TableCell className="font-medium">{i.invoice_no}</TableCell>
                    <TableCell>{fmtDate(i.delivery_date ?? i.date)}</TableCell>
                    <TableCell className="text-muted-foreground">{i.branches?.branch_name ?? "—"}</TableCell>
                    <TableCell className="text-right tabular">{pkr(Number(i.amount))}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          i.payment_status === "Done"
                            ? "border-primary/40 text-primary"
                            : i.payment_status === "Not Done"
                            ? "border-foreground/30 text-foreground"
                            : "border-warning/40 text-warning"
                        }
                      >
                        {i.payment_status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
          </div>
          <div className="space-y-3 p-4 md:hidden">
            {[...row.invoices]
              .sort((a, b) => String(b.delivery_date ?? b.date).localeCompare(String(a.delivery_date ?? a.date)))
              .map((i: any) => (
                <article key={i.id} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate font-semibold">{i.invoice_no}</h3>
                      <p className="mt-1 text-xs text-muted-foreground">{fmtDate(i.delivery_date ?? i.date)} · {i.branches?.branch_name ?? "—"}</p>
                    </div>
                    <Badge
                      variant="outline"
                      className={
                        i.payment_status === "Done"
                          ? "border-primary/40 text-primary"
                          : i.payment_status === "Not Done"
                          ? "border-foreground/30 text-foreground"
                          : "border-warning/40 text-warning"
                      }
                    >
                      {i.payment_status}
                    </Badge>
                  </div>
                  <div className="mt-3 tabular text-lg font-semibold">{pkr(Number(i.amount))}</div>
                </article>
              ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}