import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertValidStockAuditCounts } from "@/lib/stock-audits";

type ServerContext = { supabase: any; userId: string };

async function hasRole(ctx: ServerContext, role: string): Promise<boolean> {
  const { data, error } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: role });
  if (error) throw new Error(`Role check failed: ${error.message}`);
  return Boolean(data);
}

async function assertAdmin(ctx: ServerContext) {
  if (!(await hasRole(ctx, "admin"))) throw new Error("Forbidden");
}

async function assertAdminOrModerator(ctx: ServerContext) {
  if (!((await hasRole(ctx, "admin")) || (await hasRole(ctx, "moderator"))))
    throw new Error("Forbidden");
}

async function assertStaffOrAdmin(ctx: ServerContext) {
  if (!((await hasRole(ctx, "staff")) || (await hasRole(ctx, "admin"))))
    throw new Error("Forbidden");
}

const auditDateSchema = z.object({ audit_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

export const ensureDueStockAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => auditDateSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdminOrModerator(context);
    const { data: auditId, error } = await (context.supabase as any).rpc("ensure_due_stock_audit", {
      _audit_date: data.audit_date,
    });
    if (error) throw new Error(`Stock audit creation failed: ${error.message}`);
    return { audit_id: auditId as string };
  });

export const listStockAudits = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await (context.supabase as any)
      .from("stock_audits")
      .select(
        "id, audit_date, audit_type, facility_name, status, created_by, created_at, approved_by, approved_at, locked_at, approval_notes",
      )
      .order("audit_date", { ascending: false })
      .limit(100);
    if (error) throw new Error(`Stock audit list failed: ${error.message}`);
    return { rows: data ?? [] };
  });

const auditIdSchema = z.object({ audit_id: z.string().uuid() });

export const getStockAuditDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => auditIdSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { data: audit, error: auditError } = await (context.supabase as any)
      .from("stock_audits")
      .select("*")
      .eq("id", data.audit_id)
      .maybeSingle();
    if (auditError) throw new Error(`Stock audit load failed: ${auditError.message}`);
    if (!audit) throw new Error("Stock audit not found");

    const { data: items, error: itemsError } = await (context.supabase as any)
      .from("stock_audit_items")
      .select(
        "id, inventory_id, item_name_snapshot, unit_snapshot, system_quantity_snapshot, reconciled_quantity, variance_quantity, reconciliation_reason",
      )
      .eq("audit_id", data.audit_id)
      .order("item_name_snapshot", { ascending: true });
    if (itemsError) throw new Error(`Stock audit items load failed: ${itemsError.message}`);

    const { data: submissions, error: submissionsError } = await (context.supabase as any)
      .from("stock_audit_submissions")
      .select("id, participant_type, submitted_by, submitted_at, notes")
      .eq("audit_id", data.audit_id);
    if (submissionsError)
      throw new Error(`Stock audit submissions load failed: ${submissionsError.message}`);

    const submissionIds = (submissions ?? []).map((s: any) => s.id);
    let submissionItems: any[] = [];
    if (submissionIds.length > 0) {
      const { data: subItems, error: subItemsError } = await (context.supabase as any)
        .from("stock_audit_submission_items")
        .select("submission_id, audit_item_id, physical_quantity")
        .in("submission_id", submissionIds);
      if (subItemsError)
        throw new Error(`Stock audit submission items load failed: ${subItemsError.message}`);
      submissionItems = subItems ?? [];
    }

    const { data: events, error: eventsError } = await (context.supabase as any)
      .from("stock_audit_events")
      .select("id, actor_id, event_type, previous_status, new_status, reason, created_at")
      .eq("audit_id", data.audit_id)
      .order("created_at", { ascending: true });
    if (eventsError) throw new Error(`Stock audit events load failed: ${eventsError.message}`);

    return {
      audit,
      items: items ?? [],
      submissions: submissions ?? [],
      submission_items: submissionItems,
      events: events ?? [],
    };
  });

const itemCountsSchema = z.object({
  audit_id: z.string().uuid(),
  items: z.array(
    z.object({ audit_item_id: z.string().uuid(), physical_quantity: z.number().min(0) }),
  ),
  notes: z.string().trim().nullable().optional(),
});

export const submitStockAuditStaffCount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => itemCountsSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertStaffOrAdmin(context);
    assertValidStockAuditCounts(
      data.items.map((i) => ({
        auditItemId: i.audit_item_id,
        physicalQuantity: i.physical_quantity,
      })),
    );
    const { data: submissionId, error } = await (context.supabase as any).rpc(
      "submit_stock_audit_staff_count",
      {
        _audit_id: data.audit_id,
        _items: data.items,
        _notes: data.notes ?? null,
      },
    );
    if (error) throw new Error(`Staff count submission failed: ${error.message}`);
    return { submission_id: submissionId as string };
  });

export const submitStockAuditManagementCount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => itemCountsSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdminOrModerator(context);
    assertValidStockAuditCounts(
      data.items.map((i) => ({
        auditItemId: i.audit_item_id,
        physicalQuantity: i.physical_quantity,
      })),
    );
    const { data: submissionId, error } = await (context.supabase as any).rpc(
      "submit_stock_audit_management_count",
      {
        _audit_id: data.audit_id,
        _items: data.items,
        _notes: data.notes ?? null,
      },
    );
    if (error) throw new Error(`Management count submission failed: ${error.message}`);
    return { submission_id: submissionId as string };
  });

const reconcileSchema = z.object({
  audit_id: z.string().uuid(),
  reconciled_items: z.array(
    z.object({
      audit_item_id: z.string().uuid(),
      reconciled_quantity: z.number().min(0),
      reconciliation_reason: z.string().trim().nullable().optional(),
    }),
  ),
  approval_notes: z.string().trim().nullable().optional(),
});

export const reconcileAndLockStockAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => reconcileSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await (context.supabase as any).rpc("reconcile_and_lock_stock_audit", {
      _audit_id: data.audit_id,
      _reconciled_items: data.reconciled_items.map((i) => ({
        audit_item_id: i.audit_item_id,
        reconciled_quantity: i.reconciled_quantity,
        reconciliation_reason: i.reconciliation_reason ?? null,
      })),
      _approval_notes: data.approval_notes ?? null,
    });
    if (error) throw new Error(`Reconciliation failed: ${error.message}`);
    return { ok: true };
  });
