// payment-status-webhook
// Called from the frontend when an invoice payment_status is set to "Done".
// Sends a "Payment Confirmed" WhatsApp to the client and logs it.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  corsHeaders,
  authorizeRequest,
  requireStaffOrAdmin,
  pkr,
  sendWhatsApp,
  twilioFromSettings,
} from "../_shared/twilio.ts";

interface Body {
  invoice_id?: string;
  test?: boolean;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await authorizeRequest(req);
  if (!auth.ok) return auth.response;
  const roleCheck = await requireStaffOrAdmin(auth.userId);
  if (!roleCheck.ok) return roleCheck.response;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: settings } = await supabase
      .from("settings")
      .select("*")
      .limit(1)
      .single();
    const twilio = twilioFromSettings(settings);

    const body: Body = await req.json().catch(() => ({}));

    // Test mode: send a dummy confirmation to the sales rep.
    if (body.test || !body.invoice_id) {
      const to = settings?.sales_rep_phone;
      if (!to) throw new Error("sales_rep_phone not set — cannot run test");
      const msg =
        `Hi Test User,\n\n` +
        `Thank you! Payment of ${pkr(12345)} received for TFC-TEST.\n` +
        `Your account is now up to date.\n\n— The Fries Company`;
      const r = await sendWhatsApp(twilio, to, msg);
      return new Response(
        JSON.stringify({ ok: r.ok, test: true, error: r.error }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: inv, error } = await supabase
      .from("invoices")
      .select(
        "id, invoice_no, amount, payment_status, client_id, clients(id, legal_name, primary_contact, phone)",
      )
      .eq("id", body.invoice_id)
      .single();
    if (error) throw error;
    if ((inv as any).payment_status !== "Done") {
      return new Response(
        JSON.stringify({ ok: false, skipped: "invoice_not_paid" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const client = (inv as any).clients;
    if (!client?.phone) {
      return new Response(
        JSON.stringify({ ok: false, skipped: "client_has_no_phone" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const msg =
      `Hi ${client.primary_contact ?? client.legal_name},\n\n` +
      `Thank you! Payment of ${pkr(inv.amount)} received for ${inv.invoice_no}.\n` +
      `Your account is now up to date.\n\n— The Fries Company`;

    const r = await sendWhatsApp(twilio, client.phone, msg);

    await supabase.from("whatsapp_logs").insert({
      invoice_id: inv.id,
      client_id: client.id,
      channel: "whatsapp",
      message: msg,
      status: r.ok ? "sent" : "failed",
      sent_at: new Date().toISOString(),
    }).then(() => {}, () => {});

    return new Response(
      JSON.stringify({ ok: r.ok, invoice: inv.invoice_no, error: r.error }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[payment-status-webhook]", e);
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});