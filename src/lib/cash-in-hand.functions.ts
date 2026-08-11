import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type ServerContext = { supabase: any; userId: string };

async function assertAdmin(ctx: ServerContext) {
  const { data: isAdmin, error } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (error) throw new Error(`Role check failed: ${error.message}`);
  if (!isAdmin) throw new Error("Forbidden");
}

/**
 * Single shared source for Cash in Hand, backed by Prompt 2's
 * get_cash_in_hand_summary() RPC. The dashboard and P&L page both call
 * this instead of each computing their own literal formula, so the two
 * pages can never silently drift apart.
 */
export const getCashInHandSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { data, error } = await (context.supabase as any).rpc("get_cash_in_hand_summary");
    if (error) throw new Error(`Cash in hand summary failed: ${error.message}`);
    const row = Array.isArray(data) ? data[0] : data;
    return {
      opening_balance: Number(row?.opening_balance ?? 0),
      client_payment_credits: Number(row?.client_payment_credits ?? 0),
      expenses_total: Number(row?.expenses_total ?? 0),
      inventory_purchases_paid_total: Number(row?.inventory_purchases_paid_total ?? 0),
      paid_salaries_total: Number(row?.paid_salaries_total ?? 0),
      salary_advances_paid_total: Number(row?.salary_advances_paid_total ?? 0),
      adjustments_total: Number(row?.adjustments_total ?? 0),
      cash_in_hand: Number(row?.cash_in_hand ?? 0),
    };
  });

export const getCashOpeningBalanceInfo = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { data, error } = await (context.supabase as any)
      .from("cash_settings")
      .select("opening_balance, effective_at, reason, updated_at, updated_by")
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`Opening balance load failed: ${error.message}`);

    let updatedByName: string | null = null;
    if (data?.updated_by) {
      const { data: profile } = await (context.supabase as any)
        .from("profiles")
        .select("full_name, email")
        .eq("id", data.updated_by)
        .maybeSingle();
      updatedByName = profile?.full_name || profile?.email || null;
    }

    return {
      opening_balance: Number(data?.opening_balance ?? 0),
      effective_at: data?.effective_at ?? null,
      reason: data?.reason ?? null,
      updated_at: data?.updated_at ?? null,
      updated_by_name: updatedByName,
    };
  });

const setOpeningBalanceSchema = z.object({
  opening_balance: z.number().finite(),
  effective_at: z.string().datetime().optional(),
  reason: z.string().trim().max(500).optional(),
});

export const setCashOpeningBalance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => setOpeningBalanceSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await (context.supabase as any).rpc("set_cash_opening_balance", {
      _opening_balance: data.opening_balance,
      _effective_at: data.effective_at ?? new Date().toISOString(),
      _reason: data.reason || null,
    });
    if (error) throw new Error(`Opening balance update failed: ${error.message}`);
    return { ok: true };
  });
