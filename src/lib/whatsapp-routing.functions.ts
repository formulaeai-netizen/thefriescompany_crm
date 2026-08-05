import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { WHATSAPP_ROUTING_FLOW_KEYS } from "./whatsapp-routing";

type ServerContext = { supabase: any; userId: string };

async function assertAdmin(ctx: ServerContext) {
  const { data: isAdmin, error } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (error) throw new Error(`Role check failed: ${error.message}`);
  if (!isAdmin) throw new Error("Forbidden");
}

export const listWhatsAppRoutingNumbers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { data, error } = await (context.supabase as any)
      .from("whatsapp_routing_numbers")
      .select("flow_key, recipient_phone_normalized, updated_at, updated_by")
      .order("flow_key", { ascending: true });
    if (error) throw new Error(`WhatsApp routing numbers load failed: ${error.message}`);
    return { rows: data ?? [] };
  });

const setRoutingNumberSchema = z.object({
  flow_key: z.enum(WHATSAPP_ROUTING_FLOW_KEYS),
  recipient_phone: z.string().trim().min(1, "A recipient number is required"),
});

export const setWhatsAppRoutingNumber = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => setRoutingNumberSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await (context.supabase as any).rpc("set_whatsapp_routing_number", {
      _flow_key: data.flow_key,
      _recipient_phone: data.recipient_phone,
    });
    if (error) throw new Error(`WhatsApp routing number update failed: ${error.message}`);
    return { ok: true };
  });
