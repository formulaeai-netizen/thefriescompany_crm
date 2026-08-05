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

const salaryIdSchema = z.object({ salary_id: z.string().uuid() });

/**
 * Marking a salary paid is the only action that makes it subtract from
 * Cash in Hand (via get_cash_in_hand_summary()'s paid_salaries_total). No
 * expense row is created and nothing is subtracted directly in the UI -
 * the dashboard picks up the change purely by re-fetching the shared
 * summary after this mutation succeeds.
 */
export const markSalaryPaid = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => salaryIdSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await (context.supabase as any).rpc("mark_salary_paid", {
      _salary_id: data.salary_id,
    });
    if (error) throw new Error(`Marking salary paid failed: ${error.message}`);
    return { ok: true };
  });
