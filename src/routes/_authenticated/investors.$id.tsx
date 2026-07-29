import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, ShieldAlert, CheckCircle2 } from "lucide-react";

import { supabase } from "@/lib/supabase";
import { useIsAdmin } from "@/lib/roles";
import {
  fetchInvestor, fetchReturnsForInvestor,
  monthlyReturn, projectedTotal, monthsBetween,
} from "@/lib/investor-queries";
import { pkr as fmtMoney, fmtDate } from "@/lib/format";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/investors/$id")({
  head: () => ({ meta: [{ title: "Investor — TFC CRM" }] }),
  component: InvestorDetailPage,
});

function InvestorDetailPage() {
  const { id } = Route.useParams();
  const { isAdmin, isLoading } = useIsAdmin();
  const navigate = useNavigate();

  if (isLoading) return <div className="text-muted-foreground">Loading…</div>;
  if (!isAdmin) {
    return (
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-warning" /> Admins only</CardTitle>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => navigate({ to: "/" })}>Go to dashboard</Button>
        </CardContent>
      </Card>
    );
  }
  return <Detail id={id} />;
}

function Detail({ id }: { id: string }) {
  const qc = useQueryClient();
  const { data: inv, isLoading } = useQuery({
    queryKey: ["investor", id],
    queryFn: () => fetchInvestor(id),
  });
  const { data: rets = [] } = useQuery({
    queryKey: ["investor-returns", id],
    queryFn: () => fetchReturnsForInvestor(id),
  });

  const [payTarget, setPayTarget] = useState<any | null>(null);
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [payNotes, setPayNotes] = useState("");
  const [payAmount, setPayAmount] = useState("0");

  const markPaid = useMutation({
    mutationFn: async () => {
      if (!payTarget) return;
      const { error } = await supabase
        .from("investor_returns")
        .update({
          paid: true,
          paid_date: payDate,
          notes: payNotes || null,
          return_amount: Number(payAmount),
        })
        .eq("id", payTarget.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["investor-returns", id] });
      qc.invalidateQueries({ queryKey: ["investor-returns"] });
      toast.success("Marked as paid");
      setPayTarget(null);
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  if (isLoading) return <div className="text-muted-foreground">Loading…</div>;
  if (!inv) return <div>Investor not found.</div>;

  const monthly = monthlyReturn(inv.investment_amount, inv.roi_percentage);
  const totalMonths = monthsBetween(inv.investment_date, inv.investment_end_date);
  const monthsDone = monthsBetween(inv.investment_date, new Date().toISOString().slice(0, 10));
  const monthsClamped = Math.min(monthsDone, totalMonths);
  const projected = projectedTotal(inv.investment_amount, inv.roi_percentage, inv.duration_years);
  const totalPaid = rets.filter((r) => r.paid).reduce((a, r) => a + Number(r.return_amount), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon"><Link to="/investors"><ChevronLeft className="h-5 w-5" /></Link></Button>
          <div>
            <h2 className="text-xl font-bold">{inv.name}</h2>
            <p className="text-sm text-muted-foreground">{inv.email}{inv.phone ? ` • ${inv.phone}` : ""}</p>
          </div>
        </div>
        <Badge variant="outline">{inv.status}</Badge>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SmallCard label="Total Invested" value={fmtMoney(inv.investment_amount)} />
        <SmallCard label="ROI Rate" value={`${Number(inv.roi_percentage).toFixed(2)}%`} sub="per annum" />
        <SmallCard label="Monthly Return" value={fmtMoney(monthly)} sub="at full ROI" />
        <SmallCard label="Timeline" value={`${inv.duration_years} yrs`} sub={`${fmtDate(inv.investment_date)} → ${fmtDate(inv.investment_end_date)}`} />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Progress</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Progress value={totalMonths > 0 ? (monthsClamped / totalMonths) * 100 : 0} />
          <p className="text-sm text-muted-foreground">
            Month {monthsClamped} of {totalMonths} • Paid so far: <span className="text-foreground font-semibold">{fmtMoney(totalPaid)}</span> • Projected total: <span className="text-foreground font-semibold">{fmtMoney(projected)}</span> • Remaining: <span className="text-foreground font-semibold">{fmtMoney(Math.max(0, projected - totalPaid))}</span>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Monthly returns</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead className="text-right">Net profit (TFC)</TableHead>
                <TableHead className="text-right">Return %</TableHead>
                <TableHead className="text-right">Return amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rets.length === 0 && (
                <TableRow><TableCell colSpan={6} className="py-6 text-center text-muted-foreground">No return records yet. Use "Calculate this month's returns" on the Investors page.</TableCell></TableRow>
              )}
              {rets.map((r) => {
                const isLoss = Number(r.net_profit) <= 0;
                const statusBadge = r.paid
                  ? <Badge className="bg-success/15 text-success border-success/30" variant="outline">Paid{r.paid_date ? ` • ${fmtDate(r.paid_date)}` : ""}</Badge>
                  : isLoss
                    ? <Badge className="bg-destructive/15 text-destructive border-destructive/30" variant="outline">Loss month</Badge>
                    : <Badge className="bg-warning/15 text-warning border-warning/30" variant="outline">Due</Badge>;
                return (
                  <TableRow key={r.id}>
                    <TableCell>{r.month.slice(0, 7)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(r.net_profit)}</TableCell>
                    <TableCell className="text-right">{Number(r.return_percentage).toFixed(2)}%</TableCell>
                    <TableCell className="text-right">{fmtMoney(r.return_amount)}</TableCell>
                    <TableCell>{statusBadge}</TableCell>
                    <TableCell className="text-right">
                      {!r.paid && !isLoss && (
                        <Button size="sm" variant="outline" onClick={() => {
                          setPayTarget(r); setPayAmount(String(r.return_amount)); setPayDate(new Date().toISOString().slice(0, 10)); setPayNotes("");
                        }}>
                          <CheckCircle2 className="h-4 w-4" /> Mark paid
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!payTarget} onOpenChange={(o) => !o && setPayTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Mark return as paid</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Amount (Rs.)</Label><Input type="number" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} /></div>
            <div><Label>Payment date</Label><Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} /></div>
            <div><Label>Notes</Label><Textarea value={payNotes} onChange={(e) => setPayNotes(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayTarget(null)}>Cancel</Button>
            <Button onClick={() => markPaid.mutate()}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SmallCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-2 text-2xl font-bold">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}