// Daily payment-reminder agent.
// Schedule via pg_cron at 04:00 UTC (09:00 PKT) — see docs/migrations/pg-cron-agents.sql.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  corsHeaders,
  daysBetween,
  authorizeRequest,
  requireStaffOrAdmin,
  pkr,
  sendEmail,
  todayPKT,
} from "../_shared/twilio.ts";
import { metaFromSettings, sendMetaWhatsApp } from "../_shared/meta.ts";

interface InvoiceRow {
  id: string;
  invoice_no: string | null;
  amount: number;
  date: string;
  due_date: string | null;
  payment_status: string;
  is_deleted: boolean | null;
  last_reminder_sent: string | null;
  total_reminders_sent: number | null;
  client_id: string;
  clients: {
    id: string;
    legal_name: string;
    primary_contact: string | null;
    phone: string | null;
    email: string | null;
    reminders_paused: boolean | null;
  } | null;
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

    const today = todayPKT();

    // 1. Pull settings (creds + sales rep info)
    const { data: settings } = await supabase
      .from("settings")
      .select("*")
      .limit(1)
      .single();

    const meta = metaFromSettings(settings);
    const resendKey = settings?.resend_api_key as string | null | undefined;

    const isManual = req.headers.get("x-manual-trigger") === "true" ||
      (await req.json().catch(() => ({}))).manual === true;
    if (!isManual && !settings?.auto_reminders_enabled) {
      return new Response(
        JSON.stringify({ skipped: true, reason: "auto_reminders_enabled is off" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const salesRepName = settings?.sales_rep_name ?? "Sales Team";
    const salesRepPhone = settings?.sales_rep_phone ?? "";

    // 2. Pull unpaid, non-deleted invoices with client info
    const { data: invoices, error } = await supabase
      .from("invoices")
      .select(
        "id, invoice_no, amount, date, due_date, payment_status, is_deleted, last_reminder_sent, total_reminders_sent, client_id, clients(id, legal_name, primary_contact, phone, email, reminders_paused)",
      )
      .eq("payment_status", "Not Done")
      .or("is_deleted.is.null,is_deleted.eq.false");
    if (error) throw error;

    const results: Array<Record<string, unknown>> = [];

    // Group unpaid invoices by client for weekly follow-ups
    const byClient = new Map<string, InvoiceRow[]>();
    for (const inv of (invoices ?? []) as InvoiceRow[]) {
      const list = byClient.get(inv.client_id) ?? [];
      list.push(inv);
      byClient.set(inv.client_id, list);
    }

    for (const inv of (invoices ?? []) as InvoiceRow[]) {
      const client = inv.clients;
      if (!client) continue;
      if (client.reminders_paused) {
        results.push({ invoice: inv.invoice_no, skipped: "reminders_paused" });
        continue;
      }
      if (inv.last_reminder_sent === today) {
        results.push({ invoice: inv.invoice_no, skipped: "already_sent_today" });
        continue;
      }
      const dueDate = inv.due_date ?? inv.date;
      const overdue = daysBetween(dueDate, today);
      if (overdue < 15) continue;

      const isDay15 = overdue === 15;
      const isWeekly = overdue > 15 && (overdue - 15) % 7 === 0;
      if (!isDay15 && !isWeekly) continue;

      let body = "";
      let type = "";
      if (isDay15) {
        type = "day_15";
        body =
          `Hello ${client.primary_contact ?? client.legal_name},\n\n` +
          `This is a payment reminder from The Fries Company.\n\n` +
          `Invoice No: ${inv.invoice_no}\n` +
          `Client: ${client.legal_name}\n` +
          `Amount: ${pkr(inv.amount)}\n` +
          `Invoice Date: ${inv.date}\n` +
          `Days Overdue: 15 days\n\n` +
          `Kindly clear the payment at your earliest convenience.\n` +
          `For queries contact ${salesRepName}: ${salesRepPhone}\n\n` +
          `Thank you.\n— The Fries Company`;
      } else {
        type = `weekly_${overdue}`;
        const list = (byClient.get(inv.client_id) ?? []).filter((i) =>
          daysBetween(i.due_date ?? i.date, today) >= 15
        );
        const total = list.reduce((s, i) => s + Number(i.amount ?? 0), 0);
        const lines = list.map((i) =>
          `- ${i.invoice_no} ${pkr(i.amount)} (${
            daysBetween(i.due_date ?? i.date, today)
          } days overdue)`
        ).join("\n");
        body =
          `Hello ${client.primary_contact ?? client.legal_name},\n\n` +
          `Following up on our previous reminder.\n\n` +
          `Outstanding invoices:\n${lines}\n\n` +
          `Total Outstanding: ${pkr(total)}\n\n` +
          `Contact: ${salesRepName} ${salesRepPhone}\n— The Fries Company`;
      }

      // Send WhatsApp to client
      let waResult: { ok: boolean; error?: string } = { ok: false, error: "no phone" };
      if (client.phone) {
        waResult = await sendMetaWhatsApp(meta, client.phone, body);
      }

      // Email to client
      let emailResult: { ok: boolean; error?: string } = { ok: false, error: "no email" };
      if (client.email) {
        emailResult = await sendEmail(
          resendKey,
          client.email,
          `Payment Reminder — Invoice ${inv.invoice_no}`,
          `<pre style="font-family:Arial,sans-serif;white-space:pre-wrap">${body}</pre>`,
        );
      }

      // Sales rep alert on day 15
      if (isDay15 && salesRepPhone) {
        const alert =
          `Action Required — ${client.legal_name}\n` +
          `Invoice ${inv.invoice_no} of ${pkr(inv.amount)} is 15 days overdue.\n` +
          `Reminder sent to ${client.primary_contact ?? "client"} at ${client.phone ?? "—"}.\n` +
          `Please follow up personally today.\n— The Fries Company CRM`;
        await sendMetaWhatsApp(meta, salesRepPhone, alert);
      }

      // Update invoice
      await supabase
        .from("invoices")
        .update({
          last_reminder_sent: today,
          last_reminder_type: type,
          total_reminders_sent: (inv.total_reminders_sent ?? 0) + 1,
          reminder_sent: true,
          reminder_sent_at: new Date().toISOString(),
        })
        .eq("id", inv.id);

      // Optional log
      await supabase.from("whatsapp_logs").insert({
        invoice_id: inv.id,
        client_id: client.id,
        channel: "whatsapp",
        message: body,
        status: waResult.ok ? "sent" : "failed",
        sent_at: new Date().toISOString(),
      }).then(() => {}, () => {});

      results.push({
        invoice: inv.invoice_no,
        type,
        whatsapp: waResult.ok,
        email: emailResult.ok,
        overdue,
      });
    }

    return new Response(
      JSON.stringify({ ok: true, today, processed: results.length, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[payment-reminder-agent]", e);
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});