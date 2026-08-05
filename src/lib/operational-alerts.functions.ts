import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type ServerContext = { supabase: any; userId: string };

async function assertAdminOrModerator(ctx: ServerContext) {
  const [{ data: isAdmin, error: adminErr }, { data: isModerator, error: modErr }] =
    await Promise.all([
      ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" }),
      ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "moderator" }),
    ]);
  if (adminErr || modErr) throw new Error("Role check failed");
  if (!isAdmin && !isModerator) throw new Error("Forbidden");
}

export const listOperationalAlerts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdminOrModerator(context);
    const { data, error } = await (context.supabase as any)
      .from("operational_alerts")
      .select(
        "id, alert_type, source_type, source_id, severity, message, expected_value, actual_value, variance_value, unit, status, created_at, resolved_by, resolved_at, resolution_notes, whatsapp_notified_at",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(`Operational alert list failed: ${error.message}`);
    return { rows: data ?? [] };
  });

const resolveSchema = z.object({
  alert_id: z.string().uuid(),
  resolution_notes: z.string().trim().min(1),
});

export const resolveOperationalAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => resolveSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdminOrModerator(context);
    const { error } = await (context.supabase as any).rpc("resolve_operational_alert", {
      _alert_id: data.alert_id,
      _resolution_notes: data.resolution_notes,
    });
    if (error) throw new Error(`Alert resolution failed: ${error.message}`);
    return { ok: true };
  });
