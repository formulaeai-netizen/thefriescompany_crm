import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type ServerContext = { supabase: any; userId: string };

async function assertAdmin(ctx: ServerContext) {
  const { data: isAdmin, error } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (error) throw new Error(`Role check failed: ${error.message}`);
  if (!isAdmin) throw new Error("Forbidden");
}

async function namesByIds(supabase: any, ids: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return {};
  const { data } = await supabase.from("profiles").select("id, full_name, email").in("id", unique);
  const map: Record<string, string> = {};
  for (const p of data ?? []) map[p.id] = p.full_name || p.email || p.id;
  return map;
}

// =========================================================================
// Reads. RLS already restricts every table below to Admin-only SELECT, so
// these server functions exist to consolidate the cross-table name lookups
// (profiles, employees) server-side rather than to add authorization -
// assertAdmin is still called explicitly per this project's "enforce
// permissions server-side, not only UI" standard.
// =========================================================================

export const listEmployees = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { data, error } = await (context.supabase as any)
      .from("employees")
      .select(
        "id, employee_code, full_name, designation, department, base_salary, standard_working_days, standard_daily_hours, overtime_rate, fixed_allowance, is_active, notes",
      )
      .order("employee_code", { ascending: true });
    if (error) throw new Error(`Employee list failed: ${error.message}`);
    return { rows: data ?? [] };
  });

const saveEmployeeSchema = z.object({
  employee_id: z.string().uuid().nullable().optional(),
  employee_code: z.string().trim().min(1, "Employee code is required"),
  full_name: z.string().trim().min(1, "Full name is required"),
  designation: z.string().trim().max(200).nullable().optional(),
  department: z.string().trim().max(200).nullable().optional(),
  base_salary: z.number().min(0, "Base salary cannot be negative"),
  standard_working_days: z.number().int().positive("Standard working days must be positive"),
  standard_daily_hours: z.number().positive().nullable().optional(),
  overtime_rate: z.number().min(0, "Overtime rate cannot be negative"),
  fixed_allowance: z.number().min(0, "Fixed allowance cannot be negative"),
  is_active: z.boolean().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

export const saveEmployee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => saveEmployeeSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const payload = {
      employee_code: data.employee_code.trim(),
      full_name: data.full_name.trim(),
      designation: data.designation?.trim() || null,
      department: data.department?.trim() || null,
      base_salary: data.base_salary,
      standard_working_days: data.standard_working_days,
      standard_daily_hours: data.standard_daily_hours ?? null,
      overtime_rate: data.overtime_rate,
      fixed_allowance: data.fixed_allowance,
      is_active: data.is_active ?? true,
      notes: data.notes?.trim() || null,
    };
    if (data.employee_id) {
      const { error } = await (context.supabase as any)
        .from("employees")
        .update(payload)
        .eq("id", data.employee_id);
      if (error) throw new Error(`Employee update failed: ${error.message}`);
      return { ok: true, id: data.employee_id };
    }
    const { data: inserted, error } = await (context.supabase as any)
      .from("employees")
      .insert({ ...payload, created_by: context.userId })
      .select("id")
      .single();
    if (error) throw new Error(`Employee creation failed: ${error.message}`);
    return { ok: true, id: inserted.id };
  });

export const listPayroll = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { data, error } = await (context.supabase as any)
      .from("employee_salaries")
      .select(
        `id, month, period_year, period_month, employee_id, employee_name, designation, department,
         employee_ref_id, status, total_working_days, present_days, paid_leave_days, unpaid_leave_days,
         absent_days, overtime_hours, overtime_rate, overtime_amount, base_salary_used, base_earned,
         bonus, allowances, commission, other_earnings, unpaid_leave_deduction, advance_deduction,
         other_deduction, total_deductions, manual_adjustment, manual_adjustment_reason, gross_salary,
         net_salary, notes, paid, paid_at, paid_by, finalized_at, finalized_by, cancelled_at, cancelled_by,
         cancel_reason, created_by, created_at, updated_at`,
      )
      .order("created_at", { ascending: true });
    if (error) throw new Error(`Payroll list failed: ${error.message}`);

    const rows = data ?? [];
    const ids = rows.flatMap((r: any) => [r.paid_by, r.finalized_by, r.cancelled_by, r.created_by]);
    const names = await namesByIds(context.supabase, ids);

    return { rows, names };
  });

export const listSalaryAdvances = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const [{ data: advances, error: advErr }, { data: links, error: linkErr }] = await Promise.all([
      (context.supabase as any)
        .from("salary_advances")
        .select("id, employee_ref_id, amount, advance_date, notes, created_by, created_at")
        .order("advance_date", { ascending: false }),
      (context.supabase as any)
        .from("payroll_advance_links")
        .select("payroll_id, advance_id, amount, employee_salaries!inner(status)"),
    ]);
    if (advErr) throw new Error(`Salary advance list failed: ${advErr.message}`);
    if (linkErr) throw new Error(`Advance link list failed: ${linkErr.message}`);

    // Outstanding balance is derived, exactly mirroring
    // link_salary_advance_to_payroll()'s own SQL: amount minus everything
    // currently linked to a non-cancelled payroll row.
    const linkedByAdvance = new Map<string, number>();
    for (const l of links ?? []) {
      if (l.employee_salaries?.status === "cancelled") continue;
      linkedByAdvance.set(
        l.advance_id,
        (linkedByAdvance.get(l.advance_id) ?? 0) + Number(l.amount),
      );
    }

    const rows = (advances ?? []).map((a: any) => ({
      ...a,
      linked_total: linkedByAdvance.get(a.id) ?? 0,
      outstanding: Number(a.amount) - (linkedByAdvance.get(a.id) ?? 0),
    }));

    const names = await namesByIds(
      context.supabase,
      rows.map((r: any) => r.created_by),
    );

    return { rows, names };
  });

// =========================================================================
// Mutations. Every financial action is enforced Admin-only both here and
// (redundantly, on purpose - "do not trust the UI alone") inside the RPC
// itself via has_role().
// =========================================================================

// Phase 3.1: mirrors employee_salaries_day_totals_check and
// save_payroll_draft()/finalize_payroll()'s own re-checks exactly - a
// caller gets a friendly rejection at this outermost layer too, before
// the request ever reaches the database. unpaid_leave_days
// (approved/recorded unpaid leave) and absent_days (unexcused/non-leave
// absence) are mutually exclusive categories; this day-total cap is the
// strongest deterministic check possible on aggregate monthly counts.
export const saveDraftSchema = z
  .object({
    payroll_id: z.string().uuid().nullable().optional(),
    employee_ref_id: z.string().uuid(),
    month: z.string().regex(/^\d{4}-\d{2}$/, "Month must be in YYYY-MM format"),
    base_salary_used: z.number().min(0).nullable().optional(),
    total_working_days: z.number().int().positive(),
    present_days: z.number().int().min(0).nullable().optional(),
    paid_leave_days: z.number().int().min(0),
    unpaid_leave_days: z.number().int().min(0),
    absent_days: z.number().int().min(0),
    overtime_hours: z.number().min(0),
    overtime_rate: z.number().min(0),
    bonus: z.number().min(0),
    allowances: z.number().min(0),
    commission: z.number().min(0),
    other_earnings: z.number().min(0),
    other_deduction: z.number().min(0),
    manual_adjustment: z.number(),
    manual_adjustment_reason: z.string().trim().max(500).nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .refine(
    (data) =>
      data.paid_leave_days + data.unpaid_leave_days + data.absent_days <= data.total_working_days,
    {
      message: "Paid leave + unpaid leave + absent days exceeds total working days",
      path: ["absent_days"],
    },
  )
  .refine(
    (data) =>
      data.present_days == null ||
      data.present_days + data.paid_leave_days + data.unpaid_leave_days + data.absent_days <=
        data.total_working_days,
    {
      message: "Present + paid leave + unpaid leave + absent days exceeds total working days",
      path: ["present_days"],
    },
  )
  .refine((data) => data.manual_adjustment === 0 || !!data.manual_adjustment_reason?.trim(), {
    message: "A manual adjustment requires a reason",
    path: ["manual_adjustment_reason"],
  });

export const savePayrollDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => saveDraftSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { data: id, error } = await (context.supabase as any).rpc("save_payroll_draft", {
      _payroll_id: data.payroll_id ?? null,
      _employee_ref_id: data.employee_ref_id,
      _month: data.month,
      _base_salary_used: data.base_salary_used ?? null,
      _total_working_days: data.total_working_days,
      _present_days: data.present_days ?? null,
      _paid_leave_days: data.paid_leave_days,
      _unpaid_leave_days: data.unpaid_leave_days,
      _absent_days: data.absent_days,
      _overtime_hours: data.overtime_hours,
      _overtime_rate: data.overtime_rate,
      _bonus: data.bonus,
      _allowances: data.allowances,
      _commission: data.commission,
      _other_earnings: data.other_earnings,
      _other_deduction: data.other_deduction,
      _manual_adjustment: data.manual_adjustment,
      _manual_adjustment_reason: data.manual_adjustment_reason?.trim() || null,
      _notes: data.notes?.trim() || null,
    });
    if (error) throw new Error(`Saving payroll draft failed: ${error.message}`);
    return { ok: true, id: id as string };
  });

const payrollIdSchema = z.object({ payroll_id: z.string().uuid() });

export const finalizePayroll = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => payrollIdSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await (context.supabase as any).rpc("finalize_payroll", {
      _payroll_id: data.payroll_id,
    });
    if (error) throw new Error(`Finalizing payroll failed: ${error.message}`);
    return { ok: true };
  });

export const revertPayrollToDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => payrollIdSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await (context.supabase as any).rpc("revert_payroll_to_draft", {
      _payroll_id: data.payroll_id,
    });
    if (error) throw new Error(`Reverting payroll to draft failed: ${error.message}`);
    return { ok: true };
  });

const cancelPayrollSchema = z.object({
  payroll_id: z.string().uuid(),
  reason: z.string().trim().min(1, "A cancellation reason is required"),
});

export const cancelPayroll = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => cancelPayrollSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await (context.supabase as any).rpc("cancel_payroll", {
      _payroll_id: data.payroll_id,
      _reason: data.reason,
    });
    if (error) throw new Error(`Cancelling payroll failed: ${error.message}`);
    return { ok: true };
  });

/**
 * Marking payroll paid is the only action that makes it subtract from Cash
 * in Hand (via get_cash_in_hand_summary()'s paid_salaries_total). No
 * expense row is created and nothing is subtracted directly in the UI -
 * the dashboard picks up the change purely by re-fetching the shared
 * summary after this mutation succeeds. Supersedes the old markSalaryPaid.
 */
export const markPayrollPaid = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => payrollIdSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await (context.supabase as any).rpc("mark_payroll_paid", {
      _payroll_id: data.payroll_id,
    });
    if (error) throw new Error(`Marking payroll paid failed: ${error.message}`);
    return { ok: true };
  });

const createAdvanceSchema = z.object({
  employee_ref_id: z.string().uuid(),
  amount: z.number().positive("Advance amount must be positive"),
  advance_date: z.string().min(1).optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

export const createSalaryAdvance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => createAdvanceSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { data: id, error } = await (context.supabase as any).rpc("create_salary_advance", {
      _employee_ref_id: data.employee_ref_id,
      _amount: data.amount,
      _advance_date: data.advance_date ?? new Date().toISOString().slice(0, 10),
      _notes: data.notes?.trim() || null,
    });
    if (error) throw new Error(`Salary advance creation failed: ${error.message}`);
    return { ok: true, id: id as string };
  });

const linkAdvanceSchema = z.object({
  payroll_id: z.string().uuid(),
  advance_id: z.string().uuid(),
  amount: z.number().min(0),
});

export const linkSalaryAdvanceToPayroll = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => linkAdvanceSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await (context.supabase as any).rpc("link_salary_advance_to_payroll", {
      _payroll_id: data.payroll_id,
      _advance_id: data.advance_id,
      _amount: data.amount,
    });
    if (error) throw new Error(`Linking salary advance to payroll failed: ${error.message}`);
    return { ok: true };
  });
