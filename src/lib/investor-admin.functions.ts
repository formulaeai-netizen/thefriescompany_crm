import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const inviteSchema = z.object({
  investorId: z.string().uuid(),
  email: z.string().email(),
});

/**
 * Admin-only: invite an existing investor row by email (magic link),
 * then assign the 'investor' role to the newly-created auth user.
 */
export const inviteInvestor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => inviteSchema.parse(d))
  .handler(async ({ data, context }) => {
    // Verify caller is admin
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleErr) throw new Error(`Role check failed: ${roleErr.message}`);
    if (!isAdmin) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Send invite (creates auth user if missing)
    let userId: string | undefined;
    const invite = await supabaseAdmin.auth.admin.inviteUserByEmail(data.email);
    if (invite.error) {
      // If user already exists, look them up
      const list = await supabaseAdmin.auth.admin.listUsers();
      const existing = list.data?.users.find((u) => u.email?.toLowerCase() === data.email.toLowerCase());
      if (!existing) throw new Error(invite.error.message);
      userId = existing.id;
    } else {
      userId = invite.data.user?.id;
    }
    if (!userId) throw new Error("Could not resolve auth user id");

    // Assign investor role (idempotent)
    const { error: roleInsErr } = await (supabaseAdmin as any)
      .from("user_roles")
      .upsert({ user_id: userId, role: "investor" }, { onConflict: "user_id,role" });
    if (roleInsErr) throw new Error(`Role assignment failed: ${roleInsErr.message}`);

    return { ok: true, userId, alreadyExisted: !!invite.error };
  });

const calcSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // first-of-month date
  netProfit: z.number(),
});

/**
 * Admin-only: compute & upsert this month's investor_returns rows for all
 * active investors, using a provided net profit figure.
 */
export const calcMonthlyReturns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => calcSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const { data: investors, error } = await context.supabase
      .from("investors")
      .select("id, roi_percentage, status");
    if (error) throw new Error(error.message);

    const rows = (investors ?? [])
      .filter((i: any) => i.status === "Active")
      .map((i: any) => {
        const ret = data.netProfit > 0 ? (Number(data.netProfit) * Number(i.roi_percentage)) / 100 : 0;
        return {
          investor_id: i.id,
          month: data.month,
          net_profit: data.netProfit,
          return_amount: ret,
          return_percentage: Number(i.roi_percentage),
          paid: false,
        };
      });

    if (rows.length === 0) return { ok: true, inserted: 0 };

    const { error: upErr } = await (context.supabase as any)
      .from("investor_returns")
      .upsert(rows, { onConflict: "investor_id,month" });
    if (upErr) throw new Error(upErr.message);

    return { ok: true, inserted: rows.length };
  });