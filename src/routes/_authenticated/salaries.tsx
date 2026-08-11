import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { pkr } from "@/lib/format";
import { calculatePayroll, validatePayrollDayTotals } from "@/lib/payroll";
import { useIsAdmin } from "@/lib/roles";
import {
  cancelPayroll,
  createSalaryAdvance,
  finalizePayroll,
  linkSalaryAdvanceToPayroll,
  listEmployees,
  listPayroll,
  listSalaryAdvances,
  markPayrollPaid,
  revertPayrollToDraft,
  saveEmployee,
  savePayrollDraft,
} from "@/lib/payroll.functions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { Pencil, Plus, CheckCircle2, Lock, Undo2, Ban, Wallet } from "lucide-react";

export const Route = createFileRoute("/_authenticated/salaries")({
  head: () => ({ meta: [{ title: "Salaries — TFC CRM" }] }),
  component: SalariesPage,
});

// ===========================================================================
// Types (mirror payroll.functions.ts server-function return shapes)
// ===========================================================================

type PayrollRow = {
  id: string;
  month: string;
  employee_id: string;
  employee_name: string;
  designation: string | null;
  department: string | null;
  employee_ref_id: string | null;
  status: "draft" | "finalized" | "paid" | "cancelled";
  total_working_days: number;
  present_days: number | null;
  paid_leave_days: number;
  unpaid_leave_days: number;
  absent_days: number;
  overtime_hours: number;
  overtime_rate: number;
  overtime_amount: number;
  base_salary_used: number;
  base_earned: number;
  bonus: number;
  allowances: number;
  commission: number;
  other_earnings: number;
  unpaid_leave_deduction: number;
  advance_deduction: number;
  other_deduction: number;
  total_deductions: number;
  manual_adjustment: number;
  manual_adjustment_reason: string | null;
  gross_salary: number;
  net_salary: number;
  notes: string | null;
  paid: boolean;
  paid_at: string | null;
  paid_by: string | null;
  finalized_at: string | null;
  finalized_by: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  created_by: string | null;
  created_at: string;
};

type Employee = {
  id: string;
  employee_code: string;
  full_name: string;
  designation: string | null;
  department: string | null;
  base_salary: number;
  standard_working_days: number;
  standard_daily_hours: number | null;
  overtime_rate: number;
  fixed_allowance: number;
  is_active: boolean;
  notes: string | null;
};

type SalaryAdvance = {
  id: string;
  employee_ref_id: string;
  amount: number;
  advance_date: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  linked_total: number;
  outstanding: number;
};

type PayrollAdvanceLink = { payroll_id: string; advance_id: string; amount: number };

function n(v: string | number | null | undefined): number {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
}

function monthLabel(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("default", { month: "long", year: "numeric" });
}

function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const STATUS_BADGE: Record<PayrollRow["status"], { label: string; className: string }> = {
  draft: { label: "Draft", className: "border-muted-foreground/30 text-muted-foreground" },
  finalized: { label: "Finalized", className: "border-warning/30 text-warning" },
  paid: { label: "Paid", className: "border-success/30 text-success" },
  cancelled: { label: "Cancelled", className: "border-destructive/30 text-destructive" },
};

// ===========================================================================
// Page
// ===========================================================================

function SalariesPage() {
  const qc = useQueryClient();
  const { isAdmin } = useIsAdmin();

  const listPayrollFn = useServerFn(listPayroll);
  const listEmployeesFn = useServerFn(listEmployees);
  const listAdvancesFn = useServerFn(listSalaryAdvances);

  const payrollQ = useQuery({ queryKey: ["payroll"], queryFn: () => listPayrollFn({}) });
  const employeesQ = useQuery({
    queryKey: ["payroll-employees"],
    queryFn: () => listEmployeesFn({}),
  });
  const advancesQ = useQuery({ queryKey: ["salary-advances"], queryFn: () => listAdvancesFn({}) });

  const rows: PayrollRow[] = payrollQ.data?.rows ?? [];
  const names: Record<string, string> = payrollQ.data?.names ?? {};
  const employees: Employee[] = employeesQ.data?.rows ?? [];
  const advances: SalaryAdvance[] = advancesQ.data?.rows ?? [];
  const advanceNames: Record<string, string> = advancesQ.data?.names ?? {};

  const [monthFilter, setMonthFilter] = useState<string>(currentMonthKey());
  const [payrollDialogOpen, setPayrollDialogOpen] = useState(false);
  const [editingPayroll, setEditingPayroll] = useState<PayrollRow | null>(null);

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["payroll"] });
    qc.invalidateQueries({ queryKey: ["salary-advances"] });
    qc.invalidateQueries({ queryKey: ["cash-in-hand-summary"] });
  };

  const monthOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => set.add(r.month));
    set.add(currentMonthKey());
    return Array.from(set).sort().reverse();
  }, [rows]);

  const monthRows = useMemo(() => rows.filter((r) => r.month === monthFilter), [rows, monthFilter]);

  const totals = useMemo(() => {
    const acc = {
      base: 0,
      overtime: 0,
      extras: 0,
      deductions: 0,
      net: 0,
    };
    monthRows.forEach((r) => {
      if (r.status === "cancelled") return;
      acc.base += n(r.base_earned);
      acc.overtime += n(r.overtime_amount);
      acc.extras += n(r.bonus) + n(r.allowances) + n(r.commission) + n(r.other_earnings);
      acc.deductions += n(r.total_deductions);
      acc.net += n(r.net_salary);
    });
    return acc;
  }, [monthRows]);

  // ---- mutations ----
  const finalizeFn = useServerFn(finalizePayroll);
  const finalizeMut = useMutation({
    mutationFn: (payroll_id: string) => finalizeFn({ data: { payroll_id } }),
    onSuccess: () => {
      toast.success("Payroll finalized");
      invalidateAll();
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not finalize payroll"),
  });

  const revertFn = useServerFn(revertPayrollToDraft);
  const revertMut = useMutation({
    mutationFn: (payroll_id: string) => revertFn({ data: { payroll_id } }),
    onSuccess: () => {
      toast.success("Payroll reverted to draft");
      invalidateAll();
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not revert payroll"),
  });

  const cancelFn = useServerFn(cancelPayroll);
  const cancelMut = useMutation({
    mutationFn: (input: { payroll_id: string; reason: string }) => cancelFn({ data: input }),
    onSuccess: () => {
      toast.success("Payroll cancelled");
      invalidateAll();
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not cancel payroll"),
  });

  const markPaidFn = useServerFn(markPayrollPaid);
  const markPaidMut = useMutation({
    mutationFn: (payroll_id: string) => markPaidFn({ data: { payroll_id } }),
    onSuccess: () => {
      toast.success("Payroll marked as paid");
      invalidateAll();
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not mark payroll paid"),
  });

  function openCreate() {
    setEditingPayroll(null);
    setPayrollDialogOpen(true);
  }
  function openEdit(row: PayrollRow) {
    setEditingPayroll(row);
    setPayrollDialogOpen(true);
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-white">Salaries</h1>
          <p className="text-sm text-muted-foreground">Monthly payroll</p>
        </div>
      </div>

      <Tabs defaultValue="payroll">
        <TabsList>
          <TabsTrigger value="payroll">Payroll</TabsTrigger>
          <TabsTrigger value="advances">Salary Advances</TabsTrigger>
          <TabsTrigger value="employees">Employees</TabsTrigger>
        </TabsList>

        <TabsContent value="payroll" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Select value={monthFilter} onValueChange={setMonthFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {monthOptions.map((m) => (
                  <SelectItem key={m} value={m}>
                    {monthLabel(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isAdmin && (
              <Button
                onClick={openCreate}
                className="bg-amber-500 hover:bg-amber-600 text-black font-medium"
              >
                <Plus className="h-4 w-4 mr-2" /> New Payroll
              </Button>
            )}
          </div>

          <Card className="bg-[#111827] border-white/5 overflow-hidden">
            <CardContent className="p-0 overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="bg-[#0A0F1E] text-amber-300/90 uppercase tracking-wider">
                    <th className="p-2 text-left">Employee</th>
                    <th className="p-2 text-left">Period</th>
                    <th className="p-2 text-right">Base Salary</th>
                    <th className="p-2 text-right">Overtime</th>
                    <th className="p-2 text-right">Bonus/Extras</th>
                    <th className="p-2 text-right">Deductions</th>
                    <th className="p-2 text-right">Net Salary</th>
                    <th className="p-2 text-center">Status</th>
                    <th className="p-2 text-center">Paid Date</th>
                    <th className="p-2 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="text-white/90">
                  {monthRows.length === 0 && (
                    <tr>
                      <td colSpan={10} className="p-8 text-center text-muted-foreground">
                        No payroll records for {monthLabel(monthFilter)}.
                      </td>
                    </tr>
                  )}
                  {monthRows.map((r) => {
                    const extras =
                      n(r.bonus) + n(r.allowances) + n(r.commission) + n(r.other_earnings);
                    const badge = STATUS_BADGE[r.status];
                    return (
                      <tr key={r.id} className="border-t border-white/5 hover:bg-white/[0.02]">
                        <td className="p-2 font-medium">
                          {r.employee_name}
                          <div className="text-[10px] text-muted-foreground">{r.employee_id}</div>
                        </td>
                        <td className="p-2">{monthLabel(r.month)}</td>
                        <td className="p-2 text-right">{pkr(r.base_earned)}</td>
                        <td className="p-2 text-right">{pkr(r.overtime_amount)}</td>
                        <td className="p-2 text-right">{pkr(extras)}</td>
                        <td className="p-2 text-right text-red-300/90">
                          {pkr(r.total_deductions)}
                        </td>
                        <td className="p-2 text-right font-semibold text-amber-300">
                          {pkr(r.net_salary)}
                        </td>
                        <td className="p-2 text-center">
                          <Badge variant="outline" className={badge.className}>
                            {badge.label}
                          </Badge>
                        </td>
                        <td className="p-2 text-center text-[10px] text-muted-foreground">
                          {r.paid_at ? new Date(r.paid_at).toLocaleDateString() : "—"}
                          {r.paid_by && names[r.paid_by] ? <div>by {names[r.paid_by]}</div> : null}
                        </td>
                        <td className="p-2">
                          <div className="flex items-center justify-center gap-1 flex-wrap">
                            {r.status === "draft" && (
                              <Button
                                size="icon"
                                variant="ghost"
                                title="Edit"
                                onClick={() => openEdit(r)}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {r.status !== "draft" && (
                              <Button
                                size="icon"
                                variant="ghost"
                                title="View"
                                onClick={() => openEdit(r)}
                              >
                                <Pencil className="h-3.5 w-3.5 opacity-60" />
                              </Button>
                            )}
                            {isAdmin && r.status === "draft" && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={finalizeMut.isPending}
                                onClick={() => finalizeMut.mutate(r.id)}
                                title="Finalize"
                              >
                                <Lock className="h-3.5 w-3.5 mr-1" /> Finalize
                              </Button>
                            )}
                            {isAdmin && r.status === "finalized" && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={revertMut.isPending}
                                onClick={() => revertMut.mutate(r.id)}
                                title="Revert to draft"
                              >
                                <Undo2 className="h-3.5 w-3.5 mr-1" /> Revert
                              </Button>
                            )}
                            {isAdmin && r.status === "finalized" && (
                              <MarkPaidButton
                                row={r}
                                pending={markPaidMut.isPending}
                                onConfirm={() => markPaidMut.mutate(r.id)}
                              />
                            )}
                            {isAdmin && (r.status === "draft" || r.status === "finalized") && (
                              <CancelPayrollButton
                                pending={cancelMut.isPending}
                                onConfirm={(reason) =>
                                  cancelMut.mutate({ payroll_id: r.id, reason })
                                }
                              />
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {monthRows.length > 0 && (
                    <tr className="border-t-2 border-amber-500/40 bg-[#0A0F1E]/60 font-semibold text-amber-200">
                      <td className="p-2" colSpan={2}>
                        TOTAL (excludes cancelled)
                      </td>
                      <td className="p-2 text-right">{pkr(totals.base)}</td>
                      <td className="p-2 text-right">{pkr(totals.overtime)}</td>
                      <td className="p-2 text-right">{pkr(totals.extras)}</td>
                      <td className="p-2 text-right">{pkr(totals.deductions)}</td>
                      <td className="p-2 text-right text-amber-300">{pkr(totals.net)}</td>
                      <td colSpan={3} />
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="advances">
          <AdvancesTab
            employees={employees}
            advances={advances}
            names={advanceNames}
            isAdmin={isAdmin}
            onChanged={invalidateAll}
          />
        </TabsContent>

        <TabsContent value="employees">
          <EmployeesTab
            employees={employees}
            isAdmin={isAdmin}
            onChanged={() => qc.invalidateQueries({ queryKey: ["payroll-employees"] })}
          />
        </TabsContent>
      </Tabs>

      <PayrollDialog
        open={payrollDialogOpen}
        onOpenChange={setPayrollDialogOpen}
        editingPayroll={editingPayroll}
        employees={employees}
        advances={advances}
        month={monthFilter}
        onSaved={invalidateAll}
      />
    </div>
  );
}

// ===========================================================================
// Mark Paid confirmation - shows employee, period, net salary and the exact
// amount that will debit Cash in Hand, per the required confirmation UX.
// ===========================================================================

function MarkPaidButton({
  row,
  pending,
  onConfirm,
}: {
  row: PayrollRow;
  pending: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={pending} title="Mark Paid">
          <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Mark Paid
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Mark payroll as paid?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-left">
              <div>
                <span className="text-muted-foreground">Employee: </span>
                {row.employee_name}
              </div>
              <div>
                <span className="text-muted-foreground">Payroll period: </span>
                {monthLabel(row.month)}
              </div>
              <div>
                <span className="text-muted-foreground">Net salary: </span>
                <span className="font-semibold">{pkr(row.net_salary)}</span>
              </div>
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2">
                <span className="text-muted-foreground">
                  Amount that will be deducted from Cash in Hand:{" "}
                </span>
                <span className="font-semibold text-amber-300">{pkr(row.net_salary)}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                This creates exactly one cash debit and cannot be undone from here.
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Mark Paid</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function CancelPayrollButton({
  pending,
  onConfirm,
}: {
  pending: boolean;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <AlertDialog onOpenChange={(open) => !open && setReason("")}>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="ghost" disabled={pending} title="Cancel payroll">
          <Ban className="h-3.5 w-3.5 mr-1 text-red-400" /> Cancel
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel this payroll record?</AlertDialogTitle>
          <AlertDialogDescription>
            An unpaid, cancelled payroll record has no Cash in Hand effect. This cannot be applied
            to an already-paid record.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-1">
          <Label className="text-xs">Cancellation reason (required)</Label>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Back</AlertDialogCancel>
          <AlertDialogAction disabled={!reason.trim()} onClick={() => onConfirm(reason.trim())}>
            Confirm Cancel
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ===========================================================================
// Payroll create/edit dialog
// ===========================================================================

type PayrollFormState = {
  employee_ref_id: string;
  month: string;
  base_salary_used: string;
  total_working_days: string;
  present_days: string;
  paid_leave_days: string;
  unpaid_leave_days: string;
  absent_days: string;
  overtime_hours: string;
  overtime_rate: string;
  bonus: string;
  allowances: string;
  commission: string;
  other_earnings: string;
  other_deduction: string;
  manual_adjustment: string;
  manual_adjustment_reason: string;
  notes: string;
};

function emptyForm(month: string, employee?: Employee): PayrollFormState {
  return {
    employee_ref_id: employee?.id ?? "",
    month,
    base_salary_used: employee ? String(employee.base_salary) : "",
    total_working_days: employee ? String(employee.standard_working_days) : "26",
    present_days: "",
    paid_leave_days: "0",
    unpaid_leave_days: "0",
    absent_days: "0",
    overtime_hours: "0",
    overtime_rate: employee ? String(employee.overtime_rate) : "0",
    bonus: "0",
    allowances: employee ? String(employee.fixed_allowance) : "0",
    commission: "0",
    other_earnings: "0",
    other_deduction: "0",
    manual_adjustment: "0",
    manual_adjustment_reason: "",
    notes: "",
  };
}

function formFromRow(row: PayrollRow): PayrollFormState {
  return {
    employee_ref_id: row.employee_ref_id ?? "",
    month: row.month,
    base_salary_used: String(row.base_salary_used),
    total_working_days: String(row.total_working_days),
    present_days: row.present_days == null ? "" : String(row.present_days),
    paid_leave_days: String(row.paid_leave_days),
    unpaid_leave_days: String(row.unpaid_leave_days),
    absent_days: String(row.absent_days),
    overtime_hours: String(row.overtime_hours),
    overtime_rate: String(row.overtime_rate),
    bonus: String(row.bonus),
    allowances: String(row.allowances),
    commission: String(row.commission),
    other_earnings: String(row.other_earnings),
    other_deduction: String(row.other_deduction),
    manual_adjustment: String(row.manual_adjustment),
    manual_adjustment_reason: row.manual_adjustment_reason ?? "",
    notes: row.notes ?? "",
  };
}

function PayrollDialog({
  open,
  onOpenChange,
  editingPayroll,
  employees,
  advances,
  month,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingPayroll: PayrollRow | null;
  employees: Employee[];
  advances: SalaryAdvance[];
  month: string;
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<PayrollFormState>(() => emptyForm(month));
  const [payrollId, setPayrollId] = useState<string | null>(null);
  const [links, setLinks] = useState<PayrollAdvanceLink[]>([]);

  const isReadOnly = editingPayroll != null && editingPayroll.status !== "draft";
  const isCreating = editingPayroll == null;

  useEffect(() => {
    if (!open) return;
    if (editingPayroll) {
      setForm(formFromRow(editingPayroll));
      setPayrollId(editingPayroll.id);
      fetchLinks(editingPayroll.id);
    } else {
      setForm(emptyForm(month));
      setPayrollId(null);
      setLinks([]);
    }
  }, [open, editingPayroll, month]);

  async function fetchLinks(id: string) {
    const { data } = await (supabase as any)
      .from("payroll_advance_links")
      .select("payroll_id, advance_id, amount")
      .eq("payroll_id", id);
    setLinks((data ?? []) as PayrollAdvanceLink[]);
  }

  const saveDraftFn = useServerFn(savePayrollDraft);
  const saveMut = useMutation({
    mutationFn: (data: any) => saveDraftFn({ data }),
    onSuccess: (res: any) => {
      toast.success("Payroll draft saved");
      setPayrollId(res.id);
      onSaved();
      qc.invalidateQueries({ queryKey: ["payroll"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not save payroll draft"),
  });

  const linkAdvanceFn = useServerFn(linkSalaryAdvanceToPayroll);
  const linkMut = useMutation({
    mutationFn: (data: { advance_id: string; amount: number }) =>
      linkAdvanceFn({
        data: { payroll_id: payrollId!, advance_id: data.advance_id, amount: data.amount },
      }),
    onSuccess: async () => {
      toast.success("Advance deduction updated");
      if (payrollId) await fetchLinks(payrollId);
      onSaved();
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not update advance deduction"),
  });

  const selectedEmployee = employees.find((e) => e.id === form.employee_ref_id) ?? null;
  const employeeAdvances = selectedEmployee
    ? advances.filter((a) => a.employee_ref_id === selectedEmployee.id)
    : [];

  const linkedAdvanceTotal = links.reduce((s, l) => s + n(l.amount), 0);

  const preview = useMemo(() => {
    return calculatePayroll({
      baseSalary: n(form.base_salary_used),
      payrollWorkingDays: n(form.total_working_days),
      unpaidLeaveDays: n(form.unpaid_leave_days),
      absentDays: n(form.absent_days),
      overtimeHours: n(form.overtime_hours),
      overtimeRate: n(form.overtime_rate),
      bonus: n(form.bonus),
      allowances: n(form.allowances),
      commission: n(form.commission),
      otherEarnings: n(form.other_earnings),
      advanceDeduction: linkedAdvanceTotal,
      otherDeduction: n(form.other_deduction),
      manualAdjustment: n(form.manual_adjustment),
    });
  }, [form, linkedAdvanceTotal]);

  // Phase 3.1: same day-total rule the database now enforces
  // (employee_salaries_day_totals_check) - shown live so an Admin sees the
  // problem before Save is even attempted, not just after a rejection.
  const dayTotalCheck = useMemo(
    () =>
      validatePayrollDayTotals({
        totalWorkingDays: n(form.total_working_days),
        presentDays: form.present_days.trim() === "" ? null : n(form.present_days),
        paidLeaveDays: n(form.paid_leave_days),
        unpaidLeaveDays: n(form.unpaid_leave_days),
        absentDays: n(form.absent_days),
      }),
    [
      form.total_working_days,
      form.present_days,
      form.paid_leave_days,
      form.unpaid_leave_days,
      form.absent_days,
    ],
  );

  function save() {
    if (!form.employee_ref_id) return toast.error("Select an employee");
    if (!/^\d{4}-\d{2}$/.test(form.month)) return toast.error("Month must be in YYYY-MM format");
    if (!dayTotalCheck.valid) return toast.error(dayTotalCheck.reason);
    if (n(form.manual_adjustment) !== 0 && !form.manual_adjustment_reason.trim()) {
      return toast.error("A manual adjustment requires a reason");
    }
    saveMut.mutate({
      payroll_id: payrollId,
      employee_ref_id: form.employee_ref_id,
      month: form.month,
      base_salary_used: form.base_salary_used.trim() === "" ? null : n(form.base_salary_used),
      total_working_days: n(form.total_working_days),
      present_days: form.present_days.trim() === "" ? null : n(form.present_days),
      paid_leave_days: n(form.paid_leave_days),
      unpaid_leave_days: n(form.unpaid_leave_days),
      absent_days: n(form.absent_days),
      overtime_hours: n(form.overtime_hours),
      overtime_rate: n(form.overtime_rate),
      bonus: n(form.bonus),
      allowances: n(form.allowances),
      commission: n(form.commission),
      other_earnings: n(form.other_earnings),
      other_deduction: n(form.other_deduction),
      manual_adjustment: n(form.manual_adjustment),
      manual_adjustment_reason: form.manual_adjustment_reason.trim() || null,
      notes: form.notes.trim() || null,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isCreating
              ? "New Payroll"
              : `${editingPayroll!.employee_name} — ${monthLabel(editingPayroll!.month)}`}
            {isReadOnly && (
              <span className="ml-2 text-xs text-muted-foreground">
                (read-only: {editingPayroll!.status})
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Employee</Label>
            <Select
              value={form.employee_ref_id}
              onValueChange={(v) => {
                const emp = employees.find((e) => e.id === v);
                setForm((f) => ({
                  ...f,
                  employee_ref_id: v,
                  base_salary_used: emp ? String(emp.base_salary) : f.base_salary_used,
                  total_working_days: emp
                    ? String(emp.standard_working_days)
                    : f.total_working_days,
                  overtime_rate: emp ? String(emp.overtime_rate) : f.overtime_rate,
                  allowances: emp ? String(emp.fixed_allowance) : f.allowances,
                }));
              }}
              disabled={!isCreating}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select employee" />
              </SelectTrigger>
              <SelectContent>
                {employees.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.employee_code} — {e.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Field
            label="Payroll Month (YYYY-MM)"
            value={form.month}
            onChange={(v) => setForm((f) => ({ ...f, month: v }))}
            disabled={!isCreating}
          />

          <Field
            label="Base Salary"
            type="number"
            value={form.base_salary_used}
            onChange={(v) => setForm((f) => ({ ...f, base_salary_used: v }))}
            disabled={isReadOnly}
          />
          <Field
            label="Total Working Days"
            type="number"
            value={form.total_working_days}
            onChange={(v) => setForm((f) => ({ ...f, total_working_days: v }))}
            disabled={isReadOnly}
          />
          <Field
            label="Present Days (optional)"
            type="number"
            value={form.present_days}
            onChange={(v) => setForm((f) => ({ ...f, present_days: v }))}
            disabled={isReadOnly}
          />
          <Field
            label="Paid Offs"
            type="number"
            value={form.paid_leave_days}
            onChange={(v) => setForm((f) => ({ ...f, paid_leave_days: v }))}
            disabled={isReadOnly}
          />
          <Field
            label="Unpaid Offs"
            type="number"
            value={form.unpaid_leave_days}
            onChange={(v) => setForm((f) => ({ ...f, unpaid_leave_days: v }))}
            disabled={isReadOnly}
          />
          <Field
            label="Absences"
            type="number"
            value={form.absent_days}
            onChange={(v) => setForm((f) => ({ ...f, absent_days: v }))}
            disabled={isReadOnly}
          />
          <Field
            label="Overtime Hours"
            type="number"
            value={form.overtime_hours}
            onChange={(v) => setForm((f) => ({ ...f, overtime_hours: v }))}
            disabled={isReadOnly}
          />
          <Field
            label="Overtime Rate (per hour)"
            type="number"
            value={form.overtime_rate}
            onChange={(v) => setForm((f) => ({ ...f, overtime_rate: v }))}
            disabled={isReadOnly}
          />
          <div className="space-y-1">
            <Label className="text-xs">Overtime Amount (computed)</Label>
            <Input value={pkr(preview.overtimeAmount)} disabled />
          </div>
          <Field
            label="Bonus"
            type="number"
            value={form.bonus}
            onChange={(v) => setForm((f) => ({ ...f, bonus: v }))}
            disabled={isReadOnly}
          />
          <Field
            label="Allowances"
            type="number"
            value={form.allowances}
            onChange={(v) => setForm((f) => ({ ...f, allowances: v }))}
            disabled={isReadOnly}
          />
          <Field
            label="Commission"
            type="number"
            value={form.commission}
            onChange={(v) => setForm((f) => ({ ...f, commission: v }))}
            disabled={isReadOnly}
          />
          <Field
            label="Other Earnings"
            type="number"
            value={form.other_earnings}
            onChange={(v) => setForm((f) => ({ ...f, other_earnings: v }))}
            disabled={isReadOnly}
          />
          <Field
            label="Other Deduction"
            type="number"
            value={form.other_deduction}
            onChange={(v) => setForm((f) => ({ ...f, other_deduction: v }))}
            disabled={isReadOnly}
          />
          <div className="col-span-2 grid grid-cols-2 gap-3">
            <Field
              label="Manual Adjustment (+/-)"
              type="number"
              value={form.manual_adjustment}
              onChange={(v) => setForm((f) => ({ ...f, manual_adjustment: v }))}
              disabled={isReadOnly}
            />
            <Field
              label="Manual Adjustment Reason"
              value={form.manual_adjustment_reason}
              onChange={(v) => setForm((f) => ({ ...f, manual_adjustment_reason: v }))}
              disabled={isReadOnly}
            />
          </div>
          <div className="col-span-2 space-y-1">
            <Label className="text-xs">Notes</Label>
            <Textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              disabled={isReadOnly}
              rows={2}
            />
          </div>
        </div>

        {/* Salary advance deduction linker */}
        <div className="rounded-md border border-white/10 p-3 space-y-2">
          <div className="text-sm font-semibold text-white/90 flex items-center gap-2">
            <Wallet className="h-4 w-4" /> Advance Deduction
          </div>
          {!payrollId ? (
            <div className="text-xs text-muted-foreground">
              Save this draft first to attach a salary advance deduction.
            </div>
          ) : employeeAdvances.length === 0 ? (
            <div className="text-xs text-muted-foreground">
              This employee has no salary advances on record.
            </div>
          ) : (
            <div className="space-y-2">
              {employeeAdvances.map((a) => {
                const existingLink = links.find((l) => l.advance_id === a.id);
                const availableForThis = a.outstanding + n(existingLink?.amount ?? 0);
                return (
                  <AdvanceLinkRow
                    key={a.id}
                    advance={a}
                    linkedAmount={n(existingLink?.amount ?? 0)}
                    available={availableForThis}
                    disabled={isReadOnly || linkMut.isPending}
                    onApply={(amount) => linkMut.mutate({ advance_id: a.id, amount })}
                  />
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
          <div className="text-amber-300 font-semibold mb-2">Live calculation</div>
          <div className="grid grid-cols-3 gap-3 text-white/90">
            <div>
              <div className="text-xs text-muted-foreground">Gross Salary</div>
              <div className="font-mono">{pkr(preview.grossSalary)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Total Deductions</div>
              <div className="font-mono">{pkr(preview.totalDeductions)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Net Salary</div>
              <div
                className={`font-mono font-semibold ${preview.netSalary < 0 ? "text-destructive" : "text-amber-300"}`}
              >
                {pkr(preview.netSalary)}
              </div>
            </div>
          </div>
          {preview.netSalary < 0 && (
            <div className="mt-2 text-xs text-destructive">
              Net salary is negative - this cannot be finalized until earnings/deductions are
              adjusted.
            </div>
          )}
          {!dayTotalCheck.valid && (
            <div className="mt-2 text-xs text-destructive">{dayTotalCheck.reason}.</div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {!isReadOnly && (
            <Button
              className="bg-amber-500 hover:bg-amber-600 text-black"
              onClick={save}
              disabled={saveMut.isPending || !dayTotalCheck.valid}
            >
              Save Draft
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AdvanceLinkRow({
  advance,
  linkedAmount,
  available,
  disabled,
  onApply,
}: {
  advance: SalaryAdvance;
  linkedAmount: number;
  available: number;
  disabled: boolean;
  onApply: (amount: number) => void;
}) {
  const [amount, setAmount] = useState(String(linkedAmount || ""));
  useEffect(() => setAmount(String(linkedAmount || "")), [linkedAmount]);

  return (
    <div className="flex items-center gap-2 text-xs">
      <div className="flex-1">
        {pkr(advance.amount)} on {new Date(advance.advance_date).toLocaleDateString()}
        <span className="text-muted-foreground"> (available: {pkr(available)})</span>
      </div>
      <Input
        type="number"
        className="w-28 h-8"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        disabled={disabled}
      />
      <Button size="sm" variant="outline" disabled={disabled} onClick={() => onApply(n(amount))}>
        Apply
      </Button>
    </div>
  );
}

// ===========================================================================
// Salary Advances tab
// ===========================================================================

function AdvancesTab({
  employees,
  advances,
  names,
  isAdmin,
  onChanged,
}: {
  employees: Employee[];
  advances: SalaryAdvance[];
  names: Record<string, string>;
  isAdmin: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");

  const createFn = useServerFn(createSalaryAdvance);
  const createMut = useMutation({
    mutationFn: (data: any) => createFn({ data }),
    onSuccess: () => {
      toast.success("Salary advance recorded and debited from Cash in Hand");
      setOpen(false);
      setEmployeeId("");
      setAmount("");
      setNotes("");
      onChanged();
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not record salary advance"),
  });

  function employeeName(id: string) {
    return employees.find((e) => e.id === id)?.full_name ?? id;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          A salary advance is cash physically given to an employee now - it debits Cash in Hand
          immediately. Deducting it later from a payslip never debits Cash in Hand a second time.
        </p>
        {isAdmin && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Give Salary Advance</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs">Employee</Label>
                  <Select value={employeeId} onValueChange={setEmployeeId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select employee" />
                    </SelectTrigger>
                    <SelectContent>
                      {employees.map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                          {e.employee_code} — {e.full_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Field label="Amount" type="number" value={amount} onChange={setAmount} />
                <Field label="Date" type="date" value={date} onChange={setDate} />
                <div className="space-y-1">
                  <Label className="text-xs">Notes (optional)</Label>
                  <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button
                  className="bg-amber-500 hover:bg-amber-600 text-black"
                  disabled={createMut.isPending}
                  onClick={() =>
                    createMut.mutate({
                      employee_ref_id: employeeId,
                      amount: n(amount),
                      advance_date: date,
                      notes: notes.trim() || null,
                    })
                  }
                >
                  Give Advance
                </Button>
              </DialogFooter>
            </DialogContent>
            <Button
              onClick={() => setOpen(true)}
              className="bg-amber-500 hover:bg-amber-600 text-black font-medium"
            >
              <Plus className="h-4 w-4 mr-2" /> Give Advance
            </Button>
          </Dialog>
        )}
      </div>

      <Card className="bg-[#111827] border-white/5 overflow-hidden">
        <CardContent className="p-0 overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="bg-[#0A0F1E] text-amber-300/90 uppercase tracking-wider">
                <th className="p-2 text-left">Employee</th>
                <th className="p-2 text-left">Date</th>
                <th className="p-2 text-right">Amount</th>
                <th className="p-2 text-right">Deducted So Far</th>
                <th className="p-2 text-right">Outstanding</th>
                <th className="p-2 text-left">Notes</th>
                <th className="p-2 text-left">Given By</th>
              </tr>
            </thead>
            <tbody className="text-white/90">
              {advances.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-muted-foreground">
                    No salary advances recorded.
                  </td>
                </tr>
              )}
              {advances.map((a) => (
                <tr key={a.id} className="border-t border-white/5">
                  <td className="p-2 font-medium">{employeeName(a.employee_ref_id)}</td>
                  <td className="p-2">{new Date(a.advance_date).toLocaleDateString()}</td>
                  <td className="p-2 text-right">{pkr(a.amount)}</td>
                  <td className="p-2 text-right">{pkr(a.linked_total)}</td>
                  <td
                    className={`p-2 text-right font-semibold ${a.outstanding > 0 ? "text-amber-300" : "text-success"}`}
                  >
                    {pkr(a.outstanding)}
                  </td>
                  <td className="p-2 text-white/70">{a.notes ?? "—"}</td>
                  <td className="p-2 text-white/70">
                    {a.created_by ? (names[a.created_by] ?? "—") : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

// ===========================================================================
// Employees (payroll settings) tab
// ===========================================================================

function EmployeesTab({
  employees,
  isAdmin,
  onChanged,
}: {
  employees: Employee[];
  isAdmin: boolean;
  onChanged: () => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {isAdmin && (
          <Button
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
            className="bg-amber-500 hover:bg-amber-600 text-black font-medium"
          >
            <Plus className="h-4 w-4 mr-2" /> Add Employee
          </Button>
        )}
      </div>

      <Card className="bg-[#111827] border-white/5 overflow-hidden">
        <CardContent className="p-0 overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="bg-[#0A0F1E] text-amber-300/90 uppercase tracking-wider">
                <th className="p-2 text-left">Code</th>
                <th className="p-2 text-left">Name</th>
                <th className="p-2 text-left">Designation</th>
                <th className="p-2 text-left">Department</th>
                <th className="p-2 text-right">Base Salary</th>
                <th className="p-2 text-center">Working Days</th>
                <th className="p-2 text-right">Overtime Rate</th>
                <th className="p-2 text-right">Fixed Allowance</th>
                <th className="p-2 text-center">Active</th>
                <th className="p-2 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="text-white/90">
              {employees.map((e) => (
                <tr key={e.id} className="border-t border-white/5">
                  <td className="p-2">{e.employee_code}</td>
                  <td className="p-2 font-medium">{e.full_name}</td>
                  <td className="p-2 text-white/70">{e.designation ?? "—"}</td>
                  <td className="p-2 text-white/70">{e.department ?? "—"}</td>
                  <td className="p-2 text-right">{pkr(e.base_salary)}</td>
                  <td className="p-2 text-center">{e.standard_working_days}</td>
                  <td className="p-2 text-right">{pkr(e.overtime_rate)}</td>
                  <td className="p-2 text-right">{pkr(e.fixed_allowance)}</td>
                  <td className="p-2 text-center">
                    {e.is_active ? (
                      <Badge variant="outline" className="border-success/30 text-success">
                        Active
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="border-muted-foreground/30 text-muted-foreground"
                      >
                        Inactive
                      </Badge>
                    )}
                  </td>
                  <td className="p-2 text-center">
                    {isAdmin && (
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => {
                          setEditing(e);
                          setDialogOpen(true);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <EmployeeDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        onSaved={onChanged}
      />
    </div>
  );
}

type EmployeeFormState = {
  employee_code: string;
  full_name: string;
  designation: string;
  department: string;
  base_salary: string;
  standard_working_days: string;
  standard_daily_hours: string;
  overtime_rate: string;
  fixed_allowance: string;
  is_active: boolean;
  notes: string;
};

function emptyEmployeeForm(): EmployeeFormState {
  return {
    employee_code: "",
    full_name: "",
    designation: "",
    department: "",
    base_salary: "0",
    standard_working_days: "26",
    standard_daily_hours: "",
    overtime_rate: "0",
    fixed_allowance: "0",
    is_active: true,
    notes: "",
  };
}

function EmployeeDialog({
  open,
  onOpenChange,
  editing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: Employee | null;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<EmployeeFormState>(emptyEmployeeForm());

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setForm({
        employee_code: editing.employee_code,
        full_name: editing.full_name,
        designation: editing.designation ?? "",
        department: editing.department ?? "",
        base_salary: String(editing.base_salary),
        standard_working_days: String(editing.standard_working_days),
        standard_daily_hours:
          editing.standard_daily_hours == null ? "" : String(editing.standard_daily_hours),
        overtime_rate: String(editing.overtime_rate),
        fixed_allowance: String(editing.fixed_allowance),
        is_active: editing.is_active,
        notes: editing.notes ?? "",
      });
    } else {
      setForm(emptyEmployeeForm());
    }
  }, [open, editing]);

  const saveFn = useServerFn(saveEmployee);
  const saveMut = useMutation({
    mutationFn: (data: any) => saveFn({ data }),
    onSuccess: () => {
      toast.success(editing ? "Employee updated" : "Employee added");
      onOpenChange(false);
      onSaved();
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not save employee"),
  });

  function save() {
    if (!form.employee_code.trim() || !form.full_name.trim()) {
      return toast.error("Employee code and name are required");
    }
    saveMut.mutate({
      employee_id: editing?.id ?? null,
      employee_code: form.employee_code.trim(),
      full_name: form.full_name.trim(),
      designation: form.designation.trim() || null,
      department: form.department.trim() || null,
      base_salary: n(form.base_salary),
      standard_working_days: n(form.standard_working_days) || 26,
      standard_daily_hours:
        form.standard_daily_hours.trim() === "" ? null : n(form.standard_daily_hours),
      overtime_rate: n(form.overtime_rate),
      fixed_allowance: n(form.fixed_allowance),
      is_active: form.is_active,
      notes: form.notes.trim() || null,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Employee" : "Add Employee"}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Employee Code"
            value={form.employee_code}
            onChange={(v) => setForm((f) => ({ ...f, employee_code: v }))}
          />
          <Field
            label="Full Name"
            value={form.full_name}
            onChange={(v) => setForm((f) => ({ ...f, full_name: v }))}
          />
          <Field
            label="Designation"
            value={form.designation}
            onChange={(v) => setForm((f) => ({ ...f, designation: v }))}
          />
          <Field
            label="Department"
            value={form.department}
            onChange={(v) => setForm((f) => ({ ...f, department: v }))}
          />
          <Field
            label="Base Salary"
            type="number"
            value={form.base_salary}
            onChange={(v) => setForm((f) => ({ ...f, base_salary: v }))}
          />
          <Field
            label="Standard Working Days"
            type="number"
            value={form.standard_working_days}
            onChange={(v) => setForm((f) => ({ ...f, standard_working_days: v }))}
          />
          <Field
            label="Standard Daily Hours (optional)"
            type="number"
            value={form.standard_daily_hours}
            onChange={(v) => setForm((f) => ({ ...f, standard_daily_hours: v }))}
          />
          <Field
            label="Overtime Rate (per hour)"
            type="number"
            value={form.overtime_rate}
            onChange={(v) => setForm((f) => ({ ...f, overtime_rate: v }))}
          />
          <Field
            label="Fixed Allowance"
            type="number"
            value={form.fixed_allowance}
            onChange={(v) => setForm((f) => ({ ...f, fixed_allowance: v }))}
          />
          <div className="flex items-center gap-2 pt-5">
            <Switch
              checked={form.is_active}
              onCheckedChange={(v) => setForm((f) => ({ ...f, is_active: v }))}
            />
            <Label className="text-xs">Active</Label>
          </div>
          <div className="col-span-2 space-y-1">
            <Label className="text-xs">Notes</Label>
            <Textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="bg-amber-500 hover:bg-amber-600 text-black"
            onClick={save}
            disabled={saveMut.isPending}
          >
            {editing ? "Save changes" : "Add employee"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
    </div>
  );
}
