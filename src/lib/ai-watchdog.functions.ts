import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { WATCHDOG_MODULES, type WatchdogModule } from "@/lib/ai-watchdog";

type ServerContext = { supabase: any; userId: string };

async function getRoleFlags(ctx: ServerContext) {
  const [admin, moderator, staff] = await Promise.all([
    ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" }),
    ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "moderator" }),
    ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "staff" }),
  ]);
  if (admin.error || moderator.error || staff.error) throw new Error("Role check failed");
  return {
    isAdmin: !!admin.data,
    isModerator: !!moderator.data,
    isStaff: !!staff.data,
  };
}

async function assertCanReadWatchdog(ctx: ServerContext) {
  const flags = await getRoleFlags(ctx);
  if (!flags.isAdmin && !flags.isModerator && !flags.isStaff) {
    throw new Error("Forbidden");
  }
  return flags;
}

async function assertAdmin(ctx: ServerContext) {
  const flags = await getRoleFlags(ctx);
  if (!flags.isAdmin) throw new Error("Forbidden");
}

const statusSchema = z.enum(["new", "reviewed", "dismissed", "resolved"]);
const severitySchema = z.enum(["low", "medium", "high", "critical"]);
const moduleSchema = z.enum(WATCHDOG_MODULES);

const listSchema = z
  .object({
    module: moduleSchema.or(z.literal("all")).optional(),
    severity: severitySchema.or(z.literal("all")).optional(),
    status: statusSchema.or(z.literal("all")).optional(),
    since: z.string().optional(),
  })
  .optional();

export const listAiWatchdogAlerts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => listSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertCanReadWatchdog(context);
    let query = (context.supabase as any)
      .from("ai_watchdog_alerts")
      .select(
        "id, module, anomaly_type, severity, source_type, source_id, actual_value, expected_value, absolute_variance, percentage_variance, detection_method, deterministic_reason, ai_explanation, recommendation, status, detected_at, reviewed_at, reviewed_by, dedupe_key, metadata",
      )
      .order("detected_at", { ascending: false })
      .limit(200);

    if (data?.module && data.module !== "all") query = query.eq("module", data.module);
    if (data?.severity && data.severity !== "all") query = query.eq("severity", data.severity);
    if (data?.status && data.status !== "all") query = query.eq("status", data.status);
    if (data?.since) query = query.gte("detected_at", data.since);

    const { data: rows, error } = await query;
    if (error) {
      if (error.code === "42P01") return { migration_required: true, rows: [], summary: {} };
      throw new Error(`AI watchdog alerts load failed: ${error.message}`);
    }

    const summary = {
      critical: (rows ?? []).filter(
        (row: any) => row.status !== "resolved" && row.severity === "critical",
      ).length,
      high: (rows ?? []).filter((row: any) => row.status !== "resolved" && row.severity === "high")
        .length,
      medium: (rows ?? []).filter(
        (row: any) => row.status !== "resolved" && row.severity === "medium",
      ).length,
      new: (rows ?? []).filter((row: any) => row.status === "new").length,
    };

    return { migration_required: false, rows: rows ?? [], summary };
  });

export const getAiWatchdogDashboardSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertCanReadWatchdog(context);
    const { data, error } = await (context.supabase as any)
      .from("ai_watchdog_alerts")
      .select("id, module, anomaly_type, severity, deterministic_reason, status, detected_at")
      .in("status", ["new", "reviewed"])
      .order("detected_at", { ascending: false })
      .limit(20);
    if (error) {
      if (error.code === "42P01") {
        return { migration_required: true, critical: 0, high: 0, latest: [] };
      }
      throw new Error(`AI watchdog summary failed: ${error.message}`);
    }
    const rows = data ?? [];
    return {
      migration_required: false,
      critical: rows.filter((row: any) => row.severity === "critical").length,
      high: rows.filter((row: any) => row.severity === "high").length,
      latest: rows
        .filter((row: any) => row.severity === "critical" || row.severity === "high")
        .slice(0, 3),
    };
  });

const reviewSchema = z.object({
  alert_id: z.string().uuid(),
  status: z.enum(["reviewed", "dismissed", "resolved"]),
});

export const reviewAiWatchdogAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => reviewSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await (context.supabase as any).rpc("review_ai_watchdog_alert", {
      _alert_id: data.alert_id,
      _status: data.status,
    });
    if (error) throw new Error(`AI watchdog review failed: ${error.message}`);
    return { ok: true };
  });

const scanSchema = z.object({
  module: moduleSchema.or(z.literal("all")).optional(),
});

export const scanAiWatchdogOnce = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => scanSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { scanAiWatchdog } = await import("@/lib/ai-watchdog.server");
    return scanAiWatchdog({ module: (data.module ?? "all") as WatchdogModule | "all" });
  });
