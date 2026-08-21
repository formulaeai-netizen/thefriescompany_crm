import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const orderInput = z.object({
  branch_id: z.string().uuid(),
  requested_delivery_date: z.string().date(),
  customer_notes: z.string().trim().max(2000).nullable().optional(),
  items: z
    .array(
      z.object({
        product_id: z.string().uuid(),
        quantity: z.number().positive(),
        unit: z.string().trim().min(1).max(40),
      }),
    )
    .min(1),
});

export type CustomerPortalOrderDraft = z.infer<typeof orderInput>;
export type CustomerPortalOrderFieldErrors = Partial<
  Record<"branch_id" | "requested_delivery_date" | "items", string>
>;

export function validateCustomerPortalOrderDraft(
  data: Partial<CustomerPortalOrderDraft>,
): CustomerPortalOrderFieldErrors {
  const errors: CustomerPortalOrderFieldErrors = {};
  if (!data.branch_id) errors.branch_id = "Choose a branch.";

  if (!data.requested_delivery_date) {
    errors.requested_delivery_date = "Choose a requested delivery date.";
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(data.requested_delivery_date)) {
    errors.requested_delivery_date = "Enter a valid delivery date.";
  } else if (data.requested_delivery_date < new Date().toISOString().slice(0, 10)) {
    errors.requested_delivery_date = "Choose today or a future delivery date.";
  }

  if (!data.items?.some((item) => Number(item.quantity) > 0)) {
    errors.items = "Enter a quantity greater than zero for at least one product.";
  }
  return errors;
}

export const getCustomerPortal = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await (context.supabase as any).rpc("get_customer_portal_data");
    if (error) throw new Error("Customer portal is unavailable.");
    return data;
  });

export const createCustomerPortalOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => orderInput.parse(data))
  .handler(async ({ data, context }) => {
    const validationErrors = validateCustomerPortalOrderDraft(data);
    if (Object.keys(validationErrors).length > 0) {
      throw new Error(Object.values(validationErrors)[0]);
    }
    const { data: id, error } = await (context.supabase as any).rpc(
      "create_customer_portal_order",
      {
        _branch_id: data.branch_id,
        _requested_delivery_date: data.requested_delivery_date,
        _customer_notes: data.customer_notes ?? null,
        _items: data.items,
        _external_source_key: null,
      },
    );
    if (error) throw new Error("Order could not be created. Check your branch and items.");
    return { id };
  });
