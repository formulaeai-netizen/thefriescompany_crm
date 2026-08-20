import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildDailyBrief, health, operationsKpis, salesKpis } from "./employee-kpis";
import { deriveLeadMetrics, isFollowUpDue } from "./sales-leads";
import { buildOperationsRecommendations } from "./operations-recommendations";
import { getOperationsAdvice } from "./operations-advisor.server";

async function checkOps(context: any) {
  const [admin, moderator] = await Promise.all([
    context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" }),
    context.supabase.rpc("has_role", { _user_id: context.userId, _role: "moderator" }),
  ]);
  if (admin.error) throw admin.error;
  if (moderator.error) throw moderator.error;
  if (!admin.data && !moderator.data) throw new Error("Forbidden");
  return Boolean(admin.data);
}

function rangeFor(period: "week" | "month") {
  const now = new Date();
  const start = new Date(now);
  if (period === "week") start.setDate(now.getDate() - 6);
  else start.setDate(1);
  start.setHours(0, 0, 0, 0);
  return start.toISOString();
}

export const getEmployeePerformance = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) =>
    z.object({ period: z.enum(["week", "month"]).default("week") }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await checkOps(context);
    const since = rangeFor(data.period);
    const [assignments, targets, plans, fulfillments, leads] = await Promise.all([
      (context.supabase as any)
        .from("employee_kpi_assignments")
        .select(
          "user_id,profile_id,employee_kpi_profiles(id,name,category),profiles:user_id(id,full_name,email)",
        )
        .eq("active", true),
      (context.supabase as any)
        .from("employee_kpi_targets")
        .select("profile_id,metric_key,target_value,effective_from")
        .lte("effective_from", new Date().toISOString().slice(0, 10))
        .order("effective_from", { ascending: false }),
      (context.supabase as any)
        .from("production_plans")
        .select(
          "responsible_user,production_plan_items(planned_production_quantity,actual_production_quantity)",
        )
        .gte("plan_date", since.slice(0, 10)),
      (context.supabase as any)
        .from("sales_order_fulfillments")
        .select("responsible_user,status,planned_at,delivered_at,receiving_confirmed_at")
        .gte("planned_at", since),
      (context.supabase as any)
        .from("sales_leads")
        .select(
          "id,assigned_to,status,next_follow_up_at,lead_activities(lead_id,activity_type),lead_samples(lead_id,status,follow_up_due_at)",
        )
        .gte("created_at", since),
    ]);
    for (const result of [assignments, targets, plans, fulfillments, leads])
      if (result.error) throw result.error;
    return (assignments.data ?? []).map((assignment: any) => {
      const profile = assignment.employee_kpi_profiles;
      const targetMap = new Map<string, number>();
      for (const target of targets.data ?? [])
        if (target.profile_id === assignment.profile_id && !targetMap.has(target.metric_key))
          targetMap.set(target.metric_key, Number(target.target_value));
      let metrics: Record<string, number | string | null>;
      if (profile.category === "sales") {
        const owned = (leads.data ?? []).filter(
          (lead: any) => lead.assigned_to === assignment.user_id,
        );
        const activities = owned.flatMap((lead: any) => lead.lead_activities ?? []);
        const samples = owned.flatMap((lead: any) => lead.lead_samples ?? []);
        metrics = salesKpis(deriveLeadMetrics(owned, activities, samples));
      } else {
        const ownedPlans = (plans.data ?? []).filter(
          (plan: any) => plan.responsible_user === assignment.user_id,
        );
        const planItems = ownedPlans.flatMap((plan: any) => plan.production_plan_items ?? []);
        const ownedDeliveries = (fulfillments.data ?? []).filter(
          (row: any) => row.responsible_user === assignment.user_id,
        );
        metrics = operationsKpis({
          planned: planItems.reduce(
            (sum: number, item: any) => sum + Number(item.planned_production_quantity ?? 0),
            0,
          ),
          actual: planItems.reduce(
            (sum: number, item: any) => sum + Number(item.actual_production_quantity ?? 0),
            0,
          ),
          deliveries: ownedDeliveries.length,
          onTime: ownedDeliveries.filter((row: any) => row.status === "delivered").length,
          receivingDue: ownedDeliveries.filter((row: any) => row.status === "receiving_pending")
            .length,
          receivingDone: ownedDeliveries.filter((row: any) => row.receiving_confirmed_at).length,
          missingIncidents: 0,
        });
      }
      return {
        user: assignment.profiles,
        profile: { id: profile.id, name: profile.name, category: profile.category },
        metrics: Object.entries(metrics).map(([key, actual]) => ({
          key,
          actual: typeof actual === "number" ? actual : null,
          target: targetMap.get(key) ?? null,
          health: health(typeof actual === "number" ? actual : null, targetMap.get(key) ?? null),
        })),
      };
    });
  });

export const getTodayOperations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await checkOps(context);
    const today = new Date().toISOString().slice(0, 10);
    const [orders, plans, fulfillments, leads, verifications] = await Promise.all([
      (context.supabase as any)
        .from("sales_orders")
        .select("id,requested_delivery_date,status")
        .lte("requested_delivery_date", today)
        .not("status", "in", "(cancelled,fulfilled)"),
      (context.supabase as any)
        .from("production_plans")
        .select("production_plan_items(planned_production_quantity,actual_production_quantity)")
        .eq("plan_date", today),
      (context.supabase as any)
        .from("sales_order_fulfillments")
        .select("id,status,delivered_at")
        .eq("status", "receiving_pending"),
      (context.supabase as any)
        .from("sales_leads")
        .select("id,next_follow_up_at,status")
        .not("status", "in", "(converted,lost,not_interested)"),
      (context.supabase as any)
        .from("payment_verification_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending"),
    ]);
    for (const result of [orders, plans, fulfillments, leads, verifications])
      if (result.error) throw result.error;
    const productionRequired = (plans.data ?? [])
      .flatMap((plan: any) => plan.production_plan_items ?? [])
      .reduce(
        (sum: number, item: any) =>
          sum +
          Math.max(
            Number(item.planned_production_quantity ?? 0) -
              Number(item.actual_production_quantity ?? 0),
            0,
          ),
        0,
      );
    const brief = buildDailyBrief({
      ordersDue: (orders.data ?? []).length,
      overdueOrders: (orders.data ?? []).filter(
        (order: any) => order.requested_delivery_date < today,
      ).length,
      productionRequired,
      receivingMissing: (fulfillments.data ?? []).filter(
        (row: any) =>
          row.delivered_at && new Date(row.delivered_at).getTime() <= Date.now() - 3 * 86400000,
      ).length,
      leadFollowUps: (leads.data ?? []).filter((lead: any) => isFollowUpDue(lead.next_follow_up_at))
        .length,
      pendingPaymentVerifications: verifications.count ?? 0,
    });
    const recommendations = buildOperationsRecommendations(brief);
    const advice = await getOperationsAdvice(recommendations);
    return { brief, recommendations, advice };
  });
