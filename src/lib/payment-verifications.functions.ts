import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const requestIdSchema = z.object({
  request_id: z.string().uuid(),
});

const approveRequestSchema = requestIdSchema.extend({
  selected_invoice_id: z.string().uuid().nullable().optional(),
});

async function assertAdmin(ctx: any) {
  const { data: isAdmin, error } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });

  if (error) throw new Error(`Role check failed: ${error.message}`);
  if (!isAdmin) throw new Error("Forbidden");
}

export const listPaymentVerificationRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { data, error } = await (context.supabase as any)
      .from("payment_verification_requests")
      .select(
        "id, client_id, invoice_id, sender_phone, incoming_message, storage_path, media_mimetype, media_filename, media_size_bytes, status, reviewed_at, created_at, claimed_amount, parsed_invoice_reference, inbound_message_id, normalized_sender_phone, normalized_command, rejection_reason, approved_cash_entry_id, clients(legal_name), invoices(invoice_no, amount, amount_received, payment_status), cash_ledger_entries!payment_verification_requests_approved_cash_entry_id_fkey(id, amount, created_at)",
      )
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      if (error.code === "42P01") return { migration_required: true, rows: [] };
      throw new Error(`Payment verification requests load failed: ${error.message}`);
    }

    const rows = data ?? [];
    const clientIds = [...new Set(rows.map((row: any) => row.client_id).filter(Boolean))];
    const unpaidInvoicesByClient: Record<string, any[]> = {};

    if (clientIds.length > 0) {
      const { data: invoices, error: invoicesError } = await (context.supabase as any)
        .from("invoices")
        .select(
          "id, client_id, invoice_no, due_date, amount, amount_received, payment_status, is_deleted",
        )
        .in("client_id", clientIds)
        .neq("payment_status", "Done")
        .or("is_deleted.is.null,is_deleted.eq.false")
        .order("due_date", { ascending: true, nullsFirst: false });

      if (invoicesError) {
        throw new Error(`Unpaid invoice list load failed: ${invoicesError.message}`);
      }

      for (const invoice of invoices ?? []) {
        if (!invoice.client_id) continue;
        unpaidInvoicesByClient[invoice.client_id] ??= [];
        unpaidInvoicesByClient[invoice.client_id].push(invoice);
      }
    }

    return { migration_required: false, rows, unpaidInvoicesByClient };
  });

export const approvePaymentVerificationRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => approveRequestSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await (context.supabase as any).rpc("approve_payment_verification_request", {
      _request_id: data.request_id,
      _selected_invoice_id: data.selected_invoice_id ?? null,
    });
    if (error) throw new Error(`Payment verification approval failed: ${error.message}`);
    return { ok: true };
  });

const rejectRequestSchema = requestIdSchema.extend({
  reason: z.string().trim().min(1, "A rejection reason is required"),
});

export const rejectPaymentVerificationRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => rejectRequestSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await (context.supabase as any).rpc("reject_payment_verification_request", {
      _request_id: data.request_id,
      _reason: data.reason,
    });
    if (error) throw new Error(`Payment verification rejection failed: ${error.message}`);
    return { ok: true };
  });
