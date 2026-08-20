import { z } from "zod";

const expenseSchema = z.object({
  item: z.string().trim().min(1, "Item is required"),
  price: z.number().positive("Price must be positive"),
  date: z.string().min(1),
  category: z.string().nullable().optional(),
  subcategory: z.string().nullable().optional(),
  added_by: z.string().nullable().optional(),
});

export const expenseCreateInputSchema = expenseSchema.extend({
  paid_from_account_id: z.string().uuid(),
});

export type ExpenseCreateInput = z.infer<typeof expenseCreateInputSchema>;

export function validateExpenseCreateInput(input: unknown): ExpenseCreateInput {
  return expenseCreateInputSchema.parse(input);
}
