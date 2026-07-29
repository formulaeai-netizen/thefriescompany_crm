import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Trash2, Pencil, ExternalLink, Calculator, ShieldAlert } from "lucide-react";

import { supabase } from "@/lib/supabase";
import { useIsAdmin } from "@/lib/roles";
import {
  fetchInvestors,
  fetchAllReturns,
  monthlyReturn,
  addYears,
  type Investor,
} from "@/lib/investor-queries";
import { inviteInvestor, calcMonthlyReturns } from "@/lib/investor-admin.functions";
import { pkr as fmtMoney } from "@/lib/format";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/investors/")({
  head: () => ({ meta: [{ title: "Investors — TFC CRM" }] }),
  component: InvestorsPage,
});

function statusColor(s: string) {
  if (s === "Active") return "bg-success/15 text-success border-success/30";
  if (s === "Completed") return "bg-muted text-muted-foreground border-border";
  return "bg-warning/15 text-warning border-warning/30";
}

function firstOfThisMonth(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

function InvestorsPage() {
  const { isAdmin, isLoading } = useIsAdmin();
  const navigate = useNavigate();

  if (isLoading) return <div className="text-muted-foreground">Loading…</div>;
  if (!isAdmin) {
    return (
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-warning" /> Admins only</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">You don't have access to investor management.</p>
          <Button variant="outline" onClick={() => navigate({ to: "/" })}>Go to dashboard</Button>
        </CardContent>
      </Card>
    );
  }

  return <AdminInvestors />;
}

function AdminInvestors() {
  const qc = useQueryClient();
  const { data: investors = [] } = useQuery({ queryKey: ["investors"], queryFn: fetchInvestors });
  const { data: returns = [] } = useQuery({ queryKey: ["investor-returns"], queryFn: fetchAllReturns });
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Investor | null>(null);

  const thisMonthIso = firstOfThisMonth();
  const totals = useMemo(() => {
    const totalCapital = investors.reduce((a, i) => a + Number(i.investment_amount), 0);
    const activeCount = investors.filter((i) => i.status === "Active").length;
    const thisMonth = returns.filter((r) => r.month.slice(0, 7) === thisMonthIso.slice(0, 7));
    const paid = thisMonth.filter((r) => r.paid).reduce((a, r) => a + Number(r.return_amount), 0);
    const due = thisMonth.filter((r) => !r.paid).reduce((a, r) => a + Number(r.return_amount), 0);
    return { totalCapital, activeCount, paid, due };
  }, [investors, returns, thisMonthIso]);

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("investors").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["investors"] });
      toast.success("Investor deleted");
    },
    onError: (e: any) => toast.error(e.message ?? "Delete failed"),
  });

  const calcFn = useServerFn(calcMonthlyReturns);
  const [calcOpen, setCalcOpen] = useState(false);
  const [netProfit, setNetProfit] = useState("0");
  const runCalc = async () => {
    try {
      const res = await calcFn({ data: { month: thisMonthIso, netProfit: Number(netProfit) } });
      toast.success(`Returns computed for ${res.inserted} investor(s)`);
      qc.invalidateQueries({ queryKey: ["investor-returns"] });
      setCalcOpen(false);
    } catch (e: any) {
      toast.error(e.message ?? "Failed");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Investor Management</h2>
          <p className="text-sm text-muted-foreground">Capital, ROI, and monthly returns.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setCalcOpen(true)}>
            <Calculator className="h-4 w-4" /> Calculate this month's returns
          </Button>
          <Button onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> Add Investor</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total Capital Invested" value={fmtMoney(totals.totalCapital)} />
        <StatCard label="Active Investors" value={String(totals.activeCount)} />
        <StatCard label="Returns Paid (This Month)" value={fmtMoney(totals.paid)} tone="success" />
        <StatCard label="Returns Due (This Month)" value={fmtMoney(totals.due)} tone="warning" />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Investors</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead className="text-right">Investment</TableHead>
                <TableHead className="text-right">ROI %</TableHead>
                <TableHead className="text-right">Monthly</TableHead>
                <TableHead>Start</TableHead>
                <TableHead>End</TableHead>
                <TableHead>Years</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {investors.length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                    No investors yet. Click "Add Investor" to get started.
                  </TableCell>
                </TableRow>
              )}
              {investors.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="font-medium">{i.name}</TableCell>
                  <TableCell className="text-muted-foreground">{i.email}</TableCell>
                  <TableCell className="text-right">{fmtMoney(i.investment_amount)}</TableCell>
                  <TableCell className="text-right">{Number(i.roi_percentage).toFixed(2)}%</TableCell>
                  <TableCell className="text-right">{fmtMoney(monthlyReturn(i.investment_amount, i.roi_percentage))}</TableCell>
                  <TableCell>{i.investment_date}</TableCell>
                  <TableCell>{i.investment_end_date}</TableCell>
                  <TableCell>{Number(i.duration_years)}</TableCell>
                  <TableCell><Badge className={statusColor(i.status)} variant="outline">{i.status}</Badge></TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button asChild variant="ghost" size="icon" aria-label="View">
                        <Link to="/investors/$id" params={{ id: i.id }}><ExternalLink className="h-4 w-4" /></Link>
                      </Button>
                      <Button variant="ghost" size="icon" aria-label="Edit" onClick={() => setEditTarget(i)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label="Delete"><Trash2 className="h-4 w-4 text-destructive" /></Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete investor?</AlertDialogTitle>
                            <AlertDialogDescription>This removes {i.name} and all of their return records. This cannot be undone.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => del.mutate(i.id)}>Delete</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <InvestorForm
        open={addOpen}
        onOpenChange={setAddOpen}
        onSaved={() => qc.invalidateQueries({ queryKey: ["investors"] })}
      />
      <InvestorForm
        open={!!editTarget}
        onOpenChange={(o) => !o && setEditTarget(null)}
        initial={editTarget ?? undefined}
        onSaved={() => qc.invalidateQueries({ queryKey: ["investors"] })}
      />

      <Dialog open={calcOpen} onOpenChange={setCalcOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Calculate this month's returns</DialogTitle>
            <DialogDescription>
              Enter TFC's net profit for {thisMonthIso.slice(0, 7)}. Each active investor's return = net profit × their ROI %. Loss months produce Rs. 0 returns.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Label htmlFor="np">Net Profit (Rs.)</Label>
            <Input id="np" type="number" value={netProfit} onChange={(e) => setNetProfit(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCalcOpen(false)}>Cancel</Button>
            <Button onClick={runCalc}>Compute</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: string; tone?: "success" | "warning" }) {
  const valueClass =
    tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-foreground";
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={`mt-2 text-2xl font-bold ${valueClass}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

const investorSchema = z.object({
  name: z.string().trim().min(2).max(200),
  email: z.string().trim().email(),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  investment_amount: z.coerce.number().positive(),
  roi_percentage: z.coerce.number().nonnegative().max(100),
  investment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  duration_years: z.coerce.number().positive().max(100),
  status: z.enum(["Active", "Completed", "Paused"]),
  notes: z.string().max(2000).optional().or(z.literal("")),
  sendInvite: z.boolean().optional(),
});

function InvestorForm({
  open, onOpenChange, initial, onSaved,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  initial?: Investor;
  onSaved: () => void;
}) {
  const isEdit = !!initial;
  const [name, setName] = useState(initial?.name ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [amount, setAmount] = useState(String(initial?.investment_amount ?? ""));
  const [roi, setRoi] = useState(String(initial?.roi_percentage ?? ""));
  const [start, setStart] = useState(initial?.investment_date ?? new Date().toISOString().slice(0, 10));
  const [years, setYears] = useState(String(initial?.duration_years ?? "1"));
  const [status, setStatus] = useState<"Active" | "Completed" | "Paused">((initial?.status as any) ?? "Active");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [sendInvite, setSendInvite] = useState(!isEdit);
  const [saving, setSaving] = useState(false);

  const invite = useServerFn(inviteInvestor);

  const endDate = useMemo(() => addYears(start, Number(years || 0)), [start, years]);
  const monthly = useMemo(() => monthlyReturn(Number(amount || 0), Number(roi || 0)), [amount, roi]);

  const submit = async () => {
    const parsed = investorSchema.safeParse({
      name, email, phone, investment_amount: amount, roi_percentage: roi,
      investment_date: start, duration_years: years, status, notes, sendInvite,
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: parsed.data.name,
        email: parsed.data.email,
        phone: parsed.data.phone || null,
        investment_amount: parsed.data.investment_amount,
        roi_percentage: parsed.data.roi_percentage,
        investment_date: parsed.data.investment_date,
        investment_end_date: endDate,
        duration_years: parsed.data.duration_years,
        status: parsed.data.status,
        notes: parsed.data.notes || null,
      };
      let savedId: string;
      if (isEdit && initial) {
        const { error } = await supabase.from("investors").update(payload).eq("id", initial.id);
        if (error) throw error;
        savedId = initial.id;
      } else {
        const { data, error } = await supabase.from("investors").insert(payload).select("id").single();
        if (error) throw error;
        savedId = (data as any).id;
      }

      if (parsed.data.sendInvite) {
        try {
          const res = await invite({ data: { investorId: savedId, email: parsed.data.email } });
          toast.success(res.alreadyExisted ? "Investor already had an account — role assigned" : "Invite email sent");
        } catch (e: any) {
          toast.error(`Saved, but invite failed: ${e.message ?? e}`);
        }
      } else {
        toast.success(isEdit ? "Investor updated" : "Investor created");
      }
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit investor" : "Add investor"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Update the investor's details." : "Create an investor record and optionally send them a magic-link invite."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label>Full name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label>Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={isEdit} />
          </div>
          <div>
            <Label>Phone</Label>
            <Input value={phone ?? ""} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <Label>Investment amount (Rs.)</Label>
            <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div>
            <Label>ROI (% per annum)</Label>
            <Input type="number" step="0.01" value={roi} onChange={(e) => setRoi(e.target.value)} />
          </div>
          <div>
            <Label>Start date</Label>
            <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div>
            <Label>Duration (years)</Label>
            <Input type="number" step="0.5" value={years} onChange={(e) => setYears(e.target.value)} />
          </div>
          <div>
            <Label>Status</Label>
            <select
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              value={status}
              onChange={(e) => setStatus(e.target.value as any)}
            >
              <option value="Active">Active</option>
              <option value="Completed">Completed</option>
              <option value="Paused">Paused</option>
            </select>
          </div>
          <div>
            <Label>End date (auto)</Label>
            <Input value={endDate} readOnly />
          </div>
          <div className="sm:col-span-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
            Monthly return preview: {fmtMoney(monthly)} (= amount × ROI ÷ 12)
          </div>
          <div className="sm:col-span-2">
            <Label>Notes</Label>
            <Textarea value={notes ?? ""} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {!isEdit && (
            <label className="sm:col-span-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={sendInvite} onChange={(e) => setSendInvite(e.target.checked)} />
              Send magic-link invite to this email
            </label>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "Saving…" : isEdit ? "Save" : "Create investor"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}