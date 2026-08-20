import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { fetchInvoices, fetchExpenses } from "@/lib/queries";
import { pkr } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { EXPENSE_GROUPS, GROUP_NAMES, GROUP_COLORS } from "@/lib/expense-categories";
import { CashInHandBreakdownCard } from "@/components/cash-in-hand-breakdown-card";
import { AccountBalancesCard } from "@/components/account-balances-card";
import { getProfitAndLossSummary } from "@/lib/financial-accounts.functions";

export const Route = createFileRoute("/_authenticated/pnl")({
  head: () => ({ meta: [{ title: "P&L — TFC CRM" }] }),
  component: PnlPage,
});

function monthKey(d: Date) {
  return d.toISOString().slice(0, 7);
}

function PnlPage() {
  const { data: invoices = [] } = useQuery({ queryKey: ["invoices"], queryFn: fetchInvoices });
  const { data: expenses = [] } = useQuery({ queryKey: ["expenses"], queryFn: fetchExpenses });
  const pnlFn = useServerFn(getProfitAndLossSummary);

  const today = new Date();
  // Determine months to show: March, April, May, June + current month if newer
  const baseYear = today.getFullYear();
  const monthsSet = new Set<string>([
    `${baseYear}-03`,
    `${baseYear}-04`,
    `${baseYear}-05`,
    `${baseYear}-06`,
    monthKey(today),
  ]);
  const months = Array.from(monthsSet).sort();

  type Row = {
    month: string;
    label: string;
    revenue: number;
    collected: number;
    expenses: number;
    revenueLessExpenses: number;
    collectedLessExpenses: number;
    hasUnknown: boolean;
  };

  const rows: Row[] = months.map((m) => {
    const monthInvoices = invoices.filter(
      (i: any) => (i.delivery_date ?? i.date ?? "").slice(0, 7) === m,
    );
    const revenue = monthInvoices.reduce((s, i: any) => s + Number(i.amount), 0);
    const collected = monthInvoices
      .filter((i: any) => i.payment_status === "Done")
      .reduce((s, i: any) => s + Number(i.amount), 0);
    const hasUnknown = monthInvoices.some((i: any) => i.payment_status === "Unknown");
    const exp = expenses
      .filter((e: any) => (e.date ?? "").slice(0, 7) === m)
      .reduce((s: number, e: any) => s + Number(e.price), 0);
    return {
      month: m,
      label: new Date(m + "-01").toLocaleDateString("en", { month: "short", year: "2-digit" }),
      revenue,
      collected,
      expenses: exp,
      revenueLessExpenses: revenue - exp,
      collectedLessExpenses: collected - exp,
      hasUnknown,
    };
  });

  const chartData = rows.map((r) => ({
    month: r.label,
    Revenue: r.revenue,
    Expenses: r.expenses,
    "Revenue Less Expenses": r.revenueLessExpenses,
  }));

  // Current month breakdown by group vs revenue
  const currentKey = monthKey(today);
  const currentStart = `${currentKey}-01`;
  const currentEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0)
    .toISOString()
    .slice(0, 10);
  const canonicalPnlQ = useQuery({
    queryKey: ["canonical-pnl", currentStart, currentEnd],
    queryFn: () => pnlFn({ data: { start_date: currentStart, end_date: currentEnd } }),
  });
  const currentRow = rows.find((r) => r.month === currentKey);
  const breakdownByGroup = GROUP_NAMES.map((g) => ({
    name: g,
    value: expenses
      .filter(
        (e: any) =>
          (e.date ?? "").slice(0, 7) === currentKey &&
          (e.category === g || (!GROUP_NAMES.includes(e.category) && g === "One-Time / Other")),
      )
      .reduce((s: number, e: any) => s + Number(e.price), 0),
  })).filter((d) => d.value > 0);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Profit & Loss</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Canonical P&L, account balances and legacy cash collection views.
        </p>
      </div>

      <AccountBalancesCard />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Truthful P&L Policy</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-5">
          {canonicalPnlQ.isError ? (
            <div className="md:col-span-5 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              Could not load canonical P&L: {(canonicalPnlQ.error as Error)?.message}
            </div>
          ) : (
            <>
              <PnlMetric label="Revenue" value={Number(canonicalPnlQ.data?.revenue ?? 0)} />
              <PnlMetric
                label="Operating Expenses"
                value={Number(canonicalPnlQ.data?.operating_expenses ?? 0)}
              />
              <PnlMetric
                label="Payroll Expense"
                value={Number(canonicalPnlQ.data?.payroll_expense ?? 0)}
              />
              <PnlMetric
                label="Net Profit"
                value={Number(canonicalPnlQ.data?.net_profit ?? 0)}
                emphasize
              />
              <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-xs text-muted-foreground">
                COGS/Gross Profit: {canonicalPnlQ.data?.cogs_status ?? "not available"}
              </div>
              <div className="md:col-span-5 text-xs text-muted-foreground">
                {canonicalPnlQ.data?.policy}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <CashInHandBreakdownCard />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Summary by Month</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-4 py-3 text-left">Metric</th>
                  {rows.map((r) => (
                    <th key={r.month} className="px-4 py-3 text-right">
                      {r.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="tabular">
                <tr className="border-b border-border/40">
                  <td className="px-4 py-3 font-medium">Total Revenue</td>
                  {rows.map((r) => (
                    <td key={r.month} className="px-4 py-3 text-right">
                      {pkr(r.revenue)}
                    </td>
                  ))}
                </tr>
                <tr className="border-b border-border/40">
                  <td className="px-4 py-3 font-medium">Total Collected</td>
                  {rows.map((r) => (
                    <td key={r.month} className="px-4 py-3 text-right">
                      {r.hasUnknown ? (
                        <Badge variant="outline" className="border-warning/40 text-warning">
                          Unknown / Pending backfill
                        </Badge>
                      ) : (
                        pkr(r.collected)
                      )}
                    </td>
                  ))}
                </tr>
                <tr className="border-b border-border/40">
                  <td className="px-4 py-3 font-medium">Total Expenses</td>
                  {rows.map((r) => (
                    <td key={r.month} className="px-4 py-3 text-right">
                      {pkr(r.expenses)}
                    </td>
                  ))}
                </tr>
                <tr className="border-b border-border/40">
                  <td className="px-4 py-3 font-semibold">Revenue Less Expenses</td>
                  {rows.map((r) => (
                    <td
                      key={r.month}
                      className={`px-4 py-3 text-right font-semibold ${
                        r.revenueLessExpenses >= 0 ? "text-primary" : "text-foreground"
                      }`}
                    >
                      {pkr(r.revenueLessExpenses)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="px-4 py-3 font-semibold">Collected Less Expenses</td>
                  {rows.map((r) => (
                    <td
                      key={r.month}
                      className={`px-4 py-3 text-right font-semibold ${
                        r.hasUnknown
                          ? "text-muted-foreground"
                          : r.collectedLessExpenses >= 0
                            ? "text-primary"
                            : "text-foreground"
                      }`}
                    >
                      {r.hasUnknown ? "—" : pkr(r.collectedLessExpenses)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <div className="space-y-3 p-4 md:hidden">
            {rows.map((r) => (
              <article key={r.month} className="rounded-xl border border-border bg-card p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="font-semibold">{r.label}</h3>
                  {r.hasUnknown && (
                    <Badge variant="outline" className="border-warning/40 text-warning">
                      Needs backfill
                    </Badge>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">
                      Revenue
                    </div>
                    <div className="tabular font-semibold">{pkr(r.revenue)}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">
                      Collected
                    </div>
                    <div className="tabular font-semibold">
                      {r.hasUnknown ? "—" : pkr(r.collected)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">
                      Expenses
                    </div>
                    <div className="tabular font-semibold">{pkr(r.expenses)}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">
                      Collected Less Expenses
                    </div>
                    <div
                      className={`tabular font-semibold ${r.collectedLessExpenses >= 0 ? "text-primary" : "text-foreground"}`}
                    >
                      {r.hasUnknown ? "—" : pkr(r.collectedLessExpenses)}
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Revenue vs Expenses vs Revenue Less Expenses</CardTitle>
        </CardHeader>
        <CardContent className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="month" stroke="var(--muted-foreground)" fontSize={12} />
              <YAxis
                stroke="var(--muted-foreground)"
                fontSize={12}
                tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                }}
                formatter={(v: number) => pkr(v)}
              />
              <Legend />
              <Bar dataKey="Revenue" fill="var(--primary)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Expenses" fill="var(--chart-3)" radius={[4, 4, 0, 0]} />
              <Line
                type="monotone"
                dataKey="Revenue Less Expenses"
                stroke="var(--gold-bright)"
                strokeWidth={2}
                dot
              />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Current Month — Cost Mix vs Revenue (
            {new Date(currentKey + "-01").toLocaleDateString("en", {
              month: "long",
              year: "numeric",
            })}
            )
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 md:grid-cols-2">
            <div className="h-64">
              {breakdownByGroup.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No expenses recorded this month.
                </p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={breakdownByGroup}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={50}
                      outerRadius={90}
                      paddingAngle={2}
                    >
                      {breakdownByGroup.map((d, i) => (
                        <Cell key={i} fill={GROUP_COLORS[d.name as keyof typeof GROUP_COLORS]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v: number) => pkr(v)}
                      contentStyle={{
                        background: "var(--card)",
                        border: "1px solid var(--border)",
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className="space-y-3">
              <div className="rounded-md border border-primary/30 bg-primary/5 p-4">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  Revenue this month
                </div>
                <div className="tabular mt-1 text-2xl font-semibold text-primary">
                  {pkr(currentRow?.revenue ?? 0)}
                </div>
              </div>
              {breakdownByGroup.map((b) => {
                const pct =
                  currentRow && currentRow.revenue > 0
                    ? ((b.value / currentRow.revenue) * 100).toFixed(1)
                    : "—";
                return (
                  <div
                    key={b.name}
                    className="flex items-center justify-between rounded-md border border-border/60 px-4 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block h-3 w-3 rounded-sm"
                        style={{ background: GROUP_COLORS[b.name as keyof typeof GROUP_COLORS] }}
                      />
                      <span className="text-sm">{b.name}</span>
                    </div>
                    <div className="tabular text-sm">
                      <span className="font-semibold">{pkr(b.value)}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{pct}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Note: May and June invoices currently show payment status as "Unknown" — collected cash is
        pending backfill.
      </p>
    </div>
  );
}

function PnlMetric({
  label,
  value,
  emphasize = false,
}: {
  label: string;
  value: number;
  emphasize?: boolean;
}) {
  return (
    <div className={`rounded-md border p-3 ${emphasize ? "border-primary/40 bg-primary/5" : ""}`}>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`tabular mt-1 text-lg font-semibold ${value >= 0 ? "text-primary" : ""}`}>
        {pkr(value)}
      </div>
    </div>
  );
}
