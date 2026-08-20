import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { leadStatuses, suggestedStatusForActivity } from "./sales-leads";

const optionalText = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform((value) => value || undefined);
const timestamp = z.string().datetime().nullable().optional();
const leadInput = z.object({
  company_name: z.string().trim().min(1).max(200),
  contact_person: optionalText,
  phone: optionalText,
  email: z.string().trim().email().optional().or(z.literal("")),
  location: optionalText,
  source: optionalText,
  next_follow_up_at: timestamp,
  notes: optionalText,
  assigned_to: z.string().uuid().optional(),
});
const activityInput = z.object({
  lead_id: z.string().uuid(),
  activity_type: z.enum([
    "call",
    "whatsapp",
    "visit",
    "email",
    "note",
    "follow_up",
    "sample_planned",
    "sample_sent",
    "response_received",
  ]),
  outcome: optionalText,
  notes: optionalText,
  next_follow_up_at: timestamp,
});
const sampleInput = z.object({
  lead_id: z.string().uuid(),
  product_id: z.string().uuid().nullable().optional(),
  product_name_snapshot: optionalText,
  quantity: z.coerce.number().positive().nullable().optional(),
  status: z.enum(["planned", "sent", "delivered", "follow_up_due", "no_conversion"]),
  follow_up_due_at: timestamp,
  result: optionalText,
});

async function hasRole(context: any, role: "admin" | "moderator") {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: role,
  });
  if (error) throw error;
  return Boolean(data);
}
async function checkLeadOperator(context: any) {
  if ((await hasRole(context, "admin")) || (await hasRole(context, "moderator"))) return;
  const { data, error } = await context.supabase
    .from("employee_kpi_assignments")
    .select("user_id")
    .eq("user_id", context.userId)
    .eq("active", true)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Forbidden");
}
async function checkAdminOrModerator(context: any) {
  if ((await hasRole(context, "admin")) || (await hasRole(context, "moderator"))) return;
  throw new Error("Forbidden");
}

export const listSalesLeads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await checkLeadOperator(context);
    const { data, error } = await (context.supabase as any)
      .from("sales_leads")
      .select("*,lead_activities(*),lead_samples(*)")
      .order("next_follow_up_at", { ascending: true, nullsFirst: false });
    if (error) throw error;
    return data ?? [];
  });

export const getSalesLeadBootstrap = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await checkLeadOperator(context);
    const [profiles, clients, branches, products] = await Promise.all([
      (context.supabase as any).from("profiles").select("id,full_name,email").order("full_name"),
      (context.supabase as any)
        .from("clients")
        .select("id,legal_name,client_code")
        .order("legal_name"),
      (context.supabase as any)
        .from("branches")
        .select("id,client_id,branch_name")
        .order("branch_name"),
      (context.supabase as any).from("products").select("id,name").eq("active", true).order("name"),
    ]);
    for (const result of [profiles, clients, branches, products])
      if (result.error) throw result.error;
    return {
      profiles: profiles.data ?? [],
      clients: clients.data ?? [],
      branches: branches.data ?? [],
      products: products.data ?? [],
    };
  });

export const createSalesLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => leadInput.parse(data))
  .handler(async ({ data, context }) => {
    await checkLeadOperator(context);
    const { data: result, error } = await (context.supabase as any)
      .from("sales_leads")
      .insert({
        ...data,
        email: data.email || null,
        created_by: context.userId,
        assigned_to: data.assigned_to ?? context.userId,
      })
      .select("id")
      .single();
    if (error) throw error;
    return result;
  });

export const logLeadActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => activityInput.parse(data))
  .handler(async ({ data, context }) => {
    await checkLeadOperator(context);
    const { data: lead, error: leadError } = await (context.supabase as any)
      .from("sales_leads")
      .select("id,status")
      .eq("id", data.lead_id)
      .single();
    if (leadError) throw leadError;
    const { error } = await (context.supabase as any)
      .from("lead_activities")
      .insert({ ...data, performed_by: context.userId });
    if (error) throw error;
    const { error: updateError } = await (context.supabase as any)
      .from("sales_leads")
      .update({
        status: suggestedStatusForActivity(data.activity_type, lead.status),
        last_contact_at: new Date().toISOString(),
        next_follow_up_at: data.next_follow_up_at ?? null,
      })
      .eq("id", data.lead_id);
    if (updateError) throw updateError;
  });

export const saveLeadSample = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => sampleInput.parse(data))
  .handler(async ({ data, context }) => {
    await checkAdminOrModerator(context);
    const now = new Date().toISOString();
    const sampleRow = {
      ...data,
      sent_at: data.status === "sent" ? now : null,
      delivered_at: data.status === "delivered" ? now : null,
      created_by: context.userId,
    };
    const { error } = await (context.supabase as any).from("lead_samples").insert(sampleRow);
    if (error) throw error;
    const status =
      data.status === "planned"
        ? "sample_planned"
        : data.status === "sent" || data.status === "delivered"
          ? "sample_sent"
          : "follow_up";
    const { error: updateError } = await (context.supabase as any)
      .from("sales_leads")
      .update({ status, next_follow_up_at: data.follow_up_due_at ?? null })
      .eq("id", data.lead_id);
    if (updateError) throw updateError;
  });

export const updateSalesLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) =>
    z
      .object({
        lead_id: z.string().uuid(),
        status: z.enum(leadStatuses),
        next_follow_up_at: timestamp,
        notes: optionalText,
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await checkLeadOperator(context);
    const { lead_id, ...update } = data;
    const { error } = await (context.supabase as any)
      .from("sales_leads")
      .update(update)
      .eq("id", lead_id);
    if (error) throw error;
  });

export const convertSalesLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) =>
    z
      .object({
        lead_id: z.string().uuid(),
        client_id: z.string().uuid(),
        branch_id: z.string().uuid().nullable().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await checkAdminOrModerator(context);
    if (data.branch_id) {
      const { data: branch, error: branchError } = await (context.supabase as any)
        .from("branches")
        .select("id")
        .eq("id", data.branch_id)
        .eq("client_id", data.client_id)
        .maybeSingle();
      if (branchError) throw branchError;
      if (!branch) throw new Error("Selected branch does not belong to the selected client");
    }
    const { error } = await (context.supabase as any)
      .from("sales_leads")
      .update({
        status: "converted",
        converted_client_id: data.client_id,
        converted_branch_id: data.branch_id ?? null,
        next_follow_up_at: null,
      })
      .eq("id", data.lead_id);
    if (error) throw error;
  });
