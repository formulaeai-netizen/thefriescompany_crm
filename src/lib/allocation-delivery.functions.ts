import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { allocateFinishedStock } from "@/lib/allocation-delivery";

async function assertOperator(context: any) {
  const [{ data: a }, { data: m }] = await Promise.all([
    context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" }),
    context.supabase.rpc("has_role", { _user_id: context.userId, _role: "moderator" }),
  ]);
  if (!a && !m) throw new Error("Forbidden");
}
export const getAllocationDeliveryPlanner = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertOperator(context);
    const { data: orders, error } = await (context.supabase as any)
      .from("sales_orders")
      .select(
        "id,client_id,branch_id,order_number,client_name_snapshot,branch_name_snapshot,ordered_at,requested_delivery_date,promised_delivery_date,priority,status,sales_order_items(id,product_id,product_name_snapshot,quantity,unit),sales_order_fulfillments(status,sales_order_fulfillment_items(sales_order_item_id,planned_quantity))",
      )
      .in("status", ["confirmed", "planning", "allocated", "ready"]);
    if (error) throw new Error(error.message);
    const [{ data: inventory }, { data: policies }, { data: plans }] = await Promise.all([
      (context.supabase as any).from("inventory").select("item_name,unit,current_stock"),
      (context.supabase as any)
        .from("allocation_minimum_delivery_policies")
        .select("product_id,client_id,branch_id,minimum_useful_quantity,unit"),
      (context.supabase as any)
        .from("stock_allocation_plans")
        .select("*,stock_allocation_plan_items(*)")
        .order("generated_at", { ascending: false })
        .limit(20),
    ]);
    const stock = new Map<string, number>(
      (inventory ?? []).map((x: any): [string, number] => [
        `${x.item_name}:${String(x.unit).toLowerCase()}`,
        Number(x.current_stock ?? 0),
      ]),
    );
    const groups = new Map<string, any[]>();
    for (const order of orders ?? [])
      for (const line of order.sales_order_items ?? []) {
        const planned = (order.sales_order_fulfillments ?? [])
          .filter((f: any) => !["cancelled", "failed"].includes(f.status))
          .flatMap((f: any) => f.sales_order_fulfillment_items ?? [])
          .filter((x: any) => x.sales_order_item_id === line.id)
          .reduce((s: number, x: any) => s + Number(x.planned_quantity ?? 0), 0);
        const policy = (policies ?? [])
          .filter(
            (p: any) =>
              String(p.unit).toLowerCase() === String(line.unit).toLowerCase() &&
              (!p.product_id || p.product_id === line.product_id) &&
              (!p.client_id || p.client_id === order.client_id) &&
              (!p.branch_id || p.branch_id === order.branch_id),
          )
          .sort(
            (left: any, right: any) =>
              Number(Boolean(right.branch_id)) - Number(Boolean(left.branch_id)) ||
              Number(Boolean(right.client_id)) - Number(Boolean(left.client_id)) ||
              Number(Boolean(right.product_id)) - Number(Boolean(left.product_id)),
          )[0];
        const row = {
          sales_order_item_id: line.id,
          sales_order_id: order.id,
          order_number: order.order_number,
          product_id: line.product_id,
          product_name: line.product_name_snapshot,
          unit: line.unit,
          client_name: order.client_name_snapshot,
          branch_name: order.branch_name_snapshot || "No branch",
          priority: order.priority,
          ordered_at: order.ordered_at,
          requested_delivery_date: order.requested_delivery_date,
          promised_delivery_date: order.promised_delivery_date,
          remaining_quantity: Math.max(Number(line.quantity) - planned, 0),
          minimum_viable_quantity:
            policy?.minimum_useful_quantity == null ? null : Number(policy.minimum_useful_quantity),
        };
        const key = `${line.product_id}:${line.unit}`;
        groups.set(key, [...(groups.get(key) ?? []), row]);
      }
    const today = new Date().toISOString().slice(0, 10);
    return {
      today,
      proposals: [...groups.values()].map((rows: any[]) =>
        allocateFinishedStock({
          available_quantity:
            stock.get(`${rows[0].product_name}:${String(rows[0].unit).toLowerCase()}`) ?? 0,
          demands: rows,
          today,
        }),
      ),
      plans: plans ?? [],
    };
  });
const item = z.object({
  sales_order_id: z.string().uuid(),
  sales_order_item_id: z.string().uuid(),
  order_number: z.string(),
  product_id: z.string().uuid(),
  product_name: z.string(),
  client_name: z.string(),
  branch_name: z.string(),
  unit: z.string(),
  waiting_days: z.number().int().nonnegative(),
  remaining_quantity: z.number().nonnegative(),
  minimum_viable_quantity: z.number().nullable().optional(),
  suggested_quantity: z.number().nonnegative(),
  score: z.number(),
  reason: z.string(),
  priority: z.string(),
  requested_delivery_date: z.string(),
  promised_delivery_date: z.string().nullable().optional(),
  planned_delivery_date: z.string(),
});
export const createAllocationPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        strategy: z.enum(["fair_share", "oldest_first", "priority_weighted"]),
        items: z.array(item).min(1),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertOperator(context);
    const { data: id, error } = await (context.supabase as any).rpc(
      "create_stock_allocation_plan",
      {
        _plan_date: new Date().toISOString().slice(0, 10),
        _strategy: data.strategy,
        _notes: null,
        _items: data.items,
      },
    );
    if (error) throw new Error(error.message);
    await (context.supabase as any).rpc("scan_stock_allocation_notifications");
    return { id };
  });
const approvalItem = z.object({
  id: z.string().uuid(),
  approved_quantity: z.number().nonnegative(),
  planned_delivery_date: z.string().optional().nullable(),
});
export const approveAllocationPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ plan_id: z.string().uuid(), items: z.array(approvalItem).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertOperator(context);
    const { error } = await (context.supabase as any).rpc("approve_stock_allocation_plan", {
      _plan_id: data.plan_id,
      _items: data.items ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
export const cancelAllocationPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ plan_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertOperator(context);
    const { error } = await (context.supabase as any).rpc("cancel_stock_allocation_plan", {
      _plan_id: data.plan_id,
      _notes: null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
