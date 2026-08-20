import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ORDER_PRIORITIES, ORDER_SOURCES, ORDER_STATUSES } from "@/lib/sales-orders";

type ServerContext = { supabase: any; userId: string };

async function assertAdminOrModerator(ctx: ServerContext) {
  const [{ data: isAdmin, error: adminErr }, { data: isModerator, error: moderatorErr }] =
    await Promise.all([
      ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" }),
      ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "moderator" }),
    ]);
  if (adminErr || moderatorErr) throw new Error("Role check failed");
  if (!isAdmin && !isModerator) throw new Error("Forbidden");
  return { isAdmin: Boolean(isAdmin), isModerator: Boolean(isModerator) };
}

const listFiltersSchema = z
  .object({
    search: z.string().trim().max(120).optional(),
    branch_id: z.string().uuid().optional(),
    status: z.enum(ORDER_STATUSES).optional(),
    priority: z.enum(ORDER_PRIORITIES).optional(),
    order_source: z.enum(ORDER_SOURCES).optional(),
    requested_delivery_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    assigned_to: z.string().uuid().optional(),
    order_id: z.string().uuid().optional(),
    limit: z.number().int().positive().max(500).optional(),
  })
  .optional();

const orderItemSchema = z.object({
  product_id: z.string().uuid(),
  quantity: z.number().positive("Quantity must be greater than zero"),
  unit: z.string().trim().min(1, "Unit is required").max(40),
  unit_price: z.number().nonnegative().nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

const createOrderSchema = z.object({
  client_id: z.string().uuid(),
  branch_id: z.string().uuid().nullable().optional(),
  order_source: z.enum(ORDER_SOURCES).optional(),
  requested_delivery_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  promised_delivery_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  priority: z.enum(ORDER_PRIORITIES).optional(),
  customer_notes: z.string().trim().max(2000).nullable().optional(),
  internal_notes: z.string().trim().max(2000).nullable().optional(),
  assigned_to: z.string().uuid().nullable().optional(),
  external_source_key: z.string().trim().max(200).nullable().optional(),
  items: z.array(orderItemSchema).min(1),
  confirm: z.boolean().optional(),
});

const orderIdSchema = z.object({ order_id: z.string().uuid() });
const cancelSchema = orderIdSchema.extend({
  reason: z.string().trim().min(1, "A cancellation reason is required").max(500),
});
const fulfillmentLineSchema = z.object({
  sales_order_item_id: z.string().uuid(),
  quantity: z.number().positive("Quantity must be greater than zero"),
  notes: z.string().trim().max(500).nullable().optional(),
});
const createFulfillmentSchema = z.object({
  order_id: z.string().uuid(),
  responsible_user: z.string().uuid().nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  items: z.array(fulfillmentLineSchema).min(1),
});
const fulfillmentIdSchema = z.object({ fulfillment_id: z.string().uuid() });
const receivingLineSchema = z.object({
  fulfillment_item_id: z.string().uuid(),
  accepted_quantity: z.number().nonnegative(),
  rejected_quantity: z.number().nonnegative(),
});
const confirmReceivingSchema = fulfillmentIdSchema.extend({
  recipient_name: z.string().trim().min(1, "Recipient name is required").max(120),
  received_at: z.string().datetime().nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  proof_storage_path: z.string().trim().max(500).nullable().optional(),
  proof_mime_type: z.string().trim().max(120).nullable().optional(),
  proof_file_name: z.string().trim().max(240).nullable().optional(),
  items: z.array(receivingLineSchema).min(1),
});

export const listSalesOrders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => listFiltersSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdminOrModerator(context);
    const filters = data ?? {};
    let query = (context.supabase as any)
      .from("sales_orders")
      .select(
        "*, clients(id, legal_name, client_code), branches(id, branch_name), sales_order_items(id, product_id, product_name_snapshot, quantity, unit, unit_price, line_total, notes), sales_order_fulfillments(id, sales_order_id, status, responsible_user, planned_at, dispatched_at, delivered_at, receiving_confirmed_at, recipient_name, receiving_notes, proof_storage_path, proof_mime_type, proof_file_name, invoice_id, sales_order_fulfillment_items(id, sales_order_item_id, product_id, product_name_snapshot, ordered_quantity_snapshot, planned_quantity, dispatched_quantity, delivered_quantity, accepted_quantity, rejected_quantity, unit, unit_price_snapshot, invoice_id, notes), delivery_accountability_incidents(id, incident_type, status, detected_at, notes, resolved_at, penalty_recommended, penalty_amount))",
      )
      .order("requested_delivery_date", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(filters.limit ?? 200);

    if (filters.order_id) query = query.eq("id", filters.order_id);
    if (filters.branch_id) query = query.eq("branch_id", filters.branch_id);
    if (filters.status) query = query.eq("status", filters.status);
    if (filters.priority) query = query.eq("priority", filters.priority);
    if (filters.order_source) query = query.eq("order_source", filters.order_source);
    if (filters.requested_delivery_date)
      query = query.eq("requested_delivery_date", filters.requested_delivery_date);
    if (filters.assigned_to) query = query.eq("assigned_to", filters.assigned_to);

    const { data: rows, error } = await query;
    if (error) {
      if (error.code === "42P01") return { migration_required: true, rows: [], assigneeNames: {} };
      throw new Error(`Sales order list failed: ${error.message}`);
    }

    let result = (rows ?? []) as any[];
    if (filters.search) {
      const needle = filters.search.toLowerCase();
      result = result.filter((row) =>
        [
          row.order_number,
          row.client_name_snapshot,
          row.branch_name_snapshot,
          row.customer_notes,
          row.internal_notes,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle)),
      );
    }

    const assigneeIds = [...new Set(result.map((row) => row.assigned_to).filter(Boolean))];
    const assigneeNames: Record<string, string> = {};
    if (assigneeIds.length > 0) {
      const { data: profiles } = await (context.supabase as any)
        .from("profiles")
        .select("id, full_name, email")
        .in("id", assigneeIds);
      for (const profile of profiles ?? []) {
        assigneeNames[profile.id] = profile.full_name || profile.email || profile.id;
      }
    }

    return { migration_required: false, rows: result, assigneeNames };
  });

export const getSalesOrderBootstrap = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const roles = await assertAdminOrModerator(context);
    const [{ data: clients, error: clientsError }, { data: products, error: productsError }] =
      await Promise.all([
        (context.supabase as any)
          .from("clients")
          .select("id, legal_name, client_code, city, client_type, branches(id, branch_name, city)")
          .eq("client_type", "Paying Client")
          .order("legal_name"),
        (context.supabase as any)
          .from("products")
          .select("id, name")
          .eq("is_active", true)
          .order("name"),
      ]);
    if (clientsError) throw new Error(`Client list failed: ${clientsError.message}`);
    if (productsError) throw new Error(`Product list failed: ${productsError.message}`);

    let assignees: Array<{ id: string; label: string }> = [];
    if (roles.isAdmin) {
      const { data: profiles } = await (context.supabase as any)
        .from("profiles")
        .select("id, full_name, email")
        .eq("is_active", true)
        .order("full_name");
      assignees = (profiles ?? []).map((profile: any) => ({
        id: profile.id,
        label: profile.full_name || profile.email || profile.id,
      }));
    }

    return {
      clients: clients ?? [],
      products: products ?? [],
      assignees,
      canAssign: roles.isAdmin,
    };
  });

export const createSalesOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => createOrderSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdminOrModerator(context);
    const { data: id, error } = await (context.supabase as any).rpc("create_sales_order", {
      _client_id: data.client_id,
      _branch_id: data.branch_id ?? null,
      _order_source: data.order_source ?? "admin",
      _requested_delivery_date: data.requested_delivery_date,
      _promised_delivery_date: data.promised_delivery_date ?? null,
      _priority: data.priority ?? "normal",
      _customer_notes: data.customer_notes ?? null,
      _internal_notes: data.internal_notes ?? null,
      _assigned_to: data.assigned_to ?? null,
      _external_source_key: data.external_source_key ?? null,
      _items: data.items,
      _confirm: data.confirm ?? false,
    });
    if (error) throw new Error(`Sales order creation failed: ${error.message}`);
    return { ok: true, id };
  });

export const confirmSalesOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => orderIdSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdminOrModerator(context);
    const { error } = await (context.supabase as any).rpc("confirm_sales_order", {
      _order_id: data.order_id,
    });
    if (error) throw new Error(`Sales order confirmation failed: ${error.message}`);
    return { ok: true };
  });

export const moveSalesOrderToPlanning = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => orderIdSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdminOrModerator(context);
    const { error } = await (context.supabase as any).rpc("move_sales_order_to_planning", {
      _order_id: data.order_id,
    });
    if (error) throw new Error(`Sales order planning transition failed: ${error.message}`);
    return { ok: true };
  });

export const cancelSalesOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => cancelSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdminOrModerator(context);
    const { error } = await (context.supabase as any).rpc("cancel_sales_order", {
      _order_id: data.order_id,
      _reason: data.reason,
    });
    if (error) throw new Error(`Sales order cancellation failed: ${error.message}`);
    return { ok: true };
  });

export const getSalesOrderDemand = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdminOrModerator(context);
    const [{ data: summary, error: summaryError }, { data: productDemand, error: demandError }] =
      await Promise.all([
        (context.supabase as any).rpc("sales_order_demand_summary", {}),
        (context.supabase as any).rpc("product_demand", {}),
      ]);
    if (summaryError) {
      if (summaryError.code === "42883" || summaryError.code === "42P01") {
        return { migration_required: true, summary: null, productDemand: [] };
      }
      throw new Error(`Sales order demand summary failed: ${summaryError.message}`);
    }
    if (demandError) throw new Error(`Product demand failed: ${demandError.message}`);
    return { migration_required: false, summary, productDemand: productDemand ?? [] };
  });

export const createSalesOrderFulfillment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => createFulfillmentSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdminOrModerator(context);
    const { data: id, error } = await (context.supabase as any).rpc(
      "create_sales_order_fulfillment",
      {
        _order_id: data.order_id,
        _responsible_user: data.responsible_user ?? null,
        _items: data.items,
        _notes: data.notes ?? null,
      },
    );
    if (error) throw new Error(`Fulfillment creation failed: ${error.message}`);
    return { ok: true, id };
  });

export const markSalesOrderFulfillmentDispatched = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => fulfillmentIdSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdminOrModerator(context);
    const { error } = await (context.supabase as any).rpc(
      "mark_sales_order_fulfillment_dispatched",
      {
        _fulfillment_id: data.fulfillment_id,
      },
    );
    if (error) throw new Error(`Dispatch update failed: ${error.message}`);
    return { ok: true };
  });

export const markSalesOrderFulfillmentDelivered = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => fulfillmentIdSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdminOrModerator(context);
    const { error } = await (context.supabase as any).rpc(
      "mark_sales_order_fulfillment_delivered",
      {
        _fulfillment_id: data.fulfillment_id,
      },
    );
    if (error) throw new Error(`Delivery update failed: ${error.message}`);
    return { ok: true };
  });

export const confirmSalesOrderReceiving = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => confirmReceivingSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdminOrModerator(context);
    const { data: invoiceId, error } = await (context.supabase as any).rpc(
      "confirm_sales_order_receiving",
      {
        _fulfillment_id: data.fulfillment_id,
        _recipient_name: data.recipient_name,
        _received_at: data.received_at ?? new Date().toISOString(),
        _notes: data.notes ?? null,
        _proof_storage_path: data.proof_storage_path ?? null,
        _proof_mime_type: data.proof_mime_type ?? null,
        _proof_file_name: data.proof_file_name ?? null,
        _items: data.items,
      },
    );
    if (error) throw new Error(`Receiving confirmation failed: ${error.message}`);
    return { ok: true, invoiceId };
  });

export const scanMissingReceivingIncidents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdminOrModerator(context);
    const { data: count, error } = await (context.supabase as any).rpc(
      "create_missing_receiving_incidents",
      {},
    );
    if (error) throw new Error(`Missing receiving scan failed: ${error.message}`);
    return { ok: true, count: Number(count ?? 0) };
  });
