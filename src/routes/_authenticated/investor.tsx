import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip as ChartTooltip, CartesianGrid, ResponsiveContainer, ReferenceLine,
} from "recharts";

import { useMyRoles } from "@/lib/roles";
import {
  fetchMyInvestor, fetchReturnsForInvestor,
  monthlyReturn, projectedTotal, monthsBetween,
} from "@/lib/investor-queries";
import { pkr as fmtMoney, fmtDate } from "@/lib/format";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/investor")({
  head: () => ({ meta: [{ title: "My Investment — The Fries Company" }] }),
  component: InvestorDashboard,
});

function InvestorDashboard() {
  const { data: roles = [] } = useMyRoles();
  const isInvestor = roles.includes("investor");

  const { data: investor, isLoading } = useQuery({
    queryKey: ["my-investor"],
    queryFn: fetchMyInvestor,
  });

  const { data: rets = [] } = useQuery({
    queryKey: ["my-investor-returns", investor?.id],
    queryFn: () => investor ? fetchReturnsForInvestor(investor.id) : Promise.resolve([]),
    enabled: !!investor,
  });

  if (isLoading) return <div className="text-muted-foreground">Loading…</div>;

  if (!investor) {
    return (
      <Card className="max-w-md">
        <CardHeader><CardTitle>No investor profile</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">We couldn't find an investor record linked to your email. Please contact The Fries Company team.</p>
          {!isInvestor && <p className="mt-2 text-xs text-muted-foreground">Tip: this page is only meaningful for accounts with the investor role.</p>}
        </CardContent>
      </Card>
    );
  }

  const monthly = monthlyReturn(investor.investment_amount, investor.roi_percentage);
  const totalMonths = monthsBetween(investor.investment_date, investor.investment_end_date);
  const monthsDone = Math.min(monthsBetween(investor.investment_date, new Date().toISOString().slice(0, 10)), totalMonths);
  const totalPaid = rets.filter((r) => r.paid).reduce((a, r) => a + Number(r.return_amount), 0);
  const projected = projectedTotal(investor.investment_amount, investor.roi_percentage, investor.duration_years);
  const paidMonths = rets.filter((r) => r.paid).length;
  const avgMonthly = paidMonths > 0 ? totalPaid / paidMonths : 0;

  const chartData = useMemo(() => {
    return rets.map((r) => ({
      month: r.month.slice(0, 7),
      actual: Number(r.return_amount),
      projected: monthly,
    }));
  }, [rets, monthly]);

  // trend (last 3 vs prior 3)
  const sortedPaid = rets.filter((r) => r.paid).slice().sort((a, b) => a.month.localeCompare(b.month));
  const last3 = sortedPaid.slice(-3).reduce((a, r) => a + Number(r.return_amount), 0) / Math.max(1, Math.min(3, sortedPaid.length));
  const prev3 = sortedPaid.slice(-6, -3).reduce((a, r) => a + Number(r.return_amount), 0) / Math.max(1, sortedPaid.slice(-6, -3).length);
  const trend = last3 > prev3 ? "↑ Improving" : last3 < prev3 ? "↓ Declining" : "→ Steady";

  const expectedSoFar = monthly * monthsDone;
  const diff = totalPaid - expectedSoFar;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Welcome, {investor.name}</h2>
        <p className="text-sm text-muted-foreground">Investment Portfolio — The Fries Company</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">My Investment</p>
            <p className="mt-2 text-2xl font-bold">{fmtMoney(investor.investment_amount)}</p>
            <p className="text-xs text-muted-foreground mt-1">{fmtDate(investor.investment_date)} — {fmtDate(investor.investment_end_date)}</p>
            <p className="text-xs text-muted-foreground">{investor.duration_years} year term</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">My ROI Rate</p>
            <p className="mt-2 text-2xl font-bold text-[#F59E0B]">{Number(investor.roi_percentage).toFixed(2)}% p.a.</p>
            <p className="text-xs text-muted-foreground mt-1">Monthly target: {fmtMoney(monthly)}</p>
            <div className="mt-3"><Progress value={totalMonths > 0 ? (monthsDone / totalMonths) * 100 : 0} /></div>
            <p className="text-xs text-muted-foreground mt-1">{monthsDone} / {totalMonths} months</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Total Earned So Far</p>
            <p className="mt-2 text-2xl font-bold text-success">{fmtMoney(totalPaid)}</p>
            <p className="text-xs text-muted-foreground mt-1">{paidMonths} month(s) of returns received</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Monthly returns</CardTitle></CardHeader>
        <CardContent className="h-64">
          {chartData.length === 0 ? (
            <p className="text-sm text-muted-foreground">No returns recorded yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                <XAxis dataKey="month" stroke="#94A3B8" fontSize={12} />
                <YAxis stroke="#94A3B8" fontSize={12} />
                <ChartTooltip />
                <ReferenceLine y={monthly} stroke="#F59E0B" strokeDasharray="3 3" />
                <Line type="monotone" dataKey="actual" stroke="#F59E0B" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="projected" stroke="#64748B" strokeWidth={1} strokeDasharray="4 4" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Monthly statements</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead>TFC Performance</TableHead>
                <TableHead className="text-right">My Return</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rets.length === 0 && (
                <TableRow><TableCell colSpan={4} className="py-6 text-center text-muted-foreground">No returns yet — your first statement will appear after the next month-end.</TableCell></TableRow>
              )}
              {rets.map((r) => {
                const loss = Number(r.net_profit) <= 0;
                return (
                  <TableRow key={r.id}>
                    <TableCell>{r.month.slice(0, 7)}</TableCell>
                    <TableCell>
                      {loss
                        ? <Badge variant="outline" className="bg-destructive/15 text-destructive border-destructive/30">Loss month</Badge>
                        : <Badge variant="outline" className="bg-success/15 text-success border-success/30">Profitable</Badge>}
                    </TableCell>
                    <TableCell className="text-right font-medium">{fmtMoney(r.return_amount)}</TableCell>
                    <TableCell>
                      {r.paid
                        ? <Badge variant="outline" className="bg-success/15 text-success border-success/30">Paid{r.paid_date ? ` • ${fmtDate(r.paid_date)}` : ""}</Badge>
                        : <Badge variant="outline" className="bg-warning/15 text-warning border-warning/30">Pending</Badge>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Avg Monthly Returns</p>
            <p className="mt-2 text-2xl font-bold">{fmtMoney(avgMonthly)}</p>
            <p className="text-xs text-muted-foreground mt-1">Based on {paidMonths} month(s)</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Estimated Total ROI</p>
            <p className="mt-2 text-2xl font-bold text-[#F59E0B]">{fmtMoney(projected)}</p>
            <p className="text-xs text-muted-foreground mt-1">Over {investor.duration_years} years at {Number(investor.roi_percentage).toFixed(2)}%</p>
            <p className="text-xs text-muted-foreground">Monthly avg: {fmtMoney(monthly)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Performance</p>
            {diff >= 0 ? (
              <p className="mt-2 text-lg font-semibold text-success">✅ Outperforming by {fmtMoney(diff)}</p>
            ) : (
              <p className="mt-2 text-lg font-semibold text-warning">⚠️ {fmtMoney(Math.abs(diff))} below projection</p>
            )}
            <p className="text-xs text-muted-foreground mt-1">Trend: {trend}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}