import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type ServerContext = { supabase: any; userId: string };

async function assertAdminOrStaff(ctx: ServerContext) {
  const [{ data: isAdmin, error: adminErr }, { data: isStaff, error: staffErr }] =
    await Promise.all([
      ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" }),
      ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "staff" }),
    ]);
  if (adminErr || staffErr) throw new Error("Role check failed");
  if (!isAdmin && !isStaff) throw new Error("Forbidden");
}

async function assertAdmin(ctx: ServerContext) {
  const { data: isAdmin, error } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (error) throw new Error(`Role check failed: ${error.message}`);
  if (!isAdmin) throw new Error("Forbidden");
}

export const listCreditPurchases = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdminOrStaff(context);
    const { data, error } = await (context.supabase as any)
      .from("credit_inventory_purchases")
      .select(
        "id, supplier_name, inventory_item_id, item_name_snapshot, quantity, unit, amount_due, purchased_at, due_at, status, payment_mode, notes, created_by, created_at, updated_at, paid_at, cancelled_at, cancellation_reason, reminder_lead_hours, reminder_queued_at, reminder_sent_at",
      )
      .order("due_at", { ascending: true });
    if (error) throw new Error(`Credit purchase list failed: ${error.message}`);

    const createdByIds = [...new Set((data ?? []).map((r: any) => r.created_by).filter(Boolean))];
    const namesById: Record<string, string> = {};
    if (createdByIds.length > 0) {
      const { data: profiles } = await (context.supabase as any)
        .from("profiles")
        .select("id, full_name, email")
        .in("id", createdByIds);
      for (const p of profiles ?? []) {
        namesById[p.id] = p.full_name || p.email || p.id;
      }
    }

    return { rows: data ?? [], createdByNames: namesById };
  });

const createSchema = z.object({
  supplier_name: z.string().trim().min(1, "Supplier name is required"),
  item_name_snapshot: z.string().trim().min(1, "Item name is required"),
  amount_due: z.number().positive("Amount due must be positive"),
  due_at: z.string().datetime({ message: "A valid due date/time is required" }),
  inventory_item_id: z.string().uuid().nullable().optional(),
  quantity: z.number().positive().nullable().optional(),
  unit: z.string().trim().max(20).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  reminder_lead_hours: z.number().int().positive().max(720).optional(),
  payment_mode: z.enum(["cash", "credit"]).optional(),
});

export const createCreditPurchase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => createSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdminOrStaff(context);
    const { data: newId, error } = await (context.supabase as any).rpc(
      "create_credit_inventory_purchase",
      {
        _supplier_name: data.supplier_name,
        _item_name_snapshot: data.item_name_snapshot,
        _amount_due: data.amount_due,
        _due_at: data.due_at,
        _inventory_item_id: data.inventory_item_id ?? null,
        _quantity: data.quantity ?? null,
        _unit: data.unit ?? null,
        _notes: data.notes ?? null,
        _reminder_lead_hours: data.reminder_lead_hours ?? 24,
        _payment_mode: data.payment_mode ?? "credit",
      },
    );
    if (error) throw new Error(`Credit purchase creation failed: ${error.message}`);
    return { ok: true, id: newId };
  });

// payment_mode is immutable after creation - editing a purchase never
// changes cash vs credit, only its record details while still unpaid.
const updateSchema = createSchema.omit({ payment_mode: true }).extend({
  purchase_id: z.string().uuid(),
});

export const updateCreditPurchase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => updateSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdminOrStaff(context);
    const { error } = await (context.supabase as any).rpc("update_credit_inventory_purchase", {
      _purchase_id: data.purchase_id,
      _supplier_name: data.supplier_name,
      _item_name_snapshot: data.item_name_snapshot,
      _amount_due: data.amount_due,
      _due_at: data.due_at,
      _inventory_item_id: data.inventory_item_id ?? null,
      _quantity: data.quantity ?? null,
      _unit: data.unit ?? null,
      _notes: data.notes ?? null,
      _reminder_lead_hours: data.reminder_lead_hours ?? 24,
    });
    if (error) throw new Error(`Credit purchase update failed: ${error.message}`);
    return { ok: true };
  });

const purchaseIdSchema = z.object({ purchase_id: z.string().uuid() });

export const markCreditPurchasePaid = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => purchaseIdSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await (context.supabase as any).rpc("mark_credit_inventory_purchase_paid", {
      _purchase_id: data.purchase_id,
    });
    if (error) throw new Error(`Marking credit purchase paid failed: ${error.message}`);
    return { ok: true };
  });

const cancelSchema = z.object({
  purchase_id: z.string().uuid(),
  reason: z.string().trim().min(1, "A cancellation reason is required"),
});

export const cancelCreditPurchase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => cancelSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await (context.supabase as any).rpc("cancel_credit_inventory_purchase", {
      _purchase_id: data.purchase_id,
      _reason: data.reason,
    });
    if (error) throw new Error(`Credit purchase cancellation failed: ${error.message}`);
    return { ok: true };
  });
