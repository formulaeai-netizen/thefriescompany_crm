import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const statuses = [
  "new",
  "contacted",
  "meeting",
  "due_diligence",
  "negotiation",
  "invested",
  "declined",
] as const;
const leadSchema = z.object({
  name: z.string().trim().min(2).max(150),
  contact: z.string().trim().min(3).max(150),
  city: z.string().trim().min(2).max(100),
  interest_amount: z.coerce.number().positive().max(1_000_000_000),
  message: z.string().trim().max(2000).optional(),
});

async function adminOnly(context: any) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw error;
  if (!data) throw new Error("Forbidden");
}

export const listInvestorLeads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await adminOnly(context);
    const { data, error } = await (context.supabase as any)
      .from("investor_leads")
      .select("*,investor_lead_activities(*)")
      .order("next_follow_up_at", { ascending: true, nullsFirst: false });
    if (error) throw error;
    return data ?? [];
  });

export const updateInvestorLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((value: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(statuses).optional(),
        owner_user_id: z.string().uuid().nullable().optional(),
        notes: z.string().trim().max(2000).nullable().optional(),
        next_follow_up_at: z.string().datetime().nullable().optional(),
      })
      .parse(value),
  )
  .handler(async ({ data, context }) => {
    await adminOnly(context);
    const { id, ...update } = data;
    const { error } = await (context.supabase as any)
      .from("investor_leads")
      .update(update)
      .eq("id", id);
    if (error) throw error;
  });

export const addInvestorLeadActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((value: unknown) =>
    z
      .object({
        investor_lead_id: z.string().uuid(),
        activity_type: z.enum(["note", "call", "meeting", "follow_up", "document_shared"]),
        notes: z.string().trim().max(2000).optional(),
        next_follow_up_at: z.string().datetime().nullable().optional(),
      })
      .parse(value),
  )
  .handler(async ({ data, context }) => {
    await adminOnly(context);
    const { error } = await (context.supabase as any)
      .from("investor_lead_activities")
      .insert({ ...data, performed_by: context.userId });
    if (error) throw error;
  });
