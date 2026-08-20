import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { validateExpenseCreateInput } from "@/lib/expenses";

type ServerContext = { supabase: any; userId: string };

async function assertAdmin(ctx: ServerContext) {
  const { data: isAdmin, error } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (error) throw new Error(`Role check failed: ${error.message}`);
  if (!isAdmin) throw new Error("Forbidden");
}

const expenseSchema = z.object({
  item: z.string().trim().min(1, "Item is required"),
  price: z.number().positive("Price must be positive"),
  date: z.string().min(1),
  category: z.string().nullable().optional(),
  subcategory: z.string().nullable().optional(),
  added_by: z.string().nullable().optional(),
});

export const createExpense = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(validateExpenseCreateInput)
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { data: id, error } = await (context.supabase as any).rpc("create_expense", {
      _item: data.item,
      _price: data.price,
      _date: data.date,
      _category: data.category ?? null,
      _subcategory: data.subcategory ?? null,
      _added_by: data.added_by ?? null,
      _paid_from_account_id: data.paid_from_account_id,
    });
    if (error) throw new Error(`Expense creation failed: ${error.message}`);
    return { ok: true, id };
  });

export const updateExpense = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => expenseSchema.extend({ expense_id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await (context.supabase as any).rpc("update_expense", {
      _expense_id: data.expense_id,
      _item: data.item,
      _price: data.price,
      _date: data.date,
      _category: data.category ?? null,
      _subcategory: data.subcategory ?? null,
      _added_by: data.added_by ?? null,
    });
    if (error) throw new Error(`Expense update failed: ${error.message}`);
    return { ok: true };
  });

export const deleteExpense = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => z.object({ expense_id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await (context.supabase as any).rpc("delete_expense", {
      _expense_id: data.expense_id,
    });
    if (error) throw new Error(`Expense delete failed: ${error.message}`);
    return { ok: true };
  });
