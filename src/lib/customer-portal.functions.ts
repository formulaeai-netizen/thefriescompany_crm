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
