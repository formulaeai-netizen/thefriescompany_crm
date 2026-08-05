import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/lib/supabase";
import { pkr } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
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
import { Pencil, Trash2, Plus, Download, CheckCircle2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useIsAdmin } from "@/lib/roles";
import { markSalaryPaid } from "@/lib/salaries.functions";

export const Route = createFileRoute("/_authenticated/salaries")({
  head: () => ({ meta: [{ title: "Salaries — TFC CRM" }] }),
  component: SalariesPage,
});

type SalaryRow = {
  id: string;
  month: string;
  employee_id: string;
  employee_name: string;
  designation: string | null;
  department: string | null;
  total_working_days: number;
  basic_salary: number;
  gross_salary: number;
  income_tax: number;
  absent_days: number;
  advance_taken: number;
  advance_balance: number;
  non_paid_holidays: number;
  advance_repaid: number | null;
  repayment_collected_by: string | null;
  paid: boolean;
  paid_at: string | null;
  paid_by: string | null;
};

type FormState = {
  employee_id: string;
  employee_name: string;
  designation: string;
  department: string;
  total_working_days: string;
  basic_salary: string;
  gross_salary: string;
  income_tax: string;
  absent_days: string;
  advance_taken: string;
  advance_balance: string;
  non_paid_holidays: string;
  advance_repaid: string;
  repayment_collected_by: string;
};

const EMPTY_FORM: FormState = {
  employee_id: "",
  employee_name: "",
  designation: "",
  department: "",
  total_working_days: "26",
  basic_salary: "",
  gross_salary: "",
  income_tax: "0",
  absent_days: "0",
  advance_taken: "0",
  advance_balance: "0",
  non_paid_holidays: "0",
  advance_repaid: "",
  repayment_collected_by: "",
};

function n(v: string | number | null | undefined): number {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
}

function calcDeductions(gross: number, workingDays: number, absent: number) {
  if (!workingDays) return 0;
  return Math.round((gross / workingDays) * absent);
}

function calcDaysWorked(working: number, absent: number, holidays: number) {
  return working - absent - holidays;
}

function calcNet(gross: number, tax: number, deductions: number, advance: number) {
  return gross - tax - deductions - advance;
}

function monthLabel(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("default", { month: "long", year: "numeric" });
}

function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

async function fetchSalaries(): Promise<SalaryRow[]> {
  const { data, error } = await supabase
    .from("employee_salaries")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as SalaryRow[];
}

async function fetchProfileNames(ids: string[]): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .in("id", ids);
  if (error) throw error;
  const map: Record<string, string> = {};
  for (const p of data ?? []) map[p.id] = p.full_name || p.email || p.id;
  return map;
}

function SalariesPage() {
  const qc = useQueryClient();
  const { isAdmin } = useIsAdmin();
  const { data: rows = [] } = useQuery({ queryKey: ["employee_salaries"], queryFn: fetchSalaries });
  const [monthFilter, setMonthFilter] = useState<string>(currentMonthKey());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SalaryRow | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const paidByIds = useMemo(
    () => [...new Set(rows.map((r) => r.paid_by).filter((id): id is string => !!id))],
    [rows],
  );
  const { data: paidByNames = {} } = useQuery({
    queryKey: ["salary-paid-by-names", paidByIds],
    queryFn: () => fetchProfileNames(paidByIds),
    enabled: paidByIds.length > 0,
  });

  const markPaidFn = useServerFn(markSalaryPaid);
  const markPaidMut = useMutation({
    mutationFn: (salaryId: string) => markPaidFn({ data: { salary_id: salaryId } }),
    onSuccess: () => {
      toast.success("Salary marked as paid");
      qc.invalidateQueries({ queryKey: ["employee_salaries"] });
      qc.invalidateQueries({ queryKey: ["cash-in-hand-summary"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not mark salary paid"),
  });

  const monthOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => set.add(r.month));
    set.add(currentMonthKey());
    return Array.from(set).sort().reverse();
  }, [rows]);

  const monthRows = useMemo(() => rows.filter((r) => r.month === monthFilter), [rows, monthFilter]);

  // Live preview of calculated fields
  const preview = useMemo(() => {
    const gross = n(form.gross_salary);
    const working = n(form.total_working_days);
    const absent = n(form.absent_days);
    const holidays = n(form.non_paid_holidays);
    const tax = n(form.income_tax);
    const advance = n(form.advance_taken);
    const deductions = calcDeductions(gross, working, absent);
    const daysWorked = calcDaysWorked(working, absent, holidays);
    const net = calcNet(gross, tax, deductions, advance);
    return { deductions, daysWorked, net };
  }, [form]);

  const totals = useMemo(() => {
    const acc = {
      total_working_days: 0,
      basic_salary: 0,
      gross_salary: 0,
      income_tax: 0,
      absent_days: 0,
      total_deductions: 0,
      advance_taken: 0,
      advance_balance: 0,
      non_paid_holidays: 0,
      days_worked: 0,
      net_salary: 0,
    };
    monthRows.forEach((r) => {
      const ded = calcDeductions(n(r.gross_salary), n(r.total_working_days), n(r.absent_days));
      const dw = calcDaysWorked(n(r.total_working_days), n(r.absent_days), n(r.non_paid_holidays));
      const net = calcNet(n(r.gross_salary), n(r.income_tax), ded, n(r.advance_taken));
      acc.total_working_days += n(r.total_working_days);
      acc.basic_salary += n(r.basic_salary);
      acc.gross_salary += n(r.gross_salary);
      acc.income_tax += n(r.income_tax);
      acc.absent_days += n(r.absent_days);
      acc.total_deductions += ded;
      acc.advance_taken += n(r.advance_taken);
      acc.advance_balance += n(r.advance_balance);
      acc.non_paid_holidays += n(r.non_paid_holidays);
      acc.days_worked += dw;
      acc.net_salary += net;
    });
    return acc;
  }, [monthRows]);

  function openAdd() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEdit(row: SalaryRow) {
    setEditing(row);
    setForm({
      employee_id: row.employee_id,
      employee_name: row.employee_name,
      designation: row.designation ?? "",
      department: row.department ?? "",
      total_working_days: String(row.total_working_days ?? 0),
      basic_salary: String(row.basic_salary ?? 0),
      gross_salary: String(row.gross_salary ?? 0),
      income_tax: String(row.income_tax ?? 0),
      absent_days: String(row.absent_days ?? 0),
      advance_taken: String(row.advance_taken ?? 0),
      advance_balance: String(row.advance_balance ?? 0),
      non_paid_holidays: String(row.non_paid_holidays ?? 0),
      advance_repaid: row.advance_repaid != null ? String(row.advance_repaid) : "",
      repayment_collected_by: row.repayment_collected_by ?? "",
    });
    setDialogOpen(true);
  }

  async function save() {
    if (!form.employee_id.trim() || !form.employee_name.trim()) {
      toast.error("Employee ID and Name are required");
      return;
    }
    const payload = {
      month: monthFilter,
      employee_id: form.employee_id.trim(),
      employee_name: form.employee_name.trim(),
      designation: form.designation.trim() || null,
      department: form.department.trim() || null,
      total_working_days: n(form.total_working_days),
      basic_salary: n(form.basic_salary),
      gross_salary: n(form.gross_salary),
      income_tax: n(form.income_tax),
      absent_days: n(form.absent_days),
      advance_taken: n(form.advance_taken),
      advance_balance: n(form.advance_balance),
      non_paid_holidays: n(form.non_paid_holidays),
      advance_repaid: form.advance_repaid.trim() ? n(form.advance_repaid) : null,
      repayment_collected_by: form.repayment_collected_by.trim() || null,
    };
    if (editing) {
      const { error } = await supabase
        .from("employee_salaries")
        .update(payload)
        .eq("id", editing.id);
      if (error) return toast.error(error.message);
      toast.success("Salary updated");
    } else {
      const { error } = await supabase.from("employee_salaries").insert(payload);
      if (error) return toast.error(error.message);
      toast.success("Salary added");
    }
    setDialogOpen(false);
    qc.invalidateQueries({ queryKey: ["employee_salaries"] });
  }

  async function remove(id: string) {
    const { error } = await supabase.from("employee_salaries").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Row deleted");
    qc.invalidateQueries({ queryKey: ["employee_salaries"] });
  }

  function exportCsv() {
    const headers = [
      "S.No",
      "Employee ID",
      "Employee Name",
      "Designation",
      "Department",
      "Total Working Days",
      "Basic Salary",
      "Gross Salary",
      "Income Tax",
      "Absent Days",
      "Total Deductions",
      "Advance Taken",
      "Advance Balance",
      "Non-Paid Holidays",
      "Days Actually Worked",
      "Net Salary",
      "Advance Repaid",
      "Repayment Collected By",
    ];
    const lines = [headers.join(",")];
    monthRows.forEach((r, i) => {
      const ded = calcDeductions(n(r.gross_salary), n(r.total_working_days), n(r.absent_days));
      const dw = calcDaysWorked(n(r.total_working_days), n(r.absent_days), n(r.non_paid_holidays));
      const net = calcNet(n(r.gross_salary), n(r.income_tax), ded, n(r.advance_taken));
      lines.push(
        [
          i + 1,
          r.employee_id,
          `"${r.employee_name}"`,
          `"${r.designation ?? ""}"`,
          `"${r.department ?? ""}"`,
          r.total_working_days,
          r.basic_salary,
          r.gross_salary,
          r.income_tax,
          r.absent_days,
          ded,
          r.advance_taken,
          r.advance_balance,
          r.non_paid_holidays,
          dw,
          net,
          r.advance_repaid ?? "",
          `"${r.repayment_collected_by ?? ""}"`,
        ].join(","),
      );
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `salaries-${monthFilter}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-white">Salaries</h1>
          <p className="text-sm text-muted-foreground">Monthly payroll sheet</p>
        </div>
        <div className="flex items-center gap-2">
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
          <Button variant="outline" onClick={exportCsv}>
            <Download className="h-4 w-4 mr-2" /> Export
          </Button>
          <Button
            onClick={openAdd}
            className="bg-amber-500 hover:bg-amber-600 text-black font-medium"
          >
            <Plus className="h-4 w-4 mr-2" /> Add Employee
          </Button>
        </div>
      </div>

      <Card className="bg-[#111827] border-white/5 overflow-hidden">
        <CardContent className="p-0 overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="bg-[#0A0F1E] text-amber-300/90 uppercase tracking-wider">
                <th className="p-2 text-left" rowSpan={2}>
                  S.No
                </th>
                <th className="p-2 text-left" rowSpan={2}>
                  Emp ID
                </th>
                <th className="p-2 text-left" rowSpan={2}>
                  Employee Name
                </th>
                <th className="p-2 text-left" rowSpan={2}>
                  Designation
                </th>
                <th className="p-2 text-left" rowSpan={2}>
                  Department
                </th>
                <th className="p-2 text-center" rowSpan={2}>
                  Working Days
                </th>
                <th className="p-2 text-center border-l border-white/10" colSpan={3}>
                  Earnings / Allowances
                </th>
                <th className="p-2 text-center border-l border-white/10" colSpan={4}>
                  Attendance
                </th>
                <th className="p-2 text-center border-l border-white/10" colSpan={2}>
                  Advance
                </th>
                <th className="p-2 text-center border-l border-white/10" rowSpan={2}>
                  Net Salary
                </th>
                <th className="p-2 text-center border-l border-white/10" rowSpan={2}>
                  Payment Status
                </th>
                <th className="p-2 text-center border-l border-white/10" rowSpan={2}>
                  Actions
                </th>
              </tr>
              <tr className="bg-[#0A0F1E]/80 text-amber-200/70">
                <th className="p-2 text-right border-l border-white/10">Basic</th>
                <th className="p-2 text-right">Gross</th>
                <th className="p-2 text-right">Income Tax</th>
                <th className="p-2 text-center border-l border-white/10">Absent</th>
                <th className="p-2 text-right">Deductions</th>
                <th className="p-2 text-center">Holidays</th>
                <th className="p-2 text-center">Worked</th>
                <th className="p-2 text-right border-l border-white/10">Taken</th>
                <th className="p-2 text-right">Balance</th>
              </tr>
            </thead>
            <tbody className="text-white/90">
              {monthRows.length === 0 && (
                <tr>
                  <td colSpan={18} className="p-8 text-center text-muted-foreground">
                    No salary records for {monthLabel(monthFilter)}.
                  </td>
                </tr>
              )}
              {monthRows.map((r, i) => {
                const ded = calcDeductions(
                  n(r.gross_salary),
                  n(r.total_working_days),
                  n(r.absent_days),
                );
                const dw = calcDaysWorked(
                  n(r.total_working_days),
                  n(r.absent_days),
                  n(r.non_paid_holidays),
                );
                const net = calcNet(n(r.gross_salary), n(r.income_tax), ded, n(r.advance_taken));
                return (
                  <tr key={r.id} className="border-t border-white/5 hover:bg-white/[0.02]">
                    <td className="p-2">{i + 1}</td>
                    <td className="p-2">{r.employee_id}</td>
                    <td className="p-2 font-medium">{r.employee_name}</td>
                    <td className="p-2 text-white/70">{r.designation}</td>
                    <td className="p-2 text-white/70">{r.department}</td>
                    <td className="p-2 text-center">{r.total_working_days}</td>
                    <td className="p-2 text-right border-l border-white/10">
                      {pkr(r.basic_salary)}
                    </td>
                    <td className="p-2 text-right">{pkr(r.gross_salary)}</td>
                    <td className="p-2 text-right">{pkr(r.income_tax)}</td>
                    <td className="p-2 text-center border-l border-white/10">{r.absent_days}</td>
                    <td className="p-2 text-right text-red-300/90">{pkr(ded)}</td>
                    <td className="p-2 text-center">{r.non_paid_holidays}</td>
                    <td className="p-2 text-center">{dw}</td>
                    <td className="p-2 text-right border-l border-white/10">
                      {pkr(r.advance_taken)}
                    </td>
                    <td className="p-2 text-right">{pkr(r.advance_balance)}</td>
                    <td className="p-2 text-right border-l border-white/10 font-semibold text-amber-300">
                      {pkr(net)}
                    </td>
                    <td className="p-2 text-center border-l border-white/10">
                      {r.paid ? (
                        <div>
                          <Badge variant="outline" className="border-success/30 text-success">
                            Paid
                          </Badge>
                          <div className="mt-1 text-[10px] text-muted-foreground">
                            {r.paid_at ? new Date(r.paid_at).toLocaleString() : ""}
                            {r.paid_by && paidByNames[r.paid_by]
                              ? ` by ${paidByNames[r.paid_by]}`
                              : ""}
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-1">
                          <Badge variant="outline" className="border-warning/30 text-warning">
                            Unpaid
                          </Badge>
                          {isAdmin && (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={markPaidMut.isPending}
                                >
                                  <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Mark Paid
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Mark salary as paid?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    This marks {r.employee_name}'s {monthLabel(r.month)} salary (
                                    {pkr(net)}) as paid and includes it in Cash in Hand's
                                    paid-salaries total. This cannot be undone from here.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => markPaidMut.mutate(r.id)}>
                                    Mark Paid
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="p-2 text-center border-l border-white/10">
                      <div className="flex items-center justify-center gap-1">
                        <Button size="icon" variant="ghost" onClick={() => openEdit(r)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="icon" variant="ghost">
                              <Trash2 className="h-3.5 w-3.5 text-red-400" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete salary row?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Remove {r.employee_name} from {monthLabel(monthFilter)}.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => remove(r.id)}>
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {monthRows.length > 0 && (
                <tr className="border-t-2 border-amber-500/40 bg-[#0A0F1E]/60 font-semibold text-amber-200">
                  <td className="p-2" colSpan={5}>
                    TOTAL
                  </td>
                  <td className="p-2 text-center">{totals.total_working_days}</td>
                  <td className="p-2 text-right border-l border-white/10">
                    {pkr(totals.basic_salary)}
                  </td>
                  <td className="p-2 text-right">{pkr(totals.gross_salary)}</td>
                  <td className="p-2 text-right">{pkr(totals.income_tax)}</td>
                  <td className="p-2 text-center border-l border-white/10">{totals.absent_days}</td>
                  <td className="p-2 text-right">{pkr(totals.total_deductions)}</td>
                  <td className="p-2 text-center">{totals.non_paid_holidays}</td>
                  <td className="p-2 text-center">{totals.days_worked}</td>
                  <td className="p-2 text-right border-l border-white/10">
                    {pkr(totals.advance_taken)}
                  </td>
                  <td className="p-2 text-right">{pkr(totals.advance_balance)}</td>
                  <td className="p-2 text-right border-l border-white/10 text-amber-300">
                    {pkr(totals.net_salary)}
                  </td>
                  <td className="p-2 border-l border-white/10" />
                  <td className="p-2 border-l border-white/10" />
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit" : "Add"} Salary — {monthLabel(monthFilter)}
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Employee ID"
              value={form.employee_id}
              onChange={(v) => setForm({ ...form, employee_id: v })}
            />
            <Field
              label="Employee Name"
              value={form.employee_name}
              onChange={(v) => setForm({ ...form, employee_name: v })}
            />
            <Field
              label="Designation"
              value={form.designation}
              onChange={(v) => setForm({ ...form, designation: v })}
            />
            <Field
              label="Department"
              value={form.department}
              onChange={(v) => setForm({ ...form, department: v })}
            />
            <Field
              label="Total Working Days"
              type="number"
              value={form.total_working_days}
              onChange={(v) => setForm({ ...form, total_working_days: v })}
            />
            <Field
              label="Basic Salary"
              type="number"
              value={form.basic_salary}
              onChange={(v) => setForm({ ...form, basic_salary: v })}
            />
            <Field
              label="Gross Salary"
              type="number"
              value={form.gross_salary}
              onChange={(v) => setForm({ ...form, gross_salary: v })}
            />
            <Field
              label="Income Tax"
              type="number"
              value={form.income_tax}
              onChange={(v) => setForm({ ...form, income_tax: v })}
            />
            <Field
              label="Absent Days"
              type="number"
              value={form.absent_days}
              onChange={(v) => setForm({ ...form, absent_days: v })}
            />
            <Field
              label="Non-Paid Holidays (Sun+Eid)"
              type="number"
              value={form.non_paid_holidays}
              onChange={(v) => setForm({ ...form, non_paid_holidays: v })}
            />
            <Field
              label="Advance Taken"
              type="number"
              value={form.advance_taken}
              onChange={(v) => setForm({ ...form, advance_taken: v })}
            />
            <Field
              label="Advance Balance"
              type="number"
              value={form.advance_balance}
              onChange={(v) => setForm({ ...form, advance_balance: v })}
            />
            <Field
              label="Advance Repaid This Month (optional)"
              type="number"
              value={form.advance_repaid}
              onChange={(v) => setForm({ ...form, advance_repaid: v })}
            />
            <Field
              label="Repayment Collected By (optional)"
              value={form.repayment_collected_by}
              onChange={(v) => setForm({ ...form, repayment_collected_by: v })}
            />
          </div>

          <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
            <div className="text-amber-300 font-semibold mb-2">Live preview</div>
            <div className="grid grid-cols-3 gap-3 text-white/90">
              <div>
                <div className="text-xs text-muted-foreground">Total Deductions</div>
                <div className="font-mono">{pkr(preview.deductions)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Days Actually Worked</div>
                <div className="font-mono">{preview.daysWorked}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Net Salary</div>
                <div className="font-mono text-amber-300 font-semibold">{pkr(preview.net)}</div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button className="bg-amber-500 hover:bg-amber-600 text-black" onClick={save}>
              {editing ? "Save changes" : "Add employee"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
